// Client-side mirror of supabase/functions/_shared/intake-autoprovision.ts for
// the MANUAL add paths (Add Vehicle modal, CSV import, sticker createListing),
// which insert vehicle_listings directly and used to skip intake orchestration
// entirely. Same contract as the edge path: the five VIN-idempotent draft RPCs
// plus the hub token and the stored delivery clearance, every step best-effort
// — a failed artifact is recorded in vehicle_exceptions and NEVER blocks or
// undoes the insert itself.

import { supabase } from "@/integrations/supabase/client";
import { AUTOGEN_EXCEPTION_TYPE } from "@/lib/commandCenter/autogenExceptions";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

const DRAFT_RPCS: ReadonlyArray<{ fn: string; artifact: string }> = [
  { fn: "create_draft_addendum", artifact: "addendum" },
  { fn: "create_draft_buyers_guide", artifact: "buyers_guide" },
  { fn: "create_draft_safety_inspection", artifact: "k208" },
  { fn: "create_draft_get_ready", artifact: "get_ready" },
  { fn: "create_draft_window_sticker", artifact: "window_sticker" },
];

// Every artifact recorded here is sweep-retried (SWEEP_RETRIED in
// intake-autoprovision.ts), so the promise is honest.
const RECOMMENDED_ACTION =
  "Retry from the vehicle intake summary; the nightly intake sweep will also retry.";

const errText = (e: unknown): string =>
  String((e as { message?: string } | null)?.message || e || "unknown error").slice(0, 500);

// One open exception row per VIN, artifacts merged into
// source_values.artifacts — the same shape intake-autoprovision writes, so the
// VIN Command Center's retry buttons work on these rows too. Never throws.
async function recordArtifactFailure(
  tenantId: string, vin: string, artifact: string, message: string,
  recommendedAction: string = RECOMMENDED_ACTION,
): Promise<void> {
  try {
    const { data: existing } = await sb().from("vehicle_exceptions")
      .select("id, source_values")
      .eq("tenant_id", tenantId).eq("vin", vin).eq("exception_type", AUTOGEN_EXCEPTION_TYPE)
      .in("status", ["open", "in_progress"])
      .maybeSingle();
    if (existing?.id) {
      const prev = ((existing.source_values || {}) as { artifacts?: Record<string, string> }).artifacts || {};
      await sb().from("vehicle_exceptions").update({
        severity: "high",
        title: `Intake auto-generation failed: ${artifact}`,
        explanation: `Automatic creation of "${artifact}" failed: ${message}`,
        source_values: { ...(existing.source_values || {}), artifacts: { ...prev, [artifact]: message } },
        recommended_action: recommendedAction,
      }).eq("id", existing.id);
      return;
    }
    await sb().from("vehicle_exceptions").insert({
      tenant_id: tenantId, vin, exception_type: AUTOGEN_EXCEPTION_TYPE,
      severity: "high",
      title: `Intake auto-generation failed: ${artifact}`,
      explanation: `Automatic creation of "${artifact}" failed: ${message}. The vehicle was still created without this artifact.`,
      source_values: { artifacts: { [artifact]: message } },
      recommended_action: recommendedAction,
      status: "open",
    });
  } catch { /* exception recording is best-effort — never break the add */ }
}

// Stock truth is vehicle_files.stock_number (UNIQUE tenant_id+vin —
// marketcheck-sync writes it there, and the draft RPCs read it back for the
// worklist and sticker snapshot). The manual add paths collect a required
// stock and must land it in the same place. Best-effort: a failure is
// recorded, never blocks the vehicle insert.
export async function persistStockNumber(
  tenantId: string | null | undefined,
  vin: string,
  stockNumber: string | null | undefined,
): Promise<void> {
  const v = String(vin || "").trim().toUpperCase();
  const s = String(stockNumber || "").trim();
  if (!tenantId || !v || !s) return;
  try {
    const { error } = await sb().from("vehicle_files").upsert(
      { tenant_id: tenantId, vin: v, stock_number: s },
      { onConflict: "tenant_id,vin" },
    );
    if (error) {
      await recordArtifactFailure(tenantId, v, "stock_number", errText(error),
        "Re-enter the stock number on the vehicle file. No sweep retries this.");
    }
  } catch (e) {
    await recordArtifactFailure(tenantId, v, "stock_number", errText(e),
      "Re-enter the stock number on the vehicle file. No sweep retries this.");
  }
}

const INTAKE_QUEUED_ARTIFACT = "intake_incomplete";
const INTAKE_QUEUED_MESSAGE =
  "Intake queued — the nightly intake sweep will complete this vehicle if the import is interrupted.";

