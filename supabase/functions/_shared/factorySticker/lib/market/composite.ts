// GENERATED — do not edit.
// Mirror of src/lib/market/composite.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { ShadowComposite } from "./types.ts";
export const COMPOSITE_VERSION = "composite-v0-shadow";
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
    const epsilon = 0.000001;
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
