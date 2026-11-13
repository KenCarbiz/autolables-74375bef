// GENERATED — do not edit.
// Mirror of src/lib/intelligence/buyingConfidence.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type BuyingConfidenceBand = "exceptional" | "strong" | "fair" | "caution";
export interface BuyingSubscore {
    key: "priceMarketFit" | "verification" | "equipmentValue" | "demandAvailability" | "coverage";
    label: string;
    value: number;
    weight: number;
    weightPct: number;
    explanation: string;
}
export const BUYING_WEIGHTS: Record<BuyingSubscore["key"], number> = {
    priceMarketFit: 0.35,
    verification: 0.3,
    equipmentValue: 0.2,
    demandAvailability: 0.1,
    coverage: 0.05,
};
export const BUYING_CONFIDENCE_VERSION = "v1";
export interface BuyingConfidenceInput {
    subscores: Record<BuyingSubscore["key"], number>;
    explanations?: Partial<Record<BuyingSubscore["key"], string>>;
    verification: {
        materialPending: boolean;
        materialConflict: boolean;
        completedChecks: number;
        applicableChecks: number;
        sourcesConsulted: number;
        pendingLabels: string[];
    };
    normalizedComparableCount: number;
    updatedAt: string;
}
export interface BuyingConfidenceResult {
    score: number;
    band: BuyingConfidenceBand;
    conditional: boolean;
    headline: string;
    subcopy: string;
    subscores: BuyingSubscore[];
    limitations: string[];
    calcVersion: string;
    updatedAt: string;
}
const LABELS: Record<BuyingSubscore["key"], string> = {
    priceMarketFit: "Price & market fit",
    verification: "Vehicle verification",
    equipmentValue: "Equipment & value",
    demandAvailability: "Demand & availability",
    coverage: "Coverage information",
};
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
function baseBand(score: number): BuyingConfidenceBand {
    if (score >= 90)
        return "exceptional";
    if (score >= 75)
        return "strong";
    if (score >= 60)
        return "fair";
    return "caution";
}
const HEADLINE: Record<BuyingConfidenceBand, string> = {
    exceptional: "Exceptional Buying Candidate",
    strong: "Strong Buying Candidate",
    fair: "Fair Buying Candidate",
    caution: "Review Before Buying",
};
export function computeBuyingConfidence(input: BuyingConfidenceInput): BuyingConfidenceResult {
    const keys = Object.keys(BUYING_WEIGHTS) as BuyingSubscore["key"][];
    const subscores: BuyingSubscore[] = keys.map((key) => ({
        key,
        label: LABELS[key],
        value: clamp(input.subscores[key] ?? 0),
        weight: BUYING_WEIGHTS[key],
        weightPct: Math.round(BUYING_WEIGHTS[key] * 100),
        explanation: input.explanations?.[key] ?? "",
    }));
    const score = clamp(subscores.reduce((s, x) => s + x.value * x.weight, 0));
    const v = input.verification;
    let band = baseBand(score);
    const conditional = v.materialPending || v.materialConflict;
    if (v.materialConflict)
        band = "caution";
    else if (v.materialPending && band === "exceptional")
        band = "strong";
    const pendingCount = v.pendingLabels.length;
    let headline = HEADLINE[band];
    if (v.materialPending && !v.materialConflict) {
        headline = `${HEADLINE[band]} — ${pendingCount === 1 ? "One Check" : `${pendingCount} Checks`} Pending`;
    }
    const checks = `${v.completedChecks} of ${v.applicableChecks} verification checks are complete.`;
    const pending = v.materialConflict
        ? ` Conflicting information needs dealer review: ${v.pendingLabels.join(", ") || "one check"}.`
        : v.materialPending
            ? ` Pending: ${v.pendingLabels.join(", ") || "a material check"}.`
            : "";
    const subcopy = `Pricing, equipment and local-market position compare favorably. ${checks}${pending} ` +
        `Based on ${v.sourcesConsulted} data source${v.sourcesConsulted === 1 ? "" : "s"} and ` +
        `${input.normalizedComparableCount} normalized market listing${input.normalizedComparableCount === 1 ? "" : "s"}.`;
    const limitations: string[] = [
        "Final taxes, fees, and out-the-door price",
        "Current vehicle availability",
        "Financing terms and approval",
    ];
    if (v.materialPending || v.materialConflict) {
        for (const p of v.pendingLabels)
            limitations.push(`Completion of the ${p.toLowerCase()}`);
    }
    limitations.push("Warranty in-service (start) date", "Market-data freshness", "Equipment confirmation");
    return { score, band, conditional, headline, subcopy, subscores, limitations, calcVersion: BUYING_CONFIDENCE_VERSION, updatedAt: input.updatedAt };
}
