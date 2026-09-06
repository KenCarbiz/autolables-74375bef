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
  // ── V3 ──
  buildDescriptionPacket, buildMasterPromptV3, buildChannelPromptV3, validateContentV3,
  scoreVersion, computeInputChecksum, resolveChannelPolicy, computeChannelPolicyVersion,
  resolveVoiceProfile, computeVoiceProfileVersion, featureChecksum, isToneKey,
  type DescriptionPacket, type ChannelPolicy, type ComparisonDoc, type SeoTargeting,
  type ToneKey, type VoiceProfile,
  preferredLengthBand,
} from "../_shared/description-core.ts";
import { repairContent, hasRepairableFindings } from "../_shared/description-repair.ts";
import { preflight, preflightSummary } from "../_shared/description-preflight.ts";
import { evaluateBudget, DEFAULT_BUDGET } from "../_shared/description-budget.ts";
import { can } from "../_shared/description-permissions.ts";
import { buyersGuideDisposition } from "../_shared/description-warranty-policy.ts";
import { createProvider, outputTokenBudget, type GenerationResult } from "../_shared/description-provider.ts";
import { DRIVESIGNAL_V3_SYSTEM } from "../_shared/prompts/drivesignal-v3-system.ts";
import { assembleKnowledge, vehicleSignals, KNOWLEDGE_REVISION } from "../_shared/description-knowledge.ts";
import { DESCRIPTION_OUTPUT_SCHEMA, auditEvidence, factRoles } from "../_shared/description-evidence.ts";
import { runGates, vehicleClassOf } from "../_shared/description-gates.ts";
import { refreshDecision } from "../_shared/description-refresh.ts";

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

// A dropped/renamed RPC signature returns { data: null, error } — destructuring
// only `data` turns that into an indistinguishable "nothing to do" and the
// pipeline stalls silently. Every RPC goes through one of these two.
async function rpc<T = unknown>(admin: any, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    console.error(`rpc ${fn} failed`, error.code, error.message, error.details ?? "");
    throw new Error(`rpc_failed:${fn}:${error.code || ""}:${error.message}`);
  }
  return data as T;
}

// Advisory RPCs: a failure must be visible in logs but must not abort the run.
async function rpcSoft(admin: any, fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { error } = await admin.rpc(fn, args);
  if (error) {
    console.error(`rpc ${fn} failed (non-fatal)`, error.code, error.message, error.details ?? "");
    return false;
  }
  return true;
}



const DEFAULT_SETTINGS = {
  review_mode: "EXCEPTION_REVIEW", review_mode_by_class: {},
  enabled_channels: ["vehicle_passport", "dealer_website", "autotrader", "cars_com", "cargurus", "facebook", "google_seo"],
  internal_publication_enabled: true, default_tone: "professional",
  min_length: 400, max_length: 2400, prohibited_phrases: [], class_rules: {},
  generation_provider: "anthropic", prompt_profile: "platform_v3", knowledge_revision: null,
  reasoning_effort: "low", verbosity: "medium",
  warranty_language_allowed: false, cpo_language_allowed: false,
  accessory_language_allowed: false, market_context_allowed: false,
  price_in_description: false, quality_threshold: 70,
  generation_model: "claude-haiku-4-5", prompt_version: "v1",
};

