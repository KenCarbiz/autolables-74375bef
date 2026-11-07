// Per-store MarketCheck data controls and the monthly call plan.
//
// Each data category maps onto the billing products that the store gate
// (store_enrichment_admit) already enforces, so a switch here is only ever a
// view of store_enrichment_policies.allowed_products. A category with no
// store-level product behind it is shown as unavailable, never as a switch
// that does nothing. Inventory visibility is not a paid product: it comes from
// the store's feed and sharing settings and is independent of enrichment.

import { ENRICHMENT_PRODUCTS, type EnrichmentProduct } from "@/lib/inventoryNetwork/api";

export type CategoryId =
  | "inventory_visibility"
  | "marketcheck_inventory_sync"
  | "neovin_specs"
  | "market_value_comps"
  | "vehicle_history"
  | "market_days_supply"
  | "recalls"
  | "oem_incentives"
  | "factory_window_sticker";

export interface DataCategory {
  id: CategoryId;
  label: string;
  products: readonly EnrichmentProduct[];
  /** Child-store default from the owner's spec. */
  childDefault: "on_for_approved" | "configurable" | "off_until_enabled";
  paid: boolean;
  /** Why the category has no store-level switch, when it has none. */
  unavailableReason?: string;
}

export const DATA_CATEGORIES: readonly DataCategory[] = [
  { id: "inventory_visibility", label: "Inventory visibility", products: [], childDefault: "on_for_approved", paid: false },
  {
    id: "marketcheck_inventory_sync", label: "MarketCheck inventory synchronization", products: [], childDefault: "configurable", paid: true,
    unavailableReason: "Dealer syndication is configured per account today (one pinned rooftop). A per-store syndication switch needs that store's verified MarketCheck rooftop id first.",
  },
  { id: "neovin_specs", label: "NeoVIN specifications and equipment", products: ["neovin"], childDefault: "off_until_enabled", paid: true },
  { id: "market_value_comps", label: "Market Value and comparable vehicles", products: ["price_prediction", "inventory_search"], childDefault: "off_until_enabled", paid: true },
  { id: "vehicle_history", label: "Vehicle history / market history", products: ["vin_history"], childDefault: "off_until_enabled", paid: true },
  { id: "market_days_supply", label: "Market Days Supply and market trends", products: ["market_days_supply", "sales_stats", "recent_inventory"], childDefault: "off_until_enabled", paid: true },
  { id: "recalls", label: "Recall information", products: ["auto_recalls"], childDefault: "configurable", paid: true },
  {
    id: "oem_incentives", label: "OEM incentives", products: [], childDefault: "off_until_enabled", paid: true,
    unavailableReason: "OEM incentives are not a store-level product in the provider catalog, so there is nothing to switch per store.",
  },
  {
    id: "factory_window_sticker", label: "Factory window-sticker data", products: [], childDefault: "off_until_enabled", paid: true,
    unavailableReason: "Factory window-sticker data is not a MarketCheck store-level product, so there is nothing to switch per store.",
  },
];

export type CategoryState = "on" | "off" | "partial" | "unavailable";

export function isSwitchable(c: DataCategory): boolean {
  return c.paid && c.products.length > 0 && c.products.every((p) => (ENRICHMENT_PRODUCTS as readonly string[]).includes(p));
}

export function categoryState(c: DataCategory, allowedProducts: readonly string[]): CategoryState {
  if (!isSwitchable(c)) return "unavailable";
  const on = c.products.filter((p) => allowedProducts.includes(p)).length;
  return on === 0 ? "off" : on === c.products.length ? "on" : "partial";
}

/** Applies one category switch to a policy's allowed_products, leaving every other product as it was. */
export function setCategory(allowedProducts: readonly string[], id: CategoryId, on: boolean): string[] {
  const c = DATA_CATEGORIES.find((x) => x.id === id);
  if (!c || !isSwitchable(c)) return [...allowedProducts];
  const rest = allowedProducts.filter((p) => !(c.products as readonly string[]).includes(p));
  const next = on ? [...rest, ...c.products] : rest;
  return (ENRICHMENT_PRODUCTS as readonly string[]).filter((p) => next.includes(p));
}

/** Products a child store gets by default: none. Paid data is opt-in per store. */
export const CHILD_DEFAULT_PRODUCTS: readonly string[] = [];

// ── Visibility (free) vs enrichment (paid) ───────────────────────────────

export interface VisibilityInputs {
  status: "active" | "inactive";
  inventory_feed_enabled: boolean;
  mappingApproved: boolean;
  inventory_sharing_enabled: boolean;
}

/** Whether a store's own vehicles are visible in AutoLabels. Never reads the enrichment policy. */
export const inventoryVisible = (s: VisibilityInputs): boolean =>
  s.status === "active" && s.inventory_feed_enabled && s.mappingApproved;

// ── Enrichment ordering ──────────────────────────────────────────────────

