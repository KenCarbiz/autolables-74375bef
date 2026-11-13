// GENERATED — do not edit.
// Mirror of src/lib/intelligence/envelope.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type IntelligenceStatus = "verified" | "calculated" | "inferred" | "pending" | "unavailable" | "conflict_detected";
export interface IntelligenceResult<T = unknown> {
    status: IntelligenceStatus;
    value: T;
    confidence: number | null;
    sourceTypes: string[];
    sourceCount: number;
    checkedAt: string;
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
export function hasUsableValue<T>(r: IntelligenceResult<T>): boolean {
    return r.status !== "pending" && r.status !== "unavailable" && r.value != null;
}
export interface IntelligenceBadge {
    label: string;
    tone: "green" | "blue" | "violet" | "amber" | "slate";
    showValue: boolean;
    caption: string;
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
export interface ScoreDescriptor {
    scoreName: string;
    definition: string;
    min: number;
    max: number;
    value: number | null;
    band: string;
    inputFreshnessAt: string;
    confidence: number | null;
    calculationVersion: string;
    explanation: string;
    state: "ok" | "unavailable" | "conflict";
}
