// ──────────────────────────────────────────────────────────────────────
// marketcheck-recalls — recall resolution at TWO SCOPES.
//
// VIN scope: MarketCheck's licensed AutoRecalls product, the only source
// allowed to clear a VIN. It writes recall_status, open_recall_count,
// closed_recall_count and the recall_check envelope. Until its terms are
// accepted in the MarketCheck portal it answers nothing, so every vehicle is
// honestly UNKNOWN at VIN scope — and switching the product on turns the same
// call into VERIFIED_CLEAR / OPEN with no further change here.
//
// MODEL scope: NHTSA recallsByVehicle, which answers for a year/make/model
// and never for a VIN. It writes recall_payload and nothing else. It is
// campaign context, not clearance.
//
// The API key never leaves the server. Single-VIN mode checks one car; batch
// mode sweeps a tenant's inventory (skipping cars checked in the last 24h
// unless force=true), rate-limited. Sweep mode (service-role only) re-checks
// every published listing whose recall_check is missing or >30 days old,
// across all tenants — the nightly self-heal behind the Recall backfill
// screen.
//
// Body: { vin?, tenant_id?, batch?, force?, sweep? }
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY } from "../_shared/supabase.ts";
import {
  HttpGet,
  HttpOutcome,
  IdentitySource,
  ModelRecallAnswer,
  NhtsaModelCatalogue,
  VinRecallAnswer,
  classifyMarketcheckVinRecall,
  isVinAnswered,
  mayOverwriteVinWithUnanswered,
  modelRecallColumns,
  resolveNhtsaIdentity,
  resolveNhtsaModelRecall,
  vinRecallColumns,
} from "../_shared/recallState.ts";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";

// VIN: 17 chars, letters/digits, excluding I, O, Q.
const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

// Candidate MarketCheck recall endpoints (the path/host has moved across API
// generations; we try each until one answers so the feature works without a
// docs round-trip, and report which one matched for diagnostics).
const recallEndpoints = (vin: string): string[] => {
  const k = encodeURIComponent(MC_KEY);
  const v = encodeURIComponent(vin);
  return [
    `${MC_BASE}/recall/car/${v}?api_key=${k}`,
    `https://mc-api.marketcheck.com/v2/recall/car/${v}?api_key=${k}`,
    `${MC_BASE}/recall/car?api_key=${k}&vin=${v}`,
    `${MC_BASE}/recalls/car/${v}?api_key=${k}`,
  ];
};
const redact = (u: string) => u.replace(/api_key=[^&]+/, "api_key=***");

const httpGet: HttpGet = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => undefined);
    return { kind: "response", status: res.status, body };
  } catch (e) {
    return { kind: "transport_error", reason: String((e as { message?: string })?.message || e) };
  }
};

interface VinLookup {
  answer: VinRecallAnswer;
  endpoint: string | null;
  tried: { url: string; status: number | string }[];
}

// Try each candidate endpoint until one gives a usable VIN answer.
//
// The 404 branch used to return an empty recall list and store it as "clear"
// — "no record on file (typical new model year)". That is the absence of a
// record, not a statement about the car, and it is the only thing this
// licensed product has ever written to this database: the five rows tagged
// marketcheck_autorecalls all carry an empty campaign list. A 404 is now
// UNKNOWN, and so is every other non-2xx and every body whose shape we do not
// recognise. Only a 2xx carrying a real recall array clears or opens a VIN.
async function fetchVinRecalls(vin: string): Promise<VinLookup> {
  const tried: { url: string; status: number | string }[] = [];
  const at = new Date().toISOString();
  let last: VinRecallAnswer | null = null;
  for (const url of recallEndpoints(vin)) {
    const outcome = await httpGet(url);
    tried.push({
      url: redact(url),
      status: outcome.kind === "response" ? outcome.status : "timeout_or_network",
    });
    const answer = classifyMarketcheckVinRecall(outcome, {
      vin,
      source: "marketcheck_autorecalls",
      checkedAt: at,
    });
    if (isVinAnswered(answer)) return { answer, endpoint: redact(url), tried };
    last = answer;
  }
  return {
    answer: last ?? classifyMarketcheckVinRecall(
      { kind: "transport_error", reason: "no_endpoint_matched" },
      { vin, source: "marketcheck_autorecalls", checkedAt: at },
    ),
    endpoint: null,
    tried,
  };
}

// NHTSA is MODEL scope. It answers for a year/make/model, so it can describe
// the campaign context for a model line and it can never clear a VIN. Its
// answer is stored in recall_payload and nowhere else.
async function fetchModelRecalls(
  identitySource: IdentitySource,
  catalogue: NhtsaModelCatalogue,
): Promise<ModelRecallAnswer | null> {
  const identity = resolveNhtsaIdentity(identitySource);
  if (!identity.year || !identity.make || !identity.model) return null;
  return await resolveNhtsaModelRecall(identity, { get: httpGet, catalogue });
}

