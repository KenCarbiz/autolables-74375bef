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

// Why a row without a retry RPC has no Retry button — honest per artifact.
// The nightly intake sweep re-runs only the draft RPCs and the hub token, and
// recon/description have their own sweeps. The three edge-only artifacts
// (form_pdfs, oem_window_sticker, title_request_email) are fired once at
// ingest and are retried by nothing, so claiming a background task rebuilds
// them promised a retry that never comes.
const ARTIFACT_NO_RETRY_REASON: Record<string, string> = {
  get_ready_token: "The Get-Ready QR token is re-minted by the nightly intake sweep — no manual retry is needed here.",
  ingest_orchestrate: "Recon orchestration is re-run by its nightly sweep — no manual retry is needed here.",
  description: "Description generation is re-run by the nightly description reconcile sweep — no manual retry is needed here.",
  form_pdfs: "The official form PDFs are not retried by any sweep. Regenerate them from this vehicle's Print Center document list.",
  oem_window_sticker: "The OEM window sticker lookup runs once at ingest and is not retried by any sweep. Resolve it from the exception queue.",
  title_request_email: "The title request email is sent once at intake and is not retried by any sweep. Send it manually, then resolve this from the exception queue.",
};

export const artifactRetryRpc = (artifact: string): string | null =>
  ARTIFACT_RETRY_RPC[artifact] ?? null;

export const artifactNoRetryReason = (artifact: string): string | null =>
  ARTIFACT_RETRY_RPC[artifact]
    ? null
    : ARTIFACT_NO_RETRY_REASON[artifact]
      ?? "This artifact has no in-app retry. Resolve it from the exception queue.";

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
  /** Why there is no Retry button, when retryRpc is null. Honest per artifact. */
  noRetryReason: string | null;
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
        noRetryReason: "This exception predates per-artifact retries. Resolve it from the exception queue.",
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
        noRetryReason: artifactNoRetryReason(name),
      });
    }
  }
  return out;
}