export type ConditionPriority = "used_first" | "new_first" | "equal";

export function orderForEnrichment<T extends { condition: string | null | undefined; vin: string }>(rows: readonly T[], priority: ConditionPriority): T[] {
  const rank = (c: string | null | undefined): number => {
    const v = String(c ?? "").toLowerCase();
    if (priority === "equal") return 0;
    const used = v === "used" || v === "cpo";
    return priority === "used_first" ? (used ? 0 : 1) : (used ? 1 : 0);
  };
  return [...rows].sort((a, b) => rank(a.condition) - rank(b.condition) || a.vin.localeCompare(b.vin));
}

// ── Monthly call plan ────────────────────────────────────────────────────

export interface AccountBudget {
  monthlyQuota: number;
  /** Essential-only reserve. Owner policy (Nov 6 2026): 250. */
  reserve: number;
  /** Calls already consumed or reserved this period, from the ledger. Null means unknown. */
  usedThisPeriod: number | null;
}

export interface StorePlanInput {
  storeId: string;
  name: string;
  primary: boolean;
  mode: "feed_only" | "enrichment" | "paused";
  vehicles: number;
  allowedProducts: readonly string[];
  refreshCadenceHours: number | null;
  monthlyRequestCap: number;
}

/** Products bought once per VIN (identity/build). Everything else refreshes on the store cadence. */
const DECODE_ONCE = new Set(["neovin", "basic_vin_decode", "vin_history", "auto_recalls"]);
const HOURS_PER_MONTH = 24 * 31;

export interface StorePlanLine {
  storeId: string; name: string; primary: boolean;
  demand: number;
  hardCap: number;
  allocated: number;
  deferred: number;
}

export interface MonthlyPlan {
  ok: boolean;
  nonessentialBudget: number;
  worstCase: number;
  lines: StorePlanLine[];
  problems: string[];
}

/**
 * Worst case assumes the whole lot turns over once in the month (each VIN is
 * decoded twice: the current car and its replacement) and every refresh
 * product runs on every cadence tick. A store that is not in enrichment mode
 * plans zero. The hard cap is the store's monthly_request_cap, which the
 * gate enforces, so the plan's worst case is the sum of hard caps.
 */
export function planMonthlyCalls(account: AccountBudget, stores: readonly StorePlanInput[]): MonthlyPlan {
  const problems: string[] = [];
  const nonessentialBudget = Math.max(0, account.monthlyQuota - account.reserve);
  const lines: StorePlanLine[] = [];
  const ordered = [...stores].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
  for (const s of ordered) {
    let demand = 0;
    if (s.mode === "enrichment") {
      for (const p of s.allowedProducts) {
        if (DECODE_ONCE.has(p)) demand += s.vehicles * 2;
        else {
          if (!s.refreshCadenceHours) { problems.push(`${s.name}: ${p} has no refresh cadence, so its monthly calls cannot be bounded.`); continue; }
          demand += s.vehicles * Math.ceil(HOURS_PER_MONTH / s.refreshCadenceHours);
        }
      }
      if (s.monthlyRequestCap <= 0) problems.push(`${s.name}: enrichment is on with no monthly call cap.`);
    }
    lines.push({ storeId: s.storeId, name: s.name, primary: s.primary, demand, hardCap: s.mode === "enrichment" ? s.monthlyRequestCap : 0, allocated: 0, deferred: 0 });
  }
  const worstCase = lines.reduce((n, l) => n + l.hardCap, 0);
  if (worstCase > nonessentialBudget) {
    problems.push(`Store caps add up to ${worstCase} calls, more than the ${nonessentialBudget} nonessential calls left after the ${account.reserve}-call reserve.`);
  }
  if (account.usedThisPeriod === null) problems.push("Calls used this period are unknown, so nothing can be allocated.");
  let left = account.usedThisPeriod === null ? 0 : Math.max(0, nonessentialBudget - account.usedThisPeriod);
  for (const l of lines) {
    const want = Math.min(l.demand, l.hardCap);
    l.allocated = Math.min(want, left);
    l.deferred = want - l.allocated;
    left -= l.allocated;
  }
  return { ok: problems.length === 0, nonessentialBudget, worstCase, lines, problems };
}

/**
 * Primary precedence at admission time: a child store may spend only what is
 * left after the essential reserve and the primary store's holdback. Unknown
 * usage refuses, so a missing ledger can never let a child store spend.
 */
export function childStoreMayReserve(a: { quota: number; reserve: number; primaryHoldback: number; used: number | null; units?: number }): { ok: boolean; reason?: string } {
  if (a.used === null || !Number.isFinite(a.used)) return { ok: false, reason: "usage_unknown" };
  const units = a.units ?? 1;
  const available = a.quota - a.used - a.reserve - a.primaryHoldback;
  return available - units >= 0 ? { ok: true } : { ok: false, reason: "primary_precedence" };
}
