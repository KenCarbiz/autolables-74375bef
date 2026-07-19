// ── Governed intelligence envelope ──────────────────────────────────────────
// Every secondary-page claim (pricing, demand, confidence, days-on-market,
// recommendation) is wrapped in ONE envelope so the UI can always answer: what
// is this, how was it derived, how fresh, how confident, and what are its
// limits. A source can be "verified" while the CONCLUSION is only "calculated"
// or "inferred" — this type keeps those distinct so "verified sources" never
// implies "verified conclusion".

export type IntelligenceStatus =
  | "verified"          // source-verified fact
  | "calculated"        // AutoLabels computed it from inputs
  | "inferred"          // trim-typical / not vehicle-specific
  | "pending"           // still being determined
  | "unavailable"       // no trustworthy input
  | "conflict_detected";// sources disagree

export interface IntelligenceResult<T = unknown> {
  status: IntelligenceStatus;
  value: T;
  confidence: number | null;        // 0..1, null when not meaningful
  sourceTypes: string[];            // e.g. ["government","commercial_history"]
  sourceCount: number;
  checkedAt: string;                // ISO
  expiresAt: string | null;
  calculationVersion: string | null;
  explanation: string;
  limitations: string[];
}

type Meta = {
  confidence?: number | null;
  sourceTypes?: string[];
  sourceCount?: number;
  checkedAt: string;
  expiresAt?: string | null;
  calculationVersion?: string | null;
  explanation: string;
  limitations?: string[];
};

function make<T>(status: IntelligenceStatus, value: T, m: Meta): IntelligenceResult<T> {
  return {
    status,
    value,
    confidence: m.confidence ?? null,
    sourceTypes: m.sourceTypes ?? [],
    sourceCount: m.sourceCount ?? (m.sourceTypes?.length ?? 0),
    checkedAt: m.checkedAt,
    expiresAt: m.expiresAt ?? null,
    calculationVersion: m.calculationVersion ?? null,
    explanation: m.explanation,
    limitations: m.limitations ?? [],
  };
}

export const Intelligence = {
  verified: <T>(value: T, m: Meta) => make("verified", value, m),
  calculated: <T>(value: T, m: Meta) => make("calculated", value, m),
  inferred: <T>(value: T, m: Meta) => make("inferred", value, m),
  pending: <T>(value: T, m: Meta) => make("pending", value, m),
  unavailable: (m: Meta) => make<null>("unavailable", null, m),
  conflict: <T>(value: T, m: Meta) => make("conflict_detected", value, m),
};

// A result carries a usable value only when its status is not pending/unavailable.
export function hasUsableValue<T>(r: IntelligenceResult<T>): boolean {
  return r.status !== "pending" && r.status !== "unavailable" && r.value != null;
}

export interface IntelligenceBadge {
  label: string;                    // "Verified" | "AutoLabels estimate" | ...
  tone: "green" | "blue" | "violet" | "amber" | "slate";
  showValue: boolean;               // hide the number for pending/unavailable
  caption: string;                  // short provenance line for the UI
}

const STATUS_LABEL: Record<IntelligenceStatus, string> = {
  verified: "Verified",
  calculated: "AutoLabels estimate",
  inferred: "Estimated (trim-typical)",
  pending: "Pending",
  unavailable: "Not available",
  conflict_detected: "Needs review",
};

const STATUS_TONE: Record<IntelligenceStatus, IntelligenceBadge["tone"]> = {
  verified: "green",
  calculated: "blue",
  inferred: "violet",
  pending: "amber",
  unavailable: "slate",
  conflict_detected: "amber",
};

export function describeIntelligence(r: IntelligenceResult): IntelligenceBadge {
  const srcs = r.sourceCount > 0
    ? `across ${r.sourceCount} source${r.sourceCount === 1 ? "" : "s"}`
    : "";
  const conf = r.confidence != null ? ` · ${Math.round(r.confidence * 100)}% confidence` : "";
  return {
    label: STATUS_LABEL[r.status],
    tone: STATUS_TONE[r.status],
    showValue: hasUsableValue(r),
    caption: [STATUS_LABEL[r.status], srcs].filter(Boolean).join(" ") + conf,
  };
}

// ── Governed score descriptor ───────────────────────────────────────────────
// "66 High Demand", "90 Exceptional Confidence" look alike but measure different
// things. Every displayed score must declare what it is.
export interface ScoreDescriptor {
  scoreName: string;                // "Local Demand"
  definition: string;               // what it measures, in one sentence
  min: number;
  max: number;
  value: number | null;            // null when unavailable/conflict
  band: string;                     // "High" | "Exceptional" | ...
  inputFreshnessAt: string;         // ISO of the freshest input
  confidence: number | null;
  calculationVersion: string;
  explanation: string;              // why this value (the contributing inputs)
  state: "ok" | "unavailable" | "conflict";
}
