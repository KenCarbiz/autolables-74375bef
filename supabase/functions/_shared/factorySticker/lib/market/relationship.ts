// GENERATED — do not edit.
// Mirror of src/lib/market/relationship.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Two questions that were one, and should never have been ───────────────
//
// Gate 14G refused Ken's QX60 pair. It was right about the facts and wrong
// about the consequence: one car has a Vision Package and a BOSE Performance
// Package, the other does not, so they are not interchangeable — but they are
// unquestionably in the SAME MARKET. When two competing 2023 QX60 LUXEs leave
// the market and prices rise, both of Harte's cars are affected, whatever is
// bolted to them.
//
// Collapsing the two questions cost us the whole point of shared evidence:
// across five real Harte clusters, exactly ONE compatible pair existed, so
// propagation was inert.
//
// So there are two relationships now, and they answer different questions:
//
//   MarketAwarenessRelationship — "did MY market just move?"
//       Ignores equipment entirely. A package does not move a car to a
//       different market; it moves its position WITHIN one.
//
//   ValuationCompatibility — "may this car be a comparable for that one?"
//       Equipment matters completely here, and an unadjusted comparison
//       between differently-equipped cars is exactly the error the cohort
//       rules exist to prevent.
//
// The safety property is unchanged and is the reason the split is safe: only
// `exact` may serve as an unadjusted primary comparable. `adjustment_required`
// is a real, named relationship that earns a vehicle a fresh look — and
// nothing else — until a separate gate approves a deterministic adjustment
// method. This gate invents no dollar figures.

import {
  cohortsMatch, equipmentDifference, EQUIPMENT_UNKNOWN,
  type MarketCohortKey,
} from "./cohort.ts";

/** Bump when the meaning of either relationship changes. */
export const RELATIONSHIP_RULES_VERSION = "relationship-v1.0.0";

// ── Layer A: is it the same market? ────────────────────────────────────────

export type MarketAwarenessRelationship =
  | "same_market"
  | "related_market"
  | "indeterminate"
  | "different_market";

export interface AwarenessMatch {
  relationship: MarketAwarenessRelationship;
  reasons: string[];
}

/**
 * The dimensions that define a MARKET.
 *
 * Equipment is deliberately absent. Everything here changes which cars a
 * shopper is choosing between; a package changes which of those cars they pick.
 */
const MARKET_DEFINING = [
  ["year", "market_year_differs"],
  ["make", "market_make_differs"],
  ["model", "market_model_differs"],
  ["trim", "market_trim_differs"],
  ["drivetrain", "market_drivetrain_differs"],
  ["powertrain", "market_powertrain_differs"],
  ["bodyType", "market_body_differs"],
  ["vehicleClass", "market_class_differs"],
  ["certifiedClass", "market_certification_differs"],
  ["zip", "market_geography_differs"],
  ["radiusMiles", "market_radius_differs"],
] as const;

export function marketAwarenessRelationship(
  a: MarketCohortKey,
  b: MarketCohortKey,
): AwarenessMatch {
  const reasons: string[] = [];

  if (a.cohortRulesVersion !== b.cohortRulesVersion) {
    return { relationship: "different_market", reasons: ["market_rules_version_differs"] };
  }
  // A key that is not usable is not a refusal about the market — it is an
  // absence of the information needed to answer.
  if (!a.usable || !b.usable) {
    return {
      relationship: "indeterminate",
      reasons: ["market_identity_incomplete", ...a.reasons.filter((r) => r.endsWith("_unknown")),
        ...b.reasons.filter((r) => r.endsWith("_unknown"))],
    };
  }

  for (const [dimension, reason] of MARKET_DEFINING) {
    if (a[dimension] === b[dimension]) continue;

    // An adjacent model year in an otherwise identical market is a real
    // relationship and still not the same market.
    if (dimension === "year" && a.year != null && b.year != null
      && Math.abs(a.year - b.year) === 1) {
      const restMatch = MARKET_DEFINING.filter(([d]) => d !== "year")
        .every(([d]) => a[d] === b[d]);
      if (restMatch) {
        return {
          relationship: "related_market",
          reasons: ["market_adjacent_model_year", "market_same_generation_not_approved"],
        };
      }
    }
    reasons.push(reason);
    return { relationship: "different_market", reasons };
  }

  reasons.push("market_same");
  // Recorded, never disqualifying: equipment has no vote on which market a
  // car is in, and saying so out loud is what stops it creeping back.
  if (a.equipmentSignature !== b.equipmentSignature) {
    reasons.push("market_equipment_differs_but_market_is_shared");
  }
  return { relationship: "same_market", reasons };
}

/** Only this relationship earns a vehicle a fresh look at a changed market. */
export const mayReceiveMarketAwareness = (m: AwarenessMatch): boolean =>
  m.relationship === "same_market";

// ── Layer B: may it serve as a comparable? ────────────────────────────────

export type ValuationCompatibility =
  | "exact"
  | "adjustment_required"
  | "context_only"
  | "indeterminate"
  | "incompatible";

export interface CompatibilityMatch {
  compatibility: ValuationCompatibility;
  /** The awareness answer this was built on, so the two never drift apart. */
  awareness: MarketAwarenessRelationship;
  /** Material equipment present on one side only. Never a dollar figure. */
  equipmentOnlyInSubject: string[];
  equipmentOnlyInCandidate: string[];
  reasons: string[];
}

