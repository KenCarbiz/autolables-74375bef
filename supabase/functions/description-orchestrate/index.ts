// ─────────────────────────────────────────────────────────────────────
// description-orchestrate — the description lifecycle engine.
//
// Composable server-side operations behind one entry point:
//   orchestrate  — init → facts → master → channels → validate → publish
//   regenerate   — new version for a case (optionally scoped to channels)
//   reconcile    — self-healing sweep for every ingest source
//
// Isolation guarantee: this is invoked fire-and-forget from ingest. Any
// failure here records a retryable job + exception and NEVER propagates
// back into the inventory pipeline.
// ─────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CHANNELS, channelByKey, buildFactSnapshot, buildMasterPrompt, buildChannelPrompt,
  computeSourceDataVersion, computeConfigVersion, validateContent, qualityScore,
  decideEligibility, type FactSnapshot, type Finding, type FactOverride,
} from "../_shared/description-core.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
const RECONCILE_BUDGET_MS = 100_000;
const RECONCILE_MAX_DEPTH = 80; // backstop against runaway chaining

const DEFAULT_SETTINGS = {
  review_mode: "EXCEPTION_REVIEW", review_mode_by_class: {},
  enabled_channels: ["vehicle_passport", "dealer_website", "autotrader", "cars_com", "cargurus", "facebook", "google_seo"],
  internal_publication_enabled: true, default_tone: "professional",
  min_length: 400, max_length: 2400, prohibited_phrases: [], class_rules: {},
  warranty_language_allowed: false, cpo_language_allowed: false,
  accessory_language_allowed: false, market_context_allowed: false,
  price_in_description: false, quality_threshold: 70,
  generation_model: "claude-haiku-4-5", prompt_version: "v1",
};

