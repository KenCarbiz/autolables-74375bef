// MarketCheck call metering.
//
// These are PUBLIC LIST PRICES captured 2026-08-01 from marketcheck.com/apis.
// A customer's negotiated contract, plan minimums, and entitlements govern
// actual billing, so everything here is an ESTIMATE for operator visibility —
// never a bill, and never shown to a dealer.

/** Per-call list price in USD, keyed by the product each endpoint bills under. */
export const MC_CALL_PRICE_USD: Record<string, number> = {
  dealer_inventory_syndication: 1.0,
  inventory_search: 0.002,
  dealer_api: 0.0025,
  vin_history: 0.006,
  market_days_supply: 0.006,
  recent_inventory: 0.006,
  sales_stats: 0.006,
  price_prediction: 0.07,
  neovin: 0.08,
  basic_vin_decode: 0.0015,
  auto_recalls: 0.07,
  cached_images: 0.001,
  oem_incentive: 0.2,
  unknown: 0,
};

export const MC_PRICE_SOURCE = "marketcheck.com/apis public list, 2026-08-01";

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
  if (path.includes("/sales/car")) return "sales_stats";
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
 */
export function estimateCost(meter: CallMeter, runsPerMonth = 30): CostEstimate {
  const breakdown = Object.entries(meter.calls)
    .map(([product, calls]) => ({
      product,
      calls,
      usd: round2(calls * (MC_CALL_PRICE_USD[product] ?? 0)),
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
    hasUnpricedCalls: (meter.calls.unknown || 0) > 0,
  };
}
