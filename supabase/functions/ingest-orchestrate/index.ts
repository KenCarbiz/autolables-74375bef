import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient, isServiceOrCron } from "../_shared/supabase.ts";
import { invokeFunction, mapWithConcurrency } from "../_shared/invoke.ts";
import { recordIngestStep } from "../_shared/intake-autoprovision.ts";

// ──────────────────────────────────────────────────────────────────────
// ingest-orchestrate — the fire-once recon dispatch that runs the moment a
// vehicle is ingested. Two modes:
//
//   Single  { tenant_id, vin, listing_id, ymm? }
//     Claims the listing (atomic, fire-once), seeds a recon estimate from the
//     dealer's required canned services, and — in 'auto' dispatch mode — emails
//     the used-car manager the approve link for any over-threshold lines.
//     A re-sync of the same car is a no-op (the claim already fired).
//
//   Sweep   { sweep: true, tenant_id? }
//     The daily self-heal backstop, in two phases. First: in-stock listings
//     that never got orchestrated (orchestrated_at IS NULL) run the single path,
//     so a car that slipped past the intake hook still gets its recon estimate.
//     Second (reconcileArtifacts): in-stock listings whose downstream artifacts
//     are observably missing get those steps re-fired — a claim already stamped
//     hides the first phase's selector, so without this a vehicle that was
//     orchestrated and then lost a step was never looked at again.
//     Every dispatch and every declined dispatch writes vehicle_ingest_ledger,
//     and the run summary is written to audit_log as ingest_orchestrate_sweep.
//
// Auth: service-role / cron-secret only — it fans out email.
// ──────────────────────────────────────────────────────────────────────

const SWEEP_CAP = 200;

// ── The reconcile pass ────────────────────────────────────────────────
//
// The sweep above heals ONE thing: a vehicle whose orchestration never fired
// at all (orchestrated_at IS NULL). Everything downstream of the claim was
// fire-once with no reconciliation, so a vehicle that was orchestrated and
// then lost a step kept its claim and was never looked at again.
//
// Two of those losses account for the gaps the dealer sees:
//
//   * A listing that stayed DRAFT. Auto-publish is one UPDATE inside the
//     claimed window; a recall block, a write error or the isolate dying loses
//     it, and the claim is already stamped, so nothing tried again. A draft
//     listing is not served to shoppers at all, which makes it the one gap
//     that costs the dealer whether or not every artifact underneath it
//     succeeded.
//   * A missing description case or an absent/parked sticker record. Both had
//     exactly one automatic producer for a vehicle already on the lot: the
//     MarketCheck resync, which needs the tenant to have a feed AND the VIN to
//     be in tonight's payload.
//
// This is state-derived on purpose. It asks what is missing rather than
// replaying what was queued, so it heals work lost to an isolate teardown that
// left no record of itself — which is the whole class of failure the paced
// artifact queue can still suffer at the tail of a large feed.
//
// Idempotent by construction, per the owner's rule: an existing case row or a
// settled sticker record is verified, never rebuilt.
const RECONCILE_CAP = 300;
const RECONCILE_BUDGET_MS = 120_000;
const RECONCILE_GAP_MS = 250;
const RECONCILE_CONCURRENCY = 2;

// Sticker states that mean "the pipeline stopped short and re-firing is
// allowed". Deliberately NOT the in-flight, review, terminal or published
// states: re-running those is the dedicated factory-sticker sweep's decision,
// not this one's.
const STICKER_RETRYABLE = new Set(["PENDING_DATA", "FAILED_RETRYABLE", "READY_TO_GENERATE"]);
const DESCRIPTION_IN_FLIGHT = new Set(["QUEUED", "BUILDING_FACTS", "GENERATING", "VALIDATING", "PUBLISHING"]);
const DESCRIPTION_STALE_MS = 30 * 60_000;

const errText = (e: unknown): string =>
  String((e as { message?: string } | null)?.message || e || "unknown error").slice(0, 500);

/**
 * Publish the customer passport. Reports whether the listing is live.
 *
 * supabase-js REPORTS a blocked publish as { error }; it does not throw. The
 * block therefore has to be read off the result, or a car the recall gate
 * refused to publish leaves no trace anywhere.
 */
