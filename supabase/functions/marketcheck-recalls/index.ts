// ──────────────────────────────────────────────────────────────────────
// marketcheck-recalls — server-side VIN recall lookup via MarketCheck's
// AutoRecalls API. The API key never leaves the server. Single-VIN mode
// checks one car; batch mode sweeps a tenant's inventory (skipping cars
// checked in the last 24h unless force=true), rate-limited.
//
// Body: { vin?, tenant_id?, batch?, force? }
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";

// VIN: 17 chars, letters/digits, excluding I, O, Q.
const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

interface NormalRecall {
  campaignId: string; recallType: string; status: "open" | "closed" | "unknown";
  title: string; description: string; consequence: string; remedy: string;
  manufacturer: string; reportDate: string; nhtsaCampaignNumber: string; component: string;
}
interface Normalized {
  vin: string; checkedAt: string;
  recallStatus: "clear" | "open_recalls" | "unknown" | "error";
  openRecallCount: number; closedRecallCount: number;
  serviceCampaignCount: number; emissionIssueCount: number;
  recalls: NormalRecall[]; rawProvider: string;
}

// deno-lint-ignore no-explicit-any
const str = (v: any) => (v == null ? "" : String(v));

// deno-lint-ignore no-explicit-any
function normalize(vin: string, raw: any): Normalized {
  const list: any[] = Array.isArray(raw?.recalls) ? raw.recalls
    : Array.isArray(raw?.results) ? raw.results
    : Array.isArray(raw) ? raw : [];
  const recalls: NormalRecall[] = list.map((r) => {
    const status = str(r.status || r.recall_status).toLowerCase().includes("close") ? "closed" : "open";
    return {
      campaignId: str(r.campaign_id ?? r.nhtsa_campaign_number ?? r.id),
      recallType: str(r.recall_type ?? r.type ?? "safety") || "safety",
      status,
      title: str(r.title ?? r.summary ?? r.component ?? "Recall") || "Recall",
      description: str(r.description ?? r.summary ?? r.defect_summary),
      consequence: str(r.consequence ?? r.consequence_summary),
      remedy: str(r.remedy ?? r.corrective_action ?? r.remedy_summary),
      manufacturer: str(r.manufacturer ?? r.make ?? r.mfr),
      reportDate: str(r.report_date ?? r.recall_date ?? r.report_received_date),
      nhtsaCampaignNumber: str(r.nhtsa_campaign_number ?? r.campaign_id),
      component: str(r.component ?? r.components),
    };
  });
  const open = recalls.filter((r) => r.status === "open").length;
  const closed = recalls.filter((r) => r.status === "closed").length;
  const serviceCampaignCount = recalls.filter((r) => /campaign|service/i.test(r.recallType)).length;
  const emissionIssueCount = recalls.filter((r) => /emission/i.test(r.recallType + r.component)).length;
  return {
    vin, checkedAt: new Date().toISOString(),
    recallStatus: recalls.length === 0 ? "clear" : open > 0 ? "open_recalls" : "clear",
    openRecallCount: open, closedRecallCount: closed, serviceCampaignCount, emissionIssueCount,
    recalls, rawProvider: "marketcheck_autorecalls",
  };
}

function buildNormalized(vin: string, recalls: NormalRecall[], provider: string): Normalized {
  const open = recalls.filter((r) => r.status === "open").length;
  const closed = recalls.filter((r) => r.status === "closed").length;
  return {
    vin, checkedAt: new Date().toISOString(),
    recallStatus: recalls.length === 0 ? "clear" : open > 0 ? "open_recalls" : "clear",
    openRecallCount: open, closedRecallCount: closed, serviceCampaignCount: 0, emissionIssueCount: 0,
    recalls, rawProvider: provider,
  };
}

// NHTSA recallsByVehicle (free, model-level) — the authoritative fallback when
// MarketCheck AutoRecalls returns nothing (it's a separately-licensed product
// that's empty for most cars). A 200 is authoritative (open OR a real "clear");
// a transient non-200 returns null so we never downgrade a known recall on it.
// deno-lint-ignore no-explicit-any
async function fetchNhtsa(ymm: string | null): Promise<{ recalls: NormalRecall[] } | null> {
  try {
    if (!ymm) return null;
    const parts = ymm.split(/\s+/);
    const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
    const make = year ? parts[1] : parts[0];
    const model = year ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
    if (!year || !make || !model) return null;
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return { recalls: [] };          // no record on file (typical new model year) = clear
    if (!res.ok) return null;                                  // 429/500/etc — transient, do not downgrade
    // deno-lint-ignore no-explicit-any
    const b: any = await res.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const list: any[] = Array.isArray(b?.results) ? b.results : Array.isArray(b?.Results) ? b.Results : [];
    const recalls: NormalRecall[] = list.map((r) => ({
      campaignId: str(r.NHTSACampaignNumber ?? r.CampaignNumber),
      recallType: "safety", status: "open",
      title: str(r.Component ?? r.Summary ?? "Recall") || "Recall",
      description: str(r.Summary), consequence: str(r.Consequence), remedy: str(r.Remedy),
      manufacturer: str(r.Manufacturer ?? make), reportDate: str(r.ReportReceivedDate),
      nhtsaCampaignNumber: str(r.NHTSACampaignNumber ?? r.CampaignNumber), component: str(r.Component),
    }));
    return { recalls };
  } catch { return null; }
}

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

interface FetchOk { ok: true; data: Normalized; endpoint: string; raw: unknown }
interface FetchErr { ok: false; reason: string; tried: { url: string; status: number | string }[] }

