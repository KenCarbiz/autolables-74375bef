// GENERATED — do not edit.
// Mirror of src/lib/market/presentation.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { isLegacyPosition, legacyVerdictFor } from "./surfaceCompat.ts";
import type { MarketConfidence } from "./types.ts";
export type MarketTone = "positive" | "neutral" | "caution" | "negative";
export interface MarketVerdictPresentation {
    code: string;
    label: string;
    tone: MarketTone;
    colorToken: string;
    iconToken: string | null;
    explanation: string;
}
const P = (code: string, label: string, tone: MarketTone, iconToken: string | null, explanation: string): MarketVerdictPresentation => ({
    code,
    label,
    tone,
    colorToken: `market.${tone}`,
    iconToken,
    explanation,
});
export const VERDICT_PRESENTATION: Record<string, MarketVerdictPresentation> = {
    "Market Estimate Unavailable": P("unavailable", "Market estimate unavailable", "neutral", "info", "We could not verify this vehicle's market position, so we are not making a claim about it."),
    "Limited Market Evidence": P("limited", "Limited market evidence", "neutral", "info", "Too few comparable vehicles were confirmed to judge this price either way."),
    "Competitive Market Position": P("competitive", "Competitive market position", "positive", "trending-down", "This vehicle is priced below the adjusted range for comparable vehicles."),
    "Below Adjusted Market": P("below", "Below adjusted market", "positive", "trending-down", "This vehicle is priced below the adjusted market for comparable vehicles."),
    "Within Adjusted Market": P("within", "Within adjusted market", "neutral", "check", "This vehicle is priced inside the adjusted range for comparable vehicles."),
    "High End of Adjusted Market": P("high_end", "High end of adjusted market", "caution", "alert", "This vehicle sits at the upper end of the adjusted range for comparable vehicles."),
    "High End of Adjusted Market \u2014 Review Recommended": P("high_end_review", "High end of adjusted market \u2014 review recommended", "caution", "alert", "This vehicle is above the adjusted range. The evidence supports a review, not a conclusion."),
    "Above Adjusted Market": P("above", "Above adjusted market", "negative", "alert", "This vehicle is priced above the adjusted market, on a complete and independent comparable set."),
};
export const UNKNOWN_PRESENTATION = VERDICT_PRESENTATION["Limited Market Evidence"];
export const TONE_CLASSES: Record<MarketTone, {
    badge: string;
    text: string;
    dot: string;
}> = {
    positive: { badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", dot: "bg-emerald-500" },
    neutral: { badge: "bg-slate-100 text-slate-700", text: "text-slate-600", dot: "bg-slate-400" },
    caution: { badge: "bg-amber-100 text-amber-700", text: "text-amber-600", dot: "bg-amber-500" },
    negative: { badge: "bg-red-100 text-red-700", text: "text-red-700", dot: "bg-red-500" },
};
export function capToneForConfidence(tone: MarketTone, confidence: MarketConfidence): MarketTone {
    if (confidence === "unavailable" || confidence === "low")
        return "neutral";
    if (confidence === "medium" && tone === "negative")
        return "caution";
    return tone;
}
export function presentVerdict(verdict: string | null | undefined, confidence: MarketConfidence = "low"): MarketVerdictPresentation {
    const base = (verdict && VERDICT_PRESENTATION[verdict]) || UNKNOWN_PRESENTATION;
    const tone = capToneForConfidence(base.tone, confidence);
    if (tone === base.tone)
        return base;
    return { ...base, tone, colorToken: `market.${tone}` };
}
export const toneClasses = (tone: MarketTone) => TONE_CLASSES[tone];
export function presentMarketView(view: {
    verdict: string;
    confidence: MarketConfidence;
}): MarketVerdictPresentation & {
    classes: {
        badge: string;
        text: string;
        dot: string;
    };
} {
    const presentation = presentVerdict(view.verdict, view.confidence);
    return { ...presentation, classes: toneClasses(presentation.tone) };
}
export function presentLegacyPosition(position: string | null | undefined, confidence: MarketConfidence = "medium"): MarketVerdictPresentation & {
    classes: {
        badge: string;
        text: string;
        dot: string;
    };
} {
    const verdict = legacyVerdictFor(position);
    const known = isLegacyPosition(position) && position !== "unknown";
    const presentation = presentVerdict(verdict, known ? confidence : "low");
    return { ...presentation, classes: toneClasses(presentation.tone) };
}