// deno-lint-ignore no-explicit-any
async function autoPublish(admin: any, tenantId: string, vin: string, listingId: string): Promise<boolean> {
  try {
    const { error } = await admin.from("vehicle_listings")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", listingId).neq("status", "published");
    if (!error) return true;
    const reason = String(error.message || error).slice(0, 500);
    try {
      await admin.from("audit_log").insert({
        action: "ingest_auto_publish_blocked",
        entity_type: "vehicle_listing",
        entity_id: listingId,
        store_id: tenantId,
        details: { vin, code: error.code ?? null, reason },
      });
    } catch { /* audit is best-effort; it must never fail intake */ }
    await recordIngestStep(admin, tenantId, vin, "auto_publish", "parked",
      `The passport could not be published on intake, so this vehicle is still a draft and no shopper can reach it: ${reason}. The nightly ingest reconcile re-attempts the publish.`,
      { vehicleId: listingId, detail: { code: error.code ?? null } });
    return false;
  } catch (e) {
    await recordIngestStep(admin, tenantId, vin, "auto_publish", "failed",
      `Publishing the passport on intake threw: ${errText(e)}. The vehicle is still a draft.`,
      { vehicleId: listingId });
    return false;
  }
}

/**
 * One best-effort notification, with the outcome written down.
 *
 * These were `await fetch(...).catch(() => {})`. A dealer whose detail
 * department never hears about a car, or whose UCM never gets the approve
 * link, had no way to find out: the call left no row on any outcome, so a
 * silent 500 and a delivered email were the same event.
 */
// deno-lint-ignore no-explicit-any
async function notify(
  admin: any, tenantId: string, vin: string, listingId: string,
  fn: string, step: string, body: Record<string, unknown>, consequence: string,
): Promise<void> {
  const res = await invokeFunction(`${SUPABASE_URL}/functions/v1/${fn}`, SERVICE_KEY, {
    body, timeoutMs: 20_000, maxRetries: 1, maxWaitMs: 3_000, deadlineMs: 30_000,
  });
  if (res.ok) return;
  await recordIngestStep(admin, tenantId, vin, step, res.rateLimited ? "parked" : "failed",
    `${fn} did not accept the intake notification (${res.error ?? "unknown error"}), so ${consequence}.`,
    { vehicleId: listingId, detail: { function: fn, status: res.status, attempts: res.attempts } });
}

// deno-lint-ignore no-explicit-any
async function orchestrateOne(admin: any, tenantId: string, vin: string, listingId: string, ymm: string | null): Promise<string> {
  // Atomic fire-once claim. Only the winner dispatches.
  const { data: won } = await admin.rpc("claim_listing_orchestration", { _listing_id: listingId });
  if (won !== true) return "already_orchestrated";

  // Dealer's intake dispatch preference (manual = stage for UCM, auto = send now).
  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const settings = (prof?.settings || {}) as Record<string, unknown>;
  const mode = String(settings.ingest_recon_dispatch || "manual") === "auto" ? "auto" : "manual";

  // Auto-publish the customer passport on intake (default on). No prep/K-208
  // gate at intake — only a known do-not-drive recall blocks the publish
  // trigger, in which case this stays draft.
  //
  // supabase-js REPORTS a blocked publish as { error }; it does not throw. The
  // block therefore has to be read off the result, or a car that the recall
  // gate refused to publish leaves no trace anywhere.
  if (String(settings.ingest_auto_publish) !== "false") {
    await autoPublish(admin, tenantId, vin, listingId);
  }

  // Auto-dispatch the detail get-ready to the detail department on intake when
  // the dealer chose auto detail dispatch. Best-effort; never blocks the seed.
  if (String(settings.ingest_detail_dispatch || "manual") === "auto") {
    await notify(admin, tenantId, vin, listingId, "notify-getready", "getready_dispatch",
      { tenant_id: tenantId, vin },
      "the detail department was not told this vehicle arrived");
  }

  // Auto-notify the dealer's third-party installers on intake (default on).
  if (String(settings.thirdparty_auto_notify) !== "false") {
    await notify(admin, tenantId, vin, listingId, "notify-installer", "installer_notify",
      { tenant_id: tenantId, vin },
      "the dealer's third-party installers were not told this vehicle arrived");
  }

  const { data: seed } = await admin.rpc("seed_recon_estimate_for_ingest", {
    _tenant_id: tenantId, _vin: vin, _ymm: ymm, _vehicle_listing_id: listingId, _mode: mode,
  });
  const r = (seed || {}) as { ok?: boolean; approval_token?: string; needs_approval?: boolean; skipped?: string };
  if (!r.ok || r.skipped) return r.skipped || "no_estimate";

  // In auto mode, anything over the auto-approve threshold needs the UCM — email
  // the approve link now. Manual-mode estimates wait in the UCM's daily queue,
  // so we don't email on intake.
  if (mode === "auto" && r.needs_approval && r.approval_token) {
    await notify(admin, tenantId, vin, listingId, "notify-recon-approval", "recon_approval_email",
      { approval_token: r.approval_token },
      "the used-car manager never got the approve link, so the estimate is waiting on an email that was not sent");
  }
  return `seeded_${mode}`;
}

