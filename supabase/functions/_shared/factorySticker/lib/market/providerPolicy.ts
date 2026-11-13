// GENERATED — do not edit.
// Mirror of src/lib/market/providerPolicy.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { capability, effectiveCost, policyFor, publicBrowseMayTrigger, type CostOverrides, type VehicleType, } from "./providerRegistry.ts";
import { readMarketFlag, type MarketFlag } from "./flags.ts";
export const PROVIDER_POLICY_VERSION = "provider-policy-v1.0.0";
export type PolicyVehicleType = "new" | "used" | "cpo";
export type PolicyTrigger = "intake" | "scheduled" | "material_event" | "operator" | "valuation_writer" | "public_browse";
export type MaterialEvent = "price_change" | "mileage_change" | "certification_change" | "neovin_correction" | "feed_reappearance" | "condition_change";
export type EntitlementState = "entitled" | "not_entitled" | "unknown";
export const HOUR_MS = 3600000;
export const MATERIAL_EVENT_REFRESH: Record<MaterialEvent, readonly string[]> = {
    price_change: ["active_search"],
    mileage_change: ["active_search", "mds", "vin_history"],
    certification_change: ["active_search", "mds"],
    neovin_correction: ["active_search", "mds", "sales_stats"],
    feed_reappearance: ["active_search", "vin_history", "autorecalls"],
    condition_change: [],
};
export const CAPABILITY_FLAG: Readonly<Partial<Record<string, MarketFlag>>> = {
    sold_summary: "sold_summary",
    sold_summary_dealership_groups: "sold_summary",
    autorecalls: "autorecalls_vin",
    price_premium: "premium_used_refresh",
    price_premium_plus: "premium_plus_used_intake",
    available_options_packages: "available_options_packages",
    blackbook_used_vin: "blackbook_live",
    incentives_oem: "oem_incentives_v2",
    incentives_make_zip: "oem_incentives_v2",
    webhooks: "provider_webhooks",
};
export function readCapabilityFlag(settings: unknown, flag: MarketFlag): boolean {
    switch (flag) {
        case "sold_summary": return readMarketFlag(settings, "sold_summary");
        case "autorecalls_vin": return readMarketFlag(settings, "autorecalls_vin");
        case "premium_used_refresh": return readMarketFlag(settings, "premium_used_refresh");
        case "premium_plus_used_intake": return readMarketFlag(settings, "premium_plus_used_intake");
        case "available_options_packages": return readMarketFlag(settings, "available_options_packages");
        case "blackbook_live": return readMarketFlag(settings, "blackbook_live");
        case "oem_incentives_v2": return readMarketFlag(settings, "oem_incentives_v2");
        case "provider_webhooks": return readMarketFlag(settings, "provider_webhooks");
        default: return readMarketFlag(settings, flag);
    }
}
export const TTL_SETTING_KEYS: Readonly<Record<VehicleType, Readonly<Partial<Record<string, string>>>>> = {
    used: {
        price_premium: "refresh_days",
        price_base: "refresh_days",
        mds: "mds_days",
        vin_history: "history_days",
        sales_stats: "sales_stats_days",
        recents: "sales_stats_days",
        sold_summary: "sales_stats_days",
        autorecalls: "recall_cadence_days",
    },
    new: {
        autorecalls: "recall_cadence_days",
    },
};
export const OPT_IN_SETTING_KEYS: Readonly<Record<VehicleType, Readonly<Partial<Record<string, string>>>>> = {
    used: {},
    new: {
        mds: "mds",
        sales_stats: "sales_stats",
        recents: "sales_stats",
        sold_summary: "sales_stats",
        incentives_oem: "incentives",
        incentives_make_zip: "incentives",
    },
};
export const ENRICHMENT_VISIT_CAPABILITIES = [
    "active_search",
    "mds",
    "sales_stats",
    "recents",
    "vin_history",
    "autorecalls",
    "sold_summary",
] as const;
export interface TenantProviderPolicy {
    used: Record<string, unknown>;
    new: Record<string, unknown>;
    entitlements: Record<string, EntitlementState>;
}
type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const isEntitlementState = (v: unknown): v is EntitlementState => v === "entitled" || v === "not_entitled" || v === "unknown";
export function readTenantProviderPolicy(settings: unknown): TenantProviderPolicy {
    const pp = bag(bag(settings).provider_policy);
    const entitlements: Record<string, EntitlementState> = {};
    for (const [k, v] of Object.entries(bag(pp.entitlements))) {
        if (isEntitlementState(v))
            entitlements[k] = v;
    }
    return { used: bag(pp.used), new: bag(pp.new), entitlements };
}
const positiveDays = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
export const PRICE_INTEGRITY_WEEKLY_HOURS = 24 * 7;
export function tenantTtlHours(policy: TenantProviderPolicy, vehicleType: VehicleType, key: string): number | null {
    const typed = policy[vehicleType];
    const generic = positiveDays(bag(typed.ttl_days)[key]);
    if (generic != null)
        return generic * 24;
    const settingKey = TTL_SETTING_KEYS[vehicleType][key];
    if (settingKey) {
        const days = positiveDays(typed[settingKey]);
        if (days != null)
            return days * 24;
    }
    if (vehicleType === "new" && key === "active_search" && typed.price_integrity_daily === false) {
        return PRICE_INTEGRITY_WEEKLY_HOURS;
    }
    return null;
}
export const NMVTIS_CAPABILITIES: readonly string[] = ["vindata_access", "vindata_generate"];
export function nmvtisAutoVerifyAllowed(settings: unknown, policy: TenantProviderPolicy): boolean {
    return readMarketFlag(settings, "nmvtis_auto_verify") || policy.used.nmvtis_auto_verify === true;
}
export function tenantOptedIn(policy: TenantProviderPolicy, vehicleType: VehicleType, key: string): boolean {
    const settingKey = OPT_IN_SETTING_KEYS[vehicleType][key];
    const typed = policy[vehicleType];
    if (settingKey && typed[settingKey] === true)
        return true;
    return bag(typed.opt_in)[key] === true;
}
export function tenantCostOverrides(policy: TenantProviderPolicy, vehicleType: VehicleType): CostOverrides {
    const raw = bag(policy[vehicleType].cost_overrides_usd);
    const out: CostOverrides = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0)
            out[k] = v;
    }
    return out;
}
export const toRegistryVehicleType = (t: PolicyVehicleType): VehicleType => (t === "new" ? "new" : "used");
export interface DecisionInput {
    key: string;
    vehicleType: PolicyVehicleType;
    trigger: PolicyTrigger;
    lastCheckedAt: string | null | undefined;
    materialEvents?: readonly MaterialEvent[];
    settings?: unknown;
    entitlements?: Readonly<Partial<Record<string, EntitlementState>>>;
    subject?: Readonly<Record<string, string | number | null | undefined>>;
    nowMs: number;
}
export type TtlSource = "registry" | "tenant" | "immutable" | "none";
export interface ProviderCallDecision {
    key: string;
    due: boolean;
    reason: string;
    reasons: string[];
    trigger: PolicyTrigger;
    ttlHours: number | null;
    ttlSource: TtlSource;
    ageHours: number | null;
    cacheKey: string;
    estimatedCostUsd: number | null;
    entitlement: EntitlementState;
    flag: MarketFlag | null;
}
const ageHoursOf = (lastCheckedAt: string | null | undefined, nowMs: number): number | null => {
    if (!lastCheckedAt)
        return null;
    const t = Date.parse(lastCheckedAt);
    if (!Number.isFinite(t))
        return null;
    return Math.max(0, (nowMs - t) / HOUR_MS);
};
const round2 = (n: number) => Math.round(n * 100) / 100;
export function buildCacheKey(key: string, dims: readonly string[], subject?: DecisionInput["subject"]): string {
    const parts = dims.map((d) => {
        const v = subject?.[d];
        return `${d}=${v == null || v === "" ? "*" : String(v)}`;
    });
    return [key, ...parts].join("|");
}
export function decideProviderCall(input: DecisionInput): ProviderCallDecision {
    const cap = capability(input.key);
    const vt = toRegistryVehicleType(input.vehicleType);
    const policy = readTenantProviderPolicy(input.settings);
    const costOverrides = tenantCostOverrides(policy, vt);
    const flag = CAPABILITY_FLAG[input.key] ?? null;
    const base = {
        key: input.key,
        trigger: input.trigger,
        flag,
        cacheKey: cap ? buildCacheKey(input.key, cap.cacheKey, input.subject) : input.key,
        estimatedCostUsd: cap ? effectiveCost(input.key, costOverrides) : null,
        ageHours: ageHoursOf(input.lastCheckedAt, input.nowMs),
    };
    const none = { ttlHours: null, ttlSource: "none" as TtlSource };
    const notDue = (reasons: string[], ttl: {
        ttlHours: number | null;
        ttlSource: TtlSource;
    }, entitlement: EntitlementState): ProviderCallDecision => ({ ...base, due: false, reason: reasons[0], reasons, entitlement, ...ttl });
    if (!cap)
        return notDue(["unknown_capability"], none, "unknown");
    const entitlement: EntitlementState = input.entitlements?.[input.key]
        ?? policy.entitlements[input.key]
        ?? (cap.status === "entitlement_blocked" ? "not_entitled" : "entitled");
    if (input.trigger === "public_browse" || publicBrowseMayTrigger(input.key)) {
        return notDue(["public_browse_never_triggers"], none, entitlement);
    }
    const pol = policyFor(input.key, vt);
    const tenantTtl = tenantTtlHours(policy, vt, input.key);
    const ttlHours = tenantTtl ?? pol.ttlHours;
    const ttl = {
        ttlHours,
        ttlSource: (tenantTtl != null ? "tenant" : ttlHours == null ? "immutable" : "registry") as TtlSource,
    };
    const vetoes = pol.reasons.filter((r) => r !== "entitlement_blocked");
    if (!pol.allowed || vetoes.length)
        return notDue(vetoes.length ? vetoes : ["not_allowed"], ttl, entitlement);
    if (pol.requiresTenantOptIn && !tenantOptedIn(policy, vt, input.key)) {
        return notDue([`tenant_opt_in_required:${vt}`], ttl, entitlement);
    }
    if (entitlement === "not_entitled")
        return notDue(["entitlement_blocked"], ttl, entitlement);
    if (flag && !readCapabilityFlag(input.settings, flag))
        return notDue([`flag_off:${flag}`], ttl, entitlement);
    if (NMVTIS_CAPABILITIES.includes(input.key) && input.trigger !== "operator" && !nmvtisAutoVerifyAllowed(input.settings, policy)) {
        return notDue(["nmvtis_auto_verify_off"], ttl, entitlement);
    }
    const triggers = cap.triggers;
    const neverChecked = base.ageHours == null;
    const elapsed = ttlHours != null && base.ageHours != null && base.ageHours >= ttlHours;
    const due = (reasons: string[]): ProviderCallDecision => ({ ...base, due: true, reason: reasons[0], reasons, entitlement, ...ttl });
    const byAge = (): ProviderCallDecision => {
        if (neverChecked)
            return due(["never_checked"]);
        if (ttlHours == null)
            return notDue(["immutable_already_held"], ttl, entitlement);
        if (!cap.cadence.refresh)
            return notDue(["intake_only"], ttl, entitlement);
        return elapsed ? due(["ttl_elapsed"]) : notDue(["fresh"], ttl, entitlement);
    };
    switch (input.trigger) {
        case "operator":
            if (!triggers.includes("operator"))
                return notDue(["trigger_not_allowed:operator"], ttl, entitlement);
            return due(["operator_requested"]);
        case "valuation_writer":
            if (!triggers.includes("valuation_writer"))
                return notDue(["trigger_not_allowed:valuation_writer"], ttl, entitlement);
            return byAge();
        case "intake":
            if (!triggers.includes("intake"))
                return notDue(["trigger_not_allowed:intake"], ttl, entitlement);
            return byAge();
        case "material_event": {
            const forwarded = (input.materialEvents ?? []).filter((e) => MATERIAL_EVENT_REFRESH[e]?.includes(input.key));
            if (forwarded.length && triggers.includes("material_event"))
                return due(forwarded.map((e) => `material_event:${e}`));
            if (!triggers.includes("scheduled") && !triggers.includes("intake")) {
                return notDue(["trigger_not_allowed:scheduled"], ttl, entitlement);
            }
            return byAge();
        }
        case "scheduled":
            if (!triggers.includes("scheduled") && !triggers.includes("intake")) {
                return notDue(["trigger_not_allowed:scheduled"], ttl, entitlement);
            }
            return byAge();
        default:
            return notDue(["unknown_trigger"], ttl, entitlement);
    }
}
export interface VisitPlanInput {
    vehicleType: PolicyVehicleType;
    trigger: PolicyTrigger;
    lastChecked: Readonly<Record<string, string | null | undefined>>;
    candidates?: readonly string[];
    materialEvents?: readonly MaterialEvent[];
    settings?: unknown;
    entitlements?: Readonly<Partial<Record<string, EntitlementState>>>;
    subject?: DecisionInput["subject"];
    callsPerCapability?: Readonly<Record<string, number>>;
    nowMs: number;
}
export interface VisitPlan {
    version: string;
    vehicleType: PolicyVehicleType;
    trigger: PolicyTrigger;
    decidedAt: string;
    due: ProviderCallDecision[];
    skipped: ProviderCallDecision[];
    order: string[];
    estimatedCostUsd: number;
    estimatedCalls: number;
}
export function planVisit(input: VisitPlanInput): VisitPlan {
    const candidates = input.candidates ?? ENRICHMENT_VISIT_CAPABILITIES;
    const decisions = candidates.map((key) => decideProviderCall({
        key,
        vehicleType: input.vehicleType,
        trigger: input.trigger,
        lastCheckedAt: input.lastChecked[key] ?? null,
        materialEvents: input.materialEvents,
        settings: input.settings,
        entitlements: input.entitlements,
        subject: input.subject,
        nowMs: input.nowMs,
    }));
    const due = decisions.filter((d) => d.due);
    const skipped = decisions.filter((d) => !d.due);
    let cost = 0;
    let calls = 0;
    for (const d of due) {
        const n = Math.max(1, Math.floor(input.callsPerCapability?.[d.key] ?? 1));
        calls += n;
        cost += (d.estimatedCostUsd ?? 0) * n;
    }
    return {
        version: PROVIDER_POLICY_VERSION,
        vehicleType: input.vehicleType,
        trigger: input.trigger,
        decidedAt: new Date(input.nowMs).toISOString(),
        due,
        skipped,
        order: due.map((d) => d.key),
        estimatedCostUsd: round2(cost),
        estimatedCalls: calls,
    };
}
export interface VisitPlanSummary {
    version: string;
    trigger: PolicyTrigger;
    decided_at: string;
    due: string[];
    skipped: Record<string, string>;
    estimated_cost_usd: number;
    estimated_calls: number;
}
export function summarizePlan(plan: VisitPlan): VisitPlanSummary {
    const skipped: Record<string, string> = {};
    for (const d of plan.skipped)
        skipped[d.key] = d.reason;
    return {
        version: plan.version,
        trigger: plan.trigger,
        decided_at: plan.decidedAt,
        due: plan.order,
        skipped,
        estimated_cost_usd: plan.estimatedCostUsd,
        estimated_calls: plan.estimatedCalls,
    };
}
