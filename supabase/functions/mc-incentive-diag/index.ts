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
    infiniti_make_only: `https://api.marketcheck.com/v2/search/car/incentive/oem?api_key=${KEY}&zip=${zip}&radius=500&rows=5&make=INFINITI`,
    infiniti_make_nat: `https://api.marketcheck.com/v2/search/car/incentive/oem?api_key=${KEY}&rows=5&make=INFINITI`,
    qx80_no_year: `https://api.marketcheck.com/v2/search/car/incentive/oem?api_key=${KEY}&zip=${zip}&radius=500&rows=5&make=INFINITI&model=QX80`,
    qx60_no_year: `https://api.marketcheck.com/v2/search/car/incentive/oem?api_key=${KEY}&zip=${zip}&radius=500&rows=5&make=INFINITI&model=QX60`,
    facets_makes: `https://api.marketcheck.com/v2/search/car/incentive/oem?api_key=${KEY}&zip=${zip}&radius=100&rows=0&facets=make`,
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
