// ──────────────────────────────────────────────────────────────────────
// Shared intake auto-provisioning — the one orchestration every ingest path
// runs for a genuinely new VIN (marketcheck-sync, dms-webhook, autocurb-sync):
// mint the permanent Get-Ready hub token, draft the addendum + compliance
// documents (Buyers Guide, K-208, Get-Ready, used-car window sticker), and
// fire-and-forget the render/enrichment calls.
//
// Two invariants (INTAKE_SPEC S1/S4):
//   1. A draft/artifact failure must NEVER fail or block ingestion — every
//      step is isolated and the loop continues.
//   2. Failures are RECORDED, not swallowed: each one lands in
//      vehicle_exceptions as 'artifact_autogen_failed' (upserted per VIN,
//      artifacts accumulated in source_values.artifacts) so the exception
//      queue and the intake summary can surface + retry it.
//
// Every draft RPC is VIN-idempotent, so calling this twice (re-sync, sweep
// overlap) is safe. No Deno globals — unit-testable under vitest.
// ──────────────────────────────────────────────────────────────────────

// Minimal structural view of the supabase-js client; both the Deno edge
// client and the vitest fake satisfy it.
// deno-lint-ignore no-explicit-any
type Admin = any;

export interface AutoPreloadInput {
  tenantId: string;
  vin: string;
  ymm: string | null;
  listingId: string | null;
  emailTitle?: boolean;
}

const EXCEPTION_TYPE = "artifact_autogen_failed";

// What actually retries a failed artifact. The nightly intake sweep
// (sweep_missing_intake_drafts) re-runs only the draft RPCs and the hub token,
// and recon/description have their own sweeps. factory_sticker is re-fired by
// every nightly resync pass (ensureComplianceDrafts' render path re-posts it
// while the record is missing or retryable). The edge-only artifacts
// (form_pdfs, oem_window_sticker, title_request_email) are fired once at
// ingest and retried by nothing — claiming "the nightly sweep will also retry"
// for them promised a retry that never comes.
const SWEEP_RETRIED = new Set([
  "addendum", "buyers_guide", "k208", "get_ready", "window_sticker",
  "get_ready_token", "ingest_orchestrate", "description", "factory_sticker",
]);

export function recommendedActionFor(artifacts: string[]): string {
  const sweep = artifacts.filter((a) => SWEEP_RETRIED.has(a));
  const edge = artifacts.filter((a) => !SWEEP_RETRIED.has(a));
  if (edge.length === 0) {
    return "Retry from the vehicle intake summary; the nightly intake sweep will also retry.";
  }
  if (sweep.length === 0) {
    return `Retry from the vehicle intake summary. No nightly sweep re-runs ${edge.join(", ")} — it will not retry on its own.`;
  }
  return `Retry from the vehicle intake summary. The nightly intake sweep will retry ${sweep.join(", ")}, but ${edge.join(", ")} will not retry on its own.`;
}

const hex16 = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const errText = (e: unknown): string =>
  String((e as { message?: string } | null)?.message || e || "unknown error").slice(0, 500);

// AbortSignal.timeout exists in Deno and modern Node but not in every test
// environment; a missing signal only drops the client-side timeout.
const timeoutSignal = (ms: number): AbortSignal | undefined => {
  const t = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof t === "function" ? t.call(AbortSignal, ms) : undefined;
};

// Record one failed artifact for the VIN. One open exception row per VIN
// (partial unique index on (tenant, vin, exception_type) for open rows), so an
// existing row is refreshed with the new artifact merged into
// source_values.artifacts. Never throws.
export async function recordArtifactFailure(
  admin: Admin, tenantId: string, vin: string, artifact: string, message: string,
): Promise<void> {
  try {
    const { data: existing } = await admin.from("vehicle_exceptions")
      .select("id, source_values")
      .eq("tenant_id", tenantId).eq("vin", vin).eq("exception_type", EXCEPTION_TYPE)
      .in("status", ["open", "in_progress"])
      .maybeSingle();
    if (existing?.id) {
      const prev = ((existing.source_values || {}) as { artifacts?: Record<string, string> }).artifacts || {};
      const merged = { ...prev, [artifact]: message };
      await admin.from("vehicle_exceptions").update({
        severity: "high",
        title: `Intake auto-generation failed: ${artifact}`,
        explanation: `Automatic creation of "${artifact}" failed: ${message}`,
        source_values: { ...(existing.source_values || {}), artifacts: merged },
        // Recomputed over the merged set: a row that gains an edge-only
        // artifact must stop promising the sweep will retry everything.
        recommended_action: recommendedActionFor(Object.keys(merged)),
      }).eq("id", existing.id);
      return;
    }
    await admin.from("vehicle_exceptions").insert({
      tenant_id: tenantId, vin, exception_type: EXCEPTION_TYPE,
      severity: "high",
      title: `Intake auto-generation failed: ${artifact}`,
      explanation: `Automatic creation of "${artifact}" failed: ${message}. Ingestion continued without this artifact.`,
      source_values: { artifacts: { [artifact]: message } },
      recommended_action: recommendedActionFor([artifact]),
      status: "open",
    });
  } catch { /* exception recording is best-effort — never break ingest */ }
}

