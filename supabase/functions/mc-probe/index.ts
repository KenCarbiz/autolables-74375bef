import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// One-off diagnostic: does NeoVIN return the enhanced installed-options
// breakout for a VIN that currently has options=null in our DB? Confirms the
// decode source works before we back-fill the fleet. Auth: shared cron secret.

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

  const vin = "JN1FV7AR5KM800521"; // a published 2019 Q50 with options=null in our DB
  const urls = [
    { name: "neovin_specs", url: `${MC_BASE}/decode/car/neovin/${vin}/specs?api_key=${MC_KEY}&include_generic=true` },
    { name: "decode_specs", url: `${MC_BASE}/decode/car/${vin}/specs?api_key=${MC_KEY}` },
  ];

  const results: Record<string, unknown>[] = [];
  for (const u of urls) {
    try {
      const res = await fetch(u.url, { signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      let keys: string[] = [];
      let counts: Record<string, number> = {};
      try {
        const j = JSON.parse(text);
        keys = Object.keys(j);
        const arr = (k: string) => (Array.isArray(j[k]) ? j[k].length : (j[k] && typeof j[k] === "object" ? Object.keys(j[k]).length : 0));
        counts = {
          installed_options_details: arr("installed_options_details"),
          options_packages: arr("options_packages"),
          high_value_features: arr("high_value_features"),
          features: arr("features"),
          installed_equipment: arr("installed_equipment"),
        };
      } catch { /* not json */ }
      results.push({ name: u.name, status: res.status, top_keys: keys.slice(0, 40), counts, sample: text.slice(0, 400) });
    } catch (e) {
      results.push({ name: u.name, status: 0, error: String(e).slice(0, 200) });
    }
  }
  return new Response(JSON.stringify({ vin, results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
