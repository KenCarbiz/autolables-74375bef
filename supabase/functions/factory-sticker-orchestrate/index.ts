// ─────────────────────────────────────────────────────────────────────
// factory-sticker-orchestrate — the Factory Window Sticker lifecycle
// engine. Composable server-side operations behind one entry point:
//
//   orchestrate     — load saved data → normalize → reconcile → render →
//                     QA → file → (auto-)publish. Fired from ingest and
//                     resync; idempotent on the generation fingerprint.
//   regenerate      — forced re-run (manager roles), including reingest
//                     out of FAILED_PERMANENT / ARCHIVED.
//   approve_publish — manager approves a review-required sticker.
//   unpublish       — manager pulls a published sticker back to review.
//
// Hard rules:
//   * This function performs NO provider HTTP calls. Everything renders
//     from data already SAVED on vehicle_listings (mc_attributes /
//     build_sheet / epa_economy) and dealer_profiles.settings. Provider
//     pulls belong to marketcheck-specs; the raw capture belongs to
//     neovin_snapshots.
//   * Rendering goes through ONE interface (_shared/factorySticker/
//     render.ts). Until the renderer lands it throws "renderer_pending",
//     which parks the record READY_TO_GENERATE — not a failure.
//   * Fire-and-forget from ingest: failures are isolated into
//     factory_sticker_records (bounded to 3 retryable attempts) and
//     never propagate back into the inventory pipeline.
// ─────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { normalizeForSticker } from "./normalize.ts";
import {
  renderFactorySticker, FACTORY_STICKER_RENDERER_VERSION,
  type FactoryStickerRenderResult, type FactoryStickerTheme,
  resolveRenderProfile,
  selectOemTemplate, validatePageGeometry, evaluateStickerEligibility,
  listCompatibleTemplates, validateTemplateOverride, checkRenderedCompleteness,
} from "../_shared/factorySticker/render.ts";
import { parseYmm } from "../_shared/factorySticker/lib/ymm.ts";
import { structuredSheet } from "../_shared/neovinSheet.ts";
import { shouldDecodeVin, MAX_SPEC_ATTEMPTS } from "../_shared/factorySticker/lib/sourceData.ts";
import { recordSourcePayload, refreshVehicleTruth } from "./truth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";

const BUCKET = "vehicle-docs";
const TEMPLATE_VERSION = "1.0.0";
const MAX_RETRYABLE_ATTEMPTS = 3;

// ── Nightly sweep policy ─────────────────────────────────────────────
// Statuses whose record is unfinished work: the pipeline stopped short of a
// filed, decided document and would move forward the moment the missing data
// or the renderer arrives.
const SWEEP_RETRYABLE_STATUSES = new Set(["PENDING_DATA", "FAILED_RETRYABLE", "READY_TO_GENERATE"]);
// Mid-pipeline statuses. A function timeout or a killed invocation between
// NORMALIZING and the final write leaves the record parked in one of these
// with no document, reading "Generating..." and "Needs review" forever: they
// were in neither the retryable set nor the never-rerun set, so the sweep
// filtered them out and nothing else ever looked at them. Only rescued once
// the row has genuinely gone stale, so a live run is never re-entered.
const SWEEP_INFLIGHT_STATUSES = new Set(["NORMALIZING", "VALIDATING", "GENERATING", "RUNNING_QA"]);
const SWEEP_INFLIGHT_STALE_MS = 15 * 60_000;
// Statuses a sweep must never touch. PUBLISHED / APPROVED / SUPERSEDED are
// settled documents — regenerating one behind the dealer's back can replace
// what a customer is already looking at. FAILED_PERMANENT and ARCHIVED only
// re-enter through an explicitly forced regeneration.
const SWEEP_NEVER_RERUN_STATUSES = new Set([
  "PUBLISHED", "APPROVED", "SUPERSEDED", "ARCHIVED", "FAILED_PERMANENT",
]);
const SWEEP_LOCK_KEY = "factory_sticker_sweep";
const SWEEP_LOCK_TTL_SECONDS = 300;
const SWEEP_BUDGET_MS = 90_000;
const SWEEP_MAX_ROWS = 2000;

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

// Regeneration is always a recorded decision. "other" additionally demands a
// written explanation so the version history never says only "regenerated".
const REGENERATION_REASONS = new Set([
  "vehicle_information_corrected",
  "additional_source_data_available",
  "options_or_packages_corrected",
  "msrp_corrected",
  "wrong_template_selected",
  "pdf_or_layout_problem",
  "qr_or_passport_link_changed",
  "other",
]);

// Decision authority mirrors generate-vehicle-forms MANAGER_ROLES.
const MANAGER_ROLES = new Set([
  "owner", "general_manager", "gsm", "admin", "manager",
  "sales_manager", "used_car_manager", "inventory_manager",
]);

// Granular window-sticker authority, mirroring
// src/lib/permissions/windowStickerPermissions.ts. The UI hides what a
// role cannot do; this table is what actually enforces it. Requesting a
// regeneration is deliberately separated from authorizing a billable
// provider pull and from publishing to the customer passport.
const VIEWER_PERMS = ["view", "download"];
const REQUESTER_PERMS = [...VIEWER_PERMS, "view_history", "regenerate"];
const OPERATOR_PERMS = [
  ...REQUESTER_PERMS, "create", "edit_permitted_fields", "refresh_neovin",
  "approve", "publish", "unpublish", "restore_version",
];
const FULL_PERMS = [...OPERATOR_PERMS, "override_source_data"];

const STICKER_ROLE_PERMS: Record<string, string[]> = {
  owner: FULL_PERMS, admin: FULL_PERMS, general_manager: FULL_PERMS, gsm: FULL_PERMS,
  manager: OPERATOR_PERMS, used_car_manager: OPERATOR_PERMS, inventory_manager: OPERATOR_PERMS,
  sales_manager: REQUESTER_PERMS,
  salesperson: VIEWER_PERMS, finance: VIEWER_PERMS, office: VIEWER_PERMS,
  compliance: [...VIEWER_PERMS, "view_history"], biller: VIEWER_PERMS, readonly: VIEWER_PERMS,
  service_manager: VIEWER_PERMS, service_advisor: VIEWER_PERMS,
  detail: [], third_party_vendor: [],
};

// Same resolveAppBase pattern as generate-vehicle-forms: caller app_base →
// browser Origin → APP_BASE_URL secret → app host. The canonical passport
// URL (the QR payload) is derived from this.
function resolveAppBase(req: Request, appBase?: string): string {
  const isHttp = (u?: string | null): u is string => !!u && /^https?:\/\//i.test(u);
  const clean = (u: string) => u.replace(/\/+$/, "");
  if (isHttp(appBase)) return clean(appBase);
  const origin = req.headers.get("origin");
  if (isHttp(origin)) return clean(origin);
  const env = Deno.env.get("APP_BASE_URL");
  if (isHttp(env)) return clean(env);
  return "https://app.autolabels.io";
}

async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
type Admin = any;

async function audit(admin: Admin, tenantId: string, action: string, recordId: string, details: Record<string, unknown>) {
  try {
    await admin.from("audit_log").insert({
      action, entity_type: "factory_sticker_record", entity_id: recordId,
      store_id: tenantId, details,
    });
  } catch { /* audit must never break the pipeline */ }
}

// Guard-tolerant record write: the SQL transition guard may reject a status
// move (terminal states). Retry without generation_status so the rest of the
// patch (fingerprint, QA statuses, error text) is never lost to the guard.
async function setRecord(admin: Admin, recordId: string, patch: Record<string, unknown>) {
  const body = { ...patch, updated_at: new Date().toISOString() };
  const { error } = await admin.from("factory_sticker_records").update(body).eq("id", recordId);
  if (error && "generation_status" in patch) {
    console.error("setRecord rejected", recordId, error.message);
    const { generation_status: _drop, ...rest } = body as Record<string, unknown>;
    if (Object.keys(rest).length > 1) {
      await admin.from("factory_sticker_records").update(rest).eq("id", recordId);
    }
  } else if (error) {
    console.error("setRecord failed", recordId, error.message);
  }
}

interface RecordRow {
  id: string; tenant_id: string; vehicle_id: string; vin: string;
  generation_status: string; generation_fingerprint: string | null;
  current_document_id: string | null; attempt_count: number;
  qa_metadata: Record<string, unknown> | null;
}

async function loadOrCreateRecord(admin: Admin, tenantId: string, vehicleId: string, vin: string): Promise<{ record: RecordRow | null; created: boolean }> {
  const { data: existing } = await admin.from("factory_sticker_records")
    .select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
  if (existing) return { record: existing as RecordRow, created: false };
  // insert-then-reselect: a concurrent orchestrate may win the unique key race
  await admin.from("factory_sticker_records").upsert(
    { tenant_id: tenantId, vehicle_id: vehicleId, vin, generation_status: "PENDING_DATA" },
    { onConflict: "tenant_id,vehicle_id", ignoreDuplicates: true },
  );
  const { data: row } = await admin.from("factory_sticker_records")
    .select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
  return { record: (row as RecordRow) ?? null, created: true };
}