/**
 * orchestrateOne, with the fire-once claim made survivable.
 *
 * claim_listing_orchestration stamps orchestrated_at BEFORE any of the work,
 * and the sweep selects on `orchestrated_at IS NULL`. So a run that claimed a
 * vehicle and then failed left it marked as orchestrated forever: no recon
 * estimate, no publish, and no path back — the self-heal sweep is blind to
 * exactly the vehicles it exists to heal.
 *
 * Releasing the claim is safe because every step past it is idempotent:
 * seed_recon_estimate_for_ingest allows one ingest-origin estimate per car,
 * ever, and the publish is a no-op once the listing is live. A retry cannot
 * double-seed or double-email.
 */
// deno-lint-ignore no-explicit-any
async function orchestrateOneClaimSafe(
  admin: any, tenantId: string, vin: string, listingId: string, ymm: string | null,
): Promise<string> {
  try {
    return await orchestrateOne(admin, tenantId, vin, listingId, ymm);
  } catch (e) {
    try {
      await admin.from("vehicle_listings").update({ orchestrated_at: null }).eq("id", listingId);
    } catch { /* the ledger row below still names the vehicle */ }
    await recordIngestStep(admin, tenantId, vin, "ingest_orchestrate", "failed",
      `Recon orchestration failed after the fire-once claim was taken: ${errText(e)}. The claim has been released so the nightly ingest-orchestrate sweep retries this vehicle.`,
      { vehicleId: listingId });
    throw e;
  }
}

interface ReconcileTarget {
  id: string; tenant_id: string; vin: string; status: string;
}

interface ReconcileSummary {
  examined: number;
  capped: boolean;
  published: number;
  descriptions: number;
  stickers: number;
  undecidable: number;
  failed: number;
}

/** Chunked `in` read keyed by vehicle_id. Unreadable chunks are reported, not guessed. */
// deno-lint-ignore no-explicit-any
async function readByVehicle(
  admin: any, table: string, columns: string, ids: string[],
): Promise<{ rows: Map<string, Record<string, unknown>>; unreadable: Set<string> }> {
  const rows = new Map<string, Record<string, unknown>>();
  const unreadable = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    try {
      const { data, error } = await admin.from(table).select(columns).in("vehicle_id", chunk);
      if (error) { for (const id of chunk) unreadable.add(id); continue; }
      for (const row of ((data || []) as Record<string, unknown>[])) {
        const id = String(row?.vehicle_id || "");
        if (id) rows.set(id, row);
      }
    } catch { for (const id of chunk) unreadable.add(id); }
  }
  return { rows, unreadable };
}

