// Temporary diagnostic: probe MarketCheck OEM incentive endpoints.
const KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!KEY) return new Response(JSON.stringify({ error: "no key" }), { headers: cors });

  const url = new URL(req.url);
  const zip = url.searchParams.get("zip") || "06040";

  const targets: Record<string, string> = {
    oem_search_basic: `https://api.marketcheck.com/v2/search/car/incentive/oem?api_key=${KEY}&zip=${zip}&radius=100&rows=5`,
    oem_qx80_2025: `https://api.marketcheck.com/v2/search/car/incentive/oem?api_key=${KEY}&zip=${zip}&radius=100&rows=5&make=INFINITI&model=QX80&year=2025&car_type=new`,
    oem_qx_used: `https://api.marketcheck.com/v2/search/car/incentive/oem?api_key=${KEY}&zip=${zip}&radius=100&rows=5&make=INFINITI&model=QX60&year=2023&car_type=used`,
    oem_by_make_zip: `https://api.marketcheck.com/v2/incentive/oem?api_key=${KEY}&zip=${zip}&make=INFINITI`,
    oem_by_make_zip_alt: `https://api.marketcheck.com/v2/incentive/oem/make?api_key=${KEY}&zip=${zip}&make=INFINITI`,
    incentive_vin_qx80: `https://api.marketcheck.com/v2/incentive/car/5N1AL1FS7TC339685?api_key=${KEY}&zip=${zip}`,
    incentive_vin_qx: `https://api.marketcheck.com/v2/incentive/car/3PCAJ5BB1PF113139?api_key=${KEY}&zip=${zip}`,
  };

  const out: Record<string, unknown> = {};
  for (const [name, u] of Object.entries(targets)) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep text */ }
      const redacted = u.replace(KEY, "***");
      out[name] = { url: redacted, status: r.status, body };
    } catch (e) {
      out[name] = { error: String(e) };
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
