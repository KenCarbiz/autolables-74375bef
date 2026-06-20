import { supabase } from "@/integrations/supabase/client";
import { logStickerAudit } from "./api";

// ──────────────────────────────────────────────────────────────────────
// Generated-document lifecycle. A sticker/addendum/passport doc moves through:
//   draft -> pending_approval -> approved -> printed -> published
// with rejected / superseded / archived as terminal/side states. Approved docs
// are immutable: regenerating creates a NEW version and supersedes the prior
// live one. Only approved/printed/published docs are customer-visible. Every
// transition writes a public.audit_log row (actor, tenant, vehicle, doc, old
// -> new status). This is internal document state — it does NOT touch the
// customer signing flow (addendum_signings / record_customer_signing).
// ──────────────────────────────────────────────────────────────────────

export type DocumentStatus =
  | "draft" | "pending_approval" | "approved" | "printed"
  | "published" | "superseded" | "archived" | "rejected";

export type DocumentAction =
  | "submit" | "approve" | "reject" | "mark_printed"
  | "publish" | "unpublish" | "supersede" | "archive";

export interface GeneratedDocument {
  id: string;
  tenant_id: string | null;
  vehicle_id: string | null;
  template_id: string;
  template_version?: number | null;
  document_type: "window" | "addendum" | "passport";
  document_status: DocumentStatus;
  version: number;
  label_mode?: "white" | "black";
  pdf_url?: string | null;
  png_url?: string | null;
  online_url?: string | null;
  print_count?: number;
  generated_by?: string | null;
  approved_by?: string | null;
  reviewed_by?: string | null;
  approved_at?: string | null;
  printed_at?: string | null;
  published_at?: string | null;
  rejected_at?: string | null;
  reject_reason?: string | null;
  created_at?: string;
}

// Presentation metadata for each status.
export const STATUS_META: Record<DocumentStatus, { label: string; tone: "slate" | "amber" | "emerald" | "blue" | "violet" | "rose" }> = {
  draft:            { label: "Draft",            tone: "slate" },
  pending_approval: { label: "Pending approval", tone: "amber" },
  approved:         { label: "Approved",         tone: "emerald" },
  printed:          { label: "Printed",          tone: "blue" },
  published:        { label: "Published",        tone: "violet" },
  superseded:       { label: "Superseded",       tone: "slate" },
  archived:         { label: "Archived",         tone: "slate" },
  rejected:         { label: "Rejected",         tone: "rose" },
};

// Customer-visible states (Vehicle Passport / signing packet).
export const PUBLIC_STATUSES: DocumentStatus[] = ["approved", "printed", "published"];
export const isPublicDoc = (s: DocumentStatus) => PUBLIC_STATUSES.includes(s);

// Allowed actions from a given status. `manager` gates approve/reject.
export function allowedActions(status: DocumentStatus, manager: boolean): DocumentAction[] {
  switch (status) {
    case "draft":            return ["submit", ...(manager ? ["approve" as const] : []), "archive"];
    case "pending_approval": return manager ? ["approve", "reject", "archive"] : ["archive"];
    case "approved":         return ["mark_printed", "publish", "supersede", "archive"];
    case "printed":          return ["publish", "supersede", "archive"];
    case "published":        return ["unpublish", "mark_printed", "supersede", "archive"];
    case "rejected":         return ["submit", "archive"];
    case "superseded":       return ["archive"];
    case "archived":         return [];
    default:                 return [];
  }
}

const nextStatus: Record<DocumentAction, DocumentStatus> = {
  submit: "pending_approval",
  approve: "approved",
  reject: "rejected",
  mark_printed: "printed",
  publish: "published",
  unpublish: "approved",
  supersede: "superseded",
  archive: "archived",
};

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

export interface TransitionArgs {
  doc: GeneratedDocument;
  action: DocumentAction;
  actorId?: string | null;
  reason?: string;
}

// Apply one lifecycle transition with the right side-effects + audit row.
export async function transitionDocument({ doc, action, actorId, reason }: TransitionArgs): Promise<{ ok: boolean; error?: string }> {
  const to = nextStatus[action];
  const now = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const patch: Record<string, any> = { document_status: to };
  if (action === "approve") { patch.approved_by = actorId || null; patch.approved_at = now; patch.reviewed_by = actorId || null; }
  if (action === "reject") { patch.rejected_at = now; patch.reviewed_by = actorId || null; patch.reject_reason = reason || null; }
  if (action === "mark_printed") { patch.printed_at = now; patch.print_count = (doc.print_count || 0) + 1; }
  if (action === "publish") patch.published_at = now;
  if (action === "unpublish") patch.published_at = null;

  try {
    const { error } = await sb().from("generated_documents").update(patch).eq("id", doc.id);
    if (error) return { ok: false, error: error.message };
    await logStickerAudit("document_status_change", {
      tenantId: doc.tenant_id, entityType: doc.document_type, entityId: doc.id,
      details: { action, from: doc.document_status, to, vehicle_id: doc.vehicle_id, version: doc.version, reason: reason || null },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "transition_failed" };
  }
}

// When a new version is generated, supersede the prior live doc of the same
// vehicle + type so only one live doc exists per lane.
export async function supersedePriorLive(vehicleId: string, docType: string, exceptId: string): Promise<void> {
  try {
    await sb().from("generated_documents")
      .update({ document_status: "superseded" })
      .eq("vehicle_id", vehicleId)
      .eq("document_type", docType)
      .neq("id", exceptId)
      .in("document_status", ["draft", "pending_approval", "approved", "printed", "published"]);
  } catch { /* best-effort */ }
}