// deno-lint-ignore no-explicit-any
async function reconcileArtifacts(admin: any, scopeTenantId: string | null): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    examined: 0, capped: false, published: 0, descriptions: 0, stickers: 0, undecidable: 0, failed: 0,
  };
  const deadline = Date.now() + RECONCILE_BUDGET_MS;

  let q = admin.from("vehicle_listings")
    .select("id, tenant_id, vin, status")
    .in("status", ["draft", "published"])
    .order("updated_at", { ascending: false })
    .limit(RECONCILE_CAP);
  if (scopeTenantId) q = q.eq("tenant_id", scopeTenantId);
  const { data: listings, error: listErr } = await q;
  if (listErr) return summary;

  const targets = ((listings || []) as ReconcileTarget[])
    .filter((r) => !!r?.id && !!r?.tenant_id && !!r?.vin);
  summary.examined = targets.length;
  summary.capped = targets.length >= RECONCILE_CAP;
  if (targets.length === 0) return summary;

  const ids = targets.map((r) => r.id);
  const cases = await readByVehicle(admin, "description_cases", "vehicle_id, status, archived_at, updated_at", ids);
  const stickers = await readByVehicle(admin, "factory_sticker_records", "vehicle_id, generation_status", ids);

  // Auto-publish is a per-dealer setting, so it is read once per tenant rather
  // than once per car.
  const publishAllowed = new Map<string, boolean>();
  const tenantIds = [...new Set(targets.map((r) => r.tenant_id))];
  try {
    const { data: profiles } = await admin.from("dealer_profiles")
      .select("tenant_id, settings").in("tenant_id", tenantIds);
    for (const p of ((profiles || []) as Array<{ tenant_id: string; settings: Record<string, unknown> | null }>)) {
      publishAllowed.set(p.tenant_id, String((p.settings || {}).ingest_auto_publish) !== "false");
    }
  } catch { /* absent profile falls through to the default below */ }

  const now = Date.now();
  await mapWithConcurrency(targets, RECONCILE_CONCURRENCY, async (v) => {
    if (Date.now() >= deadline) return;

    // A draft passport is not served to shoppers, so re-attempting the publish
    // is worth more than any single artifact this pass could fire. The intake
    // publish is a single UPDATE with no retry behind it.
    if (v.status === "draft" && (publishAllowed.get(v.tenant_id) ?? true)) {
      if (await autoPublish(admin, v.tenant_id, v.vin, v.id)) summary.published++;
    }

    if (cases.unreadable.has(v.id) || stickers.unreadable.has(v.id)) {
      summary.undecidable++;
      await recordIngestStep(admin, v.tenant_id, v.vin, "ingest_reconcile", "parked",
        "The reconcile pass could not read this vehicle's description or sticker state, so nothing was re-fired. Reading it is what decides; guessing would re-render the fleet.",
        { vehicleId: v.id });
      return;
    }

    const caseRow = cases.rows.get(v.id) as
      { status?: string | null; archived_at?: string | null; updated_at?: string | null } | undefined;
    const descriptionWhy = describeDescriptionGap(caseRow, now);
    if (descriptionWhy && Date.now() < deadline) {
      const ok = await dispatch(admin, v, "description-orchestrate", "description",
        { action: "orchestrate", tenant_id: v.tenant_id, vehicle_id: v.id, reason: "ingest_reconcile" },
        descriptionWhy);
      if (ok) summary.descriptions++; else summary.failed++;
    }

    const stickerRow = stickers.rows.get(v.id) as { generation_status?: string | null } | undefined;
    const stickerState = String(stickerRow?.generation_status || "").toUpperCase();
    const stickerWhy = !stickerRow
      ? "no factory sticker record exists for this vehicle"
      : STICKER_RETRYABLE.has(stickerState)
        ? `the factory sticker record is parked in ${stickerState}`
        : null;
    if (stickerWhy && Date.now() < deadline) {
      const ok = await dispatch(admin, v, "factory-sticker-orchestrate", "factory_sticker",
        { action: "orchestrate", tenant_id: v.tenant_id, vehicle_id: v.id, reason: "ingest_reconcile" },
        stickerWhy);
      if (ok) summary.stickers++; else summary.failed++;
    }
  }, { gapMs: RECONCILE_GAP_MS });

  return summary;
}

