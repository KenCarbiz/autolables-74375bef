// MarketCheck call metering.
//
// These are PUBLIC LIST PRICES. The table was first captured 2026-08-01 from
// marketcheck.com/apis and revised 2026-10-27 from the owner's change order,
// which carried the then-current pricing page values (the build environment
// cannot reach marketcheck.com, so the revision is recorded as owner-supplied
// rather than read from the page). A customer's negotiated contract, plan
// minimums and entitlements govern actual billing, so everything here is an
// ESTIMATE for operator visibility — never a bill, never shown to a dealer,
// and never a constant a business rule may read directly: consumers go
// through the provider registry's `effectiveCost`, which lets tenant
// configuration override any value here.

/** Per-call list price in USD, keyed by the product each endpoint bills under. */
export const MC_CALL_PRICE_USD: Record<string, number> = {
  dealer_inventory_syndication: 1.0,
  inventory_search: 0.002,
  dealer_api: 0.0025,
  vin_history: 0.006,
  // 2026-10-27: Market Days Supply and Inferred Sales Stats were 0.006 in the
  // 2026-08-01 capture; both are now listed at 0.002. Past Inventory Search
  // (recents) moved from 0.006 to 0.0025.
  market_days_supply: 0.002,
  recent_inventory: 0.0025,
  sales_stats: 0.002,
  price_prediction: 0.07,
  neovin: 0.08,
  basic_vin_decode: 0.0015,
  auto_recalls: 0.07,
  cached_images: 0.001,
  oem_incentive: 0.2,
  // 2026-10-27: newly priced products.
  marketmatch: 0.35,
  auction: 0.008,
  fsbo: 0.01,
  vindata_generate: 0.49,
  available_options_packages: 0.002,
  unknown: 0,
};

export const MC_PRICE_SOURCE =
  "marketcheck.com/apis public list, captured 2026-08-01, revised 2026-10-27 from the owner change order (unverified against the live page from this environment)";

/**
 * Map a MarketCheck URL to the product it bills under. Path order matters:
 * the more specific prefixes are tested first.
 */
export function billingProductForUrl(url: string): string {
  const path = url.split("?")[0].replace(/^https?:\/\/[^/]+/, "");
  if (path.includes("/dealerships/inventory")) return "dealer_inventory_syndication";
  if (path.includes("/dealerships/") || path.includes("/dealers/") || path.includes("/dealer/")) return "dealer_api";
  if (path.includes("/history/car/")) return "vin_history";
  if (path.includes("/mds/car")) return "market_days_supply";
  if (path.includes("/search/car/recents")) return "recent_inventory";
  if (path.includes("/search/car/auction/")) return "auction";
  if (path.includes("/search/car/fsbo/")) return "fsbo";
  if (path.includes("/sales/car") || path.includes("/sold/car")) return "sales_stats";
  if (path.includes("/marketmatch/")) return "marketmatch";
  if (path.includes("/vindata/generate-report")) return "vindata_generate";
  if (path.includes("/predict/car/")) return "price_prediction";
  if (path.includes("/decode/car/neovin/")) return "neovin";
  if (path.includes("/decode/car/")) return "basic_vin_decode";
  if (path.includes("/recall/car/") || path.includes("/autorecalls/")) return "auto_recalls";
  if (path.includes("/image/cache/car/")) return "cached_images";
  if (path.includes("/incentive/")) return "oem_incentive";
  if (path.includes("/search/car/")) return "inventory_search";
  return "unknown";
}

export interface CallMeter {
  /** Calls made, keyed by billing product. */
  calls: Record<string, number>;
  total: number;
}

export const newCallMeter = (): CallMeter => ({ calls: {}, total: 0 });

export function recordCall(meter: CallMeter, url: string): void {
  const product = billingProductForUrl(url);
  meter.calls[product] = (meter.calls[product] || 0) + 1;
  meter.total += 1;
}

export interface CostEstimate {
  calls: Record<string, number>;
  totalCalls: number;
  /** Estimated USD for this run, rounded to the cent. */
  estimatedUsd: number;
  /** Per-product USD breakdown, largest first. */
  breakdown: Array<{ product: string; calls: number; usd: number }>;
  /** Straight-line month at this run's rate — a planning figure, not a forecast. */
  projectedMonthlyUsd: number;
  priceSource: string;
  /** True when any call hit an endpoint we have no list price for. */
  hasUnpricedCalls: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Turn a run's meter into an estimate.
 * `runsPerMonth` projects a straight line — 30 for a nightly sync.
 * `prices` lets a caller substitute configured unit costs for the list table.
 */
export function estimateCost(
  meter: CallMeter,
  runsPerMonth = 30,
  prices: Record<string, number> = MC_CALL_PRICE_USD,
): CostEstimate {
  const breakdown = Object.entries(meter.calls)
    .map(([product, calls]) => ({
      product,
      calls,
      usd: round2(calls * (prices[product] ?? 0)),
    }))
    .sort((a, b) => b.usd - a.usd || b.calls - a.calls);

  const estimatedUsd = round2(breakdown.reduce((s, b) => s + b.usd, 0));
  return {
    calls: meter.calls,
    totalCalls: meter.total,
    estimatedUsd,
    breakdown,
    projectedMonthlyUsd: round2(estimatedUsd * runsPerMonth),
    priceSource: MC_PRICE_SOURCE,
    hasUnpricedCalls: Object.keys(meter.calls).some((p) => p === "unknown" || prices[p] === undefined),
  };
}
