// Document versioning for a filed factory sticker, as a pure plan.
//
// One mutable draft/pending row per (tenant, vehicle, type) is overwritten in
// place; a locked row that is byte-identical only has its URLs refreshed; a
// locked row that changed gets a new immutable version and the old one is
// superseded, never deleted. A published version stays public until an
// authorized user approves its replacement: an unreviewed draft never
// supersedes what customers can already see on the passport.

export interface FiledDocumentRow {
  id: string;
  version: number;
  document_status: string;
  content_hash: string | null;
}

export type FilingPlan =
  | { action: "update_in_place"; documentId: string; version: number; supersedeIds: string[]; targetStatus: DocumentTargetStatus; supersededPublished: false }
  | { action: "reuse_identical"; documentId: string; version: number; supersedeIds: []; targetStatus: DocumentTargetStatus; supersededPublished: false }
  | { action: "insert"; documentId: null; version: number; supersedeIds: string[]; targetStatus: DocumentTargetStatus; supersededPublished: boolean };

export type DocumentTargetStatus = "published" | "pending_approval";

const RETIRED = new Set(["superseded", "archived", "rejected"]);
const MUTABLE = new Set(["draft", "pending_approval"]);

/** `rows` must be ordered by version, newest first. */
export function planDocumentFiling(
  rows: FiledDocumentRow[],
  contentHash: string,
  publish: boolean,
  preservePublished = true,
): FilingPlan {
  const targetStatus: DocumentTargetStatus = publish ? "published" : "pending_approval";
  const liveRows = rows.filter((r) => !RETIRED.has(r.document_status));
  const holdPublished = preservePublished && !publish;
  const publishedRows = liveRows.filter((r) => r.document_status === "published");
  const supersedable = holdPublished
    ? liveRows.filter((r) => r.document_status !== "published")
    : liveRows;
  const current = supersedable[0];
  const nextVersion = rows.reduce((m, r) => Math.max(m, r.version || 0), 0) + 1;

  if (current && MUTABLE.has(current.document_status)) {
    return {
      action: "update_in_place", documentId: current.id, version: current.version,
      supersedeIds: supersedable.slice(1).map((r) => r.id), targetStatus, supersededPublished: false,
    };
  }
  const identical = [current, ...publishedRows].find((r) => r && r.content_hash === contentHash);
  if (identical) {
    return {
      action: "reuse_identical", documentId: identical.id, version: identical.version,
      supersedeIds: [], targetStatus, supersededPublished: false,
    };
  }
  return {
    action: "insert", documentId: null, version: nextVersion,
    supersedeIds: supersedable.map((r) => r.id), targetStatus,
    supersededPublished: !holdPublished && publishedRows.length > 0,
  };
}

/** The pass/fail verdict and the record status it files under. */
export function recordStatusFor(autoPublish: boolean): "PUBLISHED" | "REVIEW_REQUIRED" {
  return autoPublish ? "PUBLISHED" : "REVIEW_REQUIRED";
}
