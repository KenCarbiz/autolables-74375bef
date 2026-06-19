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

// One MarketCheck AutoRecalls call with a timeout and a single retry.
async function fetchRecalls(vin: string): Promise<{ ok: true; data: Normalized } | { ok: false; reason: string }> {
  const url = `${MC_BASE}/recall/car/${encodeURIComponent(vin)}?api_key=${encodeURIComponent(MC_KEY)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.status === 404) return { ok: true, data: normalize(vin, { recalls: [] }) }; // no data = clear
      if (res.status === 429) { if (attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; } return { ok: false, reason: "rate_limited" }; }
      if (!res.ok) { if (attempt === 0) { await new Promise((r) => setTimeout(r, 600)); continue; } return { ok: false, reason: `provider_error_${res.status}` }; }
      const body = await res.json().catch(() => ({}));
      return { ok: true, data: normalize(vin, body) };
    } catch (_e) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 600)); continue; }
      return { ok: false, reason: "timeout_or_network" };
    }
  }
  return { ok: false, reason: "unknown" };
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
  if (!r.ok) return json(200, { vin, recallStatus: "error", error: r.reason });
  await persist(admin, tenantId, vin, r.data);
  return json(200, r.data);
});