// fileForm-style filing (generate-vehicle-forms precedent): one mutable
// draft/pending row per (tenant, vehicle, type) overwritten in place; a
// locked row byte-identical → URL refresh; locked + changed → new immutable
// version + supersede.
async function fileStickerDocument(
  admin: Admin, tenantId: string, vehicleId: string, vin: string,
  pdfBytes: Uint8Array, previewSvg: string, snapExtra: Record<string, unknown>,
  publish: boolean, profileFamily: string, preservePublished = true,
): Promise<{ documentId: string | null; version: number; pdfUrl: string; previewUrl: string | null; supersededPublished: boolean }> {
  const hash = await sha256Hex(pdfBytes);

  const { data: all } = await admin.from("generated_documents")
    .select("id, version, document_status, data_snapshot")
    .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("document_type", "factory_sticker")
    .order("version", { ascending: false });
  const rows = (all || []) as { id: string; version: number; document_status: string; data_snapshot: Record<string, unknown> | null }[];
  const RETIRED = new Set(["superseded", "archived", "rejected"]);
  const MUTABLE = new Set(["draft", "pending_approval"]);
  const liveRows = rows.filter((r) => !RETIRED.has(r.document_status));
  // A published version stays public until an authorized user approves its
  // replacement: an unreviewed draft never supersedes what customers can
  // already see on the passport.
  const holdPublished = preservePublished && !publish;
  const publishedRows = liveRows.filter((r) => r.document_status === "published");
  const supersedable = holdPublished
    ? liveRows.filter((r) => r.document_status !== "published")
    : liveRows;
  const current = supersedable[0];
  const nextVersion = rows.reduce((m, r) => Math.max(m, r.version || 0), 0) + 1;
  const version = current && MUTABLE.has(current.document_status) ? current.version : nextVersion;

  const dir = `${tenantId}/vehicles/${vehicleId}/factory-stickers/v${version}`;
  const pdfPath = `${dir}/sticker.pdf`;
  const svgPath = `${dir}/preview.svg`;

  const { error: upErr } = await admin.storage.from(BUCKET)
    .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`storage upload failed (${BUCKET}/${pdfPath}): ${upErr.message}`);
  let previewUrl: string | null = null;
  try {
    await admin.storage.from(BUCKET)
      .upload(svgPath, new TextEncoder().encode(previewSvg), { contentType: "image/svg+xml", upsert: true });
    const { data: sp } = await admin.storage.from(BUCKET).createSignedUrl(svgPath, 60 * 60 * 24 * 7);
    previewUrl = sp?.signedUrl || null;
  } catch { /* preview is best-effort; the PDF is the artifact of record */ }
  const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(pdfPath, 60 * 60 * 24 * 7);
  if (signErr || !signed?.signedUrl) throw new Error(`signed url failed (${BUCKET}/${pdfPath}): ${signErr?.message || "no url returned"}`);
  const url = signed.signedUrl as string;

  try {
    await admin.from("signed_document_archive").upsert({
      tenant_id: tenantId, doc_type: "factory_sticker", entity_id: vehicleId, vin,
      storage_path: pdfPath, storage_bucket: BUCKET, content_hash: hash, byte_size: pdfBytes.length,
    }, { onConflict: "tenant_id,doc_type,entity_id,content_hash", ignoreDuplicates: true });
  } catch { /* archive best-effort */ }

  const targetStatus = publish ? "published" : "pending_approval";
  const snap = {
    source: "factory-sticker-orchestrate", storage_path: pdfPath, storage_bucket: BUCKET,
    preview_path: svgPath, content_hash: hash, ...snapExtra,
  };

  if (current && MUTABLE.has(current.document_status)) {
    await admin.from("generated_documents").update({
      online_url: url, pdf_url: url, png_url: previewUrl, data_snapshot: snap,
      document_status: targetStatus, updated_at: new Date().toISOString(),
      ...(publish ? { published_at: new Date().toISOString() } : {}),
    }).eq("id", current.id);
    const extras = supersedable.slice(1).map((r) => r.id);
    if (extras.length) {
      await admin.from("generated_documents")
        .update({ document_status: "superseded", superseded_by: current.id, updated_at: new Date().toISOString() })
        .in("id", extras);
    }
    await recordAssets(admin, tenantId, vehicleId, current.id, version, pdfPath, svgPath, BUCKET, hash, pdfBytes.length);
    return { documentId: current.id, version, pdfUrl: url, previewUrl, supersededPublished: false };
  }

  const identical = [current, ...publishedRows].find(
    (r) => r && (r.data_snapshot as { content_hash?: string } | null)?.content_hash === hash,
  );
  if (identical) {
    await admin.from("generated_documents").update({ online_url: url, pdf_url: url, png_url: previewUrl, updated_at: new Date().toISOString() }).eq("id", identical.id);
    await recordAssets(admin, tenantId, vehicleId, identical.id, identical.version, pdfPath, svgPath, BUCKET, hash, pdfBytes.length);
    return { documentId: identical.id, version: identical.version, pdfUrl: url, previewUrl, supersededPublished: false };
  }

  const { data: inserted, error: insErr } = await admin.from("generated_documents").insert({
    tenant_id: tenantId, vehicle_id: vehicleId, template_id: profileFamily,
    document_type: "factory_sticker", document_status: targetStatus, version: nextVersion,
    template_version: 1, online_url: url, pdf_url: url, png_url: previewUrl, data_snapshot: snap,
    ...(publish ? { published_at: new Date().toISOString() } : {}),
  }).select("id").maybeSingle();
  if (insErr) throw new Error(`generated_documents insert failed: ${insErr.message}`);
  const newId = (inserted as { id?: string } | null)?.id ?? null;
  if (newId && supersedable.length) {
    await admin.from("generated_documents")
      .update({ document_status: "superseded", superseded_by: newId, updated_at: new Date().toISOString() })
      .in("id", supersedable.map((r) => r.id));
  }
  await recordAssets(admin, tenantId, vehicleId, newId, nextVersion, pdfPath, svgPath, BUCKET, hash, pdfBytes.length);
  return {
    documentId: newId, version: nextVersion, pdfUrl: url, previewUrl,
    supersededPublished: !holdPublished && publishedRows.length > 0,
  };
}

// The durable address of every filed asset. Signed URLs expire; these
// coordinates do not, so a published document keeps working long after
// the URL that was minted alongside it has died.
async function recordAssets(
  admin: Admin, tenantId: string, vehicleId: string, documentId: string | null,
  version: number, pdfPath: string, previewPath: string, bucket: string,
  checksum: string, byteSize: number,
): Promise<void> {
  if (!documentId) return;
  try {
    await admin.from("document_assets").upsert([
      {
        tenant_id: tenantId, vehicle_id: vehicleId, document_id: documentId,
        document_type: "factory_sticker", document_version: version,
        asset_type: "pdf", storage_bucket: bucket, storage_path: pdfPath,
        mime_type: "application/pdf", checksum, byte_size: byteSize,
        updated_at: new Date().toISOString(),
      },
      {
        tenant_id: tenantId, vehicle_id: vehicleId, document_id: documentId,
        document_type: "factory_sticker", document_version: version,
        asset_type: "thumbnail", storage_bucket: bucket, storage_path: previewPath,
        mime_type: "image/svg+xml", checksum, byte_size: null,
        updated_at: new Date().toISOString(),
      },
    ], { onConflict: "document_id,asset_type" });
  } catch (e) {
    // Asset bookkeeping must never fail a filed document; the backfill
    // in the migration and the next regeneration both repair it.
    console.error("document_assets upsert failed", String((e as Error)?.message || e));
  }
}


// Year + make from the trusted vehicle record, for the case where the
// pipeline has not normalized yet. The listing's own year/make/model come
// from the structured inventory feed, not from dealer prose, so they are a
// legitimate selector — and without this the studio can only ever offer the
// neutral template on a vehicle whose build sheet has not arrived.
async function identityFromListing(
  admin: Admin, tenantId: string, vehicleId: string,
): Promise<{ make: string | null; year: number | null }> {
  const { data } = await admin.from("vehicle_listings")
    .select("ymm, mc_attributes").eq("tenant_id", tenantId).eq("id", vehicleId).maybeSingle();
  const row = (data || {}) as { ymm?: string | null; mc_attributes?: Record<string, unknown> | null };
  const mc = (row.mc_attributes || {}) as Record<string, unknown>;
  const mcMake = typeof mc.make === "string" ? mc.make : null;
  const mcYear = Number(mc.year);
  const parsed = parseYmm(row.ymm);
  const year = Number(parsed.year);
  return {
    make: mcMake || parsed.make || null,
    year: Number.isFinite(mcYear) && mcYear > 1900
      ? mcYear
      : (Number.isFinite(year) && year > 1900 ? year : null),
  };
}