export function valuationCompatibility(
  subject: MarketCohortKey,
  candidate: MarketCohortKey,
): CompatibilityMatch {
  const awareness = marketAwarenessRelationship(subject, candidate);
  const base = {
    awareness: awareness.relationship,
    equipmentOnlyInSubject: [] as string[],
    equipmentOnlyInCandidate: [] as string[],
  };

  if (awareness.relationship === "different_market") {
    return { ...base, compatibility: "incompatible", reasons: awareness.reasons };
  }
  if (awareness.relationship === "indeterminate") {
    return { ...base, compatibility: "indeterminate", reasons: awareness.reasons };
  }
  if (awareness.relationship === "related_market") {
    // An adjacent year may inform a picture. It may not price a car.
    return {
      ...base,
      compatibility: "context_only",
      reasons: [...awareness.reasons, "comparable_adjacent_year_context_only"],
    };
  }

  // Same market. Now equipment decides what KIND of comparable this is.
  const subjectUnknown = subject.equipmentSignature === EQUIPMENT_UNKNOWN;
  const candidateUnknown = candidate.equipmentSignature === EQUIPMENT_UNKNOWN;
  if (subjectUnknown || candidateUnknown) {
    return {
      ...base,
      compatibility: "indeterminate",
      reasons: [
        "comparable_equipment_indeterminate",
        subjectUnknown && candidateUnknown ? "comparable_equipment_unknown_both"
          : subjectUnknown ? "comparable_equipment_unknown_subject"
          : "comparable_equipment_unknown_candidate",
        "comparable_equipment_enrichment_would_resolve",
      ],
    };
  }

  if (subject.equipmentSignature === candidate.equipmentSignature) {
    return { ...base, compatibility: "exact", reasons: [...awareness.reasons, "comparable_exact"] };
  }

  return {
    ...base,
    compatibility: "adjustment_required",
    reasons: [
      ...awareness.reasons,
      "comparable_material_equipment_differs",
      // Stated so nothing downstream can mistake this for a usable price.
      "comparable_adjustment_method_not_approved",
      "comparable_context_only_until_adjustment_approved",
    ],
  };
}

/**
 * Explain an `adjustment_required` relationship without pricing it.
 *
 * Returns the material packages and option codes present on one side only.
 * There is deliberately no amount, no MSRP, no residual and no depreciation —
 * inventing any of those is a separate gate's decision, and guessing one here
 * would be worse than the unadjusted comparison this exists to prevent.
 */
export interface EquipmentGap {
  known: boolean;
  onlyInSubject: string[];
  onlyInCandidate: string[];
  shared: string[];
  reasons: string[];
}

export function describeEquipmentGap(
  subjectEquipment: unknown,
  candidateEquipment: unknown,
): EquipmentGap {
  const diff = equipmentDifference(subjectEquipment, candidateEquipment);
  const reasons: string[] = [];
  if (!diff.known) reasons.push("equipment_gap_indeterminate");
  else {
    if (diff.onlyInA.length) reasons.push(`equipment_only_in_subject_${diff.onlyInA.length}`);
    if (diff.onlyInB.length) reasons.push(`equipment_only_in_candidate_${diff.onlyInB.length}`);
    if (!diff.onlyInA.length && !diff.onlyInB.length) reasons.push("equipment_identical");
  }
  return {
    known: diff.known,
    onlyInSubject: diff.onlyInA,
    onlyInCandidate: diff.onlyInB,
    shared: diff.shared,
    reasons,
  };
}

// ── What each relationship is allowed to do ───────────────────────────────

/** An unadjusted primary comparable. The only one. */
export const mayServeAsPrimaryComparable = (m: CompatibilityMatch): boolean =>
  m.compatibility === "exact";

/**
 * May inform diagnostics and an operator's picture; may never determine a
 * market value. `adjustment_required` lives here until a deterministic
 * adjustment method is separately approved.
 */
export const isContextOnlyEvidence = (m: CompatibilityMatch): boolean =>
  m.compatibility === "adjustment_required" || m.compatibility === "context_only";

/** Fixable by decoding the car. Not a rejection — a work item. */
export const needsEquipmentEvidence = (m: CompatibilityMatch): boolean =>
  m.compatibility === "indeterminate";

/**
 * The label an internal surface must use.
 *
 * `adjustment_required` is never rendered as plain "comparable": the qualifier
 * is part of the name, because an operator reading "comparable" will assume a
 * price was adjusted and none was.
 */
export const COMPATIBILITY_LABEL: Record<ValuationCompatibility, string> = {
  exact: "Exact comparable",
  adjustment_required: "Same market — equipment differs, not price-adjusted",
  context_only: "Context only",
  indeterminate: "Equipment unknown — cannot determine",
  incompatible: "Different market",
};

/** Compatibilities that may contribute to a market percentile. */
export const VALUE_BEARING_COMPATIBILITIES: ValuationCompatibility[] = ["exact"];

export const mayContributeToMarketValue = (c: ValuationCompatibility): boolean =>
  VALUE_BEARING_COMPATIBILITIES.includes(c);
