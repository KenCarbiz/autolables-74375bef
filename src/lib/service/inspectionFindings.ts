export type FindingResult = "passed" | "failed" | "attention";

export interface Finding {
  id: string;
  label: string;
  result: FindingResult;
  notes: string;
  measurement: string;
}

export const FINDING_RESULT_LABEL: Record<FindingResult, string> = {
  passed: "Passed",
  failed: "Failed",
  attention: "Needs attention",
};

const toResult = (raw: string | undefined): FindingResult => {
  const v = String(raw ?? "").toLowerCase();
  if (v === "pass" || v === "passed") return "passed";
  if (v === "fail" || v === "failed") return "failed";
  return "attention";
};

/** Rows of the newest inspection record, one finding per recorded checklist item. */
export function buildFindings(
  checklist: { id?: string; label?: string; result?: string; explanation?: string; measurement?: string | number | null }[] | null | undefined,
): Finding[] {
  return (checklist ?? [])
    .filter((c) => c && (c.label || c.id))
    .map((c, i) => ({
      id: c.id || `item-${i}`,
      label: c.label || String(c.id),
      result: toResult(c.result),
      notes: (c.explanation ?? "").trim(),
      measurement: c.measurement == null ? "" : String(c.measurement).trim(),
    }));
}

export function countFindings(findings: Finding[]): Record<FindingResult | "all", number> {
  return {
    all: findings.length,
    passed: findings.filter((f) => f.result === "passed").length,
    failed: findings.filter((f) => f.result === "failed").length,
    attention: findings.filter((f) => f.result === "attention").length,
  };
}
