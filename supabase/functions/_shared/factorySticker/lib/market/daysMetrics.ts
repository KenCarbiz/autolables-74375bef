// GENERATED — do not edit.
// Mirror of src/lib/market/daysMetrics.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export interface MarketDaysMetrics {
    subjectVehicle: {
        firstSeenAt: string | null;
        dealerInventoryStartAt: string | null;
        currentListingAgeDays: number | null;
        source: "dealer_feed" | "market_api" | "both";
    };
    activeComparables: {
        averageListingAgeDays: number | null;
        medianListingAgeDays: number | null;
        sampleSize: number;
        radiusMiles: number;
        filters: {
            condition: "new" | "used" | "cpo";
            make: string;
            model: string;
            modelYears: number[];
            trims: string[];
            drivetrains: string[];
        };
    };
    historicalComparables?: {
        medianObservedListingDurationDays: number | null;
        sampleSize: number;
        lookbackDays: number;
        outcomeConfidence: "confirmed_sale" | "likely_sale" | "delisted_only";
    };
    checkedAt: string;
    provider: string;
    methodologyVersion: string;
}
export interface DaysDisplay {
    subjectHeadline: string | null;
    subjectSubcopy: string | null;
    benchmarkHeadline: string;
    benchmarkSubcopy: string;
    benchmarkKind: "time_to_sell" | "active_listing_age" | "unavailable";
}
function fmtDate(iso: string | null): string | null {
    if (!iso)
        return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m)
        return null;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
export function resolveMarketDaysDisplay(m: MarketDaysMetrics): DaysDisplay {
    const cond = m.activeComparables.filters.condition;
    const model = m.activeComparables.filters.model || "vehicle";
    const radius = m.activeComparables.radiusMiles;
    const checked = fmtDate(m.checkedAt);
    const age = m.subjectVehicle.currentListingAgeDays;
    const firstSeen = fmtDate(m.subjectVehicle.dealerInventoryStartAt ?? m.subjectVehicle.firstSeenAt);
    const subjectHeadline = age != null ? `${age} ${age === 1 ? "day" : "days"} at this dealership` : null;
    const subjectSubcopy = firstSeen ? `First listed ${firstSeen}` : null;
    const hist = m.historicalComparables;
    const condLabel = cond === "new" ? "new" : cond === "cpo" ? "certified" : "used";
    if (hist && hist.medianObservedListingDurationDays != null && hist.sampleSize > 0 &&
        (hist.outcomeConfidence === "confirmed_sale" || hist.outcomeConfidence === "likely_sale")) {
        const d = hist.medianObservedListingDurationDays;
        return {
            subjectHeadline,
            subjectSubcopy,
            benchmarkKind: "time_to_sell",
            benchmarkHeadline: `${d} ${d === 1 ? "day" : "days"} median time to sell`,
            benchmarkSubcopy: `Based on ${hist.sampleSize} ${hist.outcomeConfidence === "confirmed_sale" ? "confirmed" : "likely"} comparable ${condLabel} ${model} sales in the past ${hist.lookbackDays} days.`,
        };
    }
    const median = m.activeComparables.medianListingAgeDays;
    if (median != null && m.activeComparables.sampleSize > 0) {
        return {
            subjectHeadline,
            subjectSubcopy,
            benchmarkKind: "active_listing_age",
            benchmarkHeadline: `${median} ${median === 1 ? "day" : "days"} median local listing age`,
            benchmarkSubcopy: `Comparable ${condLabel} ${model} vehicles currently listed within ${radius} miles${checked ? `, checked ${checked}` : ""}. This is current listing age, not time to sell.`,
        };
    }
    return {
        subjectHeadline,
        subjectSubcopy,
        benchmarkKind: "unavailable",
        benchmarkHeadline: "Market timing unavailable",
        benchmarkSubcopy: "We couldn't verify a reliable local days-on-market benchmark for this vehicle.",
    };
}