interface Resolved {
  vin: VinRecallAnswer;
  model: ModelRecallAnswer | null;
  endpoint: string | null;
  tried: { url: string; status: number | string }[];
}

// Both scopes are resolved on every pass, and neither can stand in for the
// other. Shared by single-VIN, batch and sweep so the three cannot drift.
async function resolveRecall(
  vin: string,
  identitySource: IdentitySource,
  catalogue: NhtsaModelCatalogue,
): Promise<Resolved> {
  const mc = await fetchVinRecalls(vin);
  const model = await fetchModelRecalls(identitySource, catalogue);
  return { vin: mc.answer, model, endpoint: mc.endpoint, tried: mc.tried };
}

// deno-lint-ignore no-explicit-any
const persist = async (admin: any, tenantId: string | null, vin: string, r: Resolved, storedStatus: string | null) => {
  const patch: Record<string, unknown> = {};
  // An unanswered VIN lookup records itself only where no VIN answer stands,
  // so a MarketCheck outage can never wipe a known open recall or a real
  // clearance. recall_check is the VIN store: after this change it carries a
  // VIN-level check or nothing, which is why the publish gate's freshness
  // requirement now means a VIN-level check.
  if (isVinAnswered(r.vin) || mayOverwriteVinWithUnanswered(storedStatus)) {
    Object.assign(patch, vinRecallColumns(r.vin));
  }
  if (r.model) Object.assign(patch, modelRecallColumns(r.model));
  if (Object.keys(patch).length === 0) return false;
  let q = admin.from("vehicle_listings").update(patch).eq("vin", vin);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  try { await q; return true; } catch { return false; }
};

interface IdentityRow extends IdentitySource {
  vin: string;
  tenant_id: string | null;
  recall_status: string | null;
}

// One batched read of the structured identity every provider call needs.
// Recall queries use the feed's own make/model keys; the display ymm string is
// the last resort, never the first choice — splitting it on whitespace is how
// "Alfa Romeo Stelvio" became make "Alfa" and how a recall query became model
// "Ram 1500 Pickup".
// deno-lint-ignore no-explicit-any
async function loadIdentities(admin: any, tenantId: string | null, vins: string[]): Promise<Map<string, IdentityRow>> {
  const out = new Map<string, IdentityRow>();
  if (vins.length === 0) return out;
  let q = admin.from("vehicle_listings").select("vin, tenant_id, ymm, mc_attributes, mc_raw, recall_status").in("vin", vins);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q;
  for (const row of (data || []) as IdentityRow[]) out.set(String(row.vin || "").toUpperCase(), row);
  return out;
}

