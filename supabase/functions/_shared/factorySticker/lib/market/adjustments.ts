// GENERATED — do not edit.
// Mirror of src/lib/market/adjustments.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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
export const REQUIRED_MODEL_FEATURES = [
    "year",
    "make",
    "model",
    "trim",
    "segment",
    "mileage",
    "cpo_status",
    "remaining_warranty",
    "drivetrain",
    "powertrain",
    "factory_equipment",
    "verified_history",
    "condition",
    "geography",
    "time",
    "seller_type",
] as const;
export type RequiredModelFeature = (typeof REQUIRED_MODEL_FEATURES)[number];
export function missingModelFeatures(present: Partial<Record<RequiredModelFeature, unknown>>): RequiredModelFeature[] {
    return REQUIRED_MODEL_FEATURES.filter((f) => {
        const v = present[f];
        return v == null || v === "" || v === "unknown";
    });
}