// supabase-js RPCs report Postgres errors on the return value, not by
// throwing — the old per-caller try/catch never saw them. Check both.
async function draftRpc(
  admin: Admin, tenantId: string, vin: string, fn: string, artifact: string,
): Promise<void> {
  try {
    const { error } = await admin.rpc(fn, { p_tenant_id: tenantId, p_vin: vin });
    if (error) await recordArtifactFailure(admin, tenantId, vin, artifact, errText(error));
  } catch (e) {
    await recordArtifactFailure(admin, tenantId, vin, artifact, errText(e));
  }
}

// Fire-and-forget POST to a sibling edge function. Never awaited by callers by
// design (a render/enrichment failure must not slow the ingest loop); failures
// are recorded asynchronously.
function firePost(
  admin: Admin, serviceKey: string, tenantId: string, vin: string,
  url: string, body: Record<string, unknown>, timeoutMs: number, artifact: string,
): void {
  const record = (msg: string) => { void recordArtifactFailure(admin, tenantId, vin, artifact, msg); };
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(body),
      signal: timeoutSignal(timeoutMs),
    }).then((res) => { if (!res.ok) record(`http_${res.status}`); })
      .catch((e) => record(errText(e)));
  } catch (e) {
    record(errText(e));
  }
}

// Mint the permanent Get-Ready hub token if this vehicle doesn't already have a
// live one. Cheap + idempotent, so it can run on every sync pass to back-fill
// pre-existing inventory and cars first ingested by other paths.
export async function ensureReadyToken(
  admin: Admin, tenantId: string, vin: string, ymm: string | null, listingId: string | null,
): Promise<void> {
  try {
    // A pending token past its expires_at is dead media — the /ready resolver
    // refuses it — so it counts as missing and a fresh token is minted. A row
    // without expires_at is treated as live (no evidence it expired).
    const { data: toks } = await admin.from("dept_signoff_tokens").select("id, expires_at")
      .eq("tenant_id", tenantId).eq("vin", vin).eq("department", "vehicle").eq("status", "pending");
    const now = Date.now();
    const live = (((toks as { expires_at?: string | null }[] | null) || []))
      .some((t) => !t.expires_at || new Date(t.expires_at).getTime() > now);
    if (!live) {
      const { error } = await admin.from("dept_signoff_tokens").insert({
        tenant_id: tenantId, vehicle_listing_id: listingId, vin, ymm,
        department: "vehicle", purpose: "get_ready", token: hex16(),
        expires_at: new Date(Date.now() + 365 * 864e5).toISOString(),
      });
      if (error) await recordArtifactFailure(admin, tenantId, vin, "get_ready_token", errText(error));
    }
  } catch (e) {
    await recordArtifactFailure(admin, tenantId, vin, "get_ready_token", errText(e));
  }
}

/** How ensureComplianceDrafts reaches generate-vehicle-forms on the resync path. */
export interface RenderTarget { supabaseUrl: string; serviceKey: string }