// CSV-import interruption guard: an open marker per VIN recorded BEFORE its
// orchestration runs, resolved after it completes. A tab closed mid-import
// leaves the marker open — visible in the exception queue instead of silent
// until the sweep. Same row/shape as the artifact failures, so the queue and
// the VIN Command Center already know how to show it.
export async function markIntakeQueued(tenantId: string | null | undefined, vin: string): Promise<void> {
  const v = String(vin || "").trim().toUpperCase();
  if (!tenantId || !v) return;
  await recordArtifactFailure(tenantId, v, INTAKE_QUEUED_ARTIFACT, INTAKE_QUEUED_MESSAGE,
    "No action needed while the import is running. If it was interrupted, the nightly intake sweep completes the drafts.");
}

// Remove the marker; resolve the row when nothing else is recorded on it. A
// real artifact failure recorded during orchestration keeps the row open.
export async function clearIntakeQueued(
  tenantId: string | null | undefined, vin: string, actorId?: string | null,
): Promise<void> {
  const v = String(vin || "").trim().toUpperCase();
  if (!tenantId || !v) return;
  try {
    const { data: existing } = await sb().from("vehicle_exceptions")
      .select("id, source_values")
      .eq("tenant_id", tenantId).eq("vin", v).eq("exception_type", AUTOGEN_EXCEPTION_TYPE)
      .in("status", ["open", "in_progress"])
      .maybeSingle();
    if (!existing?.id) return;
    const sv = (existing.source_values || {}) as { artifacts?: Record<string, string> };
    const artifacts = { ...(sv.artifacts || {}) };
    if (!(INTAKE_QUEUED_ARTIFACT in artifacts)) return;
    delete artifacts[INTAKE_QUEUED_ARTIFACT];
    const patch: Record<string, unknown> = { source_values: { ...sv, artifacts } };
    if (Object.keys(artifacts).length === 0) {
      patch.status = "resolved";
      patch.resolved_at = new Date().toISOString();
      if (actorId) patch.resolved_by = actorId;
    }
    await sb().from("vehicle_exceptions").update(patch).eq("id", existing.id);
  } catch { /* best-effort — the sweep still completes an interrupted intake */ }
}

export async function runManualIntakeOrchestration(
  tenantId: string | null | undefined,
  vin: string,
  condition?: string | null,
): Promise<void> {
  const v = String(vin || "").trim().toUpperCase();
  const cond = String(condition || "used").toLowerCase();
  if (!tenantId || !v) return;
  // Factory Window Sticker orchestration applies to EVERY condition (new
  // cars get the Monroney-style configuration record too), so it fires
  // before the used-only draft gate below. Same fire-and-forget contract as
  // the edge ingest path: fingerprint-idempotent server-side, and the
  // nightly resync re-fires unsettled records, so 'factory_sticker' keeps
  // the sweep-retried promise honest.
  try {
    void sb().functions.invoke("factory-sticker-orchestrate", {
      body: { action: "orchestrate", tenant_id: tenantId, vin: v, reason: "manual_intake" },
    })
      .then(({ error }: { error: unknown }) => {
        if (error) void recordArtifactFailure(tenantId, v, "factory_sticker", errText(error));
      })
      .catch((e: unknown) => { void recordArtifactFailure(tenantId, v, "factory_sticker", errText(e)); });
  } catch (e) {
    await recordArtifactFailure(tenantId, v, "factory_sticker", errText(e));
  }
  if (!["used", "cpo", "certified"].includes(cond)) return;
  for (const { fn, artifact } of DRAFT_RPCS) {
    try {
      const { error } = await sb().rpc(fn, { p_tenant_id: tenantId, p_vin: v });
      if (error) await recordArtifactFailure(tenantId, v, artifact, errText(error));
    } catch (e) {
      await recordArtifactFailure(tenantId, v, artifact, errText(e));
    }
  }
  // Render the official form PDFs from the drafts above — the same
  // fire-and-forget generate-vehicle-forms call autoPreload makes on the edge
  // ingest path (intake-autoprovision.ts). Runs after the draft RPCs so the
  // warranty box is set; a failure is recorded as form_pdfs and never blocks.
  try {
    void sb().functions.invoke("generate-vehicle-forms", { body: { tenant_id: tenantId, vin: v } })
      .then(({ error }: { error: unknown }) => {
        if (error) void recordArtifactFailure(tenantId, v, "form_pdfs", errText(error));
      })
      .catch((e: unknown) => { void recordArtifactFailure(tenantId, v, "form_pdfs", errText(e)); });
  } catch (e) {
    await recordArtifactFailure(tenantId, v, "form_pdfs", errText(e));
  }
  try {
    const { error } = await sb().rpc("issue_vehicle_ready_token", { p_tenant_id: tenantId, p_vin: v });
    if (error) await recordArtifactFailure(tenantId, v, "get_ready_token", errText(error));
  } catch (e) {
    await recordArtifactFailure(tenantId, v, "get_ready_token", errText(e));
  }
  try {
    await sb().rpc("recompute_delivery_clearance", { p_tenant_id: tenantId, p_vin: v });
  } catch { /* the stored clearance is recomputed by every service surface */ }
}
