// ── Shadow composite ───────────────────────────────────────────────────────
//
// Calculated, recorded, never published.
//
//   AFMV_shadow = Σ_k q_k · Estimate_k / Σ_k q_k
//   q_k         = AvailabilityQuality_k · DataCompleteness_k · 1/(err_k² + ε)
//
// The error term is the whole idea: a source earns weight by having been right
// before, measured forward in time against completed outcomes. Until
// `market_value_model_metrics` holds those rolling errors there is nothing to
// learn from, so every signal falls back to availability and completeness
// alone and the result stays unpublishable by construction — `publishable` is
// typed `false`, not defaulted to it.
//
// This is also why there is no 60/40 blend anywhere in this codebase. A fixed
// split is a claim that one source is 1.5x better than another, made without
// having checked, and it is exactly the kind of number that survives for years
// because nobody can find where it came from.

import type { ShadowComposite } from "./types.ts";

export const COMPOSITE_VERSION = "composite-v0-shadow";
/** No signal may dominate once two or more validated signals exist. */
export const MAX_SIGNAL_SHARE = 0.7;

export interface CompositeInput {
  providerPrediction: number | null;
  comparableP50: number | null;
  providerUsable: boolean;
  effectiveSampleSize: number;
  disagreement: number | null;
}

interface Signal {
  key: string;
  estimate: number | null;
  availability: number;
  completeness: number;
  /** Rolling out-of-time error for this signal's cohort. Null until measured. */
  rollingError: number | null;
}

export function shadowComposite(input: CompositeInput): ShadowComposite {
  const reasons: string[] = [];

  const signals: Signal[] = [
    {
      key: "marketcheck_prediction",
      estimate: input.providerUsable ? input.providerPrediction : null,
      availability: input.providerUsable && input.providerPrediction != null ? 1 : 0,
      completeness: input.providerUsable ? 1 : 0,
      rollingError: null,
    },
    {
      key: "comparable_p50",
      estimate: input.comparableP50,
      availability: input.comparableP50 != null ? 1 : 0,
      // A three-car median is a real estimate and a thin one. Completeness
      // scales with effective sample size and saturates at five.
      completeness: Math.min(1, input.effectiveSampleSize / 5),
      rollingError: null,
    },
  ];

  const measured = signals.filter((s) => s.rollingError != null);
  if (measured.length < 2) {
    reasons.push("rolling_cohort_error_not_measured_composite_stays_shadow_only");
  }
  if (input.disagreement != null && input.disagreement > 0.07) {
    reasons.push("sources_materially_disagree");
  }

  const epsilon = 1e-6;
  const scored = signals
    .filter((s) => s.estimate != null && s.availability > 0)
    .map((s) => ({
      ...s,
      quality: s.availability * s.completeness * (1 / ((s.rollingError ?? 1) ** 2 + epsilon)),
    }));

  const totalQuality = scored.reduce((a, s) => a + s.quality, 0);
  if (!scored.length || totalQuality <= 0) {
    return { value: null, signals: [], publishable: false, reasons: [...reasons, "no_usable_signal"] };
  }

  let shares = scored.map((s) => ({ ...s, share: s.quality / totalQuality }));

  // The dominance cap only means anything once two signals have been
  // validated. Applying it earlier would spread weight onto a source we have
  // no evidence deserves it.
  if (measured.length >= 2) {
    const over = shares.filter((s) => s.share > MAX_SIGNAL_SHARE);
    if (over.length) {
      reasons.push("signal_share_capped");
      const capped = shares.map((s) => (s.share > MAX_SIGNAL_SHARE ? { ...s, share: MAX_SIGNAL_SHARE } : s));
      const total = capped.reduce((a, s) => a + s.share, 0);
      shares = capped.map((s) => ({ ...s, share: s.share / total }));
    }
  }

  const value = shares.reduce((a, s) => a + (s.estimate as number) * s.share, 0);

  return {
    value,
    signals: shares.map((s) => ({ key: s.key, estimate: s.estimate, quality: s.quality, share: s.share })),
    publishable: false,
    reasons,
  };
}
