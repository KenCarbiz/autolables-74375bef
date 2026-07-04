import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// One-off entitlement probe: answers whether the account's MarketCheck plan
// includes sold/off-market data (sales stats + recents) before we build the
// sold-comps feature on it. Hits each candidate endpoint once and returns the
// raw status + a trimmed body. Auth: shared cron secret only.

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";
const CRON_SECRET = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const secret = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const probes: { name: string; url: string }[] = [
    { name: "sales_stats_ymm", url: `${MC_BASE}/sales/car?api_key=${MC_KEY}&make=infiniti&model=q50&year=2021&geo=state:CT` },
    { name: "sales_stats_plain", url: `${MC_BASE}/sales/car?api_key=${MC_KEY}&make=infiniti&model=q50&year=2021` },
    { name: "recents_search", url: `${MC_BASE}/search/car/recents?api_key=${MC_KEY}&make=infiniti&model=q50&year=2021&rows=2` },
    { name: "active_control", url: `${MC_BASE}/search/car/active?api_key=${MC_KEY}&make=infiniti&model=q50&year=2021&rows=1` },
  ];

  const results: Record<string, unknown>[] = [];
  for (const p of probes) {
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(15000) });
      const body = await res.text();
      results.push({ name: p.name, status: res.status, body: body.slice(0, 600) });
    } catch (e) {
      results.push({ name: p.name, status: 0, body: String(e).slice(0, 200) });
    }
  }
  return new Response(JSON.stringify({ results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