async function callGenerator(prompt: string, modelKey?: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-description`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ vehicle: { prompt_override: prompt, model_key: modelKey } }),
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

export interface MasterGeneration {
  text: string;
  headline: string | null;
  claimedFactIds: string[];
  factRoles: Record<string, string[]>;
  /** Which knowledge modules were loaded. "Why did it say that?" is not fully
   *  answerable six months later without knowing what the writer was given. */
  moduleKeys: string[];
  result: GenerationResult | null;
}

/**
 * The DriveSignal path. The approved V3 instructions and the selected
 * knowledge modules go in the provider's system slot, byte-identical on every
 * vehicle so the prefix can be served from cache; only the fact packet varies.
 *
 * A tenant not configured for it keeps the platform prompt builder untouched.
 */
async function generateMaster(
  packet: any, snap: any, settings: Record<string, any>, listing: Record<string, any>,
): Promise<MasterGeneration> {
  if (settings.prompt_profile !== "drivesignal-v3-system") {
    const text = await callGenerator(buildMasterPromptV3(packet, settings), settings.generation_model);
    return { text, headline: null, claimedFactIds: [], factRoles: {}, moduleKeys: [], result: null };
  }

  const mc = (listing.mc_attributes || {}) as Record<string, any>;
  const knowledge = assembleKnowledge(vehicleSignals({
    condition: listing.condition,
    bodyStyle: mc.body_type ?? mc.body_style,
    fuelType: mc.fuel_type,
    make: mc.make,
    trim: listing.trim,
    equipment: String(snap?.facts?.equipment?.value ?? ""),
    hasBuildSheet: !!mc.build_sheet,
    cpoVerified: !!snap?.facts?.cpo_status,
    warrantyDisposition: snap?.facts?.warranty_eligible ? "FACTORY_PERMITTED" : null,
    needsChannelDerivatives: false,
  }));

  const provider = createProvider(
    settings.generation_provider === "openai" ? "openai" : "anthropic", Deno.env);
  const result = await provider.generate({
    systemPrompt: `${DRIVESIGNAL_V3_SYSTEM}\n\n${knowledge.text}`,
    userContent: buildMasterPromptV3(packet, settings),
    model: settings.generation_model,
    schema: DESCRIPTION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "drivesignal_vehicle_description",
    maxOutputTokens: outputTokenBudget(
      preferredLengthBand(settings).max, settings.reasoning_effort),
    reasoningEffort: settings.reasoning_effort || null,
    verbosity: settings.verbosity || null,
  });

  // A structured call that came back as prose is a failed structured call, not
  // copy to publish: the evidence ledger would have nothing to audit.
  if (!result.parsed) {
    throw Object.assign(new Error("structured_output_missing"), { code: "PROVIDER_ERROR" });
  }
  return {
    text: result.parsed.master_description,
    headline: result.parsed.headline,
    claimedFactIds: [...new Set([
      ...result.parsed.used_fact_ids, ...result.parsed.hero_fact_ids,
      ...result.parsed.warranty_fact_ids, ...result.parsed.history_fact_ids,
    ])],
    factRoles: factRoles(result.parsed),
    moduleKeys: knowledge.moduleKeys,
    result,
  };
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

// ── V3 configuration loaders ─────────────────────────────────────────

/**
 * The dealership voice. Version is recomputed from the resolved content on
 * every run: an approved description keeps the version it was written under,
 * so editing the profile marks descendants stale rather than rewriting history.
 *
 * When no approved profile exists, one is DERIVED from description_settings and
 * approved automatically. resolveVoiceProfile already reads every field it
 * needs out of settings — dealer name, city, state, brand_voice, tone, CTA,
 * prohibited phrases, disclosures — and then labelled the result "draft" purely
 * because no row was stored. Preflight blocks on that label, so a dealership
 * that had configured its voice in settings still generated nothing and was
 * told its profile was a draft it had never created. Harte sat at zero
 * descriptions across 130 vehicles for that reason alone.
 *
 * Auto-approval is safe here and nowhere else: approvedClaims has NO settings
 * fallback, so a derived profile carries an empty claim list and cannot state a
 * single dealership benefit. It can describe the vehicle; it cannot promise
 * anything about the store. A human editing the profile later supersedes this
 * row through save_description_voice_profile, which archives the prior approval.
 */
async function loadVoiceProfile(
  admin: any, tenantId: string, settings: Record<string, any>, dealer: Record<string, any> | null,
): Promise<VoiceProfile> {
  const read = async () =>
    (await admin.from("description_voice_profiles")
      .select("*").eq("tenant_id", tenantId).eq("status", "approved")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()).data;

  let data = await read();
  const voice = resolveVoiceProfile(tenantId, data, settings, dealer);
  voice.version = await computeVoiceProfileVersion(voice);

  if (!data) {
    voice.status = "approved";
    const { error } = await admin.from("description_voice_profiles").insert({
      tenant_id: tenantId,
      version: voice.version,
      status: "approved",
      profile_json: voiceProfileJson(voice),
      dealer_name: voice.dealerName || null,
      city: voice.city || null,
      state: voice.state || null,
      // Empty on purpose — see above. Never seeded from settings.
      approved_claims: [],
      change_reason: "Derived automatically from the dealership's description settings.",
    });
    if (error) {
      // A concurrent run won the partial unique index (one approved profile per
      // tenant). Its row is as good as ours; adopt it rather than failing a
      // generation over a race.
      data = await read();
      if (!data) throw error;
      const adopted = resolveVoiceProfile(tenantId, data, settings, dealer);
      adopted.version = await computeVoiceProfileVersion(adopted);
      return adopted;
    }
    return voice;
  }

  if (data.version !== voice.version) {
    await admin.from("description_voice_profiles").update({ version: voice.version }).eq("id", data.id);
  }
  return voice;
}

/** The editable shape the voice screen reads back out of profile_json. */
function voiceProfileJson(v: VoiceProfile): Record<string, unknown> {
  const { tenantId: _t, version: _v, status: _s, approvedBy: _b, approvedAt: _a, ...rest } = v;
  return { ...rest, derivedFromSettings: true };
}

async function loadChannelOverrides(admin: any, tenantId: string): Promise<Map<string, Record<string, unknown>>> {
  const { data } = await admin.from("description_channel_policies")
    .select("channel, policy_json, active").eq("tenant_id", tenantId);
  const m = new Map<string, Record<string, unknown>>();
  for (const row of data || []) {
    m.set(String(row.channel), { ...(row.policy_json || {}), active: row.active !== false });
  }
  return m;
}

/**
 * SEO targeting arrives from a browser form. It reaches a prompt AND a stored
 * record, so it is sanitized here rather than trusted: markup, script and
 * control characters are stripped, and the field lengths are capped so a
 * keyword box cannot become a prompt-injection surface or a keyword block.
 */
function sanitizeTargeting(raw: Record<string, any>): Partial<SeoTargeting> {
  const clean = (v: unknown, max: number) =>
    String(v ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  const list = Array.isArray(raw.secondaryKeywords) ? raw.secondaryKeywords : [];
  const out: Partial<SeoTargeting> = {};
  const primary = clean(raw.primaryKeyword, 90);
  if (primary) out.primaryKeyword = primary;
  const secondary = [...new Set(list.map((k: unknown) => clean(k, 60)).filter(Boolean))].slice(0, 8);
  if (secondary.length) out.secondaryKeywords = secondary as string[];
  const city = clean(raw.city, 60); if (city) out.city = city;
  const state = clean(raw.state, 40); if (state) out.state = state;
  const marketArea = clean(raw.marketArea, 80); if (marketArea) out.marketArea = marketArea;
  const intent = String(raw.searchIntent || "");
  if (["inventory", "model_research", "local_dealer", "generic"].includes(intent)) {
    out.searchIntent = intent as SeoTargeting["searchIntent"];
  }
  return out;
}

const MAX_COMPARISONS = 24;

/**
 * The uniqueness comparison set. Named scopes travel with the score so the
 * stored number always answers "unique against WHAT" — an unqualified
 * percentage is exactly the decoration this phase exists to remove.
 */
async function buildComparisonSet(
  admin: any, tenantId: string, vehicleId: string, caseId: string, listing: Record<string, any>,
): Promise<ComparisonDoc[]> {
  const docs: ComparisonDoc[] = [];

  const { data: prior } = await admin.from("description_versions")
    .select("id, version_number, content").eq("description_case_id", caseId)
    .order("version_number", { ascending: false }).limit(3);
  for (const p of prior || []) {
    docs.push({ id: p.id, label: `this VIN, draft v${p.version_number}`,
      scope: "same_vin_prior_version", content: String(p.content || "") });
  }

  // Same model+trim is where real duplication happens: two QX80 Sensory
  // listings from one store are the pair a shopper sees side by side.
  const model = String(listing.ymm || "").trim();
  if (model) {
    const { data: siblings } = await admin.from("description_versions")
      .select("id, content, vehicle_id, vehicle_listings!inner(ymm, trim)")
      .eq("tenant_id", tenantId).neq("vehicle_id", vehicleId)
      .limit(60);
    const wantTrim = String(listing.trim || "").toLowerCase().trim();
    const sameModel = (siblings || []).filter((s: any) => {
      const vl = s.vehicle_listings || {};
      return String(vl.ymm || "").trim() === model;
    });
    for (const s of sameModel.slice(0, 12)) {
      const vl = (s as any).vehicle_listings || {};
      const sameTrim = String(vl.trim || "").toLowerCase().trim() === wantTrim;
      docs.push({ id: s.id, label: `${model}${sameTrim ? ` ${vl.trim}` : ""} (another unit)`,
        scope: "same_model_inventory", content: String(s.content || "") });
    }
    const others = (siblings || []).filter((s: any) => !sameModel.includes(s));
    for (const s of others.slice(0, Math.max(0, MAX_COMPARISONS - docs.length - 2))) {
      docs.push({ id: s.id, label: "another vehicle in this inventory",
        scope: "tenant_inventory", content: String(s.content || "") });
    }
  }

  return docs.filter((d) => d.content.trim().length > 40).slice(0, MAX_COMPARISONS);
}

/** Persist the feature selection that produced this version. */
async function saveFeatureSelections(
  admin: any, tenantId: string, vehicleId: string, caseId: string,
  versionId: string, packet: DescriptionPacket,
) {
  const rows = [
    ...packet.factoryFeatures, ...packet.dealerAddedFeatures, ...packet.excludedFeatures,
  ].map((f) => ({
    tenant_id: tenantId, vehicle_id: vehicleId, description_case_id: caseId, version_id: versionId,
    canonical_feature_id: f.canonical_id, display_name: f.display_name, category: f.category,
    origin: f.origin, source: f.source, confidence: f.confidence,
    package_id: f.package_id, package_name: f.package_name,
    conflict: f.conflict, description_eligible: f.description_eligible,
    public_eligible: f.public_eligible, priority_rank: f.priority_rank,
    priority_score: f.priority_score, selected: f.selected,
    selection_reason: f.selection_reason, selection_actor: "automation",
    aliases_seen: f.aliases_seen,
  }));
  if (!rows.length) return;
  const { error } = await admin.from("description_feature_selections").insert(rows);
  if (error) console.error("feature selection insert failed", error.message);
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
  admin: any, tenantId: string, vehicleId: string,
  opts: {
    force?: boolean; reason?: string; channels?: string[];
    tone?: string; targeting?: Partial<SeoTargeting>;
  } = {},
): Promise<Record<string, unknown>> {
  const { data: listing } = await admin.from("vehicle_listings").select("*").eq("id", vehicleId).maybeSingle();
  if (!listing) return { vehicle_id: vehicleId, skipped: "listing_not_found" };
  // A NULL-tenant listing must never be adopted by whoever asks first.
  if (listing.tenant_id !== tenantId) return { vehicle_id: vehicleId, skipped: "tenant_mismatch" };
  if (listing.status === "archived") return { vehicle_id: vehicleId, skipped: "archived" };

  // The Buyers Guide the customer signs is the ceiling on warranty language.
  // Copy implying coverage beside an AS-IS Guide puts the dealership in
  // contradiction with its own paperwork, so the filed document decides.
  const { data: guide } = await admin.from("generated_documents")
    .select("data_snapshot")
    .eq("vehicle_id", vehicleId).eq("document_type", "buyers_guide")
    .is("superseded_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  (listing as Record<string, unknown>).buyers_guide_disposition =
    buyersGuideDisposition(guide?.data_snapshot as Record<string, unknown> | null);

  const caseId = await rpc<string | null>(admin, "init_description_case", {
    p_tenant_id: tenantId, p_vehicle_id: vehicleId,
  });
  if (!caseId) return { vehicle_id: vehicleId, skipped: "case_not_initialized" };

  const { settings, configVersion } = await loadSettings(admin, tenantId);
  const sdv = await computeSourceDataVersion(listing, configVersion, !!settings.price_in_description);

  const { data: existing } = await admin.from("description_cases").select("*").eq("id", caseId).maybeSingle();
  await setCase(admin, caseId, { current_source_data_version: sdv, configuration_version: configVersion });

  // Refresh cadence. The sweep's SQL predicate is a coarse bound -- old enough
  // to possibly be owed a rewrite -- and this is the authority on whether one
  // is actually due and which milestone it satisfies. A vehicle that is not due
  // must leave with `skipped` so the sweep stamps its cursor; otherwise the
  // next hop re-selects it and the same 85 cars burn the whole nightly budget.
  let refreshMilestone: number | null = null;
  if (opts.reason === "reconcile:refresh_due") {
    const decision = refreshDecision({
      dom: (listing.mc_attributes as Record<string, unknown> | null)?.dom as number | null | undefined,
      ingestedAt: listing.created_at,
      lastMilestone: existing?.last_refresh_milestone ?? null,
      hasDescription: !!existing?.published_master_version_id,
      locked: !!existing?.master_locked,
    });
    if (!decision.due) {
      return { vehicle_id: vehicleId, case_id: caseId, skipped: `refresh_${decision.reason}`,
               days_in_inventory: decision.daysInInventory, age_source: decision.ageSource };
    }
    refreshMilestone = decision.milestone;
    await audit(admin, tenantId, "description_refresh_due", caseId, {
      vin: listing.vin, milestone: decision.milestone,
      days_in_inventory: decision.daysInInventory, age_source: decision.ageSource,
    });
  }

  // Idempotency: identical inputs + identical config → nothing to do.
  // Inputs changed under a locked or published case: flag it rather than
  // silently overwriting a human's copy.
  if (existing && existing.processed_source_data_version &&
      existing.processed_source_data_version !== sdv &&
      (existing.master_locked || existing.status === "PUBLISHED")) {
    await rpcSoft(admin, "mark_description_stale", { p_case_id: caseId, p_reason: "source data changed" });
  }

  if (!opts.force && existing?.processed_source_data_version === sdv &&
      ["READY", "PUBLISHED", "PARTIALLY_PUBLISHED", "REVIEW_REQUIRED"].includes(existing?.status)) {
    return { vehicle_id: vehicleId, case_id: caseId, skipped: "unchanged", source_data_version: sdv };
  }

  const scopedRun = Array.isArray(opts.channels) && opts.channels.length > 0;
  const toneKey = opts.tone && isToneKey(opts.tone) ? opts.tone : "default";
  const targetKey = opts.targeting
    ? `${opts.targeting.primaryKeyword || ""}|${(opts.targeting.secondaryKeywords || []).slice().sort().join(",")}|${opts.targeting.city || ""}`
    : "default";
  const jobKey = `${tenantId}:${vehicleId}:${sdv}:${configVersion}:${toneKey}:${targetKey}:${scopedRun ? "channels:" + [...opts.channels!].sort().join("+") : "full_generation"}`;
  // rpc() throws on a failed claim, so a null id here is only ever a genuine
  // concurrent claim. Discarding that error once cost this pipeline every
  // generation on every vehicle: a dropped RPC reported for weeks as the
  // benign "already running", with no failure recorded to contradict it.
  const jobId = await rpc<string | null>(admin, "claim_description_job", {
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
      features_json: { features: snap.features },
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

    // 2 ── voice, tone, targeting, feature selection → one approved packet
    const voice = await loadVoiceProfile(admin, tenantId, settings, dealer);
    const channelOverrides = await loadChannelOverrides(admin, tenantId);
    const requestedTone = opts.tone && isToneKey(opts.tone) ? opts.tone : null;
    const tone: ToneKey = requestedTone
      ?? (isToneKey(voice.defaultTone) ? voice.defaultTone : "professional");
    const packet: DescriptionPacket = buildDescriptionPacket(snap, settings, voice, {
      tone,
      targeting: opts.targeting,
      featureBudget: resolveChannelPolicy("vehicle_passport")?.featureBudget ?? 10,
    });
    const featChecksum = await featureChecksum(packet.selectedFeatureIds);
    const masterPolicy = resolveChannelPolicy("vehicle_passport", channelOverrides.get("vehicle_passport"))!;

    // ── Preflight: refuse a doomed request BEFORE any provider call ──
    // Everything above this point is free. Everything below spends money, so
    // a request that was always going to fail must be rejected here rather
    // than discovered by the model.
    const { data: budgetRow } = await admin.from("description_generation_budgets")
      .select("*").eq("tenant_id", tenantId).maybeSingle();
    const spend = await rpc(admin, "description_generation_spend", { p_tenant_id: tenantId });
    const budgetCfg = budgetRow ? {
      ...DEFAULT_BUDGET,
      monthlyGenerationBudget: budgetRow.monthly_generation_budget,
      monthlyPreviewBudget: budgetRow.monthly_preview_budget,
      maxCostPerGeneration: budgetRow.max_cost_per_generation,
      maxRepairAttempts: budgetRow.max_repair_attempts ?? DEFAULT_BUDGET.maxRepairAttempts,
      maxChannelsPerBatch: budgetRow.max_channels_per_batch ?? DEFAULT_BUDGET.maxChannelsPerBatch,
      dailyGenerationLimit: budgetRow.daily_generation_limit,
      perUserDailyLimit: budgetRow.per_user_daily_limit,
      warningThresholdPct: budgetRow.warning_threshold_pct ?? DEFAULT_BUDGET.warningThresholdPct,
      hardStopPct: budgetRow.hard_stop_pct ?? DEFAULT_BUDGET.hardStopPct,
    } : DEFAULT_BUDGET;
    const budgetDecision = evaluateBudget(budgetCfg, {
      monthProductionSpend: Number((spend as any)?.month_production_spend ?? 0),
      monthPreviewSpend: Number((spend as any)?.month_preview_spend ?? 0),
      todayGenerationCount: Number((spend as any)?.today_generation_count ?? 0),
      userTodayGenerationCount: 0,
    }, { isPreview: false, estimatedCost: null });

    const pf = preflight({
      authenticated: true,
      canGenerate: true,
      listing, tenantId,
      snapshot: snap,
      policy: masterPolicy,
      channelEnabled: true,
      voice,
      targeting: packet.targeting,
      jobInFlight: false,
      budget: { withinBudget: budgetDecision.withinBudget, reason: budgetDecision.reason },
      providerConfigured: !!SERVICE_KEY,
    });

    await admin.from("description_preflight_results").insert({
      tenant_id: tenantId, vehicle_id: vehicleId, description_case_id: caseId,
      channel: "master", passed: pf.ok, blocking_codes: pf.blockingCodes,
      findings_json: pf.findings, summary: preflightSummary(pf),
    });

    if (!pf.ok) {
      await admin.from("description_jobs").update({
        status: "failed_blocked", last_error_code: pf.blockingCodes[0] || "PREFLIGHT_FAILED",
        last_error_message: preflightSummary(pf), failed_at: new Date().toISOString(),
      }).eq("id", jobId);
      await setCase(admin, caseId, {
        status: "FAILED_BLOCKED", publication_eligibility: "blocked",
        last_error_message: preflightSummary(pf),
      });
      await raiseException(admin, ctx, "GENERATION_BLOCKED", "high", true,
        "Generation refused before any AI cost", preflightSummary(pf),
        { blocking_codes: pf.blockingCodes, findings: pf.findings });
      await audit(admin, tenantId, "generation_preflight_rejected", caseId,
        { vin: listing.vin, blocking_codes: pf.blockingCodes });
      return { vehicle_id: vehicleId, case_id: caseId, skipped: "preflight_rejected",
               blocking_codes: pf.blockingCodes, reason: preflightSummary(pf), cost_incurred: false };
    }
    if (budgetDecision.verdict === "warning") {
      await audit(admin, tenantId, "generation_budget_warning", caseId,
        { vin: listing.vin, consumed_pct: budgetDecision.consumedPct });
    }
    const masterPolicyVersion = await computeChannelPolicyVersion(masterPolicy);
    const inputChecksum = await computeInputChecksum({
      tenantId, vehicleId, snapshotChecksum: sdv, channel: "master",
      channelPolicyVersion: masterPolicyVersion, voiceProfileVersion: voice.version, tone,
      featureChecksum: featChecksum, targeting: packet.targeting,
      promptVersion: settings.prompt_version, model: settings.generation_model,
    });

    // Cost guard: an identical packet has already been paid for. Reuse the
    // stored output rather than billing the provider for the same answer.
    if (!opts.force) {
      const { data: reusable } = await admin.from("description_versions")
        .select("id, version_number").eq("description_case_id", caseId)
        .eq("input_checksum", inputChecksum).in("validation_status", ["passed", "warning"])
        .order("version_number", { ascending: false }).limit(1).maybeSingle();
      if (reusable?.id) {
        await admin.from("description_jobs").update({
          status: "succeeded", completed_at: new Date().toISOString(),
        }).eq("id", jobId);
        await audit(admin, tenantId, "description_generation_reused", caseId,
          { vin: listing.vin, version_id: reusable.id, input_checksum: inputChecksum });
        return { vehicle_id: vehicleId, case_id: caseId, version_id: reusable.id,
                 skipped: "equivalent_output_reused", input_checksum: inputChecksum };
      }
    }

    // 3 ── master
    await setCase(admin, caseId, { status: "GENERATING" });
    await audit(admin, tenantId, "description_generation_started", caseId,
      { vin: listing.vin, tone, voice_profile_version: voice.version, input_checksum: inputChecksum });
    const generation = await generateMaster(packet, snap, settings, listing);
    const masterText = generation.text;
    const knowledgeModules = generation.moduleKeys;

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
      prompt_profile: settings.prompt_profile,
      knowledge_revision: settings.prompt_profile === "drivesignal-v3-system"
        ? KNOWLEDGE_REVISION : null,
      knowledge_modules: knowledgeModules,
      headline: generation.headline,
      claimed_fact_ids: generation.claimedFactIds,
      fact_roles_json: generation.factRoles,
      evidence_audit_json: generation.result
        ? auditEvidence({
            used_fact_ids: generation.claimedFactIds, hero_fact_ids: [],
            warranty_fact_ids: [], history_fact_ids: [],
          }, snap)
        : {},
      source_data_version: sdv, created_by_type: "automation",
      tone, seo_targeting_json: packet.targeting, voice_profile_version: voice.version,
      channel_policy_version: masterPolicyVersion, selected_feature_checksum: featChecksum,
      input_checksum: inputChecksum,
    }).select("*").single();
    if (!version?.id) {
      throw Object.assign(new Error("version_insert_failed"), { code: "DB_CONFLICT" });
    }

    await saveFeatureSelections(admin, tenantId, vehicleId, caseId, version.id, packet);

    // 4 ── validate → repair → revalidate
    await setCase(admin, caseId, { status: "VALIDATING" });
    let masterFinal = masterText;
    let findings: Finding[] = validateContentV3(masterFinal, snap, settings, packet);
    let repairLog: Record<string, unknown> | null = null;

    // The DriveSignal QA gates contribute the checks the prose validator does
    // not make: whether the writer cited evidence it was given, whether the
    // length suits this class of vehicle, editorial standards, identity
    // presence, and the prohibited hype and safety-overclaim libraries.
    //
    // They feed decideEligibility rather than deciding publication themselves.
    // Two authorities over the same decision drift; this way the gates add
    // findings and the existing engine keeps the verdict. Only gate-originated
    // findings are merged — the routed validator ones are already in the list.
    const gateReport = runGates({
      content: masterFinal,
      snapshot: snap,
      validatorFindings: findings,
      output: generation.result && generation.claimedFactIds.length
        ? { used_fact_ids: generation.claimedFactIds, hero_fact_ids: [],
            warranty_fact_ids: [], history_fact_ids: [] }
        : null,
      lengthBand: preferredLengthBand(settings),
      vehicleClass: vehicleClassOf({
        isTruck: /\b(pickup|truck|cab)\b/i.test(String(listing.mc_attributes?.body_type ?? "")),
        isLuxuryOrPerformance: knowledgeModules.includes("luxury"),
        msrp: Number(listing.msrp) || null,
      }),
      identity: {
        year: listing.mc_attributes?.year ?? null,
        make: listing.mc_attributes?.make ?? null,
        model: listing.mc_attributes?.model ?? null,
      },
    });
    findings = [...findings, ...gateReport.findings
      .filter((g) => g.origin === "gate")
      .map((g) => ({
        validator_code: g.code,
        severity: (g.blocking ? "blocking" : "warning") as Finding["severity"],
        message: `[${g.gate}] ${g.message}`,
        blocking: g.blocking,
      }))];
    await audit(admin, tenantId, "description_gates_evaluated", caseId, {
      vin: listing.vin, decision: gateReport.decision, characters: gateReport.characterCount,
      by_gate: gateReport.byGate,
    });

    // Repair only ever DELETES the offending sentence, trims, or appends the
    // dealer's own disclosure. It never rewrites a claim and never calls the
    // model again — a generative "fix" is a second chance to hallucinate.
    if (hasRepairableFindings(findings)) {
      const repaired = repairContent(masterFinal, findings, masterPolicy, voice.requiredDisclosures);
      if (repaired.changed) {
        const after = validateContentV3(repaired.content, snap, settings, packet);
        const before = findings.filter((f) => f.blocking).length;
        // Keep the repair only if it strictly reduces blocking findings.
        // A repair that trades one blocker for another is not an improvement.
        if (after.filter((f) => f.blocking).length < before) {
          masterFinal = repaired.content;
          findings = after;
          repairLog = { applied: repaired.applied, unrepairable: repaired.unrepairable,
                        blocking_before: before, blocking_after: after.filter((f) => f.blocking).length };
          await admin.from("description_versions").update({
            content: masterFinal,
            word_count: masterFinal.split(/\s+/).filter(Boolean).length,
            character_count: masterFinal.length,
            repair_json: repairLog,
          }).eq("id", version.id);
          await audit(admin, tenantId, "description_repair_applied", caseId,
            { vin: listing.vin, version_id: version.id, ...repairLog });
        }
      }
    }
    const masterText2 = masterFinal;
    // The comparison set is built AFTER the version row exists but excludes it,
    // because the prior-version query orders by version_number and this run's
    // own copy would otherwise score as its own duplicate.
    const comparisons = (await buildComparisonSet(admin, tenantId, vehicleId, caseId, listing))
      .filter((d) => d.id !== version.id);
    const masterScore = scoreVersion({ text: masterText2, packet, findings, comparisons });
    const quality = masterScore.total;

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
    await admin.from("description_versions").update({
      validation_status: masterStatus, quality_score: quality,
      score_breakdown_json: masterScore, readability_json: masterScore.readability,
      uniqueness_json: masterScore.uniqueness, score_version: masterScore.version,
      read_time_seconds: Math.max(15, Math.round((masterScore.readability.words / 200) * 60)),
    }).eq("id", version.id);

    // 5 ── channel variants
    const allEnabled: string[] = Array.isArray(settings.enabled_channels) ? settings.enabled_channels : [];
    // Selective regeneration: when the caller names channels, only those are
    // rebuilt; everything else keeps its existing variant.
    const scoped = Array.isArray(opts.channels) && opts.channels.length
      ? allEnabled.filter((k) => opts.channels!.includes(k)) : allEnabled;
    // Naming a channel the tenant has not enabled used to intersect to nothing
    // and fall through silently: the master was regenerated at full provider
    // cost, no variant was written, and the caller was told nothing. Say so.
    const refusedChannels = Array.isArray(opts.channels) && opts.channels.length
      ? opts.channels.filter((k) => !allEnabled.includes(k)) : [];
    const enabled = scoped;
    const channelRows: Array<Record<string, unknown>> = [];
    // Cross-channel comparison corpus, grown as each variant lands.
    const channelTexts: Array<{ channel: string; label: string; content: string }> = [];
    const channelBlocking: Finding[] = [];
    for (const key of enabled) {
      const policy: ChannelPolicy | undefined = resolveChannelPolicy(key, channelOverrides.get(key));
      if (!policy || !policy.active) continue;
      // a locked channel is never overwritten by automation
      const { data: locked } = await admin.from("description_channel_versions")
        .select("id, locked").eq("description_case_id", caseId).eq("channel", key)
        .eq("locked", true).limit(1).maybeSingle();
      if (locked?.locked) {
        await admin.from("description_channel_versions")
          .update({ potentially_stale: true }).eq("id", locked.id);
        await raiseException(admin, ctx, "MANUAL_CONTENT_STALE", "medium", false,
          `${policy.label} copy may be out of date`,
          "This channel is locked to a manual edit while the underlying vehicle data changed.",
          { source_data_version: sdv }, key);
        continue;
      }
      const policyVersion = await computeChannelPolicyVersion(policy);
      // Each channel gets its own feature budget, so the destination's own
      // policy decides how much equipment the copy carries.
      const channelPacket: DescriptionPacket = buildDescriptionPacket(snap, settings, voice, {
        tone, targeting: packet.targeting, featureBudget: policy.featureBudget,
      });

      try {
        const raw = await callGenerator(
          buildChannelPromptV3(masterText2, policy, channelPacket), settings.generation_model);
        let content = raw, seoTitle: string | null = null, metaDesc: string | null = null;
        if (policy.seoFields) {
          try {
            const parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
            content = String(parsed.content || raw);
            seoTitle = parsed.seo_title ? String(parsed.seo_title) : null;
            metaDesc = parsed.meta_description ? String(parsed.meta_description) : null;
          } catch { /* fall back to raw text */ }
        }
        let cFindings = validateContentV3(content, snap, settings, channelPacket, policy);
        let cRepair: Record<string, unknown> | null = null;
        // Same removal-only repair per channel. A channel variant is the most
        // common place a length or formatting rule bites, and those are the
        // repairs that are unambiguously safe.
        if (hasRepairableFindings(cFindings) || cFindings.some((f) =>
            ["CHANNEL_LENGTH_EXCEEDED", "CHANNEL_FORMAT_INVALID", "CHANNEL_EMOJI_NOT_ALLOWED"]
              .includes(f.validator_code))) {
          const r = repairContent(content, cFindings, policy, policy.requiredDisclosures);
          if (r.changed) {
            const after = validateContentV3(r.content, snap, settings, channelPacket, policy);
            const beforeBlocking = cFindings.filter((f) => f.blocking).length;
            const afterBlocking = after.filter((f) => f.blocking).length;
            if (afterBlocking <= beforeBlocking && after.length < cFindings.length) {
              content = r.content;
              cFindings = after;
              cRepair = { applied: r.applied, unrepairable: r.unrepairable };
            }
          }
        }
        const cStatus = cFindings.some((f) => f.blocking) ? "blocked"
          : cFindings.some((f) => f.severity === "warning") ? "warning" : "passed";

        // A derivative is compared against the master and its already-generated
        // siblings: "same copy with the channel name swapped" is a real defect,
        // and only a cross-channel comparison can see it.
        const cScore = scoreVersion({
          text: content, packet: channelPacket, findings: cFindings, policy,
          comparisons: [
            { id: version.id, label: "master description", scope: "cross_channel", content: masterText2 },
            ...channelTexts.map((t) => ({
              id: `${version.id}:${t.channel}`, label: `${t.label} variant`,
              scope: "cross_channel" as const, content: t.content,
            })),
            ...comparisons,
          ],
        });
        channelTexts.push({ channel: key, label: policy.label, content });

        const { data: cv } = await admin.from("description_channel_versions").upsert({
          tenant_id: tenantId, vehicle_id: vehicleId, description_case_id: caseId,
          master_version_id: version.id, channel: key, content,
          seo_title: seoTitle, meta_description: metaDesc,
          character_count: content.length, character_limit: policy.characterLimit,
          word_count: cScore.readability.words,
          read_time_seconds: Math.max(10, Math.round((cScore.readability.words / 200) * 60)),
          channel_policy_version: policyVersion, score_breakdown_json: cScore,
          repair_json: cRepair,
          quality_score: cScore.total,
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
            `${policy.label} exceeds the destination limit`,
            cFindings.find((f) => f.validator_code === "CHANNEL_LENGTH_EXCEEDED")!.message, {}, key);
        }
        channelRows.push({ channel: key, status: cStatus });
        // A channel variant that introduces an unsupported claim must not be
        // exportable while the case reports "eligible".
        if (cStatus === "blocked") channelBlocking.push(...cFindings.filter((f) => f.blocking));
      } catch (e) {
        await raiseException(admin, ctx, "CHANNEL_GENERATION_FAILED", "medium", false,
          `${policy.label} variant could not be generated`, String((e as Error).message).slice(0, 200), {}, key);
      }
    }

    // 5 ── eligibility + honest publication
    const { eligibility, reason } = decideEligibility(
      [...findings, ...channelBlocking], settings, listing.condition || "used", quality);
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
      // Stamped when the rewrite exists, not when it publishes. A refresh held
      // for review has still satisfied its milestone; stamping on publish
      // instead would re-select the vehicle every night until a human acted.
      ...(refreshMilestone ? { last_refresh_milestone: refreshMilestone } : {}),
    }, true);

    // Auto-publish only when eligible, permitted, and not manually locked.
    let published = false;
    const { data: caseNow } = await admin.from("description_cases").select("lock_version, master_locked").eq("id", caseId).maybeSingle();
    const gate = await rpc(admin, "description_publish_allowed", {
      p_case_id: caseId, p_version_id: version.id,
    });
    const gateOk = (gate as any)?.ok !== false;
    if (eligibility === "eligible" && settings.internal_publication_enabled && !caseNow?.master_locked && gateOk) {
      // PUBLISHING is a real observable state: publication is several round
      // trips, and a crash mid-flight must leave a status the reconcile sweep
      // recognizes as stalled rather than a silent "READY".
      await setCase(admin, caseId, { status: "PUBLISHING" });
      const pub = await rpc(admin, "publish_description_internal", {
        p_case_id: caseId, p_version_id: version.id, p_expected_lock_version: caseNow?.lock_version ?? null,
      });
      published = !!(pub as any)?.ok;
      if (published) {
        finalStatus = "PUBLISHED";
      } else {
        await setCase(admin, caseId, { status: finalStatus });
        await raiseException(admin, ctx, "INTERNAL_PUBLICATION_FAILED", "high", false,
          "Internal publication did not complete", String((pub as any)?.error || "unknown"), { result: pub });
      }
    }

    // Published internally, but one or more enabled channels did not produce a
    // usable variant — the vehicle is live on the shopper page while an export
    // is missing. That is PARTIALLY_PUBLISHED, not PUBLISHED.
    const expectedChannels = allEnabled.filter((k) => channelByKey(k)).length;
    const usableChannels = channelRows.filter((r) => r.status !== "blocked").length;
    if (published && expectedChannels > 0 && !scopedRun && usableChannels < expectedChannels) {
      await setCase(admin, caseId, { status: "PARTIALLY_PUBLISHED" });
      finalStatus = "PARTIALLY_PUBLISHED";
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
      await rpcSoft(admin, "close_resolved_description_exceptions", {
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
      status: finalStatus, eligibility, quality,
      fact_confidence: snap.fact_confidence, channels: channelRows.length,
      conflicts: snap.conflicts.length, published,
      ...(refusedChannels.length ? { refused_channels: refusedChannels } : {}),
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
      // Any run that spends provider credits needs authority, not just
      // membership — a forced "orchestrate" is a regeneration by another name.
      if ((action === "regenerate" || body.force) && !authorized(tenantId)) {
        return json({ error: "insufficient_permission" }, 403);
      }
      const result: Record<string, unknown> = await orchestrateVehicle(admin, tenantId, vehicleId, {
        force: action === "regenerate" || !!body.force,
        reason: action === "regenerate" ? "manual_regenerate" : String(body.reason || "ingest"),
        channels: Array.isArray(body.channels) ? body.channels.map(String) : undefined,
        tone: typeof body.tone === "string" ? body.tone : undefined,
        targeting: body.targeting && typeof body.targeting === "object"
          ? sanitizeTargeting(body.targeting) : undefined,
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
      // Validation rewrites validation_status and publication_eligibility, so
      // it is a mutation and needs the same authority as generation.
      if (!authorized(tenantId)) return json({ error: "insufficient_permission" }, 403);

      const { data: ver } = await admin.from("description_versions").select("*").eq("id", versionId).maybeSingle();
      if (!ver || ver.tenant_id !== tenantId) return json({ error: "version_not_found" }, 404);
      const { data: listing } = await admin.from("vehicle_listings").select("*").eq("id", ver.vehicle_id).maybeSingle();
      const { settings } = await loadSettings(admin, tenantId);
      const { data: dealer } = await admin.from("dealer_profiles").select("*").eq("tenant_id", tenantId).maybeSingle();
      const { data: ovRows } = await admin.from("description_fact_overrides")
        .select("field_key, decision, value").eq("description_case_id", ver.description_case_id);
      const snap = buildFactSnapshot(listing || {}, settings, dealer, (ovRows || []) as FactOverride[]);

      // A human edit clears the SAME V3 validators as generated copy, against
      // the same packet the version was written under. Falling back to the
      // legacy validator here would let a manual edit introduce an unapproved
      // dealer claim that automation could never have produced.
      const voice = await loadVoiceProfile(admin, tenantId, settings, dealer);
      const packet = buildDescriptionPacket(snap, settings, voice, {
        tone: isToneKey(ver.tone) ? ver.tone : undefined,
        targeting: (ver.seo_targeting_json || undefined) as Partial<SeoTargeting> | undefined,
      });
      const comparisons = await buildComparisonSet(
        admin, tenantId, ver.vehicle_id, ver.description_case_id, listing || {});
      const f = validateContentV3(ver.content, snap, settings, packet);
      const score = scoreVersion({
        text: ver.content, packet, findings: f,
        comparisons: comparisons.filter((d) => d.id !== versionId),
      });
      const q = score.total;
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
      await admin.from("description_versions").update({
        validation_status: st, quality_score: q, score_breakdown_json: score,
        readability_json: score.readability, uniqueness_json: score.uniqueness,
        score_version: score.version,
        read_time_seconds: Math.max(15, Math.round((score.readability.words / 200) * 60)),
      }).eq("id", versionId);

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
        const batch = await rpc(admin, "next_description_reconcile_batch", {
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
            // refresh_due is by definition unchanged source data -- that is the
            // whole point of a time-based rewrite -- so without force it would
            // return "unchanged" and no description would ever be refreshed.
            // Whether it is genuinely due was already settled by
            // refreshDecision inside orchestrateVehicle.
            force: r.reason === "stalled" || r.reason === "retryable" || r.reason === "refresh_due",
            reason: `reconcile:${r.reason}`,
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
      let pendingCount = 0;
      if (depth < RECONCILE_MAX_DEPTH) {
        const more = await rpc(admin, "next_description_reconcile_batch", {
          p_tenant_id: tenantId, p_limit: 20, p_sweep_start: sweepStart,
        });
        // Chain only for work this hop did not already attempt — a vehicle that
        // cannot leave the cursor would otherwise chain 80 hops deep.
        const pending = ((more || []) as Array<{ vehicle_id: string }>)
          .filter((r) => !seenThisHop.has(r.vehicle_id));
        pendingCount = pending.length;
        if (pending.length > 0) {
          // The hop is REQUESTED, not confirmed: the call is fire-and-forget and
          // the child may cold-start-fail. Reporting "chained" as if the backlog
          // were draining would hide a sweep that never resumed.
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
      return json({ success: true, examined, depth, chain_requested: chained, remaining_at_exit: pendingCount, sweep_start: sweepStart, results });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "unknown error" }, 500);
  }
});