function describeDescriptionGap(
  row: { status?: string | null; archived_at?: string | null; updated_at?: string | null } | undefined,
  nowMs: number,
): string | null {
  if (!row) return "no description case exists for this vehicle";
  if (row.archived_at) return "the description case is archived while the vehicle is in stock";
  const status = String(row.status || "").toUpperCase();
  if (status === "FAILED_RETRYABLE") return "the description case is in FAILED_RETRYABLE";
  if (DESCRIPTION_IN_FLIGHT.has(status)) {
    const at = Date.parse(String(row.updated_at || ""));
    if (!Number.isFinite(at)) return `the description case is ${status} with no update time`;
    if (nowMs - at > DESCRIPTION_STALE_MS) return `the description case has been ${status} for over 30 minutes`;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function dispatch(
  admin: any, v: ReconcileTarget, fn: string, step: string,
  body: Record<string, unknown>, why: string,
): Promise<boolean> {
  const res = await invokeFunction(`${SUPABASE_URL}/functions/v1/${fn}`, SERVICE_KEY, {
    body, timeoutMs: 20_000, maxRetries: 1, maxWaitMs: 3_000, deadlineMs: 30_000,
  });
  const detail = { function: fn, status: res.status, attempts: res.attempts, why };
  if (res.ok) {
    await recordIngestStep(admin, v.tenant_id, v.vin, step, "succeeded",
      `The nightly ingest reconcile re-fired ${fn} because ${why}; it answered ${res.status}.`,
      { vehicleId: v.id, detail });
    return true;
  }
  await recordIngestStep(admin, v.tenant_id, v.vin, step, res.rateLimited ? "parked" : "failed",
    `The nightly ingest reconcile re-fired ${fn} because ${why}, and it did not accept the request: ${res.error ?? "unknown error"}. The next nightly pass retries it.`,
    { vehicleId: v.id, detail });
  return false;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!isServiceOrCron(req)) return json(401, { error: "unauthorized" });

  const body = await req.json().catch(() => ({})) as {
    tenant_id?: string; vin?: string; listing_id?: string; ymm?: string | null; sweep?: boolean;
  };
  const admin = adminClient();

  // ── Single-vehicle dispatch (called from the intake hook) ────────────────
  if (!body.sweep) {
    const tenantId = body.tenant_id;
    const vin = (body.vin || "").toUpperCase().trim();
    const listingId = body.listing_id;
    if (!tenantId || !vin || !listingId) return json(400, { error: "tenant_id, vin, listing_id required" });
    try {
      const result = await orchestrateOneClaimSafe(admin, tenantId, vin, listingId, body.ymm ?? null);
      return json(200, { ok: true, result });
    } catch (e) {
      return json(500, { ok: false, error: String((e as Error)?.message || e).slice(0, 300) });
    }
  }

  // ── Self-heal sweep: orchestrate anything the intake hook missed ─────────
  const { data: pending } = await admin.from("vehicle_listings")
    .select("id, tenant_id, vin, ymm")
    .is("orchestrated_at", null)
    .in("status", ["draft", "published"])
    .limit(SWEEP_CAP);
  let done = 0;
  for (const v of (pending || []) as { id: string; tenant_id: string; vin: string; ymm: string | null }[]) {
    if (!v.tenant_id || !v.vin || !v.id) continue;
    try {
      const result = await orchestrateOneClaimSafe(admin, v.tenant_id, (v.vin || "").toUpperCase(), v.id, v.ymm);
      if (result.startsWith("seeded")) done++;
    } catch { /* skip one, keep sweeping */ }
  }

  // Second phase: heal what the fire-once claim cannot. See RECONCILE_CAP.
  const reconciled = await reconcileArtifacts(admin, body.tenant_id ?? null);

  const summary = { scanned: (pending || []).length, seeded: done, reconciled };
  // The cron calls this through net.http_post and discards the body, so a
  // response nobody reads is not a record. This row is.
  try {
    await admin.from("audit_log").insert({
      action: "ingest_orchestrate_sweep",
      entity_type: "tenant",
      entity_id: body.tenant_id ?? "all_tenants",
      store_id: body.tenant_id ?? null,
      details: summary,
    });
  } catch { /* audit is best-effort */ }

  return json(200, { ok: true, ...summary });
});