async function callGenerator(prompt: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-description`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ vehicle: { prompt_override: prompt } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    // 429 and 5xx are transient; any other 4xx is a deterministic input
    // problem that would fail identically on every retry.
    const code = res.status === 429 ? "RATE_LIMIT"
      : res.status >= 500 ? "PROVIDER_ERROR"
      : "INVALID_INPUT";
    throw Object.assign(new Error(`generator_failed:${res.status}`), { code, detail: t.slice(0, 400) });
  }
  const body = await res.json();
  const text = String(body?.description || "").trim();
  if (!text) throw Object.assign(new Error("generator_empty"), { code: "PROVIDER_ERROR" });
  return text;
}

async function loadSettings(admin: any, tenantId: string) {
  const { data } = await admin.from("description_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  const merged = { ...DEFAULT_SETTINGS, ...(data || {}) };
  const configVersion = await computeConfigVersion(merged);
  if (!data) {
    // materialize defaults so the dealer has something to edit
    await admin.from("description_settings")
      .upsert({ tenant_id: tenantId, ...DEFAULT_SETTINGS, configuration_version: configVersion },
              { onConflict: "tenant_id" });
  } else if (data.configuration_version !== configVersion) {
    await admin.from("description_settings")
      .update({ configuration_version: configVersion }).eq("tenant_id", tenantId);
  }
  return { settings: merged, configVersion };
}

async function raiseException(
  admin: any, c: { tenant_id: string; vehicle_id: string; case_id: string; raised?: Set<string> },
  type: string, severity: string, blocking: boolean, title: string, summary: string,
  details: Record<string, unknown> = {}, channel: string | null = null,
  fieldKey: string | null = null,
) {
  // Dedupe happens inside the RPC. A PostgREST upsert cannot target the
  // partial expression index, and a swallowed failure here would leave the
  // whole exception queue silently empty.
  const { error } = await admin.rpc("raise_description_exception", {
    p_tenant_id: c.tenant_id, p_vehicle_id: c.vehicle_id, p_case_id: c.case_id,
    p_type: type, p_severity: severity, p_blocking: blocking,
    p_title: title, p_summary: summary, p_details: details, p_channel: channel,
    p_field_key: fieldKey ?? (typeof details.field === "string" ? details.field : null),
  });
  c.raised?.add(type);
  if (error) console.error("raise_description_exception failed", type, error.message);
}

async function audit(admin: any, tenantId: string, action: string, caseId: string, details: Record<string, unknown>) {
  try {
    await admin.from("audit_log").insert({
      action, entity_type: "description_case", entity_id: caseId,
      store_id: tenantId, details,
    });
  } catch { /* audit must never break the pipeline */ }
}

async function setCase(admin: any, caseId: string, patch: Record<string, unknown>, bump = false) {
  // bump=true advances the optimistic-concurrency counter, so an approval
  // issued against copy that has since been regenerated is rejected. Writing
  // read+1 unconditionally would move the counter BACKWARDS whenever a
  // concurrent RPC bumped it in between, silently validating a stale actor —
  // so the write is a compare-and-set on the value we read.
  for (let attempt = 0; attempt < 3; attempt++) {
    let body = { ...patch, updated_at: new Date().toISOString() };
    let guard: number | null = null;
    if (bump) {
      const { data: cur } = await admin.from("description_cases")
        .select("lock_version").eq("id", caseId).maybeSingle();
      guard = cur?.lock_version ?? 0;
      body = { ...body, lock_version: guard + 1 };
    }
    let q = admin.from("description_cases").update(body).eq("id", caseId);
    if (guard !== null) q = q.eq("lock_version", guard);
    const { data, error } = await q.select("id");

    if (!error && (data?.length || !bump)) return;
    if (error) {
      console.error("setCase rejected", caseId, Object.keys(patch).join(","), error.message);
      // Retry without the status so the rest of the patch (version pointer,
      // processed fingerprint, scores) is never lost to a transition guard.
      if ("status" in patch) {
        const { status: _drop, ...rest } = patch as Record<string, unknown>;
        if (Object.keys(rest).length) {
          await admin.from("description_cases")
            .update({ ...rest, updated_at: new Date().toISOString() }).eq("id", caseId);
        }
      }
      return;
    }
    // compare-and-set lost the race — re-read and try again
  }
  console.error("setCase gave up after lock contention", caseId);
}

// ── The pipeline for a single vehicle ────────────────────────────────
async function orchestrateVehicle(
  admin: any, tenantId: string, vehicleId: string, opts: { force?: boolean; reason?: string; channels?: string[] } = {},
): Promise<Record<string, unknown>> {
  const { data: listing } = await admin.from("vehicle_listings").select("*").eq("id", vehicleId).maybeSingle();
  if (!listing) return { vehicle_id: vehicleId, skipped: "listing_not_found" };
  // A NULL-tenant listing must never be adopted by whoever asks first.
  if (listing.tenant_id !== tenantId) return { vehicle_id: vehicleId, skipped: "tenant_mismatch" };
  if (listing.status === "archived") return { vehicle_id: vehicleId, skipped: "archived" };

  const { data: caseId } = await admin.rpc("init_description_case", {
    p_tenant_id: tenantId, p_vehicle_id: vehicleId,
  });
  if (!caseId) return { vehicle_id: vehicleId, skipped: "case_not_initialized" };

  const { settings, configVersion } = await loadSettings(admin, tenantId);
  const sdv = await computeSourceDataVersion(listing, configVersion, !!settings.price_in_description);

  const { data: existing } = await admin.from("description_cases").select("*").eq("id", caseId).maybeSingle();
  await setCase(admin, caseId, { current_source_data_version: sdv, configuration_version: configVersion });

  // Idempotency: identical inputs + identical config → nothing to do.
  // Inputs changed under a locked or published case: flag it rather than
  // silently overwriting a human's copy.
  if (existing && existing.processed_source_data_version &&
      existing.processed_source_data_version !== sdv &&
      (existing.master_locked || existing.status === "PUBLISHED")) {
    await admin.rpc("mark_description_stale", { p_case_id: caseId, p_reason: "source data changed" });
  }

  if (!opts.force && existing?.processed_source_data_version === sdv &&
      ["READY", "PUBLISHED", "PARTIALLY_PUBLISHED", "REVIEW_REQUIRED"].includes(existing?.status)) {
    return { vehicle_id: vehicleId, case_id: caseId, skipped: "unchanged", source_data_version: sdv };
  }

  const scopedRun = Array.isArray(opts.channels) && opts.channels.length > 0;
  const jobKey = `${tenantId}:${vehicleId}:${sdv}:${configVersion}:${scopedRun ? "channels:" + [...opts.channels!].sort().join("+") : "full_generation"}`;
  const { data: jobId } = await admin.rpc("claim_description_job", {
    p_tenant_id: tenantId, p_vehicle_id: vehicleId, p_case_id: caseId,
    p_job_type: "full_generation", p_idempotency_key: jobKey,
    p_payload: { reason: opts.reason || "ingest" },
    p_allow_completed: !!opts.force,
  });
  if (!jobId) return { vehicle_id: vehicleId, case_id: caseId, skipped: "already_claimed" };

  const raisedTypes = new Set<string>();
  const ctx = { tenant_id: tenantId, vehicle_id: vehicleId, case_id: caseId, raised: raisedTypes };
  const failJob = async (code: string, msg: string, retryable: boolean) => {
    await admin.from("description_jobs").update({
      status: retryable ? "failed_retryable" : "failed_blocked",
      last_error_code: code, last_error_message: msg.slice(0, 500),
      failed_at: new Date().toISOString(),
    }).eq("id", jobId);
    await setCase(admin, caseId, {
      status: retryable ? "FAILED_RETRYABLE" : "FAILED_BLOCKED",
      last_failure_at: new Date().toISOString(), last_error_message: msg.slice(0, 500),
      publication_eligibility: "blocked",
    });
    await raiseException(admin, ctx, retryable ? "GENERATION_FAILED" : "GENERATION_BLOCKED",
      retryable ? "high" : "critical", true, "Description generation failed", msg.slice(0, 300), { code });
    await audit(admin, tenantId, "description_generation_failed", caseId, { code, vin: listing.vin });
  };

  try {
    // 1 ── facts
    await setCase(admin, caseId, { status: "BUILDING_FACTS" });
    const { data: dealer } = await admin.from("dealer_profiles").select("*").eq("tenant_id", tenantId).maybeSingle();
    // Resolved conflicts are durable decisions — honor them so a vehicle a
    // manager already ruled on never blocks on the same conflict again.
    const { data: ovRows } = await admin.from("description_fact_overrides")
      .select("field_key, decision, value").eq("description_case_id", caseId);
    const overrides = (ovRows || []) as FactOverride[];
    const snap: FactSnapshot = buildFactSnapshot(listing, settings, dealer, overrides);

    const { data: snapRow } = await admin.from("description_fact_snapshots").insert({
      tenant_id: tenantId, vehicle_id: vehicleId, description_case_id: caseId,
      source_data_version: sdv, facts_json: snap.facts, source_lineage_json: snap.lineage,
      conflicts_json: snap.conflicts, excluded_claims_json: snap.excluded_claims,
      market_context_json: snap.market_context, fact_confidence: snap.fact_confidence,
    }).select("id").single();

    await audit(admin, tenantId, "description_fact_snapshot_created", caseId,
      { vin: listing.vin, source_data_version: sdv, fact_confidence: snap.fact_confidence });

    const materialConflicts = snap.conflicts.filter((x) => x.material);
    for (const c of materialConflicts.filter((x) => x.field !== "cpo_status")) {
      await raiseException(admin, ctx, "EQUIPMENT_CONFLICT", "high", true,
        `Source conflict: ${c.field.replace("equipment:", "")}`,
        "Trusted sources disagree. The claim is excluded from customer-facing copy until resolved.",
        { field: c.field, values: c.values });
      await audit(admin, tenantId, "description_source_conflict_detected", caseId, { vin: listing.vin, field: c.field });
    }
    const cpoConflict = materialConflicts.find((x) => x.field === "cpo_status");
    if (cpoConflict) {
      // field + values must be present: the resolution UI writes the manager's
      // decision back keyed on `field`, so an exception without it is unresolvable.
      await raiseException(admin, ctx, "CPO_STATUS_CONFLICT", "high", true,
        "CPO status is not confirmed by an approved source",
        "The feed reports CPO but no approved CPO program source confirms it. CPO language is blocked.",
        { field: "cpo_status", values: cpoConflict.values });
      await audit(admin, tenantId, "description_source_conflict_detected", caseId,
        { vin: listing.vin, field: "cpo_status" });
    }

    // 2 ── master
    await setCase(admin, caseId, { status: "GENERATING" });
    await audit(admin, tenantId, "description_generation_started", caseId, { vin: listing.vin });
    const masterText = await callGenerator(buildMasterPrompt(snap, settings));

    const { data: lastVer } = await admin.from("description_versions")
      .select("id, version_number").eq("description_case_id", caseId)
      .order("version_number", { ascending: false }).limit(1).maybeSingle();
    const nextNumber = (lastVer?.version_number || 0) + 1;

    const { data: version } = await admin.from("description_versions").insert({
      tenant_id: tenantId, vehicle_id: vehicleId, description_case_id: caseId,
      parent_version_id: lastVer?.id || null, fact_snapshot_id: snapRow?.id || null,
      version_number: nextNumber, version_type: opts.reason === "manual_regenerate" ? "regenerated" : "generated",
      content: masterText, word_count: masterText.split(/\s+/).filter(Boolean).length,
      character_count: masterText.length, generation_model: settings.generation_model,
      prompt_version: settings.prompt_version, configuration_version: configVersion,
      source_data_version: sdv, created_by_type: "automation",
    }).select("*").single();
    if (!version?.id) {
      throw Object.assign(new Error("version_insert_failed"), { code: "DB_CONFLICT" });
    }

    // 3 ── validate master
    await setCase(admin, caseId, { status: "VALIDATING" });
    const findings: Finding[] = validateContent(masterText, snap, settings);
    const quality = qualityScore(masterText, snap, settings);

    if (findings.length) {
      await admin.from("description_validation_results").insert(findings.map((f) => ({
        tenant_id: tenantId, description_case_id: caseId, version_id: version.id,
        validator_code: f.validator_code, severity: f.severity, message: f.message,
        fact_path: f.fact_path ?? null, claim_text: f.claim_text ?? null,
        source_reference: f.source_reference ?? null, blocking: f.blocking,
      })));
    }
    const masterStatus = findings.some((f) => f.blocking) ? "blocked"
      : findings.some((f) => f.severity === "warning") ? "warning" : "passed";
    await admin.from("description_versions")
      .update({ validation_status: masterStatus, quality_score: quality }).eq("id", version.id);

    // 4 ── channel variants
    const allEnabled: string[] = Array.isArray(settings.enabled_channels) ? settings.enabled_channels : [];
    // Selective regeneration: when the caller names channels, only those are
    // rebuilt; everything else keeps its existing variant.
    const scoped = Array.isArray(opts.channels) && opts.channels.length
      ? allEnabled.filter((k) => opts.channels!.includes(k)) : allEnabled;
    const enabled = scoped;
    const channelRows: Array<Record<string, unknown>> = [];
    const channelBlocking: Finding[] = [];
    for (const key of enabled) {
      const ch = channelByKey(key);
      if (!ch) continue;
      // a locked channel is never overwritten by automation
      const { data: locked } = await admin.from("description_channel_versions")
        .select("id, locked").eq("description_case_id", caseId).eq("channel", key)
        .eq("locked", true).limit(1).maybeSingle();
      if (locked?.locked) {
        await admin.from("description_channel_versions")
          .update({ potentially_stale: true }).eq("id", locked.id);
        await raiseException(admin, ctx, "MANUAL_CONTENT_STALE", "medium", false,
          `${ch.label} copy may be out of date`,
          "This channel is locked to a manual edit while the underlying vehicle data changed.",
          { source_data_version: sdv }, key);
        continue;
      }
      try {
        const raw = await callGenerator(buildChannelPrompt(masterText, ch, snap, settings));
        let content = raw, seoTitle: string | null = null, metaDesc: string | null = null;
        if (ch.seoFields) {
          try {
            const parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
            content = String(parsed.content || raw);
            seoTitle = parsed.seo_title ? String(parsed.seo_title) : null;
            metaDesc = parsed.meta_description ? String(parsed.meta_description) : null;
          } catch { /* fall back to raw text */ }
        }
        const cFindings = validateContent(content, snap, settings, ch);
        const cStatus = cFindings.some((f) => f.blocking) ? "blocked"
          : cFindings.some((f) => f.severity === "warning") ? "warning" : "passed";

        const { data: cv } = await admin.from("description_channel_versions").upsert({
          tenant_id: tenantId, vehicle_id: vehicleId, description_case_id: caseId,
          master_version_id: version.id, channel: key, content,
          seo_title: seoTitle, meta_description: metaDesc,
          character_count: content.length, character_limit: ch.characterLimit,
          validation_status: cStatus, potentially_stale: false,
        }, { onConflict: "master_version_id,channel" }).select("id").single();

        if (cFindings.length && cv?.id) {
          await admin.from("description_validation_results").insert(cFindings.map((f) => ({
            tenant_id: tenantId, description_case_id: caseId, version_id: version.id,
            channel_version_id: cv.id, validator_code: f.validator_code, severity: f.severity,
            message: f.message, fact_path: f.fact_path ?? null, claim_text: f.claim_text ?? null,
            source_reference: f.source_reference ?? null, blocking: f.blocking,
          })));
        }
        if (cFindings.some((f) => f.validator_code === "CHANNEL_LENGTH_EXCEEDED")) {
          await raiseException(admin, ctx, "CHANNEL_LENGTH_EXCEEDED", "medium", false,
            `${ch.label} exceeds the destination limit`,
            cFindings.find((f) => f.validator_code === "CHANNEL_LENGTH_EXCEEDED")!.message, {}, key);
        }
        channelRows.push({ channel: key, status: cStatus });
        // A channel variant that introduces an unsupported claim must not be
        // exportable while the case reports "eligible".
        if (cStatus === "blocked") channelBlocking.push(...cFindings.filter((f) => f.blocking));
      } catch (e) {
        await raiseException(admin, ctx, "CHANNEL_GENERATION_FAILED", "medium", false,
          `${ch.label} variant could not be generated`, String((e as Error).message).slice(0, 200), {}, key);
      }
    }

    // 5 ── eligibility + honest publication
    const { eligibility, reason } = decideEligibility([...findings, ...channelBlocking], settings, listing.condition || "used");
    await audit(admin, tenantId, "description_validation_completed", caseId,
      { vin: listing.vin, version_id: version.id, findings: findings.length,
        blocking: findings.filter((f) => f.blocking).length, eligibility, quality });

    let finalStatus = "READY";
    if (eligibility === "blocked") {
      finalStatus = "FAILED_BLOCKED";
      await raiseException(admin, ctx, "VALIDATION_FAILED", "high", true,
        "Description blocked by validation",
        findings.filter((f) => f.blocking).map((f) => f.message).join(" · ").slice(0, 400),
        { findings: findings.filter((f) => f.blocking) });
    } else if (eligibility === "review_required") {
      finalStatus = "REVIEW_REQUIRED";
      await raiseException(admin, ctx, "REVIEW_REQUIRED", "medium", false,
        "Manager review required before publication", reason, { findings });
    }

    await setCase(admin, caseId, {
      status: finalStatus,
      // a manually locked master stays the current version; automation may
      // produce a newer one but must not silently take its place
      ...(existing?.master_locked ? {} : { current_master_version_id: version.id }),
      processed_source_data_version: sdv, publication_eligibility: eligibility,
      fact_confidence: snap.fact_confidence, quality_score: quality,
      potentially_stale: false, last_orchestrated_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(), last_error_message: null,
    }, true);

    // Auto-publish only when eligible, permitted, and not manually locked.
    let published = false;
    const { data: caseNow } = await admin.from("description_cases").select("lock_version, master_locked").eq("id", caseId).maybeSingle();
    const { data: gate } = await admin.rpc("description_publish_allowed", {
      p_case_id: caseId, p_version_id: version.id,
    });
    const gateOk = (gate as any)?.ok !== false;
    if (eligibility === "eligible" && settings.internal_publication_enabled && !caseNow?.master_locked && gateOk) {
      const { data: pub } = await admin.rpc("publish_description_internal", {
        p_case_id: caseId, p_version_id: version.id, p_expected_lock_version: caseNow?.lock_version ?? null,
      });
      published = !!(pub as any)?.ok;
      if (!published) {
        await raiseException(admin, ctx, "INTERNAL_PUBLICATION_FAILED", "high", false,
          "Internal publication did not complete", String((pub as any)?.error || "unknown"), { result: pub });
      }
    }

    // Live copy that stays live must not be reported as unpublished. When a new
    // version is held back (publication disabled, locked, gate refused) the
    // previously published copy is still what the customer sees.
    if (!published && finalStatus === "READY" && existing?.published_master_version_id) {
      await setCase(admin, caseId, { status: "PUBLISHED", potentially_stale: true });
      finalStatus = "PUBLISHED";
    }

    // Record honest state for every external destination: modeled, never delivered.
    for (const key of allEnabled) {
      const ch = channelByKey(key);
      if (!ch || ch.deliveryMode === "internal_projection") continue;
      await admin.from("description_deliveries").upsert({
        tenant_id: tenantId, vehicle_id: vehicleId, description_case_id: caseId,
        version_id: version.id, destination: key, delivery_mode: ch.deliveryMode,
        connector_status: ch.connectorStatus,
        status: ch.connectorStatus === "not_configured" ? "unavailable" : "skipped",
        idempotency_key: `${caseId}:${version.id}:${key}`,
        response_metadata: { note: ch.connectorStatus === "not_configured"
          ? "No connector configured for this destination."
          : "Export only — content is generated and downloadable; no automated delivery exists." },
      }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    }

    // A condition that no longer reproduces is resolved. Without this a vehicle
    // that was repaired and cleanly regenerated reads as "Blocked" forever.
    // Scoped runs only touch the channels they rebuilt, so they never sweep.
    if (!scopedRun) {
      await admin.rpc("close_resolved_description_exceptions", {
        p_case_id: caseId, p_keep_types: [...raisedTypes],
      });
    }

    const { count: openExc } = await admin.from("description_exceptions")
      .select("id", { count: "exact", head: true })
      .eq("description_case_id", caseId).in("status", ["open", "in_progress"]);
    await setCase(admin, caseId, { open_exception_count: openExc || 0 });

    await admin.from("description_jobs").update({
      status: "succeeded", completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    await audit(admin, tenantId, "description_generation_succeeded", caseId,
      { vin: listing.vin, version_id: version.id, version_number: nextNumber,
        channels: channelRows.length, published, eligibility });

    return {
      vehicle_id: vehicleId, case_id: caseId, version_id: version.id, version_number: nextNumber,
      status: published ? "PUBLISHED" : finalStatus, eligibility, quality,
      fact_confidence: snap.fact_confidence, channels: channelRows.length,
      conflicts: snap.conflicts.length, published,
    };
  } catch (e) {
    const err = e as Error & { code?: string };
    const retryable = err.code === "RATE_LIMIT" || err.code === "PROVIDER_ERROR" || err.code === "DB_CONFLICT" || !err.code;
    // INVALID_INPUT is deterministic — retrying only wastes the attempt budget.
    await failJob(err.code || "UNKNOWN", err.message || "unknown error", retryable);
    return { vehicle_id: vehicleId, case_id: caseId, error: err.code || "UNKNOWN", retryable };
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

    // Interactive callers must be an accepted member of the tenant.
    let callerTenants: string[] | null = null;
    let callerIsPlatformAdmin = false;
    const callerRoles = new Map<string, string>();
    if (!isService && !isCron) {
      if (!jwt) return json({ error: "missing bearer token" }, 401);
      const { data: userRes, error } = await admin.auth.getUser(jwt);
      if (error || !userRes?.user) return json({ error: "invalid token" }, 401);
      const { data: mems } = await admin.from("tenant_members")
        .select("tenant_id, role").eq("user_id", userRes.user.id).not("accepted_at", "is", null);
      callerTenants = (mems || []).map((m: any) => m.tenant_id);
      for (const m of mems || []) callerRoles.set(m.tenant_id, String(m.role || ""));
      const { data: pa } = await admin.from("user_roles")
        .select("role").eq("user_id", userRes.user.id).eq("role", "admin").maybeSingle();
      callerIsPlatformAdmin = !!pa;
      if (!callerTenants.length && !callerIsPlatformAdmin) {
        return json({ error: "no tenant membership" }, 403);
      }
    }
    const allowed = (t: string) => !callerTenants || callerIsPlatformAdmin || callerTenants.includes(t);
    // Generation spends provider credits, so an interactive caller needs the
    // same authority the UI claims to require — membership alone is not enough.
    // This set mirrors `can_create_documents` in dealerRoleCapabilities.ts
    // exactly; any divergence 403s a button the UI has already enabled.
    // The role is read from the membership row we already loaded: calling the
    // SQL helper over the service-role client would evaluate auth.uid() as
    // NULL and deny everyone.
    const GENERATE_ROLES = new Set([
      "owner", "general_manager", "gsm", "admin", "manager",
      "sales_manager", "salesperson", "sales", "staff",
      "used_car_manager", "inventory_manager",
      "office", "finance", "compliance",
    ]);
    const authorized = (t: string) =>
      !callerTenants || callerIsPlatformAdmin || GENERATE_ROLES.has((callerRoles.get(t) || "").trim().toLowerCase());

    if (action === "orchestrate" || action === "regenerate") {
      const tenantId = String(body.tenant_id || "");
      const vehicleId = String(body.vehicle_id || "");
      if (!tenantId || !vehicleId) return json({ error: "tenant_id and vehicle_id required" }, 400);
      if (!allowed(tenantId)) return json({ error: "forbidden" }, 403);
      if (action === "regenerate" && !authorized(tenantId)) {
        return json({ error: "insufficient_permission" }, 403);
      }
      const result: Record<string, unknown> = await orchestrateVehicle(admin, tenantId, vehicleId, {
        force: action === "regenerate" || !!body.force,
        reason: action === "regenerate" ? "manual_regenerate" : String(body.reason || "ingest"),
        channels: Array.isArray(body.channels) ? body.channels.map(String) : undefined,
      });
      // "skipped" is not success-with-a-new-version; say so plainly so the
      // UI cannot claim work that did not happen.
      return json({ success: !result.error, generated: !result.error && !result.skipped, ...result });
    }

    if (action === "validate") {
      // A human edit must clear the same validators as generated copy before
      // it can ever reach a shopper.
      const tenantId = String(body.tenant_id || "");
      const versionId = String(body.version_id || "");
      if (!tenantId || !versionId) return json({ error: "tenant_id and version_id required" }, 400);
      if (!allowed(tenantId)) return json({ error: "forbidden" }, 403);

      const { data: ver } = await admin.from("description_versions").select("*").eq("id", versionId).maybeSingle();
      if (!ver || ver.tenant_id !== tenantId) return json({ error: "version_not_found" }, 404);
      const { data: listing } = await admin.from("vehicle_listings").select("*").eq("id", ver.vehicle_id).maybeSingle();
      const { settings } = await loadSettings(admin, tenantId);
      const { data: dealer } = await admin.from("dealer_profiles").select("*").eq("tenant_id", tenantId).maybeSingle();
      const { data: ovRows } = await admin.from("description_fact_overrides")
        .select("field_key, decision, value").eq("description_case_id", ver.description_case_id);
      const snap = buildFactSnapshot(listing || {}, settings, dealer, (ovRows || []) as FactOverride[]);

      const f = validateContent(ver.content, snap, settings);
      const q = qualityScore(ver.content, snap, settings);
      // master-scoped only; channel findings belong to their channel rows
      await admin.from("description_validation_results")
        .delete().eq("version_id", versionId).is("channel_version_id", null);
      if (f.length) {
        await admin.from("description_validation_results").insert(f.map((x) => ({
          tenant_id: tenantId, description_case_id: ver.description_case_id, version_id: versionId,
          validator_code: x.validator_code, severity: x.severity, message: x.message,
          fact_path: x.fact_path ?? null, claim_text: x.claim_text ?? null,
          source_reference: x.source_reference ?? null, blocking: x.blocking,
        })));
      }
      const st = f.some((x) => x.blocking) ? "blocked" : f.some((x) => x.severity === "warning") ? "warning" : "passed";
      await admin.from("description_versions")
        .update({ validation_status: st, quality_score: q }).eq("id", versionId);

      const { eligibility } = decideEligibility(f, settings, listing?.condition || "used");
      await setCase(admin, ver.description_case_id, { publication_eligibility: eligibility, quality_score: q }, true);
      await audit(admin, tenantId, "description_validation_completed", ver.description_case_id,
        { version_id: versionId, findings: f.length, validation_status: st, manual: true });
      return json({ success: true, validation_status: st, eligibility, findings: f.length });
    }

    if (action === "reconcile") {
      // Self-healing sweep: covers AutoCurb / DMS / CSV / manual VINs that
      // never pass through the MarketCheck post-ingest hook.
      // Interactive callers may reconcile their own tenant; cross-tenant
      // sweeps stay service-role only.
      const reqTenant = body.tenant_id ? String(body.tenant_id) : null;
      if (!isService && !isCron) {
        if (!reqTenant || !allowed(reqTenant)) return json({ error: "forbidden" }, 403);
        if (!authorized(reqTenant)) return json({ error: "insufficient_permission" }, 403);
      }
      const tenantId = reqTenant;
      // One hop works a wall-clock budget, then re-invokes itself with the same
      // sweep cursor. A single 12-vehicle batch could never drain a real
      // inventory; without chaining the backlog simply never reconciled.
      const sweepStart = typeof body.sweep_start === "string" ? body.sweep_start : new Date().toISOString();
      const depth = Number(body.depth) || 0;
      const deadline = Date.now() + RECONCILE_BUDGET_MS;
      const results: unknown[] = [];
      const seenThisHop = new Set<string>();
      let examined = 0;
      while (Date.now() < deadline) {
        const { data: batch } = await admin.rpc("next_description_reconcile_batch", {
          p_tenant_id: tenantId, p_limit: 5, p_sweep_start: sweepStart,
        });
        const rows = ((batch || []) as Array<{ tenant_id: string; vehicle_id: string; reason: string }>)
          // A vehicle the pipeline declined may have no case row to stamp
          // (missing_case + init refused), so the cursor cannot drop it. Without
          // this guard the hop re-selects the same vehicle until the budget dies.
          .filter((r) => !seenThisHop.has(r.vehicle_id));
        if (!rows.length) break;
        for (const r of rows) {
          if (Date.now() >= deadline) break;
          seenThisHop.add(r.vehicle_id);
          examined++;
          const out = await orchestrateVehicle(admin, r.tenant_id, r.vehicle_id, {
            force: r.reason === "stalled" || r.reason === "retryable", reason: `reconcile:${r.reason}`,
          });
          if (results.length < 50) results.push(out);
          // Liveness: a vehicle that produced no new version must still leave
          // this sweep's cursor so the NEXT hop does not re-select it either.
          if ((out as { skipped?: string }).skipped) {
            await admin.from("description_cases")
              .update({ last_orchestrated_at: new Date().toISOString() })
              .eq("tenant_id", r.tenant_id).eq("vehicle_id", r.vehicle_id);
          }
        }
      }

      let chained = false;
      if (depth < RECONCILE_MAX_DEPTH) {
        const { data: more } = await admin.rpc("next_description_reconcile_batch", {
          p_tenant_id: tenantId, p_limit: 20, p_sweep_start: sweepStart,
        });
        // Chain only for work this hop did not already attempt — a vehicle that
        // cannot leave the cursor would otherwise chain 80 hops deep.
        const pending = ((more || []) as Array<{ vehicle_id: string }>)
          .filter((r) => !seenThisHop.has(r.vehicle_id));
        if (pending.length > 0) {
          chained = true;
          await fetch(`${SUPABASE_URL}/functions/v1/description-orchestrate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`,
                       "x-cron-secret": CRON_SECRET },
            body: JSON.stringify({ action: "reconcile", tenant_id: tenantId,
                                   sweep_start: sweepStart, depth: depth + 1 }),
            signal: AbortSignal.timeout(15000),
          }).catch(() => { /* best-effort; the next nightly sweep retries */ });
        }
      }
      return json({ success: true, examined, depth, chained, sweep_start: sweepStart, results });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "unknown error" }, 500);
  }
});
