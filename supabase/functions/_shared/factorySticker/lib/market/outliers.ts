// GENERATED — do not edit.
// Mirror of src/lib/market/outliers.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { weightedMad, weightedMedian, type WeightedPoint } from "./statistics.ts";
export const MIN_SAMPLE_FOR_OUTLIER_REMOVAL = 7;
export const DEFAULT_MAD_THRESHOLD = 3.5;
export const SUPPORTING_EXCLUSION_EVIDENCE = [
    "incorrect_trim",
    "incorrect_mileage",
    "adverse_title",
    "accident_history",
    "conditional_pricing",
    "missing_mandatory_charges",
    "stale_listing",
    "incorrect_certification",
    "duplicate_listing",
    "data_corruption",
] as const;
export type SupportingExclusionEvidence = (typeof SUPPORTING_EXCLUSION_EVIDENCE)[number];
export interface OutlierCandidate extends WeightedPoint {
    key: string;
    supportingEvidence: SupportingExclusionEvidence[];
}
export interface OutlierReview {
    center: number | null;
    mad: number | null;
    threshold: number;
    flagged: string[];
    excluded: {
        key: string;
        reasons: string[];
    }[];
    concerns: string[];
    sampleTooSmall: boolean;
}
export function reviewOutliers(candidates: OutlierCandidate[], threshold = DEFAULT_MAD_THRESHOLD): OutlierReview {
    const concerns: string[] = [];
    const usable = candidates.filter((c) => Number.isFinite(c.value) && c.weight > 0);
    const center = weightedMedian(usable);
    const mad = weightedMad(usable);
    const sampleTooSmall = usable.length < MIN_SAMPLE_FOR_OUTLIER_REMOVAL;
    if (center == null || mad == null || mad <= 0) {
        if (usable.length >= 2)
            concerns.push("dispersion_could_not_be_estimated");
        return { center, mad, threshold, flagged: [], excluded: [], concerns, sampleTooSmall };
    }
    const flagged = usable
        .filter((c) => Math.abs(c.value - center) > threshold * mad)
        .map((c) => c.key);
    if (!flagged.length) {
        return { center, mad, threshold, flagged, excluded: [], concerns, sampleTooSmall };
    }
    if (sampleTooSmall) {
        concerns.push(`outliers_flagged_but_sample_below_${MIN_SAMPLE_FOR_OUTLIER_REMOVAL}_none_removed`);
        return { center, mad, threshold, flagged, excluded: [], concerns, sampleTooSmall };
    }
    const excluded: {
        key: string;
        reasons: string[];
    }[] = [];
    for (const key of flagged) {
        const candidate = usable.find((c) => c.key === key);
        const support = candidate?.supportingEvidence ?? [];
        if (support.length) {
            excluded.push({ key, reasons: ["statistical_outlier", ...support] });
        }
        else {
            concerns.push(`outlier_kept_no_supporting_evidence_${key}`);
        }
    }
    return { center, mad, threshold, flagged, excluded, concerns, sampleTooSmall };
}
