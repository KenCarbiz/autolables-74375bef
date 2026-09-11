// GENERATED — do not edit.
// Mirror of src/lib/market/compatibilityWrite.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Compatibility columns: the non-destruction rule ────────────────────────
//
// `market-valuation-write` can mirror its conclusion back onto the three
// legacy columns every customer surface still reads:
//
//   vehicle_listings.market_value      PublicListing, TrustStrip, Passport
//   vehicle_listings.market_position   the same three
//   vehicle_listings.market_payload
//
// The write it used to perform was:
//
//   market_value:    view.marketP50
//   market_position: null
//
// On the one vehicle we have actually valued, `marketP50` is null — zero of
// seven comparables were eligible, so there is no percentile to publish.
// Flipping `market_value_v2_admin` would therefore have written NULL over
// $39,158 and NULL over `above_market`, blanking a claim on a published
// vehicle. The flag is named "admin"; the columns are the customer's.
//
// Two separate failures, and this module refuses both:
//
//   1. ERASURE. Absence of a V2 answer is not a V2 answer of "none". A null
//      never overwrites a non-null legacy value or position.
//   2. HALF-WRITES. A new value beside an old position is a vehicle whose
//      number and whose word were decided by different engines, months apart.
//      Value and position move together or neither moves.
//
// And one rule about authority: a feature flag says a tenant is willing to
// SEE V2. It does not say anyone approved V2's vocabulary replacing the legacy
// one on a published page. Until a value-and-position mapping is approved on
// its own, `approvedPositionMapping` is null and the safe answer is: no
// compatibility update, `compatibility_updated: false`, evidence intact.
//
// Nothing here touches the append-only evidence tables. Those are written once
// by the commit RPC and never revised.

import type { MarketConfidence, MarketViewStatus } from "./types.ts";

export interface LegacyMarketColumns {
  market_value: number | null;
  market_position: string | null;
}

export interface CompatibilityCandidate {
  /** The percentile of the ELIGIBLE comparable set. Never the provider's prediction. */
  marketP50: number | null;
  status: MarketViewStatus;
  confidence: MarketConfidence;
  checkedAt: string | null;
  verdict: string;
  /**
   * How many comparables actually survived eligibility. Zero means the
   * percentile, if somehow present, rests on nothing.
   */
  effectiveComparableCount: number;
  /**
   * The paid provider number. Carried ONLY so this module can refuse to let it
   * become the compatibility value on its own.
   */
  providerPrediction: number | null;
  /**
   * The approved legacy position this verdict maps to. Null until a mapping is
   * signed off separately — and null means no write, not a blank write.
   */
  approvedPositionMapping: string | null;
}

export interface CompatibilityPatch {
  market_value: number;
  market_position: string;
  market_checked_at: string;
  market_payload: Record<string, unknown>;
}

export interface CompatibilityDecision {
  /** False is the safe answer and the current answer. */
  update: boolean;
  patch: CompatibilityPatch | null;
  reasons: string[];
}

/** Confidence tiers that may speak about a published vehicle. */
const PUBLISHABLE_CONFIDENCE: MarketConfidence[] = ["high", "medium"];

export function decideCompatibilityWrite(input: {
  flagEnabled: boolean;
  legacy: LegacyMarketColumns;
  candidate: CompatibilityCandidate;
  payload: Record<string, unknown>;
}): CompatibilityDecision {
  const reasons: string[] = [];
  const { legacy, candidate } = input;
  const refuse = (): CompatibilityDecision => ({ update: false, patch: null, reasons });

  if (!input.flagEnabled) {
    reasons.push("compatibility_flag_off");
    return refuse();
  }

  // The flag is consent to see V2, not authorization to retire the legacy
  // vocabulary on a published page. Checked FIRST and on its own so the
  // evidence says plainly that a flag was not sufficient.
  if (candidate.approvedPositionMapping == null) {
    reasons.push("legacy_position_mapping_not_approved");
    reasons.push("flag_alone_is_not_authorization_for_a_destructive_write");
    return refuse();
  }

  if (candidate.status !== "available") {
    reasons.push(`v2_status_${candidate.status}`);
    if (legacy.market_value != null) reasons.push("would_erase_legacy_market_value");
    if (legacy.market_position != null) reasons.push("would_erase_legacy_market_position");
    return refuse();
  }

  if (!PUBLISHABLE_CONFIDENCE.includes(candidate.confidence)) {
    reasons.push(`v2_confidence_${candidate.confidence}`);
    return refuse();
  }

  if (candidate.marketP50 == null || !(candidate.marketP50 > 0)) {
    reasons.push("v2_market_value_absent");
    if (legacy.market_value != null) reasons.push("would_erase_legacy_market_value");
    return refuse();
  }

  // A prediction is one provider's opinion about one car. The compatibility
  // value is a market position, and a market position needs a market.
  if (candidate.effectiveComparableCount <= 0) {
    reasons.push("no_effective_comparables");
    if (candidate.providerPrediction != null) {
      reasons.push("provider_prediction_is_not_a_market_value");
    }
    return refuse();
  }

  if (!candidate.approvedPositionMapping.trim()) {
    reasons.push("approved_position_mapping_blank");
    if (legacy.market_position != null) reasons.push("would_erase_legacy_market_position");
    return refuse();
  }

  if (!candidate.checkedAt) {
    reasons.push("v2_checked_at_absent");
    return refuse();
  }

  reasons.push("compatibility_write_authorized");
  return {
    update: true,
    // Value and position, together, or not at all.
    patch: {
      market_value: candidate.marketP50,
      market_position: candidate.approvedPositionMapping,
      market_checked_at: candidate.checkedAt,
      market_payload: input.payload,
    },
    reasons,
  };
}

/** A patch that would blank or downgrade a legacy claim. The guard predicate. */
export function wouldDestroyLegacyClaim(
  legacy: LegacyMarketColumns,
  patch: Partial<Record<"market_value" | "market_position", unknown>> | null,
): boolean {
  if (!patch) return false;
  const value = patch.market_value;
  const position = patch.market_position;
  if (legacy.market_value != null && (value === null || value === undefined)) return true;
  if (legacy.market_position != null && (position === null || position === undefined)) return true;
  return false;
}
