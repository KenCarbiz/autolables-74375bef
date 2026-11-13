// GENERATED — do not edit.
// Mirror of src/lib/intelligence/marketPass/marketDesirability.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { resolveFreshness } from "../contracts.ts";
import { READ_MODEL_TTL_DAYS } from "../readModels/listingFacts.ts";
import { MARKET_DESIRABILITY_VERSION, type DesirabilityComponent, type EvidenceProvenance, type MarketDesirabilityAssessment, type VehicleType, } from "./contracts.ts";
export const DESIRABILITY_INPUT_MEANING_VERIFIED = {
    market_days_supply: false,
    inferred_sold_dom_median: false,
} as const;
export const DESIRABILITY_RULES = {
    mds: { bestDays: 30, worstDays: 120, minCohortCount: 10 },
    soldDom: { bestDays: 20, worstDays: 90, minCount: 10, scopes: ["model_year_state", "model_state"] },
    crossCheckDisagreementPoints: 40,
    bands: { high: 75, steady: 50, soft: 25 },
} as const;
export const linearScore = (value: number, best: number, worst: number): number => Math.max(0, Math.min(100, Math.round((100 * (worst - value)) / (worst - best))));
export const desirabilityBand = (score: number): MarketDesirabilityAssessment["band"] => {
    const b = DESIRABILITY_RULES.bands;
    return score >= b.high ? "high" : score >= b.steady ? "steady" : score >= b.soft ? "soft" : "slow";
};
const BAND_LABEL: Record<NonNullable<MarketDesirabilityAssessment["band"]>, string> = {
    high: "High market demand",
    steady: "Steady market demand",
    soft: "Soft market demand",
    slow: "Slow market demand",
};
type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export interface MarketDesirabilityInput {
    vehicleType: VehicleType;
    marketMeta: unknown;
    nowMs: number;
    evidence: EvidenceProvenance[];
}
function mdsComponent(meta: Bag, nowMs: number): DesirabilityComponent {
    const r = DESIRABILITY_RULES.mds;
    const mds = num(meta.market_days_supply);
    const count = num(meta.inventory_count);
    const scope = str(meta.mds_match_level);
    const fresh = resolveFreshness({ checkedAt: str(meta.mds_checked_at) ?? str(meta.checked_at), ttlDays: READ_MODEL_TTL_DAYS.marketDaysSupply, nowMs });
    const base = { key: "supply_turnover" as const, input: "market_days_supply" as const, rawValue: mds, sampleCount: count, scope, meaningVerified: DESIRABILITY_INPUT_MEANING_VERIFIED.market_days_supply };
    if (mds == null || mds <= 0)
        return { ...base, score: null, used: false, reason: "market_days_supply_absent" };
    if (count == null)
        return { ...base, score: null, used: false, reason: "cohort_inventory_count_not_recorded" };
    if (count < r.minCohortCount)
        return { ...base, score: null, used: false, reason: `cohort_inventory_below_${r.minCohortCount}` };
    if (fresh.state !== "current")
        return { ...base, score: null, used: false, reason: `market_days_supply_${fresh.state}` };
    return { ...base, score: linearScore(mds, r.bestDays, r.worstDays), used: true, reason: scope ? `mds_scope_${scope.toLowerCase()}` : "mds_scope_not_recorded" };
}
function soldDomComponent(meta: Bag, nowMs: number): DesirabilityComponent {
    const r = DESIRABILITY_RULES.soldDom;
    const sold = bag(meta.sold_stats);
    const dom = num(sold.dom_median);
    const count = num(sold.count);
    const scope = str(sold.scope);
    const fresh = resolveFreshness({ checkedAt: str(sold.checked_at), ttlDays: READ_MODEL_TTL_DAYS.salesStats, nowMs });
    const base = { key: "supply_turnover" as const, input: "inferred_sold_dom_median" as const, rawValue: dom, sampleCount: count, scope, meaningVerified: DESIRABILITY_INPUT_MEANING_VERIFIED.inferred_sold_dom_median };
    if (dom == null || dom < 0)
        return { ...base, score: null, used: false, reason: "inferred_sold_dom_absent" };
    if (count == null || count < r.minCount)
        return { ...base, score: null, used: false, reason: `inferred_sold_count_below_${r.minCount}` };
    if (!scope || !(r.scopes as readonly string[]).includes(scope))
        return { ...base, score: null, used: false, reason: `inferred_sold_scope_${scope ?? "unknown"}_too_broad` };
    if (fresh.state !== "current")
        return { ...base, score: null, used: false, reason: `inferred_sold_${fresh.state}` };
    return { ...base, score: linearScore(dom, r.bestDays, r.worstDays), used: true, reason: `inferred_sold_scope_${scope}` };
}
export function buildMarketDesirability(input: MarketDesirabilityInput): MarketDesirabilityAssessment {
    const meta = bag(input.marketMeta);
    const mds = mdsComponent(meta, input.nowMs);
    const dom = soldDomComponent(meta, input.nowMs);
    const primary = mds.used ? mds : dom.used ? dom : null;
    const secondary = primary === mds ? dom : primary === dom ? mds : null;
    const crossCheck = secondary ? { ...secondary, used: false, reason: secondary.score != null ? "cross_check_only_same_construct" : secondary.reason } : null;
    const reasons: string[] = [mds.reason, dom.reason];
    if (primary && crossCheck?.score != null && Math.abs((primary.score as number) - crossCheck.score) > DESIRABILITY_RULES.crossCheckDisagreementPoints) {
        reasons.push("supply_and_inferred_sold_velocity_disagree");
    }
    const score = primary?.score ?? null;
    const band = score != null ? desirabilityBand(score) : null;
    const verified = primary?.meaningVerified === true;
    if (primary && !verified)
        reasons.push(`input_meaning_unverified:${primary.input}`);
    const state: MarketDesirabilityAssessment["state"] = score == null ? "unavailable" : verified ? "available" : "provisional";
    const days = primary?.rawValue != null ? Math.round(primary.rawValue) : null;
    const explanation = score == null
        ? "Market desirability is not available: no market days supply or inferred-sold turnover figure meets the sample and freshness minimums."
        : primary?.input === "market_days_supply"
            ? `${days} days of market supply across ${primary.sampleCount} listings in the cohort.${state === "provisional" ? " Provisional: the provider's definition of this figure is not yet verified." : ""}`
            : `Inferred-sold listings left the market after a median of ${days} days (${primary?.sampleCount} listings).${state === "provisional" ? " Provisional: inferred sales mix sold and expired listings." : ""}`;
    return {
        indicator: "market_desirability",
        version: MARKET_DESIRABILITY_VERSION,
        vehicleType: input.vehicleType,
        state,
        score,
        band,
        label: band ? BAND_LABEL[band] : "Not available",
        explanation,
        components: primary ? [primary] : [mds, dom],
        context: { activeCohortSupply: num(meta.inventory_count), crossCheck },
        reasons: [...new Set(reasons)],
        evidence: input.evidence.filter((e) => e.key === "market_days_supply" || e.key === "inferred_sold_stats"),
    };
}
