// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/resolveField.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { capConfidence, canProduceVerifiedFact, sourceRank, type Confidence, type SourceKind, } from "../vehicleTruth/precedence.ts";
import type { FieldCandidate, FreshnessState, ParityClass, ResolvedField, } from "./readModelTypes.ts";
const FACT_KEY: Record<string, string> = {
    advertised_retail: "advertised_price",
    selling_price: "advertised_price",
    observed_price: "advertised_price",
    msrp_factory: "total_msrp",
    msrp_feed: "msrp",
    stock: "stock_number",
    certified: "is_certified",
    market_value: "market_value",
};
export const factKeyFor = (field: string): string => FACT_KEY[field] ?? field;
export const FRESHNESS_DAYS: Record<string, number | null> = {
    vin: null,
    year: null,
    make: null,
    model: null,
    trim: null,
    body_style: null,
    engine: null,
    drivetrain: null,
    transmission: null,
    fuel_type: null,
    exterior_color: null,
    interior_color: null,
    msrp_factory: null,
    total_msrp: null,
    base_msrp: null,
    epa_city: null,
    epa_highway: null,
    stock: 30,
    stock_number: 30,
    mileage: 14,
    condition: 30,
    certified: 30,
    is_certified: 30,
    advertised_retail: 3,
    advertised_price: 3,
    selling_price: 3,
    doc_fee: 30,
    dealer_discount: 3,
    msrp_feed: 30,
    msrp: 30,
    in_transit: 3,
    observed_price: 7,
    observed_before_doc_fee: 7,
    observed_doc_fee: 7,
    observed_discount: 7,
    market_value: 7,
    days_on_market: 2,
    comparable_count: 7,
    market_days_supply: 7,
    price_change_percent: 7,
    reference_price: 7,
    recall_status: 30,
    open_recall_count: 30,
    title_status: 90,
    title_verification: 90,
    completed_work: null,
};
const DAY_MS = 86400000;
export const ageInDays = (observedAt: string | null | undefined, now: number): number | null => {
    if (!observedAt)
        return null;
    const t = Date.parse(observedAt);
    if (Number.isNaN(t))
        return null;
    return (now - t) / DAY_MS;
};
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const semanticallySame = (a: unknown, b: unknown): boolean => {
    if (sameValue(a, b))
        return true;
    if (a == null || b == null)
        return false;
    if (typeof a === "number" && typeof b === "number")
        return Math.abs(a - b) < 0.005;
    const norm = (v: unknown) => String(v).toLowerCase().replace(/[\s_-]+/g, " ").replace(/[^a-z0-9. ]/g, "").trim();
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb)
        return false;
    return na === nb;
};
export interface ResolveFieldOptions {
    configuredOrder?: SourceKind[] | null;
    now?: number;
    freshnessDays?: number | null;
    expectedDisagreement?: string | null;
    suppressDispute?: boolean;
}
const rankOf = (factKey: string, c: FieldCandidate, order: SourceKind[] | null): number => sourceRank(factKey, c.source, order);
const conf = (c: FieldCandidate): Confidence => capConfidence(c.source, c.confidence);
const CONFIDENCE_ORDER: Confidence[] = ["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"];
export function resolveField<T>(key: string, candidates: Array<FieldCandidate<T>>, options: ResolveFieldOptions = {}): ResolvedField<T> {
    const now = options.now ?? Date.now();
    const factKey = factKeyFor(key);
    const order = options.configuredOrder ?? null;
    const usable = candidates.filter((c) => c.value !== null && c.value !== undefined && c.value !== "");
    if (!usable.length) {
        return {
            key,
            value: null,
            chosen: null,
            freshness: "UNKNOWN",
            ageDays: null,
            candidates: [...candidates],
            disagreeing: [],
            disputed: false,
            reason: candidates.length
                ? `Every candidate for ${key} was empty (${candidates.map((c) => c.origin).join(", ")}).`
                : `No source supplies ${key} for this vehicle.`,
        };
    }
    const ranked = [...usable].sort((a, b) => {
        const byRank = rankOf(factKey, a, order) - rankOf(factKey, b, order);
        if (byRank !== 0)
            return byRank;
        const byConf = CONFIDENCE_ORDER.indexOf(conf(a)) - CONFIDENCE_ORDER.indexOf(conf(b));
        if (byConf !== 0)
            return byConf;
        return String(b.observedAt ?? "").localeCompare(String(a.observedAt ?? ""));
    });
    const winner = ranked[0];
    const disagreeing = ranked.slice(1).filter((c) => !sameValue(c.value, winner.value));
    const disputed = !options.suppressDispute
        && disagreeing.some((c) => canProduceVerifiedFact(c.source)
            && canProduceVerifiedFact(winner.source)
            && conf(c) === "VERIFIED"
            && conf(winner) === "VERIFIED");
    const winnerRank = rankOf(factKey, winner, order);
    const winnerAge = ageInDays(winner.observedAt, now);
    const superseded = disagreeing.some((c) => {
        if (rankOf(factKey, c, order) > winnerRank)
            return false;
        const cAge = ageInDays(c.observedAt, now);
        return cAge != null && winnerAge != null && cAge < winnerAge;
    });
    const windowDays = options.freshnessDays !== undefined
        ? options.freshnessDays
        : (factKey in FRESHNESS_DAYS ? FRESHNESS_DAYS[factKey] : FRESHNESS_DAYS[key]);
    let freshness: FreshnessState;
    let reason: string;
    if (disputed) {
        freshness = "CONFLICTED";
        reason = `${winner.provider} says ${JSON.stringify(winner.value)} and ${disagreeing[0].provider} says `
            + `${JSON.stringify(disagreeing[0].value)}; both may verify ${factKey}, so a person decides.`;
    }
    else if (superseded) {
        freshness = "SUPERSEDED";
        reason = `A newer answer of equal or better standing disagrees (${disagreeing[0].provider}, `
            + `${disagreeing[0].observedAt ?? "unstamped"}).`;
    }
    else if (windowDays === undefined) {
        freshness = "UNKNOWN";
        reason = `${winner.provider} via ${winner.origin}; no freshness policy is defined for ${factKey}.`;
    }
    else if (windowDays === null) {
        freshness = "CURRENT";
        reason = `${winner.provider} via ${winner.origin}; this fact does not expire.`;
    }
    else if (winnerAge == null) {
        freshness = "UNKNOWN";
        reason = `${winner.provider} via ${winner.origin}; nothing stamps when the source observed it.`;
    }
    else if (winnerAge > windowDays) {
        freshness = "STALE";
        reason = `${winner.provider} via ${winner.origin}, last observed ${winnerAge.toFixed(1)} days ago; `
            + `policy for ${factKey} is ${windowDays} days.`;
    }
    else {
        freshness = "CURRENT";
        reason = `${winner.provider} via ${winner.origin}, observed ${winnerAge.toFixed(1)} days ago.`;
    }
    if (options.expectedDisagreement && disagreeing.length) {
        reason += ` Disagreement is expected: ${options.expectedDisagreement}`;
    }
    return {
        key,
        value: winner.value,
        chosen: winner,
        freshness,
        ageDays: winnerAge,
        candidates: ranked,
        disagreeing,
        disputed,
        reason,
    };
}
export function emptyField<T>(key: string, why: string): ResolvedField<T> {
    return {
        key,
        value: null,
        chosen: null,
        freshness: "UNKNOWN",
        ageDays: null,
        candidates: [],
        disagreeing: [],
        disputed: false,
        reason: why,
    };
}
export interface ParityInput {
    currentValue: unknown;
    resolved: ResolvedField<unknown>;
    expectedDifference?: string | null;
    currentKnownWrong?: string | null;
    resolvedKnownWrong?: string | null;
}
export function classifyParity(input: ParityInput): {
    verdict: ParityClass;
    explanation: string;
} {
    const { currentValue, resolved } = input;
    const resolvedValue = resolved.value;
    const both = currentValue != null && currentValue !== "" && resolvedValue != null;
    if (sameValue(currentValue ?? null, resolvedValue ?? null)) {
        return {
            verdict: "MATCH",
            explanation: `Both read ${JSON.stringify(resolvedValue)}${resolved.chosen ? ` (${resolved.chosen.origin})` : ""}.`,
        };
    }
    if (both && semanticallySame(currentValue, resolvedValue)) {
        return {
            verdict: "SEMANTIC_MATCH",
            explanation: `Same value, different form: ${JSON.stringify(currentValue)} vs ${JSON.stringify(resolvedValue)}.`,
        };
    }
    if (input.currentKnownWrong) {
        return {
            verdict: "CURRENT_OLD_VALUE_WRONG",
            explanation: input.currentKnownWrong,
        };
    }
    if (input.resolvedKnownWrong) {
        return {
            verdict: "NEW_VALUE_WRONG",
            explanation: input.resolvedKnownWrong,
        };
    }
    if (input.expectedDifference) {
        return {
            verdict: "EXPECTED_SOURCE_DIFFERENCE",
            explanation: input.expectedDifference,
        };
    }
    if (resolved.freshness === "STALE" && both) {
        return {
            verdict: "NEW_VALUE_WRONG",
            explanation: `Resolved from a stale source: ${resolved.reason}`,
        };
    }
    if (resolvedValue == null && currentValue != null) {
        return {
            verdict: "UNEXPLAINED",
            explanation: `The app shows ${JSON.stringify(currentValue)} and no source supplies it. ${resolved.reason}`,
        };
    }
    if (currentValue == null && resolvedValue != null) {
        return {
            verdict: "CURRENT_OLD_VALUE_WRONG",
            explanation: `The app shows nothing while ${resolved.chosen?.provider ?? "a source"} supplies `
                + `${JSON.stringify(resolvedValue)} (${resolved.chosen?.origin ?? "unknown origin"}).`,
        };
    }
    return {
        verdict: "UNEXPLAINED",
        explanation: `App: ${JSON.stringify(currentValue)} (current path). Resolved: ${JSON.stringify(resolvedValue)}. `
            + `${resolved.reason} No rule explains the difference.`,
    };
}
