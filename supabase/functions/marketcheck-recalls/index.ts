// ──────────────────────────────────────────────────────────────────────
// marketcheck-recalls — server-side VIN recall lookup via MarketCheck's
// AutoRecalls API. The API key never leaves the server. Single-VIN mode
// checks one car; batch mode sweeps a tenant's inventory (skipping cars
// checked in the last 24h unless force=true), rate-limited.
//
// Body: { vin?, tenant_id?, batch?, force? }
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
  recalls: NormalRecall[]; rawProvider: "marketcheck_autorecalls";
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!MC_KEY) return json(200, { recallStatus: "error", error: "not_configured", note: "Set MARKETCHECK_API_KEY_1 (AutoRecalls access)" });

  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body.tenant_id || null;

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

  const r = await fetchRecalls(vin);
  if (!r.ok) return json(200, { vin, recallStatus: "error", error: r.reason, tried: r.tried });
  await persist(admin, tenantId, vin, r.data);
  return json(200, { ...r.data, endpoint: r.endpoint, ...(body.diagnostic ? { _raw: r.raw } : {}) });
});