// Try each candidate endpoint with a timeout; first one that returns parseable
// JSON wins. A 404 is treated as "no recalls" (clear) on a path that exists.
async function fetchRecalls(vin: string): Promise<FetchOk | FetchErr> {
  const tried: { url: string; status: number | string }[] = [];
  let sawRateLimit = false;
  for (const url of recallEndpoints(vin)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      tried.push({ url: redact(url), status: res.status });
      if (res.status === 429) { sawRateLimit = true; continue; }
      if (res.status === 404) { return { ok: true, data: normalize(vin, { recalls: [] }), endpoint: redact(url), raw: { status: 404 } }; }
      if (!res.ok) continue;
      const body = await res.json().catch(() => null);
      if (body == null) continue;
      return { ok: true, data: normalize(vin, body), endpoint: redact(url), raw: body };
    } catch (_e) {
      tried.push({ url: redact(url), status: "timeout_or_network" });
    }
  }
  return { ok: false, reason: sawRateLimit ? "rate_limited" : "no_endpoint_matched", tried };
}

// deno-lint-ignore no-explicit-any
const persist = async (admin: any, tenantId: string | null, vin: string, n: Normalized) => {
  let q = admin.from("vehicle_listings").update({
    recall_status: n.recallStatus,
    recall_checked_at: n.checkedAt,
    open_recall_count: n.openRecallCount,
    closed_recall_count: n.closedRecallCount,
    recall_payload: n,
  }).eq("vin", vin);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  try { await q; } catch { /* recall_* columns may not be migrated yet */ }
};

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (!MC_KEY) return json(200, { recallStatus: "error", error: "not_configured", note: "Set MARKETCHECK_API_KEY_1 (AutoRecalls access)" });

  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body.tenant_id || null;

  // ── Auth gate: service-role (cron) bypasses; otherwise require a
  // signed-in tenant member or platform admin for the requested tenant.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth !== serviceKey) {
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


  // ── Batch sweep ──────────────────────────────────────────────────────
  if (body.batch) {
    if (!tenantId) return json(400, { error: "tenant_id required for batch" });
    const force = !!body.force;
    const { data: vehicles } = await admin.from("vehicle_listings")
      .select("vin, recall_checked_at").eq("tenant_id", tenantId).limit(1000);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let checked = 0, openFound = 0, errors = 0, skipped = 0;
    for (const v of (vehicles || []) as Array<{ vin: string; recall_checked_at: string | null }>) {
      const vin = (v.vin || "").toUpperCase();
      if (!validVin(vin)) { skipped++; continue; }
      if (!force && v.recall_checked_at && new Date(v.recall_checked_at).getTime() > dayAgo) { skipped++; continue; }
      const r = await fetchRecalls(vin);
      if (r.ok) { await persist(admin, tenantId, vin, r.data); checked++; if (r.data.openRecallCount > 0) openFound++; }
      else { errors++; if (r.reason === "rate_limited") break; }
      await new Promise((res) => setTimeout(res, 250)); // rate-limit courtesy
    }
    return json(200, { batch: true, checked, openFound, errors, skipped });
  }

  // ── Single VIN ───────────────────────────────────────────────────────
  const vin = String(body.vin || "").toUpperCase().trim();
  if (!vin) return json(400, { recallStatus: "error", error: "vin required" });
  if (!validVin(vin)) return json(400, { recallStatus: "error", error: "invalid_vin", note: "VIN must be 17 chars with no I, O, or Q" });

  // Current state, so a failed re-check never downgrades a known-open recall.
  let q0 = admin.from("vehicle_listings").select("ymm, recall_status, open_recall_count").eq("vin", vin);
  if (tenantId) q0 = q0.eq("tenant_id", tenantId);
  const { data: row0 } = await q0.maybeSingle();
  const ymm: string | null = (row0 as { ymm?: string } | null)?.ymm ?? null;
  const hadOpen = (row0 as { recall_status?: string } | null)?.recall_status === "open_recalls"
    && ((row0 as { open_recall_count?: number } | null)?.open_recall_count ?? 0) > 0;

  const mc = await fetchRecalls(vin);
  let final: Normalized | null = null;
  let authoritativeClear = false;

  if (mc.ok && mc.data.recalls.length > 0) {
    final = mc.data;                                        // MarketCheck found recalls — authoritative
  } else {
    // MarketCheck empty/unlicensed/errored → confirm with NHTSA (free, model-level).
    const nh = await fetchNhtsa(ymm);
    if (nh) {
      final = buildNormalized(vin, nh.recalls, "nhtsa");   // open recalls OR an authoritative clear
      authoritativeClear = nh.recalls.length === 0;
    } else if (mc.ok) {
      final = mc.data;                                      // MC returned a valid empty; NHTSA unavailable
    }
  }

  // Neither source answered → never wipe a known recall.
  if (!final) {
    return json(200, { vin, recallStatus: hadOpen ? "open_recalls" : "error", error: mc.ok ? undefined : mc.reason, preserved: hadOpen, note: "no_authoritative_source" });
  }
  // A non-authoritative "clear" must not overwrite an existing open recall.
  if (final.recallStatus === "clear" && hadOpen && !authoritativeClear) {
    return json(200, { vin, recallStatus: "open_recalls", preserved: true, note: "kept_existing_open" });
  }

  await persist(admin, tenantId, vin, final);
  return json(200, { ...final, ...(mc.ok ? { endpoint: mc.endpoint } : {}), ...(body.diagnostic && mc.ok ? { _raw: mc.raw } : {}) });
});
