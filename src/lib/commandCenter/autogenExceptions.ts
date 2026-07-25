// ──────────────────────────────────────────────────────────────────────
// Intake automation exceptions on the VIN Command Center.
//
// supabase/functions/_shared/intake-autoprovision.ts records every failed
// artifact into ONE open vehicle_exceptions row per VIN (exception_type
// 'artifact_autogen_failed'), accumulating them under
// source_values.artifacts[name] = message. This module is the client-side
// reading of that contract: one display row per failed artifact, each knowing
// whether the artifact's draft RPC can be re-invoked from the browser.
//
// The RPC map mirrors intake-autoprovision's draftRpc calls exactly — the
// RPCs are VIN-idempotent, so a retry can never double-create. Artifacts
// produced by fire-and-forget edge posts (form PDFs, OEM sticker, recon and
// description orchestration) have no client-invokable draft RPC; those rows
// say so and point at the exception queue.
// ──────────────────────────────────────────────────────────────────────

export const AUTOGEN_EXCEPTION_TYPE = "artifact_autogen_failed";

const ARTIFACT_RETRY_RPC: Record<string, string> = {
  addendum: "create_draft_addendum",
  buyers_guide: "create_draft_buyers_guide",
  k208: "create_draft_safety_inspection",
  get_ready: "create_draft_get_ready",
  window_sticker: "create_draft_window_sticker",
};

const ARTIFACT_LABEL: Record<string, string> = {
  get_ready_token: "Get-Ready QR token",
  addendum: "Addendum draft",
  buyers_guide: "FTC Buyers Guide draft",
  k208: "K-208 draft",
  get_ready: "Get Ready draft",
  window_sticker: "Used-car window sticker draft",
  form_pdfs: "Official form PDFs",
  oem_window_sticker: "OEM window sticker",
  title_request_email: "Title request email",
  ingest_orchestrate: "Recon orchestration",
  description: "Description generation",
};

export const artifactRetryRpc = (artifact: string): string | null =>
  ARTIFACT_RETRY_RPC[artifact] ?? null;

export const artifactLabel = (artifact: string): string =>
  ARTIFACT_LABEL[artifact]
  ?? artifact.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export interface AutogenExceptionRow {
  exceptionId: string;
  artifact: string;
  label: string;
  message: string;
  /** The draft RPC a Retry button re-invokes, or null when only the queue can. */
  retryRpc: string | null;
}

export interface VehicleExceptionRecord {
  id?: string | null;
  exception_type?: string | null;
  status?: string | null;
  title?: string | null;
  explanation?: string | null;
  source_values?: { artifacts?: Record<string, unknown> } | null;
}

/**
 * One display row per failed artifact, from the open autogen exception rows.
 * A row recorded before the artifacts map existed still surfaces, under its
 * title, so an exception is never invisible just because it is old.
 */
export function buildAutogenExceptionRows(rows: VehicleExceptionRecord[]): AutogenExceptionRow[] {
  const out: AutogenExceptionRow[] = [];
  for (const row of rows) {
    if (String(row.exception_type || "") !== AUTOGEN_EXCEPTION_TYPE) continue;
    const status = String(row.status || "open");
    if (status !== "open" && status !== "in_progress") continue;
    const id = String(row.id || "");
    const artifacts = row.source_values?.artifacts || {};
    const names = Object.keys(artifacts);
    if (names.length === 0) {
      out.push({
        exceptionId: id,
        artifact: "",
        label: String(row.title || "Intake auto-generation failed"),
        message: String(row.explanation || "An intake artifact failed to generate."),
        retryRpc: null,
      });
      continue;
    }
    for (const name of names) {
      out.push({
        exceptionId: id,
        artifact: name,
        label: artifactLabel(name),
        message: String(artifacts[name] ?? "unknown error"),
        retryRpc: artifactRetryRpc(name),
      });
    }
  }
  return out;
}
