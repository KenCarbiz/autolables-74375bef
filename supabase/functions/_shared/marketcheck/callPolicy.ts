// MarketCheck call policy: the owner's switch and scope rules (2026-11-12),
// checked in admitProviderCall before the database budget gates.
//
//   MARKETCHECK_MODE             off (default) | primary_only | unrestricted
//                                off refuses every MarketCheck call, including
//                                the nightly feed. unrestricted is the behavior
//                                before this policy existed.
//   MARKETCHECK_MONTHLY_LIMIT    billable calls per UTC month before every
//                                non-essential call is refused (default 3000,
//                                under the 5,000-call plan).
//   MARKETCHECK_VIN_TTL_HOURS    one billable call per VIN per product inside
//                                this window (default 168). A visit's own
//                                follow-up requests inside REPEAT_GRACE_MS pass.
//   MARKETCHECK_SCHEDULED_REFRESH  true lets the self-chaining enrich and specs
//                                sweeps run; anything else stops them.
//
// primary_only admits a VIN call only for the tenant's own unarchived listing,
// and only for the group's primary inventory store when the listing belongs to
// a store. The intake decode of a VIN not listed yet is the one exception.

export type MarketcheckMode = "off" | "primary_only" | "unrestricted";

export interface CallPolicyConfig {
  mode: MarketcheckMode;
  monthlyLimit: number;
  vinTtlHours: number;
  scheduledRefresh: boolean;
}

export type PolicyRefusal =
  | "kill_switch" | "no_tenant" | "not_tenant_inventory" | "archived" | "not_primary_store"
  | "vin_repeat_window" | "monthly_limit" | "policy_unavailable";

export const REPEAT_GRACE_MS = 10 * 60 * 1000;
export const DEFAULT_MONTHLY_LIMIT = 3000;
export const DEFAULT_VIN_TTL_HOURS = 168;
export const INTAKE_DECODE_PRODUCTS: readonly string[] = ["neovin", "basic_vin_decode"];
export const BILLABLE_OUTCOMES: readonly string[] = ["admitted", "ok", "no_result", "provider_error", "transport_error"];

type EnvGet = (key: string) => string | undefined;

export function envGet(): EnvGet {
  const deno = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
  if (deno?.env?.get) return (k) => deno.env!.get(k);
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return (k) => proc?.env?.[k];
}

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function readCallPolicy(get: EnvGet = envGet()): CallPolicyConfig {
  const raw = (get("MARKETCHECK_MODE") || "").trim().toLowerCase();
  const mode: MarketcheckMode = raw === "primary_only" || raw === "unrestricted" ? raw : "off";
  return {
    mode,
    monthlyLimit: positiveInt(get("MARKETCHECK_MONTHLY_LIMIT"), DEFAULT_MONTHLY_LIMIT),
    vinTtlHours: positiveInt(get("MARKETCHECK_VIN_TTL_HOURS"), DEFAULT_VIN_TTL_HOURS),
    scheduledRefresh: (get("MARKETCHECK_SCHEDULED_REFRESH") || "").trim().toLowerCase() === "true",
  };
}

export interface ScopeFacts {
  listing: { archived: boolean; storeId: string | null } | null;
  storeIsPrimary: boolean | null;
  lastBillableAtMs: number | null;
  monthBillable: number;
}

export interface PolicyInput {
  config: CallPolicyConfig;
  essential: boolean;
  tenantId: string | null;
  vin: string | null;
  product: string;
  nowMs: number;
}

export type PolicyDecision = { admitted: true } | { admitted: false; reason: PolicyRefusal };

// Pure: the rule, given what the database said.
export function decideCallPolicy(input: PolicyInput, facts: ScopeFacts | null): PolicyDecision {
  const { config } = input;
  if (config.mode === "unrestricted") return { admitted: true };
  if (config.mode === "off") return { admitted: false, reason: "kill_switch" };
  if (!input.tenantId) return { admitted: false, reason: "no_tenant" };
  if (!facts) return { admitted: false, reason: "policy_unavailable" };
  if (input.vin) {
    if (!facts.listing) {
      if (!INTAKE_DECODE_PRODUCTS.includes(input.product)) return { admitted: false, reason: "not_tenant_inventory" };
    } else {
      if (facts.listing.archived) return { admitted: false, reason: "archived" };
      if (facts.listing.storeId && facts.storeIsPrimary !== true) return { admitted: false, reason: "not_primary_store" };
    }
    if (!input.essential && facts.lastBillableAtMs != null) {
      const age = input.nowMs - facts.lastBillableAtMs;
      if (age >= REPEAT_GRACE_MS && age < config.vinTtlHours * 3600_000) return { admitted: false, reason: "vin_repeat_window" };
    }
  }
  if (!input.essential && facts.monthBillable >= config.monthlyLimit) return { admitted: false, reason: "monthly_limit" };
  return { admitted: true };
}

