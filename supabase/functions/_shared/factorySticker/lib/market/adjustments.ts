// GENERATED — do not edit.
// Mirror of src/lib/market/adjustments.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Subject-equivalent adjustment framework ────────────────────────────────
//
//   AdjustedCompPrice_i = BasePrice_i
//                       + MileageAdjustment_i
//                       + CertificationAdjustment_i
//                       + EquipmentAdjustment_i
//                       + HistoryAdjustment_i
//                       + ConditionAdjustment_i
//                       + RegionalAdjustment_i
//
// The structure is here. The coefficients are not, and inventing them would be
// worse than leaving them out, because a wrong adjustment is indistinguishable
// from a right one once it has been added to a price and shown to a dealer.
//
// A single cents-per-mile figure is wrong across segments; a flat CPO premium
// is wrong across brands, ages and warranty terms; equipment valued at sticker
// is wrong the day the car is sold; and an accident deduction without severity
// is a guess with a dollar sign on it. None of those may be shipped as
// arithmetic on a customer-facing number.
//
// So every function returns `unavailable` with a reason, and the total is
// zero. Until the local model in Section 14 is trained on completed
// transactions and validated out of time, mileage, certification, equipment,
// history, condition and geography are used ONLY for eligibility, tiering,
// weight, confidence and explanation — which is exactly where similarity.ts
// uses them. Turning an adjustment on is a code change plus a model-metrics
// record, never a config edit.

export const ADJUSTMENT_MODEL_VERSION = "adjustments-v0-unavailable";

export type AdjustmentStatus = "applied" | "unavailable";

export interface AdjustmentTerm {
  key: "mileage" | "certification" | "equipment" | "history" | "condition" | "region";
  amount: number;
  status: AdjustmentStatus;
  reason: string;
  modelVersion: string;
}

export interface AdjustmentResult {
  basePrice: number;
  adjustedPrice: number;
  terms: AdjustmentTerm[];
  /** True while every term is unavailable, so adjustedPrice === basePrice. */
  identityOnly: boolean;
  modelVersion: string;
}

const unavailable = (key: AdjustmentTerm["key"], reason: string): AdjustmentTerm => ({
  key,
  amount: 0,
  status: "unavailable",
  reason,
  modelVersion: ADJUSTMENT_MODEL_VERSION,
});

/**
 * Apply every adjustment we are entitled to apply.
 *
 * Today that is none of them, and `adjustedPrice` equals `basePrice`. That is
 * not a stub — it is the correct answer given the evidence available, and the
 * caller records `identityOnly` so no surface can claim an adjusted market
 * value that has not actually been adjusted.
 */
export function adjustComparablePrice(basePrice: number): AdjustmentResult {
  const terms: AdjustmentTerm[] = [
    unavailable("mileage", "no cohort-aware mileage curve has been trained or validated out of time"),
    unavailable("certification", "no CPO premium has been estimated for this brand, age and warranty cohort"),
    unavailable("equipment", "equipment residual value is not modelled; original MSRP is not a residual"),
    unavailable("history", "no severity-aware accident or ownership adjustment has been validated"),
    unavailable("condition", "comparable condition is not observed at a usable grade"),
    unavailable("region", "no validated geographic residual correction exists for this market"),
  ];
  return {
    basePrice,
    adjustedPrice: basePrice,
    terms,
    identityOnly: terms.every((t) => t.status === "unavailable"),
    modelVersion: ADJUSTMENT_MODEL_VERSION,
  };
}

/** The features the Section 14 model will need. Recorded now so the shadow report can report what is missing. */
export const REQUIRED_MODEL_FEATURES = [
  "year", "make", "model", "trim", "segment", "mileage", "cpo_status",
  "remaining_warranty", "drivetrain", "powertrain", "factory_equipment",
  "verified_history", "condition", "geography", "time", "seller_type",
] as const;

export type RequiredModelFeature = (typeof REQUIRED_MODEL_FEATURES)[number];

/** Which features a candidate actually carries, so the gap is measurable rather than assumed. */
export function missingModelFeatures(present: Partial<Record<RequiredModelFeature, unknown>>): RequiredModelFeature[] {
  return REQUIRED_MODEL_FEATURES.filter((f) => {
    const v = present[f];
    return v == null || v === "" || v === "unknown";
  });
}
