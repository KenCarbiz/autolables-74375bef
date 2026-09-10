// ── Confidence ─────────────────────────────────────────────────────────────
//
// Confidence is not decoration on a number. It is the gate that decides
// whether AutoLabels is allowed to make a claim at all, and the only thing
// standing between a thin, contaminated sample and a red warning on a dealer's
// car. Every rule below is a reason to say less.
//
// Three tiers and one trapdoor:
//   unavailable — something is wrong with the inputs. No dollar claim, at all.
//   low         — the evidence exists and is not sufficient. Neutral only.
//   medium      — usable. Amber at the top of the range; never red.
//   high        — the full evidentiary standard, and the only door to red.

import { isPrimaryTier } from "./comparables.ts";
import { CONCENTRATION_CAP } from "./concentration.ts";
import type {
  ComparableTier, MarketConfidence, MarketPriceBasis, ProviderValidation, WeightedStats,
} from "./types.ts";

export const HIGH_MIN_EFFECTIVE_PRIMARY = 5;
export const HIGH_MIN_ROOFTOPS = 3;
export const HIGH_MAX_PROVIDER_DISAGREEMENT = 0.03;
export const HIGH_MAX_PROVIDER_AGE_DAYS = 7;

export const MEDIUM_MIN_EFFECTIVE_PRIMARY = 3;
export const MEDIUM_MIN_ROOFTOPS = 2;
export const MEDIUM_MAX_PROVIDER_DISAGREEMENT = 0.07;
export const MEDIUM_MAX_PROVIDER_AGE_DAYS = 14;

export interface ConfidenceInput {
  priceBasis: MarketPriceBasis;
  providerValidation: ProviderValidation;
  providerAgeDays: number | null;
  providerPrediction: number | null;
  stats: WeightedStats;
  winningTier: ComparableTier | null;
  /** True when at least one comparable carried a real dealer-group id. */
  groupIdentityKnown: boolean;
  /** True when the 20% rule could not be satisfied because sources were too few. */
  concentrationUnderAllocated: boolean;
  /** Unresolved contradictions between sources about history or condition. */
  materialContradictions: string[];
}

export interface ConfidenceResult {
  confidence: MarketConfidence;
  reasons: string[];
}

/** Relative gap between the provider estimate and the comparable median. */
export function providerDisagreement(prediction: number | null, comparableP50: number | null): number | null {
  if (prediction == null || comparableP50 == null || comparableP50 <= 0) return null;
  return Math.abs(prediction - comparableP50) / comparableP50;
}

export function resolveConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];
  const { priceBasis, providerValidation, stats } = input;

  // ── Trapdoor: nothing may be claimed ─────────────────────────────────────
  if (priceBasis.basisStatus === "invalid") {
    return { confidence: "unavailable", reasons: ["price_basis_invalid", ...priceBasis.basisReasons] };
  }
  if (!providerValidation.usable && providerValidation.rejections.length) {
    // A quarantined provider answer is only fatal when there is no comparable
    // market to fall back on. A certification mismatch is fatal either way:
    // the number describes a different car and nothing downstream can undo it.
    const fatal = providerValidation.rejections.filter((r) =>
      r === "provider_input_mismatch"
      || r === "provider_certification_conflict"
      || r === "specification_conflict"
      || r === "invalid_vin"
      || r === "missing_mileage"
      || r === "implausible_mileage"
      || r === "missing_dealer_type"
      || r === "missing_location"
      || r === "unreconstructable_request"
      // Section 19: past the hard TTL the answer is not evidence any more.
      || r === "stale_response");
    if (fatal.length) {
      return { confidence: "unavailable", reasons: fatal.map((r) => `provider_${r}`) };
    }
  }

  const disagreement = providerDisagreement(input.providerPrediction, stats.p50);
  const providerFresh = input.providerAgeDays != null && input.providerAgeDays <= HIGH_MAX_PROVIDER_AGE_DAYS;
  const providerUsable = input.providerAgeDays != null && input.providerAgeDays <= MEDIUM_MAX_PROVIDER_AGE_DAYS;

  // ── High ─────────────────────────────────────────────────────────────────
  const highChecks: [boolean, string][] = [
    [priceBasis.basisStatus === "verified", "price_basis_not_verified"],
    [providerValidation.usable, "provider_answer_not_usable"],
    [!providerValidation.cautions.includes("provider_did_not_echo_certification")
      || input.providerPrediction != null, "certification_unconfirmed"],
    [providerFresh, "provider_answer_older_than_seven_days"],
    [stats.effectiveSampleSize >= HIGH_MIN_EFFECTIVE_PRIMARY,
      `effective_primary_comparables_below_${HIGH_MIN_EFFECTIVE_PRIMARY}`],
    [stats.independentRooftopCount >= HIGH_MIN_ROOFTOPS,
      `independent_rooftops_below_${HIGH_MIN_ROOFTOPS}`],
    [stats.topRooftopShare <= CONCENTRATION_CAP + 1e-9, "one_rooftop_exceeds_concentration_cap"],
    [stats.topGroupShare <= CONCENTRATION_CAP + 1e-9, "one_dealer_group_exceeds_concentration_cap"],
    [!input.concentrationUnderAllocated, "too_few_sources_for_concentration_rule"],
    [input.groupIdentityKnown, "dealer_group_identity_unknown"],
    [input.winningTier != null && isPrimaryTier(input.winningTier), "no_primary_comparable_tier"],
    [disagreement != null && disagreement <= HIGH_MAX_PROVIDER_DISAGREEMENT,
      "provider_and_comparable_evidence_disagree"],
    [input.materialContradictions.length === 0, "unresolved_material_contradiction"],
  ];

  const highFailures = highChecks.filter(([ok]) => !ok).map(([, why]) => why);
  if (!highFailures.length) return { confidence: "high", reasons: [] };

  // ── Medium ───────────────────────────────────────────────────────────────
  // An invalid basis already returned above, so it is not re-checked here.
  const mediumChecks: [boolean, string][] = [
    [providerUsable || input.providerPrediction == null, "provider_answer_expired"],
    [stats.effectiveSampleSize >= MEDIUM_MIN_EFFECTIVE_PRIMARY,
      `effective_primary_comparables_below_${MEDIUM_MIN_EFFECTIVE_PRIMARY}`],
    [stats.independentRooftopCount >= MEDIUM_MIN_ROOFTOPS,
      `independent_rooftops_below_${MEDIUM_MIN_ROOFTOPS}`],
    [disagreement == null || disagreement <= MEDIUM_MAX_PROVIDER_DISAGREEMENT,
      "provider_and_comparable_evidence_disagree"],
    [input.winningTier != null && isPrimaryTier(input.winningTier), "no_primary_comparable_tier"],
  ];
  const mediumFailures = mediumChecks.filter(([ok]) => !ok).map(([, why]) => why);
  if (!mediumFailures.length) {
    reasons.push(...highFailures);
    return { confidence: "medium", reasons };
  }

  reasons.push(...new Set([...mediumFailures, ...highFailures]));
  return { confidence: "low", reasons };
}
