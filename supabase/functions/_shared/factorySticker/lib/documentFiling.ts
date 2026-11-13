// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/documentFiling.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export interface FiledDocumentRow {
    id: string;
    version: number;
    document_status: string;
    content_hash: string | null;
}
export type FilingPlan = {
    action: "update_in_place";
    documentId: string;
    version: number;
    supersedeIds: string[];
    targetStatus: DocumentTargetStatus;
    supersededPublished: false;
} | {
    action: "reuse_identical";
    documentId: string;
    version: number;
    supersedeIds: [
    ];
    targetStatus: DocumentTargetStatus;
    supersededPublished: false;
} | {
    action: "insert";
    documentId: null;
    version: number;
    supersedeIds: string[];
    targetStatus: DocumentTargetStatus;
    supersededPublished: boolean;
};
export type DocumentTargetStatus = "published" | "pending_approval";
const RETIRED = new Set(["superseded", "archived", "rejected"]);
const MUTABLE = new Set(["draft", "pending_approval"]);
export function planDocumentFiling(rows: FiledDocumentRow[], contentHash: string, publish: boolean, preservePublished = true): FilingPlan {
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
            action: "update_in_place",
            documentId: current.id,
            version: current.version,
            supersedeIds: supersedable.slice(1).map((r) => r.id),
            targetStatus,
            supersededPublished: false,
        };
    }
    const identical = [current, ...publishedRows].find((r) => r && r.content_hash === contentHash);
    if (identical) {
        return {
            action: "reuse_identical",
            documentId: identical.id,
            version: identical.version,
            supersedeIds: [],
            targetStatus,
            supersededPublished: false,
        };
    }
    return {
        action: "insert",
        documentId: null,
        version: nextVersion,
        supersedeIds: supersedable.map((r) => r.id),
        targetStatus,
        supersededPublished: !holdPublished && publishedRows.length > 0,
    };
}
export function recordStatusFor(autoPublish: boolean): "PUBLISHED" | "REVIEW_REQUIRED" {
    return autoPublish ? "PUBLISHED" : "REVIEW_REQUIRED";
}
