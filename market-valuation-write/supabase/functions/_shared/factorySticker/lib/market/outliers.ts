// GENERATED — do not edit.
// Mirror of src/lib/market/outliers.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Outliers ───────────────────────────────────────────────────────────────
//
// The cheapest listing is not an error. Removing it because it is cheapest is
// how a market calculation quietly becomes a defence of the dealer's price,
// and it is the same instinct that produced the stored comparable sample
// ordered "at or above our price first".
//
// So a price is only ever FLAGGED by the statistics, and flagging alone never
// removes anything. Exclusion needs a second, independent reason: the trim is
// wrong, the mileage is wrong, the title is branded, the price is conditional,
// the listing is stale, the certification is wrong, the row is a duplicate.
// Absent one of those, the cheap car stays in the market and the market is
// lower — which is the honest outcome.
//
// Below seven eligible comparables the MAD is not a stable enough estimate of
// spread to act on at all, so nothing is excluded and the concern is reported
// instead.

import { weightedMad, weightedMedian, type WeightedPoint } from "./statistics.ts";

export const MIN_SAMPLE_FOR_OUTLIER_REMOVAL = 7;
export const DEFAULT_MAD_THRESHOLD = 3.5;

/** Reasons that, combined with a statistical flag, justify removing a listing. */
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
  /** Independent problems already known about this listing. */
  supportingEvidence: SupportingExclusionEvidence[];
}

export interface OutlierReview {
  center: number | null;
  mad: number | null;
  threshold: number;
  /** Flagged by the statistics. Flagged is not excluded. */
  flagged: string[];
  /** Flagged AND independently supported. These leave the market calculation. */
  excluded: { key: string; reasons: string[] }[];
  concerns: string[];
  /** True when the sample was too small to act on a statistical flag. */
  sampleTooSmall: boolean;
}

export function reviewOutliers(
  candidates: OutlierCandidate[],
  threshold = DEFAULT_MAD_THRESHOLD,
): OutlierReview {
  const concerns: string[] = [];
  const usable = candidates.filter((c) => Number.isFinite(c.value) && c.weight > 0);
  const center = weightedMedian(usable);
  const mad = weightedMad(usable);
  const sampleTooSmall = usable.length < MIN_SAMPLE_FOR_OUTLIER_REMOVAL;

  if (center == null || mad == null || mad <= 0) {
    if (usable.length >= 2) concerns.push("dispersion_could_not_be_estimated");
    return { center, mad, threshold, flagged: [], excluded: [], concerns, sampleTooSmall };
  }

  const flagged = usable
    .filter((c) => Math.abs(c.value - center) > threshold * mad)
    .map((c) => c.key);

  if (!flagged.length) {
    return { center, mad, threshold, flagged, excluded: [], concerns, sampleTooSmall };
  }

  if (sampleTooSmall) {
    concerns.push(
      `outliers_flagged_but_sample_below_${MIN_SAMPLE_FOR_OUTLIER_REMOVAL}_none_removed`,
    );
    return { center, mad, threshold, flagged, excluded: [], concerns, sampleTooSmall };
  }

  const excluded: { key: string; reasons: string[] }[] = [];
  for (const key of flagged) {
    const candidate = usable.find((c) => c.key === key);
    const support = candidate?.supportingEvidence ?? [];
    if (support.length) {
      excluded.push({ key, reasons: ["statistical_outlier", ...support] });
    } else {
      concerns.push(`outlier_kept_no_supporting_evidence_${key}`);
    }
  }

  return { center, mad, threshold, flagged, excluded, concerns, sampleTooSmall };
}