// ── The pipeline for a single vehicle ────────────────────────────────
async function orchestrateVehicle(
  admin: Admin, req: Request, tenantId: string, vehicleId: string,
  opts: {
    force?: boolean; reason?: string; appBase?: string;
    /** Permission-gated: retrieve provider data when none is saved. */
    allowSourceFetch?: boolean;
    regeneration?: {
      reasonCode: string; reasonNotes: string | null;
      dataSource: "reuse" | "refresh"; userId: string | null;
    };
  } = {},
): Promise<Record<string, unknown>> {
  const { data: listing } = await admin.from("vehicle_listings").select("*").eq("id", vehicleId).maybeSingle();
  if (!listing) return { vehicle_id: vehicleId, skipped: "listing_not_found" };
  // A NULL-tenant listing must never be adopted by whoever asks first.
  if (listing.tenant_id !== tenantId) return { vehicle_id: vehicleId, skipped: "tenant_mismatch" };

  const vin = String(listing.vin || "").toUpperCase().trim();
  const { record } = await loadOrCreateRecord(admin, tenantId, vehicleId, vin);
  if (!record) return { vehicle_id: vehicleId, skipped: "record_not_initialized" };

  if (listing.status === "archived") {
    // The SQL trigger normally handles this; belt-and-suspenders for records
    // orchestrated after an archive raced past it.
    if (!["ARCHIVED", "SUPERSEDED"].includes(record.generation_status)) {
      await setRecord(admin, record.id, { generation_status: "ARCHIVED" });
    }
    return { vehicle_id: vehicleId, record_id: record.id, skipped: "archived" };
  }

  // Terminal-state handling: SUPERSEDED never re-runs; FAILED_PERMANENT and
  // ARCHIVED only re-enter via an explicit force (the guard allows exactly
  // the → PENDING_DATA edge).
  if (record.generation_status === "SUPERSEDED") {
    return { vehicle_id: vehicleId, record_id: record.id, skipped: "superseded" };
  }
  if (["FAILED_PERMANENT", "ARCHIVED"].includes(record.generation_status)) {
    if (!opts.force) return { vehicle_id: vehicleId, record_id: record.id, skipped: record.generation_status.toLowerCase() };
    await setRecord(admin, record.id, {
      generation_status: "PENDING_DATA", attempt_count: 0, last_error: null,
      review_required: false, review_reason: null,
    });
    record.attempt_count = 0;
  }
  if (record.generation_status === "FAILED_RETRYABLE" && record.attempt_count >= MAX_RETRYABLE_ATTEMPTS && !opts.force) {
    await setRecord(admin, record.id, {
      generation_status: "FAILED_PERMANENT",
      review_required: true, review_reason: "retry_budget_exhausted",
    });
    return { vehicle_id: vehicleId, record_id: record.id, skipped: "retry_budget_exhausted" };
  }

  await audit(admin, tenantId, "factory_sticker.ingest_triggered", record.id,
    { vin, reason: opts.reason || "ingest", force: !!opts.force });

  // ── VIN validation: a bad or drifted VIN is deterministic — it would fail
  // identically on every retry, so it is FAILED_PERMANENT, not retryable.
  if (!VIN_RE.test(vin) || (record.vin && record.vin.toUpperCase() !== vin)) {
    const reason = !VIN_RE.test(vin)
      ? `invalid_vin: listing VIN ${JSON.stringify(vin)} is not a valid 17-character VIN`
      : `vin_mismatch: record VIN ${record.vin} does not match listing VIN ${vin}`;
    await setRecord(admin, record.id, {
      generation_status: "FAILED_PERMANENT",
      review_required: true, review_reason: reason, last_error: reason,
    });
    await audit(admin, tenantId, "factory_sticker.review_required", record.id, { vin, reason });
    return { vehicle_id: vehicleId, record_id: record.id, status: "FAILED_PERMANENT", error: reason };
  }

  try {
    // ── Load SAVED data. The nightly path never calls a provider; an
    // operator pressing Generate on a vehicle that has no build sheet is
    // the one case where fetching is the only way forward, and that is an
    // explicit, permissioned, audited request rather than an implicit one.
    let mc = (listing.mc_attributes || {}) as Record<string, unknown>;
    let sheet = (mc.build_sheet || null) as Record<string, unknown> | null;
    // Before paying: we already stored the complete raw provider response for
    // every decode we have ever run, and nothing has ever read it back. A
    // build sheet missing from mc_attributes does NOT mean we never decoded
    // this VIN — the nightly feed sync used to delete the key outright. Try
    // the durable copy first; it costs a select and closes the re-purchase
    // loop that was re-billing the fleet.
    if (!sheet) {
      try {
        const { data: snap } = await admin.from("neovin_snapshots")
          .select("payload").eq("tenant_id", tenantId).eq("vin", vin)
          .order("fetched_at", { ascending: false }).limit(1).maybeSingle();
        const payload = (snap as { payload?: Record<string, unknown> } | null)?.payload;
        if (payload) {
          const rehydrated = structuredSheet(payload);
          if (rehydrated) {
            sheet = rehydrated;
            mc = { ...mc, build_sheet: rehydrated };
            await admin.from("vehicle_listings")
              .update({ mc_attributes: mc }).eq("id", vehicleId);
            listing.mc_attributes = mc;
            await audit(admin, tenantId, "factory_sticker.source_rehydrated", record.id,
              { vin, from: "neovin_snapshots" });
          }
        }
      } catch { /* the paid path below is the fallback, not the other way round */ }
    }
    // Attempt cap. The two sweeps enforce MAX_SPEC_ATTEMPTS; this path did
    // not, and never stamped the attempt either, so it was the one way to
    // re-buy an undecodable VIN indefinitely — four times a night.
    const decodeDecision = shouldDecodeVin(mc, MAX_SPEC_ATTEMPTS);
    if (!sheet && opts.allowSourceFetch && !decodeDecision.decode) {
      await setRecord(admin, record.id, {
        generation_status: "PENDING_DATA",
        last_error: `attempt_cap_reached: ${decodeDecision.reason}`,
        review_required: false, review_reason: null,
      });
      return { vehicle_id: vehicleId, record_id: record.id, status: "PENDING_DATA", skipped: "no_build_sheet" };
    }
    if (!sheet && opts.allowSourceFetch) {
      await setRecord(admin, record.id, { generation_status: "PENDING_DATA", last_error: null });
      await audit(admin, tenantId, "factory_sticker.source_fetch_requested", record.id,
        { vin, reason: "no_build_sheet", user_id: opts.regeneration?.userId ?? null });
      let fetchDetail: string | null = null;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/marketcheck-specs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ vin, tenant_id: tenantId, vehicle_id: vehicleId }),
        });
        const payload = await res.json().catch(() => ({}));
        fetchDetail = res.ok && payload?.ok !== false ? null : String(payload?.error || `http_${res.status}`);
      } catch (e) {
        fetchDetail = String((e as Error)?.message || e).slice(0, 200);
      }
      // Stamp the attempt from here. marketcheck-specs returns early without
      // writing on a no-match, which is exactly the case the cap exists for.
      // A retryable provider refusal is deliberately not counted.
      try {
        const { data: after } = await admin.from("vehicle_listings")
          .select("mc_attributes").eq("id", vehicleId).maybeSingle();
        const fresh = ((after?.mc_attributes ?? mc) || {}) as Record<string, unknown>;
        await admin.from("vehicle_listings").update({
          mc_attributes: {
            ...fresh,
            specs_attempts: (Number(fresh.specs_attempts) || 0) + 1,
            specs_attempted_at: new Date().toISOString(),
          },
        }).eq("id", vehicleId);
      } catch { /* the cap is the backstop */ }
      await audit(admin, tenantId, "factory_sticker.source_fetch_completed", record.id,
        { vin, ok: fetchDetail === null, detail: fetchDetail });
      // Re-read: marketcheck-specs writes the decode back onto the listing.
      const { data: refreshed } = await admin.from("vehicle_listings")
        .select("mc_attributes").eq("id", vehicleId).maybeSingle();
      mc = ((refreshed as { mc_attributes?: Record<string, unknown> } | null)?.mc_attributes || {}) as Record<string, unknown>;
      sheet = (mc.build_sheet || null) as Record<string, unknown> | null;
      if (!sheet) {
        const reason = fetchDetail
          ? `source_fetch_failed: ${fetchDetail}`
          : "source_fetch_returned_no_build_sheet: the provider had no equipment breakout for this VIN";
        // NOT review_required. Nothing was produced to review, and a human
        // cannot make the provider answer. Flagging it as a pending review
        // put the record in a state the operator could not clear and the
        // sweep would not retry, so the same stale reason ("source fetch
        // failed: provider quota exhausted") sat on the card indefinitely
        // while the actual condition was simply "no data yet".
        await setRecord(admin, record.id, {
          generation_status: "PENDING_DATA", last_error: reason,
          review_required: false, review_reason: null,
        });
        return {
          vehicle_id: vehicleId, record_id: record.id, status: "PENDING_DATA",
          skipped: "no_build_sheet", source_fetch: { ok: false, detail: fetchDetail },
        };
      }
      listing.mc_attributes = mc;
    }
    if (!sheet) {
      // Clear any stale review flag from an earlier failed run. This patch
      // used to touch only status and last_error, so a review_reason written
      // days ago survived every subsequent pass — which is why a card could
      // show "Review: source_fetch_failed: provider_quota_exhausted" long
      // after that had stopped being what was wrong.
      await setRecord(admin, record.id, {
        generation_status: "PENDING_DATA",
        last_error: "awaiting_build_sheet: no saved NeoVIN build sheet on this listing yet. Use Generate to retrieve it.",
        review_required: false, review_reason: null,
      });
      return { vehicle_id: vehicleId, record_id: record.id, status: "PENDING_DATA", skipped: "no_build_sheet" };
    }

    // ── Shared truth snapshot ────────────────────────────────────────
    // Resolved BEFORE the sticker is normalized, so the sticker, the
    // description and the Passport all describe the same vehicle rather
    // than each re-deriving it from the same blob. A vehicle that has not
    // materially changed reuses its current snapshot and costs nothing.
    let truth: Awaited<ReturnType<typeof refreshVehicleTruth>> | null = null;
    try {
      const sourceKind = String(mc.specs_source || "") === "neovin" ? "neovin" : "marketcheck";
      const sourceRecordId = await recordSourcePayload(admin, {
        tenantId, vehicleId, vin,
        sourceKind,
        sourceName: sourceKind === "neovin" ? "neovin_build_sheet" : "marketcheck_listing",
        payload: mc,
        billable: !!opts.allowSourceFetch,
        requestReason: opts.reason || "ingest",
      });
      truth = await refreshVehicleTruth(admin, tenantId, listing, {
        sourceRecordIds: sourceRecordId ? { [sourceKind]: sourceRecordId } : {},
      });
      if (truth.created) {
        await audit(admin, tenantId, "vehicle_truth.snapshot_recorded", record.id, {
          vin, version: truth.version, reason: truth.reason,
          affected_families: truth.affected_families,
        });
      }
    } catch (e) {
      // The truth layer informs generation; it does not gate it. A failure
      // here must not stop a dealer getting a sticker off data we already
      // hold, so it is recorded and the pipeline continues.
      await audit(admin, tenantId, "vehicle_truth.snapshot_failed", record.id,
        { vin, error: String((e as Error)?.message || e).slice(0, 300) });
    }

    const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
    const dealerSettings = (prof?.settings || {}) as Record<string, unknown>;

    // ── Normalize
    await setRecord(admin, record.id, { generation_status: "NORMALIZING" });
    const slug = String(listing.slug || "").trim();
    const appBase = resolveAppBase(req, opts.appBase);
    const canonicalPassportUrl = slug ? `${appBase}/v/${slug}` : null;

    const condRaw = String(listing.condition || "used").toLowerCase();
    const title = condRaw === "new"
      ? "Factory Window Sticker — Configuration & MSRP"
      : "Original Factory Build & MSRP Record";

    const normalized = normalizeForSticker(listing, dealerSettings, canonicalPassportUrl || "", title);
    await audit(admin, tenantId, "factory_sticker.normalized", record.id,
      { vin, confidence: normalized.confidence, missing: normalized.missing });

    // ── Eligibility: should a manufacturer-style document exist at all?
    // Used and CPO inventory stays in the Used Car Sticker workflow unless
    // the dealership explicitly enabled reproductions. An ineligible
    // vehicle is parked, never rendered — a document that should not exist
    // is not a failure to retry.
    const stickerSettings = (dealerSettings.factory_sticker || {}) as Record<string, unknown>;
    const eligibility = evaluateStickerEligibility({
      condition: condRaw,
      corroboratingConditions: [
        typeof (mc as Record<string, unknown>).condition === "string"
          ? String((mc as Record<string, unknown>).condition) : null,
      ],
      settings: {
        enabled: stickerSettings.enabled !== false,
        // `=== true` made this opt-IN, so every tenant that had never opened
        // the Factory Sticker panel had no `factory_sticker` key at all and
        // every used and CPO vehicle returned ineligible_used before anything
        // rendered. The documented default is on (DEFAULT_FACTORY_STICKER_
        // SETTINGS.used_reproduction === true) and the library already treats
        // a used reproduction as permitted unless explicitly disabled — this
        // line was the only thing overriding both.
        used_reproduction: stickerSettings.used_reproduction !== false,
      },
      hasVinSpecificBuildData: !normalized.data.generic,
      hasManufacturerPricing: !!normalized.baseMsrp && !!normalized.statedTotalMsrp,
    });
    if (!eligibility.eligible) {
      await setRecord(admin, record.id, {
        generation_status: "REVIEW_REQUIRED",
        review_required: true,
        review_reason: `${eligibility.status}: ${eligibility.reasons.join("; ") || "not eligible"}`,
        last_error: null,
        qa_metadata: {
          ...(record.qa_metadata || {}),
          eligibility: {
            status: eligibility.status,
            condition_class: eligibility.conditionClass,
            blocker_code: eligibility.blockerCode,
            reasons: eligibility.reasons,
          },
        },
      });
      await audit(admin, tenantId, "factory_sticker.ineligible", record.id,
        { vin, status: eligibility.status, blocker: eligibility.blockerCode, reasons: eligibility.reasons });
      return {
        vehicle_id: vehicleId, record_id: record.id, status: "REVIEW_REQUIRED",
        eligibility: eligibility.status, blocker: eligibility.blockerCode,
        reasons: eligibility.reasons,
      };
    }

    // ── OEM resolution: model-year-aware versioned theme profile. The
    // profile pins the visual identity for this brand + model year so
    // regenerating older documents never adopts a future brand identity.
    const make = normalized.data.identity.make;
    const modelYearNum = Number(normalized.data.identity.year);
    // The selection engine is the only thing allowed to name a template.
    // A corporate parent, a dealer name or a description never selects;
    // disagreement between trusted sources blocks outright.
    const selection = selectOemTemplate({
      vin,
      modelYear: Number.isFinite(modelYearNum) ? modelYearNum : null,
      canonicalMake: make,
      canonicalManufacturer: typeof sheet.manufacturer === "string" ? sheet.manufacturer : null,
      canonicalModel: normalized.data.identity.model,
      market: "US",
      condition: condRaw,
      corroboratingMakes: [
        typeof (mc as Record<string, unknown>).make === "string"
          ? String((mc as Record<string, unknown>).make) : null,
      ],
    });
    await audit(admin, tenantId, "factory_sticker.template_selected", record.id, {
      vin, template_key: selection.templateKey, status: selection.selectionStatus,
      confidence: selection.confidence, reasons: selection.reasons,
      conflicting_fields: selection.conflictingFields,
    });
    if (selection.selectionStatus === "unsupported" || selection.selectionStatus === "conflict") {
      const code = selection.selectionStatus === "conflict"
        ? "OEM_TEMPLATE_CONFLICT" : "OEM_TEMPLATE_UNSUPPORTED";
      const reason = `${code}: ${selection.reasons.join("; ") || "no registered template for this vehicle"}`;
      await setRecord(admin, record.id, {
        generation_status: "REVIEW_REQUIRED",
        review_required: true, review_reason: reason, last_error: null,
        detected_make_value: make || null,
        oem_resolution_confidence: selection.selectionStatus.toUpperCase(),
        qa_metadata: {
          ...(record.qa_metadata || {}),
          selection: {
            status: selection.selectionStatus, confidence: selection.confidence,
            reasons: selection.reasons, conflicting_fields: selection.conflictingFields,
          },
        },
      });
      await audit(admin, tenantId, "factory_sticker.review_required", record.id, { vin, reason });
      return {
        vehicle_id: vehicleId, record_id: record.id, status: "REVIEW_REQUIRED",
        selection: selection.selectionStatus, reasons: selection.reasons,
      };
    }
    // An authorized manual override replaces the automatic choice, but only
    // one the compatibility gate still accepts: a stale override naming a
    // template that is no longer valid for this make is discarded, never
    // applied.
    const storedOverride = (record.qa_metadata?.template_override || null) as
      { template_key?: string; layout_family?: string; theme_version?: string; reason?: string } | null;
    const overrideVerdict = storedOverride?.template_key
      ? validateTemplateOverride(
        selection.canonicalMake,
        storedOverride.template_key,
        Number.isFinite(modelYearNum) ? modelYearNum : null,
      )
      : null;
    const appliedOverride = overrideVerdict?.allowed ? overrideVerdict.option : null;
    if (storedOverride?.template_key && !overrideVerdict?.allowed) {
      await audit(admin, tenantId, "factory_sticker.template_override_discarded", record.id, {
        vin, requested: storedOverride.template_key, reason: overrideVerdict?.reason ?? null,
      });
    }

    const canonicalOemId = make ? make.toLowerCase().replace(/[^a-z0-9]+/g, "-") : null;
    const profile = resolveRenderProfile(normalized.data);
    const profileFamily = appliedOverride && !appliedOverride.isAutomatic
      ? appliedOverride.layoutFamily
      : profile.profile.layoutFamily;
    const theme: FactoryStickerTheme = {
      oemThemeId: canonicalOemId ? `oem-${canonicalOemId}` : "oem-neutral",
      oemThemeVersion: appliedOverride && !appliedOverride.isAutomatic
        ? appliedOverride.themeVersion : profile.profile.themeVersion,
      canonicalOemId,
      templateFamilyId: profileFamily,
      templateVersion: TEMPLATE_VERSION,
      logoAssetId: String(dealerSettings.dealer_logo_url ?? dealerSettings.logo_url ?? "").trim() || null,
      logoAssetVersion: null,
      templateOverrideKey: appliedOverride && !appliedOverride.isAutomatic
        ? appliedOverride.templateKey : null,
    };

    // ── Reconcile MSRP: computed (base + options + destination) vs the
    // stated total (NeoVIN combined_msrp, else the feed MSRP).
    await setRecord(admin, record.id, { generation_status: "VALIDATING" });
    let reconciliationStatus = "INSUFFICIENT_DATA";
    let reconciliationDifference: number | null = null;
    let reviewRequired = false;
    let reviewReason: string | null = null;
    if (normalized.baseMsrp && normalized.statedTotalMsrp) {
      const computed = normalized.baseMsrp + (normalized.optionsTotal || 0) + (normalized.destinationCharge || 0);
      reconciliationDifference = Math.round(Math.abs(computed - normalized.statedTotalMsrp) * 100) / 100;
      if (reconciliationDifference <= 5) reconciliationStatus = "MATCHED";
      else if (reconciliationDifference <= 100) reconciliationStatus = "MINOR_VARIANCE";
      else {
        reconciliationStatus = "REVIEW_REQUIRED";
        reviewRequired = true;
        reviewReason = `msrp_reconciliation: computed ${computed} differs from stated ${normalized.statedTotalMsrp} by ${reconciliationDifference}`;
      }
    }
    if (!canonicalPassportUrl) {
      reviewRequired = true;
      reviewReason = reviewReason || "missing_passport_slug: the QR payload cannot be resolved";
    }
    if (reviewRequired) {
      await audit(admin, tenantId, "factory_sticker.review_required", record.id,
        { vin, reason: reviewReason, reconciliation: reconciliationStatus });
    }

    // ── Existing OEM provider sticker: recorded as the original-document
    // reference, but per §25 the generated record is still produced — the
    // two artifacts serve different classifications.
    const oemOriginalUrl = String(listing.oem_sticker_url || "").trim() || null;

    // ── Fingerprint: stable inputs + every version knob + the passport URL.
    const fingerprint = await sha256Hex(JSON.stringify({
      data: normalized.data,
      template_family_id: profileFamily,
      template_version: TEMPLATE_VERSION,
      renderer_version: FACTORY_STICKER_RENDERER_VERSION,
      oem_theme_id: theme.oemThemeId,
      oem_theme_version: theme.oemThemeVersion,
      logo_asset_id: theme.logoAssetId,
      logo_asset_version: theme.logoAssetVersion,
      passport_url: canonicalPassportUrl,
      template_override: appliedOverride?.templateKey ?? null,
    }));

    const basePatch: Record<string, unknown> = {
      vin,
      source_provider: String(sheet.source || "neovin"),
      source_classification: "REGENERATED_RECORD",
      confidence_level: normalized.confidence,
      verification_status: normalized.data.generic ? "UNVERIFIED_GENERIC" : "PROVIDER_DECODED",
      reconciliation_status: reconciliationStatus,
      reconciliation_difference: reconciliationDifference,
      review_required: reviewRequired,
      review_reason: reviewReason,
      normalized_data_json: normalized.data,
      canonical_oem_id: canonicalOemId,
      detected_make_value: make || null,
      oem_resolution_confidence: selection.selectionStatus === "selected"
        ? (selection.confidence >= 1 ? "EXACT" : "ALIAS")
        : selection.selectionStatus.toUpperCase(),
      oem_theme_id: theme.oemThemeId,
      oem_theme_version: theme.oemThemeVersion,
      template_family_id: profileFamily,
      template_version: TEMPLATE_VERSION,
      renderer_version: FACTORY_STICKER_RENDERER_VERSION,
      logo_asset_id: theme.logoAssetId,
      logo_asset_version: theme.logoAssetVersion,
      passport_slug: slug || null,
      canonical_passport_url: canonicalPassportUrl,
      qr_payload: canonicalPassportUrl,
      barcode_payload: vin,
      generation_fingerprint: fingerprint,
      qa_metadata: {
        ...(record.qa_metadata || {}),
        ...(oemOriginalUrl ? { oem_original_url: oemOriginalUrl, oem_original_classification: "ORIGINAL_OEM_DOCUMENT" } : {}),
      },
    };

    // ── Idempotency: identical inputs with a live document → reuse.
    if (!opts.force && record.generation_fingerprint === fingerprint && record.current_document_id) {
      const { data: doc } = await admin.from("generated_documents")
        .select("id, document_status").eq("id", record.current_document_id).maybeSingle();
      if (doc && !["superseded", "archived", "rejected"].includes(String(doc.document_status))) {
        await audit(admin, tenantId, "factory_sticker.existing_document_reused", record.id,
          { vin, document_id: doc.id, fingerprint });
        return {
          vehicle_id: vehicleId, record_id: record.id, document_id: doc.id,
          status: record.generation_status, reused: true,
        };
      }
    }

    // ── Render through the one interface. "renderer_pending" is NOT a
    // failure: everything upstream is durable and the record waits
    // READY_TO_GENERATE for the renderer to land.
    await setRecord(admin, record.id, { ...basePatch, generation_status: "GENERATING" });
    let rendered: FactoryStickerRenderResult;
    try {
      rendered = await renderFactorySticker(normalized.data, theme);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (msg === "renderer_pending") {
        await setRecord(admin, record.id, { generation_status: "READY_TO_GENERATE", last_error: "renderer_pending" });
        return {
          vehicle_id: vehicleId, record_id: record.id, status: "READY_TO_GENERATE",
          renderer: "pending", reconciliation: reconciliationStatus, confidence: normalized.confidence,
        };
      }
      throw e;
    }

    // ── QA: identity invariants the sticker must never violate.
    await setRecord(admin, record.id, { generation_status: "RUNNING_QA" });
    const drawn = rendered.layout?.drawnStrings || [];
    // Page geometry is checked against the template's own declared format,
    // not a shared assumption: a portrait template must never pass because
    // the landscape one would have.
    const geometry = selection.definition
      ? validatePageGeometry(selection.definition.pageFormat, {
        widthPt: Number(rendered.layout?.widthPt ?? 0),
        heightPt: Number(rendered.layout?.heightPt ?? 0),
        pageCount: Number(rendered.layout?.pages ?? 0),
      })
      : { pass: true, code: "OK" as const, reasons: [] };
    // Fit is never trusted. The manifest states everything the document is
    // required to print — every option, every package member the buyer is
    // charged for, both MSRP anchors, the parts content and the
    // disclosure — and the render is checked against it.
    const completeness = checkRenderedCompleteness(normalized.data, {
      width: Number(rendered.layout?.widthPt ?? 0),
      height: Number(rendered.layout?.heightPt ?? 0),
      mode: "STANDARD",
      pages: [],
      drawnStrings: drawn,
      fontFamilies: { heading: "", body: "", numeric: "" },
    });
    const qaChecks = {
      vin_drawn: drawn.includes(vin),
      content_complete: completeness.pass,
      barcode_is_vin: normalized.data.barcodePayload === vin,
      qr_is_canonical_passport: !!canonicalPassportUrl && normalized.data.passportUrl === canonicalPassportUrl,
      page_count_ok: geometry.pass,
    };
    const qaPass = Object.values(qaChecks).every(Boolean);
    const qaPatch = {
      qr_identity_qa_status: qaChecks.qr_is_canonical_passport ? "PASS" : "FAIL",
      barcode_identity_qa_status: qaChecks.barcode_is_vin ? "PASS" : "FAIL",
      visual_qa_status: qaChecks.vin_drawn && qaChecks.page_count_ok ? "PASS" : "FAIL",
      qa_metadata: {
        ...(basePatch.qa_metadata as Record<string, unknown>),
        checks: qaChecks,
        pages: rendered.layout?.pages ?? null,
        completeness: {
          code: completeness.code,
          checked: completeness.checked,
          missing: completeness.missing.map((m) => ({ label: m.label, category: m.category })),
          miscounted: completeness.miscounted,
        },
        geometry: {
          code: geometry.code, reasons: geometry.reasons,
          width_pt: rendered.layout?.widthPt ?? null,
          height_pt: rendered.layout?.heightPt ?? null,
        },
        selection: {
          status: selection.selectionStatus, confidence: selection.confidence,
          template_key: selection.templateKey, reasons: selection.reasons,
        },
      },
    };
    await audit(admin, tenantId, qaPass ? "factory_sticker.qa_passed" : "factory_sticker.qa_failed",
      record.id, { vin, checks: qaChecks });

    // ── File + publish decision: auto-publish ONLY on a fully clean run.
    const autoPublish = qaPass && reconciliationStatus === "MATCHED"
      && normalized.confidence === "HIGH" && !reviewRequired
      && selection.selectionStatus === "selected";
    const filed = await fileStickerDocument(admin, tenantId, vehicleId, vin,
      rendered.pdfBytes, rendered.previewSvg, {
        title, condition: normalized.data.condition, vin,
        template_family_id: profileFamily, template_version: TEMPLATE_VERSION,
        renderer_version: FACTORY_STICKER_RENDERER_VERSION,
        oem_theme_id: theme.oemThemeId, generation_fingerprint: fingerprint,
        reconciliation_status: reconciliationStatus, confidence_level: normalized.confidence,
        template_key: selection.templateKey, selection_status: selection.selectionStatus,
        selection_confidence: selection.confidence,
        generated_by: opts.regeneration ? "user" : "system",
        generated_by_user_id: opts.regeneration?.userId ?? null,
        ...(opts.regeneration
          ? {
            regeneration_reason_code: opts.regeneration.reasonCode,
            regeneration_reason_notes: opts.regeneration.reasonNotes,
            regeneration_data_source: opts.regeneration.dataSource,
          }
          : {}),
        ...(oemOriginalUrl ? { oem_original_url: oemOriginalUrl } : {}),
      }, autoPublish, profileFamily);

    await audit(admin, tenantId, "factory_sticker.generated", record.id, {
      vin, document_id: filed.documentId, version: filed.version, auto_publish: autoPublish,
      generated_by: opts.regeneration ? "user" : "system",
      ...(opts.regeneration ? { reason_code: opts.regeneration.reasonCode } : {}),
    });

    const finalStatus = autoPublish ? "PUBLISHED" : "REVIEW_REQUIRED";
    await setRecord(admin, record.id, {
      ...qaPatch,
      generation_status: finalStatus,
      current_document_id: filed.documentId,
      review_required: !autoPublish,
      review_reason: autoPublish ? null : (reviewReason
        || (!completeness.pass
          ? `${completeness.code.toLowerCase()}: ${[
            ...completeness.missing.map((m) => `missing ${m.label}`),
            ...completeness.miscounted.map((m) => `${m.label} appeared ${m.actualCount}x`),
          ].slice(0, 6).join("; ")}`
          : !geometry.pass ? `${geometry.code.toLowerCase()}: ${geometry.reasons.join("; ")}`
          : !qaPass ? "qa_failed"
          : selection.selectionStatus !== "selected" ? `template_${selection.selectionStatus}: ${selection.reasons.join("; ")}`
          : reconciliationStatus !== "MATCHED" ? `reconciliation_${reconciliationStatus.toLowerCase()}`
          : `confidence_${normalized.confidence.toLowerCase()}`)),
      attempt_count: 0, last_error: null,
      ...(autoPublish ? { published_at: new Date().toISOString(), approved_at: new Date().toISOString() } : {}),
    });
    if (autoPublish) {
      await audit(admin, tenantId, "factory_sticker.published", record.id,
        { vin, document_id: filed.documentId, mode: "auto" });
    }

    return {
      vehicle_id: vehicleId, record_id: record.id, document_id: filed.documentId,
      status: finalStatus, version: filed.version, qa: qaChecks,
      reconciliation: reconciliationStatus, confidence: normalized.confidence, published: autoPublish,
      truth,
    };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500);
    const attempts = (record.attempt_count || 0) + 1;
    const permanent = attempts >= MAX_RETRYABLE_ATTEMPTS;
    await setRecord(admin, record.id, {
      generation_status: permanent ? "FAILED_PERMANENT" : "FAILED_RETRYABLE",
      attempt_count: attempts, last_error: msg,
      ...(permanent ? { review_required: true, review_reason: "retry_budget_exhausted" } : {}),
    });
    await audit(admin, tenantId, "factory_sticker.generation_failed", record.id,
      { vin, error: msg, attempts, permanent });
    return { vehicle_id: vehicleId, record_id: record.id, error: msg, retryable: !permanent };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const cronHeader = req.headers.get("x-cron-secret") || "";
    const isService = !!SERVICE_KEY && jwt === SERVICE_KEY;
    const isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "orchestrate");

    // Interactive callers must be an accepted member of the tenant; decisions
    // (regenerate / approve / unpublish) additionally need manager authority.
    let callerTenants: string[] | null = null;
    let callerIsPlatformAdmin = false;
    let callerUserId: string | null = null;
    const callerRoles = new Map<string, string>();
    if (!isService && !isCron) {
      if (!jwt) return json({ error: "missing bearer token" }, 401);
      const { data: userRes, error } = await admin.auth.getUser(jwt);
      if (error || !userRes?.user) return json({ error: "invalid token" }, 401);
      callerUserId = userRes.user.id;
      const { data: mems } = await admin.from("tenant_members")
        .select("tenant_id, role").eq("user_id", userRes.user.id).not("accepted_at", "is", null);
      callerTenants = (mems || []).map((m: { tenant_id: string }) => m.tenant_id);
      for (const m of mems || []) callerRoles.set(m.tenant_id, String(m.role || ""));
      const { data: pa } = await admin.from("user_roles")
        .select("role").eq("user_id", userRes.user.id).eq("role", "admin").maybeSingle();
      callerIsPlatformAdmin = !!pa;
      if (!callerTenants.length && !callerIsPlatformAdmin) {
        return json({ error: "no tenant membership" }, 403);
      }
    }
    const allowed = (t: string) => !callerTenants || callerIsPlatformAdmin || callerTenants.includes(t);
    const isManager = (t: string) =>
      !callerTenants || callerIsPlatformAdmin || MANAGER_ROLES.has((callerRoles.get(t) || "").trim().toLowerCase());
    const can = (t: string, permission: string): boolean => {
      // Service role and cron run the pipeline itself; a platform admin has
      // full authority. Everyone else is bound by the table above.
      if (!callerTenants || callerIsPlatformAdmin) return true;
      const role = (callerRoles.get(t) || "").trim().toLowerCase();
      const perms = STICKER_ROLE_PERMS[role] ?? VIEWER_PERMS;
      return perms.includes(permission);
    };

    const tenantId = String(body.tenant_id || "");
    // The nightly cron has no tenant to name — it sweeps every dealer. Only a
    // service-role or cron caller may omit the scope; an interactive caller
    // still has to say which tenant it is acting for.
    const allTenantSweep = action === "orchestrate_sweep" && !tenantId && (isService || isCron);
    if (!tenantId && !allTenantSweep) return json({ error: "tenant_id required" }, 400);
    if (tenantId && !allowed(tenantId)) return json({ error: "forbidden" }, 403);

    // vehicle_id or vin: the manual add paths only know the VIN.
    let vehicleId = String(body.vehicle_id || "");
    if (!vehicleId && body.vin) {
      const vin = String(body.vin).toUpperCase().trim();
      const { data: byVin } = await admin.from("vehicle_listings")
        .select("id").eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
      vehicleId = String(byVin?.id || "");
    }
    if (!vehicleId && action !== "refresh_truth_sweep" && action !== "orchestrate_sweep") {
      return json({ error: "vehicle_id or vin required" }, 400);
    }

    if (action === "orchestrate" || action === "regenerate") {
      const force = action === "regenerate" || !!body.force;
      // A forced run overrides review decisions and terminal states — that is
      // a manager decision, not a membership privilege.
      if (force && !can(tenantId, "regenerate")) return json({ error: "insufficient_permission" }, 403);

      let reasonCode: string | null = null;
      let reasonNotes: string | null = null;
      let dataSource: "reuse" | "refresh" = "reuse";
      let refresh: Record<string, unknown> | null = null;

      if (action === "regenerate") {
        // An operator-initiated regeneration is a recorded decision: the
        // reason travels with the version so the history explains itself.
        reasonCode = String(body.reason_code || "").trim();
        reasonNotes = String(body.reason_notes || "").trim() || null;
        if (!REGENERATION_REASONS.has(reasonCode)) {
          return json({ error: "reason_required", allowed: [...REGENERATION_REASONS] }, 400);
        }
        if (reasonCode === "other" && !reasonNotes) {
          return json({ error: "reason_notes_required" }, 400);
        }
        dataSource = body.data_source === "refresh" ? "refresh" : "reuse";

        const { data: priorRecord } = await admin.from("factory_sticker_records")
          .select("id, vin, current_document_id").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
        let priorVersion: number | null = null;
        if (priorRecord?.current_document_id) {
          const { data: pd } = await admin.from("generated_documents")
            .select("version").eq("id", priorRecord.current_document_id).maybeSingle();
          priorVersion = (pd as { version?: number } | null)?.version ?? null;
        }
        if (priorRecord?.id) {
          await audit(admin, tenantId, "factory_sticker.regeneration_requested", priorRecord.id, {
            vin: priorRecord.vin, reason_code: reasonCode, reason_notes: reasonNotes,
            data_source: dataSource, prior_version: priorVersion, user_id: callerUserId,
          });
        }

        // Refreshing provider data is a separate, explicitly authorized act:
        // it may incur a charge, so it never happens implicitly on a
        // presentation-only regeneration.
        if (dataSource === "refresh") {
          if (!can(tenantId, "refresh_neovin")) return json({ error: "insufficient_permission" }, 403);
          const { data: veh } = await admin.from("vehicle_listings")
            .select("vin").eq("id", vehicleId).eq("tenant_id", tenantId).maybeSingle();
          const refreshVin = String((veh as { vin?: string } | null)?.vin || "").toUpperCase().trim();
          if (!VIN_RE.test(refreshVin)) return json({ error: "invalid_vin_for_refresh" }, 400);
          if (priorRecord?.id) {
            await audit(admin, tenantId, "factory_sticker.neovin_refresh_authorized", priorRecord.id, {
              vin: refreshVin, user_id: callerUserId, reason_code: reasonCode,
            });
          }
          try {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/marketcheck-specs`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
              body: JSON.stringify({ vin: refreshVin, tenant_id: tenantId, vehicle_id: vehicleId }),
            });
            const payload = await res.json().catch(() => ({}));
            refresh = { ok: res.ok && payload?.ok !== false, detail: payload?.error ?? null };
          } catch (e) {
            refresh = { ok: false, detail: String((e as Error)?.message || e).slice(0, 200) };
          }
          if (priorRecord?.id) {
            await audit(admin, tenantId, "factory_sticker.neovin_refresh_completed", priorRecord.id,
              { vin: refreshVin, ...(refresh || {}) });
          }
        } else {
          const { data: pr } = await admin.from("factory_sticker_records")
            .select("id, vin").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
          if (pr?.id) {
            await audit(admin, tenantId, "factory_sticker.stored_source_reused", pr.id,
              { vin: pr.vin, user_id: callerUserId, reason_code: reasonCode });
          }
        }
      }

      // Fetching provider data is opt-in per request and needs the same
      // permission a refresh does. The nightly sweep never sets it.
      const allowSourceFetch = body.allow_source_fetch === true
        || (action === "regenerate" && dataSource === "refresh");
      if (allowSourceFetch && !can(tenantId, "refresh_neovin")) {
        return json({ error: "insufficient_permission", detail: "retrieving provider data needs manager authority" }, 403);
      }
      const result = await orchestrateVehicle(admin, req, tenantId, vehicleId, {
        force,
        allowSourceFetch,
        reason: action === "regenerate" ? `manual_regenerate:${reasonCode}` : String(body.reason || "ingest"),
        appBase: body.app_base ? String(body.app_base) : undefined,
        regeneration: action === "regenerate"
          ? { reasonCode: reasonCode as string, reasonNotes, dataSource, userId: callerUserId }
          : undefined,
      });
      return json({
        success: !result.error,
        generated: !result.error && !result.skipped && !result.reused,
        ...(refresh ? { source_refresh: refresh } : {}),
        ...result,
      });
    }

    if (action === "approve_publish") {
      if (!can(tenantId, "approve") || !can(tenantId, "publish")) {
        return json({ error: "insufficient_permission" }, 403);
      }
      const { data: record } = await admin.from("factory_sticker_records")
        .select("id, generation_status, current_document_id, vin")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      if (!record) return json({ error: "record_not_found" }, 404);
      if (!record.current_document_id) return json({ error: "nothing_to_publish" }, 409);
      const now = new Date().toISOString();
      // The approved draft supersedes whichever version was public — the
      // prior version is retired, never deleted, and stays readable to
      // authorized users through the version history.
      const { data: priorPublished } = await admin.from("generated_documents")
        .select("id, version")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .eq("document_type", "factory_sticker").eq("document_status", "published")
        .neq("id", record.current_document_id);
      const priorIds = ((priorPublished || []) as { id: string }[]).map((r) => r.id);
      if (priorIds.length) {
        await admin.from("generated_documents").update({
          document_status: "superseded", superseded_by: record.current_document_id, updated_at: now,
        }).in("id", priorIds);
        await audit(admin, tenantId, "factory_sticker.version_superseded", record.id, {
          vin: record.vin, superseded_ids: priorIds,
          superseded_by: record.current_document_id, user_id: callerUserId,
        });
      }
      await admin.from("generated_documents").update({
        document_status: "published", published_at: now, updated_at: now,
      }).eq("id", record.current_document_id);
      await setRecord(admin, record.id, {
        generation_status: "PUBLISHED", review_required: false,
        reviewed_by: callerUserId, reviewed_at: now,
        approved_by: callerUserId, approved_at: now, published_at: now,
      });
      await audit(admin, tenantId, "factory_sticker.published", record.id,
        { vin: record.vin, document_id: record.current_document_id, mode: "manual", user_id: callerUserId });
      return json({ success: true, record_id: record.id, document_id: record.current_document_id, status: "PUBLISHED" });
    }

    if (action === "version_history") {
      if (!can(tenantId, "view_history")) return json({ error: "insufficient_permission" }, 403);
      const { data: record } = await admin.from("factory_sticker_records")
        .select("id, vin, current_document_id").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      const { data: versions } = await admin.from("generated_documents")
        .select("id, version, document_status, pdf_url, online_url, published_at, created_at, updated_at, superseded_by, data_snapshot")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("document_type", "factory_sticker")
        .order("version", { ascending: false });
      const rows = ((versions || []) as Array<Record<string, unknown>>).map((r) => {
        const snap = (r.data_snapshot || {}) as Record<string, unknown>;
        return {
          id: r.id, version: r.version, status: r.document_status,
          pdf_url: r.pdf_url ?? r.online_url ?? null,
          published_at: r.published_at, created_at: r.created_at, updated_at: r.updated_at,
          superseded_by: r.superseded_by,
          generated_by: snap.generated_by ?? "system",
          generated_by_user_id: snap.generated_by_user_id ?? null,
          reason_code: snap.regeneration_reason_code ?? null,
          reason_notes: snap.regeneration_reason_notes ?? null,
          data_source: snap.regeneration_data_source ?? null,
          template_key: snap.template_key ?? null,
          template_family_id: snap.template_family_id ?? null,
          template_version: snap.template_version ?? null,
          renderer_version: snap.renderer_version ?? null,
          content_hash: snap.content_hash ?? null,
          reconciliation_status: snap.reconciliation_status ?? null,
        };
      });
      return json({
        success: true, record_id: record?.id ?? null,
        current_document_id: record?.current_document_id ?? null, versions: rows,
      });
    }

    if (action === "restore_version") {
      if (!can(tenantId, "restore_version")) return json({ error: "insufficient_permission" }, 403);
      const documentId = String(body.document_id || "");
      if (!documentId) return json({ error: "document_id required" }, 400);
      const { data: record } = await admin.from("factory_sticker_records")
        .select("id, vin, current_document_id").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      if (!record) return json({ error: "record_not_found" }, 404);
      const { data: target } = await admin.from("generated_documents")
        .select("id, version, document_status")
        .eq("id", documentId).eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .eq("document_type", "factory_sticker").maybeSingle();
      if (!target) return json({ error: "version_not_found" }, 404);
      const now = new Date().toISOString();
      // Restoring reactivates a preserved version as the draft awaiting
      // approval. It does not republish on its own — the publish decision
      // stays a separate, audited act.
      await admin.from("generated_documents").update({
        document_status: "pending_approval", superseded_by: null, updated_at: now,
      }).eq("id", documentId);
      await setRecord(admin, record.id, {
        current_document_id: documentId,
        generation_status: "REVIEW_REQUIRED",
        review_required: true,
        review_reason: `restored_version_${(target as { version?: number }).version ?? "?"}`,
      });
      await audit(admin, tenantId, "factory_sticker.version_restored", record.id, {
        vin: record.vin, document_id: documentId,
        version: (target as { version?: number }).version ?? null,
        previous_current: record.current_document_id, user_id: callerUserId,
      });
      return json({ success: true, record_id: record.id, document_id: documentId, status: "REVIEW_REQUIRED" });
    }

    if (action === "document_assets") {
      // Fresh signed URLs for a filed version. The thumbnail is the vector
      // first page of the SAME immutable snapshot the PDF was realized
      // from — never a stock graphic and never another vehicle's document.
      const documentId = String(body.document_id || "");
      if (!documentId) return json({ error: "document_id required" }, 400);
      const { data: doc } = await admin.from("generated_documents")
        .select("id, version, document_status, data_snapshot")
        .eq("id", documentId).eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .eq("document_type", "factory_sticker").maybeSingle();
      if (!doc) return json({ error: "document_not_found" }, 404);
      const snap = ((doc as { data_snapshot?: Record<string, unknown> }).data_snapshot || {}) as Record<string, unknown>;
      // Prefer the durable asset rows; fall back to the snapshot for
      // documents filed before document_assets existed.
      const { data: assetRows } = await admin.from("document_assets")
        .select("asset_type, storage_bucket, storage_path")
        .eq("tenant_id", tenantId).eq("document_id", documentId);
      const byType = new Map(((assetRows || []) as Array<{ asset_type: string; storage_bucket: string; storage_path: string }>)
        .map((r) => [r.asset_type, r]));
      const bucket = String(byType.get("pdf")?.storage_bucket || snap.storage_bucket || BUCKET);
      const sign = async (path: unknown): Promise<string | null> => {
        if (typeof path !== "string" || !path) return null;
        const { data } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60);
        return (data as { signedUrl?: string } | null)?.signedUrl ?? null;
      };
      const pdfUrl = await sign(byType.get("pdf")?.storage_path ?? snap.storage_path);
      const previewUrl = await sign(byType.get("thumbnail")?.storage_path ?? snap.preview_path);
      return json({
        success: true, document_id: documentId,
        version: (doc as { version?: number }).version ?? null,
        status: (doc as { document_status?: string }).document_status ?? null,
        pdf_url: pdfUrl, preview_url: previewUrl,
        content_hash: snap.content_hash ?? null,
      });
    }

    // The shared read contract, surfaced to the client. Every generator and
    // every panel reads the vehicle from here rather than assembling its own
    // view of mc_attributes, which is what keeps one VIN from printing
    // different truth on different documents.
    if (action === "vehicle_truth") {
      const { data: snap } = await admin.from("vehicle_snapshots")
        .select("id, snapshot_version, snapshot_json, content_checksum, material_changes, affected_families, source_kinds, has_unresolved_conflicts, created_at")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .order("snapshot_version", { ascending: false }).limit(1).maybeSingle();
      const { data: facts } = await admin.from("vehicle_facts")
        .select("fact_key, fact_value, source_kind, confidence, authority, usable_in_copy, evidence, observed_at, overridden_by")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId);
      const { data: conflicts } = await admin.from("vehicle_fact_conflicts")
        .select("id, fact_key, authority, candidates, status, blocks_generation, created_at")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("status", "open");
      const { data: sources } = await admin.from("vehicle_source_records")
        .select("id, source_kind, source_name, retrieved_at, billable")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
        .order("retrieved_at", { ascending: false }).limit(20);
      return json({
        success: true,
        snapshot: snap ?? null,
        facts: facts ?? [],
        conflicts: conflicts ?? [],
        sources: sources ?? [],
      });
    }

    // Re-resolve every published vehicle for the tenant. Reads only saved
    // data — no provider call, so it cannot spend money however often it is
    // run. Bounded by a wall-clock budget rather than a row count so it
    // cannot exceed the function timeout on a large inventory; re-invoke
    // until `remaining` is 0.
    if (action === "refresh_truth_sweep") {
      if (!can(tenantId, "regenerate")) return json({ error: "insufficient_permission" }, 403);
      // `only_missing` (the default) skips vehicles already resolved, so a
      // run that hits the budget resumes where the last one stopped instead
      // of spending it re-resolving settled work. Pass only_missing: false to
      // re-check the whole inventory.
      const onlyMissing = body.only_missing !== false;
      const { data: listings } = await admin.from("vehicle_listings")
        .select("*").eq("tenant_id", tenantId).eq("status", "published")
        .order("updated_at", { ascending: false }).limit(500);
      let rows = (listings || []) as Array<Record<string, unknown>>;

      if (onlyMissing && rows.length) {
        const { data: existing } = await admin.from("vehicle_snapshots")
          .select("vehicle_id").eq("tenant_id", tenantId);
        const resolved = new Set(
          ((existing || []) as Array<{ vehicle_id: string }>).map((r) => r.vehicle_id),
        );
        rows = rows.filter((r) => !resolved.has(String(r.id)));
      }

      // Callers (the admin curl tool, the app button) have short client-side
      // deadlines that a 90s inline sweep blows past. Ack immediately and let
      // EdgeRuntime.waitUntil finish the work; re-invoke to see remaining.
      const sync = !!body.sync;
      const worker = async () => {
        const deadline = Date.now() + 90_000;
        let created = 0, reused = 0, failed = 0, processed = 0;
        const conflicts: string[] = [];
        for (const listing of rows) {
          if (Date.now() >= deadline) break;
          processed++;
          try {
            const res = await refreshVehicleTruth(admin, tenantId, listing);
            if (res.created) created++; else reused++;
            if (res.blocking_conflicts > 0) conflicts.push(String(listing.vin || ""));
          } catch { failed++; }
        }
        return { created, reused, failed, processed, conflicts };
      };
      if (sync) {
        const r = await worker();
        return json({ success: true, total: rows.length, ...r, remaining: Math.max(0, rows.length - r.processed) });
      }
      // deno-lint-ignore no-explicit-any
      const er = (globalThis as any).EdgeRuntime;
      if (er && typeof er.waitUntil === "function") er.waitUntil(worker());
      else worker();
      return json({ success: true, started: true, total: rows.length, note: "Sweep running in background; re-invoke to see remaining." });
    }

    // Nightly self-heal for the sticker itself. A factory_sticker_record is
    // otherwise only ever created by a live orchestrate call, so a vehicle that
    // arrived from autocurb-sync, the DMS webhook, a CSV import or a manual add
    // got exactly one attempt at ingest and was never retried — and a vehicle
    // that was parked PENDING_DATA before its build sheet landed stayed parked
    // forever. Bounded by a wall-clock budget rather than a row count so it
    // cannot exceed the function timeout; re-invoke until `remaining` is 0.
    if (action === "orchestrate_sweep") {
      if (tenantId && !can(tenantId, "regenerate")) return json({ error: "insufficient_permission" }, 403);
      // `only_missing` (the default) is the worklist: vehicles with no record
      // at all plus records the pipeline left unfinished. Pass false to also
      // re-run records wedged mid-pipeline by a crashed run and drafts sitting
      // in review; the never-re-run terminal states are excluded either way.
      const onlyMissing = body.only_missing !== false;
      // Opt-in: re-run REVIEW_REQUIRED records that already have a filed
      // document waiting on a human. See the default rule below.
      const includeReview = body.include_review === true;
      const limit = Math.min(Math.max(Number(body.limit) || 500, 1), SWEEP_MAX_ROWS);

      let listingQuery = admin.from("vehicle_listings")
        .select("id, tenant_id, vin")
        .eq("status", "published")
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (tenantId) listingQuery = listingQuery.eq("tenant_id", tenantId);
      const { data: listings } = await listingQuery;
      let rows = ((listings || []) as Array<{ id: string; tenant_id: string | null; vin: string | null }>)
        .filter((r) => !!r.tenant_id);

      if (rows.length) {
        // Chunked: a single `in` over a whole inventory builds a URL long
        // enough to be rejected, and PostgREST caps an unfiltered select.
        const existing = new Map<string, { status: string; documentId: string | null; updatedAt: string | null }>();
        for (let i = 0; i < rows.length; i += 200) {
          const ids = rows.slice(i, i + 200).map((r) => r.id);
          let recordQuery = admin.from("factory_sticker_records")
            .select("vehicle_id, generation_status, current_document_id, updated_at").in("vehicle_id", ids);
          if (tenantId) recordQuery = recordQuery.eq("tenant_id", tenantId);
          const { data: recs } = await recordQuery;
          for (const r of (recs || []) as Array<{ vehicle_id: string; generation_status: string; current_document_id: string | null; updated_at: string | null }>) {
            existing.set(r.vehicle_id, {
              status: String(r.generation_status || ""),
              documentId: r.current_document_id ?? null,
              updatedAt: r.updated_at ?? null,
            });
          }
        }
        rows = rows.filter((r) => {
          const rec = existing.get(r.id);
          if (!rec) return true;
          if (SWEEP_NEVER_RERUN_STATUSES.has(rec.status)) return false;
          if (rec.status === "REVIEW_REQUIRED") {
            // A REVIEW_REQUIRED record with no filed document is not a pending
            // human decision — nothing was ever produced to decide on. It is a
            // pipeline blocked upstream (ineligible, template unresolved, no
            // passport slug), which is precisely the population that can never
            // self-heal once the underlying data is fixed. Those are swept. One
            // that DOES hold a document is a manager's draft, and re-rendering
            // it under them is a decision the sweep does not get to make.
            return includeReview || !onlyMissing || !rec.documentId;
          }
          if (SWEEP_INFLIGHT_STATUSES.has(rec.status)) {
            const age = Date.now() - Date.parse(rec.updatedAt || "");
            return !Number.isFinite(age) ? false : age > SWEEP_INFLIGHT_STALE_MS;
          }
          return onlyMissing ? SWEEP_RETRYABLE_STATUSES.has(rec.status) : true;
        });
      }

      if (!rows.length) {
        return json({ success: true, total: 0, processed: 0, remaining: 0, note: "Nothing to sweep." });
      }

      // Single-runner. The pipeline this drives files documents, writes
      // storage objects and can reach a paid provider, so two overlapping
      // sweeps would do — and be billed for — the same work twice. Taken only
      // once the worklist is known, so a failed query can never leak the lock.
      const { data: acquired } = await admin.rpc("try_acquire_service_lock", {
        _key: SWEEP_LOCK_KEY,
        _ttl_seconds: SWEEP_LOCK_TTL_SECONDS,
        _holder: tenantId || "all_tenants",
      });
      if (acquired === false) {
        return json({ success: true, skipped: "already_running", total: rows.length });
      }
      const releaseSweepLock = async () => {
        try { await admin.rpc("release_service_lock", { _key: SWEEP_LOCK_KEY }); }
        catch { /* the TTL expiry is the backstop */ }
      };

      const sync = !!body.sync;
      const worker = async () => {
        const deadline = Date.now() + SWEEP_BUDGET_MS;
        let processed = 0, generated = 0, published = 0, skipped = 0, failed = 0;
        // Bounded provider spend per sweep run. Explicitly overridable so an
        // admin can drain a backlog deliberately.
        let fetchBudget = Math.max(0, Number(body.fetch_limit ?? 25));
        const statuses: Record<string, number> = {};
        try {
          for (const row of rows) {
            if (Date.now() >= deadline) break;
            processed++;
            try {
              // A sweep that may never fetch could not make a PENDING_DATA
              // record progress: it re-entered the same "awaiting_build_sheet"
              // branch four times a night, forever, for every undecoded car.
              // The decode is now durable (the feed sync no longer wipes it),
              // so acquiring a missing sheet is a one-time cost per VIN rather
              // than a nightly one — but it is still money, so it is bounded
              // per run and never forces, so no review decision is overridden.
              const mayFetch = fetchBudget > 0;
              const res = await orchestrateVehicle(admin, req, String(row.tenant_id), row.id, {
                reason: "nightly_sweep",
                allowSourceFetch: mayFetch,
                appBase: body.app_base ? String(body.app_base) : undefined,
              });
              // Decrement on EVERY fetch-enabled pass. Charging the budget only
              // when a sheet came back exempted precisely the fruitless calls
              // the budget exists to bound, so fetch_limit bounded nothing.
              if (mayFetch) fetchBudget--;
              const outcome = String(res.status || res.skipped || (res.error ? "error" : "unknown"));
              statuses[outcome] = (statuses[outcome] || 0) + 1;
              if (res.error) failed++;
              else if (res.skipped) skipped++;
              else {
                generated++;
                if (res.published === true) published++;
              }
            } catch { failed++; }
          }
        } finally {
          await releaseSweepLock();
        }
        return { processed, generated, published, skipped, failed, statuses };
      };

      if (sync) {
        const r = await worker();
        return json({ success: true, total: rows.length, ...r, remaining: Math.max(0, rows.length - r.processed) });
      }
      // Callers (cron's http_post, the admin button) have short deadlines a 90s
      // inline sweep blows past. Ack immediately and finish in the background.
      // deno-lint-ignore no-explicit-any
      const er = (globalThis as any).EdgeRuntime;
      if (er && typeof er.waitUntil === "function") er.waitUntil(worker());
      else worker();
      return json({
        success: true, started: true, total: rows.length,
        scope: tenantId || "all_tenants",
        note: "Sweep running in background; re-invoke to see remaining.",
      });
    }

    if (action === "refresh_truth") {
      const { data: listing } = await admin.from("vehicle_listings")
        .select("*").eq("tenant_id", tenantId).eq("id", vehicleId).maybeSingle();
      if (!listing) return json({ error: "listing_not_found" }, 404);
      // Reads what is already saved; it never calls a provider, so it can
      // never spend money.
      const result = await refreshVehicleTruth(admin, tenantId, listing);
      return json({ success: true, ...result });
    }

    if (action === "template_options") {
      const { data: record } = await admin.from("factory_sticker_records")
        .select("id, canonical_oem_id, normalized_data_json, qa_metadata")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      const normalized = (record?.normalized_data_json || {}) as { identity?: { make?: string; year?: string } };
      // Fall back to the vehicle record when the pipeline has not normalized
      // yet, so a vehicle awaiting its build sheet still shows its real brand.
      const fallback = await identityFromListing(admin, tenantId, vehicleId);
      const normalizedYear = Number(normalized.identity?.year);
      const year = Number.isFinite(normalizedYear) ? normalizedYear : fallback.year;
      const sel = selectOemTemplate({
        canonicalMake: normalized.identity?.make ?? fallback.make,
        modelYear: year ?? null,
      });
      const meta = (record?.qa_metadata || {}) as Record<string, unknown>;
      return json({
        success: true,
        canonical_make: sel.canonicalMake,
        automatic_template_key: sel.templateKey,
        current_override: (meta.template_override as Record<string, unknown> | undefined) ?? null,
        options: listCompatibleTemplates(sel.canonicalMake, year ?? null),
        resolved_from: normalized.identity?.make ? "normalized_data" : "vehicle_record",
      });
    }

    if (action === "set_template") {
      if (!can(tenantId, "edit_permitted_fields")) return json({ error: "insufficient_permission" }, 403);
      const requested = String(body.template_key || "").trim();
      const overrideReason = String(body.reason_notes || "").trim();
      if (!overrideReason) return json({ error: "reason_notes_required" }, 400);
      const { data: record } = await admin.from("factory_sticker_records")
        .select("id, vin, canonical_oem_id, normalized_data_json, qa_metadata")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      if (!record) return json({ error: "record_not_found" }, 404);
      const normalized = (record.normalized_data_json || {}) as { identity?: { make?: string; year?: string } };
      const fallbackIdentity = await identityFromListing(admin, tenantId, vehicleId);
      const normalizedYear = Number(normalized.identity?.year);
      const modelYear = Number.isFinite(normalizedYear) ? normalizedYear : fallbackIdentity.year;
      const sel = selectOemTemplate({
        canonicalMake: normalized.identity?.make ?? fallbackIdentity.make,
        modelYear,
      });
      // The canonical make governs, never the operator's pick: a request
      // for another manufacturer's template is refused here, server-side,
      // regardless of what the UI offered.
      const verdict = validateTemplateOverride(sel.canonicalMake, requested, modelYear);
      if (!verdict.allowed) {
        await audit(admin, tenantId, "factory_sticker.template_override_refused", record.id, {
          vin: record.vin, requested, reason: verdict.reason, user_id: callerUserId,
        });
        return json({ error: "incompatible_template", detail: verdict.reason }, 400);
      }
      const isAutomatic = verdict.option?.isAutomatic === true;
      await setRecord(admin, record.id, {
        qa_metadata: {
          ...(record.qa_metadata || {}),
          // Clearing the override restores automatic selection rather than
          // pinning the same value forever.
          template_override: isAutomatic ? null : {
            template_key: requested,
            layout_family: verdict.option?.layoutFamily ?? null,
            theme_version: verdict.option?.themeVersion ?? null,
            reason: overrideReason,
            set_by: callerUserId,
            set_at: new Date().toISOString(),
          },
        },
      });
      await audit(admin, tenantId, "factory_sticker.template_manually_changed", record.id, {
        vin: record.vin, requested, automatic_template_key: sel.templateKey,
        cleared: isAutomatic, reason: overrideReason, user_id: callerUserId,
      });
      return json({
        success: true, record_id: record.id, template_key: requested,
        cleared: isAutomatic,
        note: "Regenerate the sticker to apply the template change as a new version.",
      });
    }

    if (action === "unpublish") {
      if (!can(tenantId, "unpublish")) return json({ error: "insufficient_permission" }, 403);
      const { data: record } = await admin.from("factory_sticker_records")
        .select("id, generation_status, current_document_id, vin")
        .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      if (!record) return json({ error: "record_not_found" }, 404);
      const now = new Date().toISOString();
      if (record.current_document_id) {
        await admin.from("generated_documents").update({
          document_status: "pending_approval", updated_at: now,
        }).eq("id", record.current_document_id);
      }
      await setRecord(admin, record.id, {
        generation_status: "REVIEW_REQUIRED", review_required: true,
        review_reason: "manual_unpublish", published_at: null,
        reviewed_by: callerUserId, reviewed_at: now,
      });
      await audit(admin, tenantId, "factory_sticker.unpublished", record.id,
        { vin: record.vin, document_id: record.current_document_id, user_id: callerUserId });
      return json({ success: true, record_id: record.id, status: "REVIEW_REQUIRED" });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "unknown error" }, 500);
  }
});