const response = (vin: string, r: Resolved) => ({
  vin,
  scopes: {
    vin: {
      state: r.vin.state,
      status: vinRecallColumns(r.vin).recall_status,
      source: r.vin.source,
      checked_at: r.vin.checkedAt,
      open_recall_count: r.vin.openCount,
      closed_recall_count: r.vin.closedCount,
      campaigns: r.vin.campaigns,
      note: r.vin.note,
    },
    model: r.model
      ? {
        state: r.model.state,
        source: r.model.source,
        checked_at: r.model.checkedAt,
        campaign_count: r.model.campaignCount,
        campaigns: r.model.campaigns,
        queried: r.model.queried,
        matched_model: r.model.matchedModel,
        note: r.model.note,
      }
      : null,
  },
  endpoint: r.endpoint,
});

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  // 503, not 200: pg_cron's recall sweep and every dashboard read a 2xx as a
  // successful recall check, so a missing key used to mute the entire recall
  // system silently. Callers already fall back to NHTSA on a non-2xx.
  if (!MC_KEY) return json(503, { recallStatus: "error", error: "not_configured", note: "Set MARKETCHECK_API_KEY_1 (AutoRecalls access)" });

  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body.tenant_id || null;

  // ── Auth gate: service-role (cron) bypasses; otherwise require a
  // signed-in tenant member or platform admin for the requested tenant.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth !== SERVICE_KEY) {
    const { data: ures, error: uerr } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (uerr || !userId) return json(401, { error: "authentication required" });
    if (!tenantId) return json(400, { error: "tenant_id required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
      if (!membership) return json(403, { error: "not a member of this tenant" });
    }
  }


  // ── All-tenants self-heal sweep (cron) ───────────────────────────────
  // Re-checks every published listing whose recall_check is missing or
  // >30 days old, reusing the same definition of "stale" as the admin
  // worklist (listings_with_stale_recalls). Service-role only.
  if (body.sweep) {
    if (auth !== SERVICE_KEY) return json(403, { error: "sweep is service-role only" });
    const limit = Math.min(Math.max(Number(body.limit) || 500, 1), 1000);
    const { data: stale, error: staleErr } = await admin.rpc("listings_with_stale_recalls", { p_limit: limit });
    if (staleErr) return json(200, { sweep: true, error: staleErr.message, checked: 0 });
    const rows = (stale || []) as Array<{ tenant_id: string | null; vin: string; ymm: string | null }>;
    const vins = rows.map((r) => (r.vin || "").toUpperCase()).filter(validVin);
    const identities = await loadIdentities(admin, null, vins);
    // One catalogue for the whole sweep: 130 vehicles are a handful of
    // distinct year/make pairs, so NHTSA's model list is fetched once each.
    const catalogue = new NhtsaModelCatalogue(httpGet);
    let vinVerified = 0, vinOpen = 0, vinUnknownCount = 0, modelContext = 0, skipped = 0;
    for (const row of rows) {
      const vin = (row.vin || "").toUpperCase();
      if (!validVin(vin)) { skipped++; continue; }
      const identity = identities.get(vin);
      const r = await resolveRecall(vin, { ymm: identity?.ymm ?? row.ymm, mc_attributes: identity?.mc_attributes, mc_raw: identity?.mc_raw }, catalogue);
      await persist(admin, row.tenant_id, vin, r, identity?.recall_status ?? null);
      if (r.vin.state === "VERIFIED_CLEAR") vinVerified++;
      else if (r.vin.state === "OPEN") vinOpen++;
      else vinUnknownCount++;
      if (r.model && r.model.state !== "LOOKUP_FAILED") modelContext++;
      await new Promise((res) => setTimeout(res, 250)); // rate-limit courtesy
    }
    return json(200, {
      sweep: true,
      candidates: rows.length,
      vin_verified_clear: vinVerified,
      vin_open: vinOpen,
      vin_unknown: vinUnknownCount,
      model_context_written: modelContext,
      catalogue_calls: catalogue.callCount,
      skipped,
    });
  }

  // ── Batch sweep ──────────────────────────────────────────────────────
  if (body.batch) {
    if (!tenantId) return json(400, { error: "tenant_id required for batch" });
    const force = !!body.force;
    const { data: vehicles } = await admin.from("vehicle_listings")
      .select("vin, recall_checked_at, ymm, mc_attributes, mc_raw, recall_status").eq("tenant_id", tenantId).limit(1000);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const catalogue = new NhtsaModelCatalogue(httpGet);
    let vinVerified = 0, vinOpen = 0, vinUnknownCount = 0, skipped = 0;
    for (const v of (vehicles || []) as Array<IdentityRow & { recall_checked_at: string | null }>) {
      const vin = (v.vin || "").toUpperCase();
      if (!validVin(vin)) { skipped++; continue; }
      if (!force && v.recall_checked_at && new Date(v.recall_checked_at).getTime() > dayAgo) { skipped++; continue; }
      const r = await resolveRecall(vin, { ymm: v.ymm, mc_attributes: v.mc_attributes, mc_raw: v.mc_raw }, catalogue);
      await persist(admin, tenantId, vin, r, v.recall_status ?? null);
      if (r.vin.state === "VERIFIED_CLEAR") vinVerified++;
      else if (r.vin.state === "OPEN") vinOpen++;
      else vinUnknownCount++;
      await new Promise((res) => setTimeout(res, 250)); // rate-limit courtesy
    }
    return json(200, {
      batch: true,
      vin_verified_clear: vinVerified,
      vin_open: vinOpen,
      vin_unknown: vinUnknownCount,
      catalogue_calls: catalogue.callCount,
      skipped,
    });
  }

  // ── Single VIN ───────────────────────────────────────────────────────
  const vin = String(body.vin || "").toUpperCase().trim();
  if (!vin) return json(400, { recallStatus: "error", error: "vin required" });
  if (!validVin(vin)) return json(400, { recallStatus: "error", error: "invalid_vin", note: "VIN must be 17 chars with no I, O, or Q" });

  // Current state, so a failed re-check never downgrades a known VIN answer.
  let q0 = admin.from("vehicle_listings").select("ymm, mc_attributes, mc_raw, recall_status").eq("vin", vin);
  if (tenantId) q0 = q0.eq("tenant_id", tenantId);
  const { data: row0 } = await q0.maybeSingle();
  const identity = (row0 || {}) as IdentityRow;
  const storedStatus = identity.recall_status ?? null;

  const r = await resolveRecall(
    vin,
    { ymm: identity.ymm ?? null, mc_attributes: identity.mc_attributes, mc_raw: identity.mc_raw },
    new NhtsaModelCatalogue(httpGet),
  );
  const written = await persist(admin, tenantId, vin, r, storedStatus);
  return json(200, { ...response(vin, r), written, preserved_vin_status: written ? null : storedStatus });
});
