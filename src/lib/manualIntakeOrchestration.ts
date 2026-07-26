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
        recommended_action: RECOMMENDED_ACTION,
      }).eq("id", existing.id);
      return;
    }
    await sb().from("vehicle_exceptions").insert({
      tenant_id: tenantId, vin, exception_type: AUTOGEN_EXCEPTION_TYPE,
      severity: "high",
      title: `Intake auto-generation failed: ${artifact}`,
      explanation: `Automatic creation of "${artifact}" failed: ${message}. The vehicle was still created without this artifact.`,
      source_values: { artifacts: { [artifact]: message } },
      recommended_action: RECOMMENDED_ACTION,
      status: "open",
    });
  } catch { /* exception recording is best-effort — never break the add */ }
}

export async function runManualIntakeOrchestration(
  tenantId: string | null | undefined,
  vin: string,
  condition?: string | null,
): Promise<void> {
  const v = String(vin || "").trim().toUpperCase();
  const cond = String(condition || "used").toLowerCase();
  if (!tenantId || !v) return;
  if (!["used", "cpo", "certified"].includes(cond)) return;
  for (const { fn, artifact } of DRAFT_RPCS) {
    try {
      const { error } = await sb().rpc(fn, { p_tenant_id: tenantId, p_vin: v });
      if (error) await recordArtifactFailure(tenantId, v, artifact, errText(error));
    } catch (e) {
      await recordArtifactFailure(tenantId, v, artifact, errText(e));
    }
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
