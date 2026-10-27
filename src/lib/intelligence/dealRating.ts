// ── Deal Rating ────────────────────────────────────────────────────────────
//
// The dealer's asking price measured against the AutoLabels Market Value
// (master build section 32). It is its own conclusion: the Vehicle Score is
// not an input here and the price is not an input there, so a markdown can
// move the rating and can never move the score. The thresholds are
// configuration with defaults, calibrated server-side, never literals in a
// UI. When the value cannot be trusted the rating is unavailable with the
// reason, never a guess.

import type { PriceBasisStatus } from "../market/types.ts";
import type {
  DealRatingLabel, DealRatingResult, DealRatingThresholds, MarketValueV3, ValuationConfidence,
} from "./contracts.ts";

export const DEAL_RATING_VERSION = "deal-rating-v1.0.0-shadow";

/** Signed percent of market value; asking below value is negative. Starting calibration, overridable per call. */
export const DEFAULT_DEAL_RATING_THRESHOLDS: DealRatingThresholds = {
  greatValueMaxPct: -5,
  goodValueMaxPct: -1.5,
  fairPriceMaxPct: 2,
  aboveMarketMaxPct: 7,
};

export const VALUATION_CONFIDENCE_RANK: Record<ValuationConfidence, number> = {
  unavailable: 0, low: 1, medium: 2, high: 3,
};

export const DEFAULT_MINIMUM_VALUATION_CONFIDENCE: ValuationConfidence = "medium";

/** Outside this band an asking price is a data error, not a deal. */
export const DEFAULT_PLAUSIBLE_ASKING_PRICE = { min: 1000, max: 500000 };

export interface DealRatingInput {
  /** The vehicle comparison price: doc fee excluded, conditional discounts added back (market/priceBasis.ts). */
  askingPrice: number | null | undefined;
  /** From resolvePriceBasis; an invalid basis cannot be rated. */
  basisStatus?: PriceBasisStatus | null;
  marketValue: MarketValueV3;
  vehicleType?: "new" | "used";
}

export interface DealRatingOptions {
  thresholds?: Partial<DealRatingThresholds>;
  minimumConfidence?: ValuationConfidence;
  plausibleAskingPrice?: { min: number; max: number };
  /** New vehicles are rated only when a surface asks for it explicitly. */
  rateNewVehicles?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const monotonic = (t: DealRatingThresholds): boolean =>
  t.greatValueMaxPct < t.goodValueMaxPct && t.goodValueMaxPct < t.fairPriceMaxPct && t.fairPriceMaxPct < t.aboveMarketMaxPct;

export function resolveDealRatingThresholds(
  overrides?: Partial<DealRatingThresholds>,
): { thresholds: DealRatingThresholds; reasons: string[] } {
  const merged: DealRatingThresholds = { ...DEFAULT_DEAL_RATING_THRESHOLDS, ...(overrides ?? {}) };
  const allFinite = Object.values(merged).every((v) => typeof v === "number" && Number.isFinite(v));
  if (!allFinite || !monotonic(merged)) {
    return { thresholds: { ...DEFAULT_DEAL_RATING_THRESHOLDS }, reasons: ["thresholds_not_monotonic_defaults_used"] };
  }
  return { thresholds: merged, reasons: [] };
}

export function labelForDelta(deltaPct: number, t: DealRatingThresholds): Exclude<DealRatingLabel, "unavailable"> {
  if (deltaPct <= t.greatValueMaxPct) return "great_value";
  if (deltaPct <= t.goodValueMaxPct) return "good_value";
  if (deltaPct <= t.fairPriceMaxPct) return "fair_price";
  if (deltaPct <= t.aboveMarketMaxPct) return "above_market";
  return "well_above_market";
}

export function buildDealRating(input: DealRatingInput, options: DealRatingOptions = {}): DealRatingResult {
  const { thresholds, reasons: thresholdReasons } = resolveDealRatingThresholds(options.thresholds);
  const minimum = options.minimumConfidence ?? DEFAULT_MINIMUM_VALUATION_CONFIDENCE;
  const plausible = options.plausibleAskingPrice ?? DEFAULT_PLAUSIBLE_ASKING_PRICE;
  const mv = input.marketValue;
  const asking = typeof input.askingPrice === "number" && Number.isFinite(input.askingPrice) ? input.askingPrice : null;
  const reasons: string[] = [...thresholdReasons];

  const unavailable = (why: string, applicable = true): DealRatingResult => ({
    version: DEAL_RATING_VERSION,
    label: "unavailable",
    askingPrice: asking,
    marketValue: mv.estimatedValue,
    deltaDollars: null,
    deltaPct: null,
    valuationConfidence: mv.confidence,
    thresholds,
    applicable,
    reasons: [...reasons, why],
  });

  if (input.vehicleType === "new" && options.rateNewVehicles !== true) {
    return unavailable("new_vehicle_rating_not_enabled", false);
  }
  if (input.basisStatus === "invalid") return unavailable("price_basis_invalid");
  if (asking == null || asking <= 0) return unavailable("asking_price_missing");
  if (asking < plausible.min || asking > plausible.max) return unavailable("asking_price_implausible");
  if (mv.estimatedValue == null || !Number.isFinite(mv.estimatedValue) || mv.estimatedValue <= 0) {
    return unavailable("market_value_unavailable");
  }
  if (VALUATION_CONFIDENCE_RANK[mv.confidence] < VALUATION_CONFIDENCE_RANK[minimum]) {
    return unavailable(`valuation_confidence_${mv.confidence}_below_minimum_${minimum}`);
  }

  const deltaDollars = Math.round(asking - mv.estimatedValue);
  const deltaPct = round2(((asking - mv.estimatedValue) / mv.estimatedValue) * 100);
  const label = labelForDelta(deltaPct, thresholds);

  if (input.basisStatus === "ambiguous") reasons.push("price_basis_ambiguous");
  if (mv.investigationFlagged) reasons.push("valuation_disagreement_flagged_for_investigation");
  if (mv.freshness.state === "stale") reasons.push("market_value_stale");
  reasons.push(
    deltaPct < 0
      ? `asking_below_market_value_by_${Math.abs(deltaPct)}_percent`
      : deltaPct > 0
        ? `asking_above_market_value_by_${deltaPct}_percent`
        : "asking_at_market_value",
  );

  return {
    version: DEAL_RATING_VERSION,
    label,
    askingPrice: asking,
    marketValue: mv.estimatedValue,
    deltaDollars,
    deltaPct,
    valuationConfidence: mv.confidence,
    thresholds,
    applicable: true,
    reasons,
  };
}
