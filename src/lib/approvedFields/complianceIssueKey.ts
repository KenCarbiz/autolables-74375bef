// A compliance issue key names the source row an issue comes from, so an
// owner assignment survives reloads, re-runs and reordering. Format:
//   `${source}:${sourceRowId}` or `${source}:${sourceRowId}:${part}`
// where source is one of the seven tables the Compliance Center reads.
// The same pattern is a CHECK on compliance_issue_owners.issue_key.

export const COMPLIANCE_ISSUE_SOURCES = [
  "vehicle_listings",
  "ct_mvp_certification_runs",
  "vehicle_exceptions",
  "stale_document_flags",
  "advertised_prices",
  "vehicle_documents",
  "recall_service_tasks",
] as const;

export type ComplianceIssueSource = (typeof COMPLIANCE_ISSUE_SOURCES)[number];

export const COMPLIANCE_ISSUE_KEY_PATTERN = new RegExp(
  `^(${COMPLIANCE_ISSUE_SOURCES.join("|")}):[A-Za-z0-9_.:-]{1,200}$`,
);

const isSource = (v: string): v is ComplianceIssueSource =>
  (COMPLIANCE_ISSUE_SOURCES as readonly string[]).includes(v);

const segment = (v: string): string =>
  v.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");

export function complianceIssueKey(source: ComplianceIssueSource, sourceRowId: string, part?: string | null): string {
  if (!isSource(source)) throw new Error(`unknown compliance issue source: ${String(source)}`);
  const id = (sourceRowId ?? "").trim();
  if (!id || !/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error("compliance issue key needs a source row id");
  const tail = part == null ? "" : segment(part);
  const key = tail ? `${source}:${id}:${tail}` : `${source}:${id}`;
  if (!COMPLIANCE_ISSUE_KEY_PATTERN.test(key)) throw new Error("compliance issue key is too long");
  return key;
}

export const isComplianceIssueKey = (v: unknown): v is string =>
  typeof v === "string" && COMPLIANCE_ISSUE_KEY_PATTERN.test(v);

export function parseComplianceIssueKey(
  key: string,
): { source: ComplianceIssueSource; sourceRowId: string; part: string | null } | null {
  if (!isComplianceIssueKey(key)) return null;
  const [source, sourceRowId, ...rest] = key.split(":");
  if (!isSource(source)) return null;
  return { source, sourceRowId, part: rest.length ? rest.join(":") : null };
}

// The Issues view is one row per vehicle; its owner hangs off the listing.
export const vehicleIssueKey = (vehicleId: string): string => complianceIssueKey("vehicle_listings", vehicleId);

// Certification runs are re-created on every run, so a check is identified by
// the vehicle it is about and its check key, not by the run row.
export const certificationIssueKey = (vehicleId: string, checkKey: string | null | undefined): string =>
  complianceIssueKey("ct_mvp_certification_runs", vehicleId, checkKey || "not_ready");
