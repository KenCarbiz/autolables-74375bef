// GENERATED — do not edit.
// Mirror of src/lib/market/verdict.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Verdict ────────────────────────────────────────────────────────────────
//
// The dealer screen currently computes 43,876 − 39,158 and prints "$4,718
// Above Market". Both halves of that subtraction are wrong: the left is
// fee-inclusive and the right priced a certified car as an ordinary one. The
// output is a red accusation built from two mismatched numbers, and no part of
// the code that drew it could say where it came from.
//
// A bare dollar-sign test is therefore prohibited. Every verdict here is a
// function of the comparison price against a RANGE, gated by confidence, with
// a buffer so a rounding difference cannot flip a car into red.
//
// Red is reachable from exactly one place — Section 21 — and every one of its
// conditions is an argument about evidence, not about price.

import { CONCENTRATION_CAP } from "./concentration.ts";
import { isPrimaryTier } from "./comparables.ts";
import {
  HIGH_MIN_EFFECTIVE_PRIMARY, HIGH_MIN_ROOFTOPS, HIGH_MAX_PROVIDER_DISAGREEMENT,
  providerDisagreement,
} from "./confidence.ts";
import type {
  ComparableTier, MarketConfidence, MarketPriceBasis, VerdictResult, WeightedStats,
} from "./types.ts";

export const MIN_BUFFER_DOLLARS = 500;
export const BUFFER_PERCENT = 0.02;

/** max($500, 2% of the market median). */
export const verdictBuffer = (marketP50: number | null): number | null =>
  marketP50 == null || marketP50 <= 0 ? null : Math.max(MIN_BUFFER_DOLLARS, marketP50 * BUFFER_PERCENT);

export interface VerdictInput {
  priceBasis: MarketPriceBasis;
  confidence: MarketConfidence;
  stats: WeightedStats;
  winningTier: ComparableTier | null;
  providerPrediction: number | null;
  concentrationUnderAllocated: boolean;
  materialContradictions: string[];
}

export interface RedGateResult {
  allowed: boolean;
  failures: string[];
}

/**
 * Section 21, as a single function, so no surface can approximate it.
 *
 * Everything here is required. A failure anywhere downgrades to amber or to a
 * neutral statement — never to a softer shade of red.
 */
export function redWarningGate(input: VerdictInput): RedGateResult {
  const { stats, priceBasis } = input;
  const price = priceBasis.vehicleComparisonPrice;
  const buffer = verdictBuffer(stats.p50);
  const upper = stats.p90 ?? stats.p75;
  const disagreement = providerDisagreement(input.providerPrediction, stats.p50);

  const checks: [boolean, string][] = [
    [priceBasis.basisStatus === "verified", "price_basis_not_verified"],
    [input.confidence === "high", "confidence_not_high"],
    [input.winningTier != null && isPrimaryTier(input.winningTier), "no_primary_comparable_tier"],
    [stats.effectiveSampleSize >= HIGH_MIN_EFFECTIVE_PRIMARY, "effective_primary_comparables_below_5"],
    [stats.independentRooftopCount >= HIGH_MIN_ROOFTOPS, "independent_dealerships_below_3"],
    [stats.topRooftopShare <= CONCENTRATION_CAP + 1e-9, "rooftop_exceeds_20_percent"],
    [stats.topGroupShare <= CONCENTRATION_CAP + 1e-9, "dealer_group_exceeds_20_percent"],
    [!input.concentrationUnderAllocated, "too_few_sources_for_concentration_rule"],
    [input.materialContradictions.length === 0, "unresolved_material_contradiction"],
    [disagreement == null || disagreement <= HIGH_MAX_PROVIDER_DISAGREEMENT, "provider_and_comparables_disagree"],
    [price != null && upper != null && buffer != null, "no_upper_market_boundary"],
    [price != null && upper != null && buffer != null && price > upper && price - upper > buffer,
      "price_does_not_exceed_upper_boundary_plus_buffer"],
  ];

  const failures = checks.filter(([ok]) => !ok).map(([, why]) => why);
  return { allowed: failures.length === 0, failures };
}

export function resolveVerdict(input: VerdictInput): VerdictResult {
  const { stats, priceBasis, confidence } = input;
  const price = priceBasis.vehicleComparisonPrice;
  const p50 = stats.p50;
  const buffer = verdictBuffer(p50);

  const difference = price != null && p50 != null ? price - p50 : null;
  const differencePercent = difference != null && p50 ? difference / p50 : null;
  const priceToMarketPercent = price != null && p50 ? (price / p50) * 100 : null;

  // Nothing may be claimed. This branch is for a BROKEN input — an invalid
  // basis, a mismatched or expired provider answer — not for a thin market.
  if (confidence === "unavailable" || price == null) {
    return {
      verdict: "Market Estimate Unavailable",
      tone: "neutral",
      difference: null,
      differencePercent: null,
      priceToMarketPercent: null,
      buffer: null,
      reasons: [confidence === "unavailable" ? "confidence_unavailable" : "no_vehicle_comparison_price"],
    };
  }

  const base = { difference, differencePercent, priceToMarketPercent, buffer };

  // The inputs are sound and the evidence is thin. That is a different
  // sentence from "unavailable", and saying the wrong one trains dealers to
  // ignore both. A missing comparable median lands here too: a usable provider
  // estimate with no qualified competitors is limited evidence, not a broken
  // valuation, and it is still never a deal claim.
  if (confidence === "low" || p50 == null) {
    return {
      ...base,
      verdict: "Limited Market Evidence",
      tone: "neutral",
      reasons: p50 == null ? ["no_comparable_market_median"] : ["confidence_low"],
    };
  }

  const lower = stats.p25 ?? p50;
  const upper75 = stats.p75 ?? p50;
  const upper90 = stats.p90 ?? upper75;

  if (confidence === "medium") {
    if (price < lower) {
      return { ...base, verdict: "Competitive Market Position", tone: "green", reasons: ["below_lower_market_range"] };
    }
    if (price <= upper75) {
      return { ...base, verdict: "Within Adjusted Market", tone: "neutral", reasons: ["inside_market_range"] };
    }
    if (buffer != null && price <= upper75 + buffer) {
      return { ...base, verdict: "High End of Adjusted Market", tone: "amber", reasons: ["above_range_within_buffer"] };
    }
    return {
      ...base,
      verdict: "High End of Adjusted Market — Review Recommended",
      tone: "amber",
      reasons: ["above_range_beyond_buffer", "medium_confidence_never_red"],
    };
  }

  // High confidence.
  if (price < lower) {
    return { ...base, verdict: "Below Adjusted Market", tone: "green", reasons: ["below_p25"] };
  }
  if (price <= upper75) {
    return { ...base, verdict: "Within Adjusted Market", tone: "neutral", reasons: ["p25_to_p75"] };
  }
  if (price <= upper90) {
    return { ...base, verdict: "High End of Adjusted Market", tone: "amber", reasons: ["p75_to_p90"] };
  }

  const gate = redWarningGate(input);
  if (gate.allowed) {
    return { ...base, verdict: "Above Adjusted Market", tone: "red", reasons: ["above_p90_and_buffer"] };
  }
  return {
    ...base,
    verdict: "High End of Adjusted Market",
    tone: "amber",
    reasons: ["red_gate_failed", ...gate.failures],
  };
}