// deno-lint-ignore no-explicit-any
export type QueryClient = { from: (table: string) => any };

const monthStartIso = (nowMs: number): string => {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

// Reads the facts the rule needs. Any read error returns null, which refuses.
export async function loadScopeFacts(db: QueryClient, input: Omit<PolicyInput, "config"> & { vinTtlHours: number }): Promise<ScopeFacts | null> {
  try {
    const month = await db.from("provider_call_events")
      .select("id", { count: "exact", head: true })
      .eq("provider", "marketcheck").in("outcome", BILLABLE_OUTCOMES as string[]).gte("at", monthStartIso(input.nowMs));
    if (month.error || typeof month.count !== "number") return null;
    const facts: ScopeFacts = { listing: null, storeIsPrimary: null, lastBillableAtMs: null, monthBillable: month.count };
    if (!input.vin || !input.tenantId) return facts;

    const listing = await db.from("vehicle_listings")
      .select("archived_at, owning_store_id")
      .eq("tenant_id", input.tenantId).eq("vin", input.vin).limit(1);
    if (listing.error) return null;
    const row = (listing.data ?? [])[0] as { archived_at?: string | null; owning_store_id?: string | null } | undefined;
    if (row) {
      facts.listing = { archived: !!row.archived_at, storeId: row.owning_store_id ?? null };
      if (facts.listing.storeId) {
        const store = await db.from("dealer_stores").select("is_primary_inventory_store").eq("id", facts.listing.storeId).limit(1);
        if (store.error) return null;
        facts.storeIsPrimary = ((store.data ?? [])[0] as { is_primary_inventory_store?: boolean } | undefined)?.is_primary_inventory_store === true;
      }
    }

    const since = new Date(input.nowMs - input.vinTtlHours * 3600_000).toISOString();
    const last = await db.from("provider_call_events")
      .select("at")
      .eq("provider", "marketcheck").eq("tenant_id", input.tenantId).eq("vin", input.vin).eq("product", input.product)
      .in("outcome", BILLABLE_OUTCOMES as string[]).gte("at", since)
      .lte("at", new Date(input.nowMs - REPEAT_GRACE_MS).toISOString())
      .order("at", { ascending: false }).limit(1);
    if (last.error) return null;
    const at = ((last.data ?? [])[0] as { at?: string } | undefined)?.at;
    facts.lastBillableAtMs = at ? Date.parse(at) : null;
    return facts;
  } catch {
    return null;
  }
}

export const normalizeVin = (vin: string | null | undefined): string | null => {
  const v = (vin ?? "").trim().toUpperCase();
  return v ? v : null;
};

export async function checkCallPolicy(
  db: Partial<QueryClient> | null | undefined,
  a: { caller: string; essential: boolean; tenantId: string | null; vin: string | null; product: string },
  config: CallPolicyConfig = readCallPolicy(),
  nowMs: number = Date.now(),
): Promise<PolicyDecision> {
  const input: PolicyInput = { config, essential: a.essential, tenantId: a.tenantId, vin: normalizeVin(a.vin), product: a.product, nowMs };
  let decision: PolicyDecision;
  if (config.mode !== "primary_only" || !input.tenantId) {
    decision = decideCallPolicy(input, null);
  } else {
    const facts = typeof db?.from === "function"
      ? await loadScopeFacts(db as QueryClient, { ...input, vinTtlHours: config.vinTtlHours })
      : null;
    decision = decideCallPolicy(input, facts);
  }
  if (!decision.admitted) {
    const vinTail = input.vin ? `...${input.vin.slice(-6)}` : "-";
    console.warn(`marketcheck policy refused ${a.product} for ${a.caller}: ${decision.reason} (mode ${config.mode}, tenant ${input.tenantId ?? "-"}, vin ${vinTail})`);
  }
  return decision;
}
