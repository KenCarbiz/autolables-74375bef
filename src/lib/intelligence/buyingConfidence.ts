// ── Buying Confidence Score governance ──────────────────────────────────────
// The passport's headline conclusion. Two hard rules:
//   1. It is a COMPOSITE score out of 100 — never a probability/percentage.
//   2. It can never be MORE certain than its underlying checks. A pending or
//      conflicting MATERIAL verification (e.g. title) caps the conclusion — the
//      page may not say "Exceptional Buy" while a material check is unresolved.
// Verification is a first-class weighted factor, not buried inside "coverage".

export type BuyingConfidenceBand = "exceptional" | "strong" | "fair" | "caution";

export interface BuyingSubscore {
  key: "priceMarketFit" | "verification" | "equipmentValue" | "demandAvailability" | "coverage";
  label: string;
  value: number;        // 0..100
  weight: number;       // 0..1
  weightPct: number;    // 0..100 for display
  explanation: string;
}

export const BUYING_WEIGHTS: Record<BuyingSubscore["key"], number> = {
  priceMarketFit: 0.35,
  verification: 0.30,
  equipmentValue: 0.20,
  demandAvailability: 0.10,
  coverage: 0.05,
};

export const BUYING_CONFIDENCE_VERSION = "v1";

export interface BuyingConfidenceInput {
  subscores: Record<BuyingSubscore["key"], number>; // each 0..100
  explanations?: Partial<Record<BuyingSubscore["key"], string>>;
  verification: {
    materialPending: boolean;
    materialConflict: boolean;
    completedChecks: number;
    applicableChecks: number;
    sourcesConsulted: number;
    pendingLabels: string[];   // e.g. ["Title and brand verification"]
  };
  normalizedComparableCount: number; // NORMALIZED comps only
  updatedAt: string;                 // ISO
}

export interface BuyingConfidenceResult {
  score: number;                 // 0..100 — display as "N/100", never "N%"
  band: BuyingConfidenceBand;
  conditional: boolean;          // a material check is pending/conflicting
  headline: string;              // "Strong Buying Candidate" / "Strong Candidate — One Check Pending"
  subcopy: string;
  subscores: BuyingSubscore[];
  limitations: string[];         // "What could change this result?"
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
  if (score >= 90) return "exceptional";
  if (score >= 75) return "strong";
  if (score >= 60) return "fair";
  return "caution";
}

const HEADLINE: Record<BuyingConfidenceBand, string> = {
  exceptional: "Exceptional Buying Candidate",
  strong: "Strong Buying Candidate",
  fair: "Fair Buying Candidate",
  caution: "Review Before Buying",
};

/**
 * Compute the governed Buying Confidence Score. Pure + deterministic.
 * A pending material check downgrades an "exceptional" result to "strong" and
 * always annotates the pending item; a material conflict forces "caution".
 */
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

  // The conclusion can never exceed the certainty of its checks.
  if (v.materialConflict) band = "caution";
  else if (v.materialPending && band === "exceptional") band = "strong";

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
  const subcopy =
    `Pricing, equipment and local-market position compare favorably. ${checks}${pending} ` +
    `Based on ${v.sourcesConsulted} data source${v.sourcesConsulted === 1 ? "" : "s"} and ` +
    `${input.normalizedComparableCount} normalized market listing${input.normalizedComparableCount === 1 ? "" : "s"}.`;

  const limitations: string[] = [
    "Final taxes, fees, and out-the-door price",
    "Current vehicle availability",
    "Financing terms and approval",
  ];
  if (v.materialPending || v.materialConflict) {
    for (const p of v.pendingLabels) limitations.push(`Completion of the ${p.toLowerCase()}`);
  }
  limitations.push("Warranty in-service (start) date", "Market-data freshness", "Equipment confirmation");

  return { score, band, conditional, headline, subcopy, subscores, limitations, calcVersion: BUYING_CONFIDENCE_VERSION, updatedAt: input.updatedAt };
}
