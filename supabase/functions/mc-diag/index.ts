// One-off MarketCheck diagnostic. Returns HTTP status + tiny field summary
// for active inventory, price predict, recall, and specs decode per VIN.
const MC = Deno.env.get("MARKETCHECK_API_KEY_1") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

async function hit(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let body: any = null; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    return { status: r.status, body };
  } catch (e) { return { status: "ERR", body: String(e) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!MC) return new Response(JSON.stringify({ error: "no key" }), { headers: cors });
  const vins = ["5N1AL1FS7TC339685", "3PCAJ5BB1PF113139"];
  const out: any = {};
  for (const vin of vins) {
    const inv = await hit(`https://api.marketcheck.com/v2/search/car/active?api_key=${MC}&vin=${vin}`);
    const price = await hit(`https://api.marketcheck.com/v2/predict/car/price?api_key=${MC}&vin=${vin}`);
    const recall = await hit(`https://mc-api.marketcheck.com/v2/recall/car/${vin}?api_key=${MC}`);
    const decode = await hit(`https://api.marketcheck.com/v2/decode/car/${vin}/specs?api_key=${MC}`);
    // Summarize
    const first = inv.body?.listings?.[0] || null;
    out[vin] = {
      inventory: { status: inv.status, num_found: inv.body?.num_found, price: first?.price, dom: first?.dom, msrp: first?.msrp, dealer: first?.dealer?.name, source_url: first?.vdp_url },
      price_predict: { status: price.status, predicted: price.body?.predicted_price ?? price.body?.price, range: price.body?.price_range, err: price.body?.error || price.body?.message },
      recall: { status: recall.status, count: Array.isArray(recall.body?.recalls) ? recall.body.recalls.length : (recall.body?.recall_count ?? null), sample: Array.isArray(recall.body?.recalls) ? recall.body.recalls.slice(0,2).map((r:any)=>({ camp: r.nhtsa_campaign_number || r.campaign_number, comp: r.component, sum: (r.summary||"").slice(0,80) })) : recall.body?.error || (typeof recall.body === "string" ? recall.body : null) },
      decode: { status: decode.status, ymm: decode.body?.build ? `${decode.body.build.year} ${decode.body.build.make} ${decode.body.build.model}` : null, err: decode.body?.error || (typeof decode.body === "string" ? decode.body.slice(0,120) : null) },
    };
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
});
