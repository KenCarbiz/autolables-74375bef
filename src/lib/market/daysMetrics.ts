// ── Market days-on-market governance ────────────────────────────────────────
// A single "154 days" is meaningless without its definition, population, window,
// sample size and timestamp. Three DISTINCT measurements are kept separate and
// never conflated:
//   1. This vehicle's inventory age (days since first listed at this dealer)
//   2. Local comparable ACTIVE listing age (current age, not time-to-sale)
//   3. Local comparable time-to-SELL (only with trustworthy sale/delist data)
// Active inventory can only prove current listing age — never completed
// time-to-sale. Model-year age is never substituted for listing age.

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
  // Subject-vehicle line (about THIS car), independent of the benchmark.
  subjectHeadline: string | null;      // "17 days at this dealership"
  subjectSubcopy: string | null;       // "First listed Jul 2, 2026"
  // Market benchmark line.
  benchmarkHeadline: string;           // "54 days median local listing age" | "Market timing unavailable"
  benchmarkSubcopy: string;
  benchmarkKind: "time_to_sell" | "active_listing_age" | "unavailable";
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  // Caller passes ISO; format without Date.now dependence.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/**
 * Resolve what the customer page may honestly show. Pure + deterministic.
 * Rules: median is the primary benchmark; time-to-sell only with confirmed/likely
 * sale data; otherwise active listing age; otherwise "unavailable". Never invents.
 */
export function resolveMarketDaysDisplay(m: MarketDaysMetrics): DaysDisplay {
  const cond = m.activeComparables.filters.condition;
  const model = m.activeComparables.filters.model || "vehicle";
  const radius = m.activeComparables.radiusMiles;
  const checked = fmtDate(m.checkedAt);

  // Subject vehicle — its own listing age at this dealership.
  const age = m.subjectVehicle.currentListingAgeDays;
  const firstSeen = fmtDate(m.subjectVehicle.dealerInventoryStartAt ?? m.subjectVehicle.firstSeenAt);
  const subjectHeadline = age != null ? `${age} ${age === 1 ? "day" : "days"} at this dealership` : null;
  const subjectSubcopy = firstSeen ? `First listed ${firstSeen}` : null;

  // Benchmark — prefer confirmed time-to-sell, else active listing age, else none.
  const hist = m.historicalComparables;
  const condLabel = cond === "new" ? "new" : cond === "cpo" ? "certified" : "used";

  if (hist && hist.medianObservedListingDurationDays != null && hist.sampleSize > 0 &&
      (hist.outcomeConfidence === "confirmed_sale" || hist.outcomeConfidence === "likely_sale")) {
    const d = hist.medianObservedListingDurationDays;
    return {
      subjectHeadline, subjectSubcopy,
      benchmarkKind: "time_to_sell",
      benchmarkHeadline: `${d} ${d === 1 ? "day" : "days"} median time to sell`,
      benchmarkSubcopy: `Based on ${hist.sampleSize} ${hist.outcomeConfidence === "confirmed_sale" ? "confirmed" : "likely"} comparable ${condLabel} ${model} sales in the past ${hist.lookbackDays} days.`,
    };
  }

  const median = m.activeComparables.medianListingAgeDays;
  if (median != null && m.activeComparables.sampleSize > 0) {
    return {
      subjectHeadline, subjectSubcopy,
      benchmarkKind: "active_listing_age",
      benchmarkHeadline: `${median} ${median === 1 ? "day" : "days"} median local listing age`,
      benchmarkSubcopy: `Comparable ${condLabel} ${model} vehicles currently listed within ${radius} miles${checked ? `, checked ${checked}` : ""}. This is current listing age, not time to sell.`,
    };
  }

  return {
    subjectHeadline, subjectSubcopy,
    benchmarkKind: "unavailable",
    benchmarkHeadline: "Market timing unavailable",
    benchmarkSubcopy: "We couldn't verify a reliable local days-on-market benchmark for this vehicle.",
  };
}