// Ensure the compliance drafts exist for a used/CPO vehicle on EVERY sync —
// not just first insert. Each RPC is VIN-idempotent and no-ops for new cars,
// so re-syncs safely backfill inventory that predates the autogen flow.
//
// When `render` is passed (the resync/backfill path — autoPreload fires
// generate-vehicle-forms itself and passes nothing), a form draft newly
// created here also gets its render: without it, a backfilled Buyers Guide /
// K-208 draft sat file-less forever, because generate-vehicle-forms only ran
// on first ingest. Fire-and-forget; a failure is recorded as form_pdfs.
export async function ensureComplianceDrafts(
  admin: Admin, tenantId: string, vin: string, render?: RenderTarget,
): Promise<void> {
  // Before the idempotent RPCs run, ask whether the vehicle is missing either
  // form document generate-vehicle-forms fills. Best-effort: an undecidable
  // read skips the render rather than re-rendering every vehicle every night.
  let needsFormRender = false;
  let needsFactorySticker = false;
  let listingId: string | null = null;
  if (render) {
    try {
      const { data: listing } = await admin.from("vehicle_listings")
        .select("id, condition")
        .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
      const cond = String(listing?.condition || "used").toLowerCase();
      listingId = (listing?.id as string | undefined) ?? null;
      if (listing?.id && ["used", "cpo", "certified"].includes(cond)) {
        const { data: formDocs, error } = await admin.from("generated_documents")
          .select("id, document_type")
          .eq("tenant_id", tenantId).eq("vehicle_id", listing.id)
          .in("document_type", ["buyers_guide", "k208"])
          .not("document_status", "in", '("superseded","archived","rejected")');
        if (!error) {
          const types = new Set(
            (((formDocs || []) as { document_type?: string }[])).map((d) => String(d.document_type)));
          needsFormRender = !types.has("buyers_guide") || !types.has("k208");
        }
      }
      // Factory sticker orchestration (all conditions — new cars get the
      // Monroney-style configuration record too): re-fire only while the
      // record is missing or parked awaiting data / a retry / the renderer
      // (READY_TO_GENERATE is how records wait for the renderer to land —
      // without re-firing it the fleet would never generate once it does),
      // so resyncs and backfills cover the fleet without re-posting settled
      // vehicles every night. Undecidable read → do not fire.
      if (listing?.id) {
        const { data: fsr, error: fsErr } = await admin.from("factory_sticker_records")
          .select("id, generation_status")
          .eq("tenant_id", tenantId).eq("vehicle_id", listing.id).maybeSingle();
        if (!fsErr) {
          const status = String((fsr as { generation_status?: string } | null)?.generation_status || "");
          needsFactorySticker = !fsr || ["PENDING_DATA", "FAILED_RETRYABLE", "READY_TO_GENERATE"].includes(status);
        }
      }
    } catch { /* undecidable — do not render */ }
  }

  await draftRpc(admin, tenantId, vin, "create_draft_buyers_guide", "buyers_guide");
  await draftRpc(admin, tenantId, vin, "create_draft_safety_inspection", "k208");
  await draftRpc(admin, tenantId, vin, "create_draft_get_ready", "get_ready");
  await draftRpc(admin, tenantId, vin, "create_draft_window_sticker", "window_sticker");

  if (render && needsFormRender) {
    firePost(admin, render.serviceKey, tenantId, vin,
      `${render.supabaseUrl}/functions/v1/generate-vehicle-forms`,
      { tenant_id: tenantId, vin }, 25000, "form_pdfs");
  }
  if (render && needsFactorySticker && listingId) {
    firePost(admin, render.serviceKey, tenantId, vin,
      `${render.supabaseUrl}/functions/v1/factory-sticker-orchestrate`,
      { action: "orchestrate", tenant_id: tenantId, vehicle_id: listingId, reason: "resync" },
      20000, "factory_sticker");
  }
}

// Auto-preload a brand-new vehicle the moment it's ingested: hub token, draft
// addendum + compliance docs, then the fire-and-forget render/enrichment calls
// (official PDFs, OEM sticker, title email, recon orchestration, description).
// Never throws back into the ingest loop. Run only on genuinely new listings.
export async function autoPreload(
  admin: Admin, supabaseUrl: string, serviceKey: string, input: AutoPreloadInput,
): Promise<void> {
  const { tenantId, vin, ymm, listingId, emailTitle = false } = input;
  await ensureReadyToken(admin, tenantId, vin, ymm, listingId);
  await draftRpc(admin, tenantId, vin, "create_draft_addendum", "addendum");
  await ensureComplianceDrafts(admin, tenantId, vin);

  // Fill the official FTC Buyers Guide + K-208 PDFs from the drafted data.
  // Runs after the drafts above so the warranty box is set.
  firePost(admin, serviceKey, tenantId, vin,
    `${supabaseUrl}/functions/v1/generate-vehicle-forms`, { tenant_id: tenantId, vin }, 25000, "form_pdfs");
  // No-op if no window-sticker API key is configured.
  firePost(admin, serviceKey, tenantId, vin,
    `${supabaseUrl}/functions/v1/oem-window-sticker`, { vin, tenant_id: tenantId }, 20000, "oem_window_sticker");
  if (emailTitle) {
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/email-title-request`, { tenant_id: tenantId, vin }, 20000, "title_request_email");
  }
  if (listingId) {
    // Fire-once recon orchestration; idempotent server-side, so a re-sync
    // never double-dispatches.
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/ingest-orchestrate`,
      { tenant_id: tenantId, vin, listing_id: listingId, ymm }, 20000, "ingest_orchestrate");
    // Description Intelligence: idempotent on (tenant, vehicle, versions); the
    // nightly reconcile sweep picks up anything missed here.
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/description-orchestrate`,
      { action: "orchestrate", tenant_id: tenantId, vehicle_id: listingId, reason: "ingest" }, 20000, "description");
    // Factory Window Sticker: fingerprint-idempotent server-side; the nightly
    // resync path (ensureComplianceDrafts) re-fires anything missed here.
    firePost(admin, serviceKey, tenantId, vin,
      `${supabaseUrl}/functions/v1/factory-sticker-orchestrate`,
      { action: "orchestrate", tenant_id: tenantId, vehicle_id: listingId, reason: "ingest" }, 20000, "factory_sticker");
  }
}
