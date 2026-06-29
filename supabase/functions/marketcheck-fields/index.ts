import { json, preflight } from "../_shared/http.ts";
import { isServiceOrCron } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// marketcheck-fields — one-time field-discovery probe. Hits the live
// MarketCheck account across every car endpoint and returns the COMPLETE,
// flattened list of field paths each one returns for this plan tier, with
// the value type and a truncated sample. This is the authoritative answer to
// "every single piece of data MarketCheck provides for us".
//
// Auth: service-role bearer or the cron secret (NOT public) — it returns live
// inventory data. Call it once, read the field tree, then delete the function.
//
//   curl -X POST https://<project>.functions.supabase.co/marketcheck-fields \
//     -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
//     -H "Content-Type: application/json" \
//     -d '{"vin":"<optional VIN>","zip":"06010","dealer_id":"<optional>"}'
// ──────────────────────────────────────────────────────────────────────

const KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const BASE = "https://api.marketcheck.com/v2";

// deno-lint-ignore no-explicit-any
function flatten(obj: any, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (obj === null || obj === undefined) { out[prefix || "(root)"] = "null"; return out; }
  if (Array.isArray(obj)) {
    out[`${prefix}[] (len)`] = String(obj.length);
    if (obj.length) flatten(obj[0], `${prefix}[]`, out);     // shape from the first element
    return out;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj).sort()) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  const t = typeof obj;
  const sample = String(obj).slice(0, 60);
  out[prefix] = `${t} = ${sample}`;
  return out;
}

async function hit(url: string): Promise<{ ok: boolean; status: number; fields?: Record<string, string>; error?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const status = res.status;
    if (!res.ok) return { ok: false, status, error: (await res.text().catch(() => "")).slice(0, 200) };
    const data = await res.json().catch(() => null);
    return { ok: true, status, fields: flatten(data) };
  } catch (e) {
    return { ok: false, status: 0, error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (!isServiceOrCron(req)) return json(401, { error: "unauthorized" });
  if (!KEY) return json(500, { error: "MARKETCHECK_API_KEY not set" });

  const body = await req.json().catch(() => ({})) as { vin?: string; zip?: string; dealer_id?: string };
  const zip = body.zip || "06010";

  // 1) One active listing — the richest object (build/dealer/media/price/dom/...).
  const searchQ = new URLSearchParams({ api_key: KEY, rows: "1", start: "0", zip, radius: "500", car_type: "used" });
  if (body.dealer_id) searchQ.set("dealer_id", body.dealer_id);
  const search = await hit(`${BASE}/search/car/active?${searchQ}`);

  // Pull a VIN to drive the per-VIN endpoints.
  let vin = (body.vin || "").toUpperCase().trim();
  if (!vin && search.ok && search.fields) {
    // re-fetch the raw listing to read the VIN (flatten hides values past 60 chars; VIN is short)
    try {
      const res = await fetch(`${BASE}/search/car/active?${searchQ}`, { signal: AbortSignal.timeout(20000) });
      const d = await res.json();
      vin = (d?.listings?.[0]?.vin || "").toUpperCase();
    } catch { /* ignore */ }
  }

  const out: Record<string, unknown> = {
    probed_at_note: "Field paths your MarketCheck tier returns. `x[]` = array; nested via dots.",
    vin_used: vin || null,
    endpoints: {},
  };
  const ep = out.endpoints as Record<string, unknown>;
  ep["search/car/active (listing object)"] = search;

  if (vin) {
    ep["decode/car/neo/{vin}/specs (NeoVIN)"]   = await hit(`${BASE}/decode/car/neo/${vin}/specs?api_key=${KEY}`);
    ep["decode/car/{vin}/specs (basic)"]        = await hit(`${BASE}/decode/car/${vin}/specs?api_key=${KEY}`);
    ep["decode/car/{vin}/options (packages)"]   = await hit(`${BASE}/decode/car/${vin}/options?api_key=${KEY}`);
    ep["history/car/{vin}"]                      = await hit(`${BASE}/history/car/${vin}?api_key=${KEY}`);
    ep["recall/car/{vin}"]                       = await hit(`${BASE}/recall/car/${vin}?api_key=${KEY}`);
    ep["predict/car/price"]                      = await hit(`${BASE}/predict/car/price?api_key=${KEY}&vin=${vin}&miles=40000&zip=${zip}&car_type=used`);
    ep["mds/car"]                                = await hit(`${BASE}/mds/car?api_key=${KEY}&vin=${vin}&latitude=41.6&longitude=-72.9&radius=100`);
  }

  // Stats + facets shape (separate call so the listing object stays clean).
  ep["search/car/active?stats+facets (analytics shape)"] =
    await hit(`${BASE}/search/car/active?api_key=${KEY}&rows=0&zip=${zip}&radius=100&stats=price,miles,dom&facets=make,inventory_type,dealer_type`);

  return json(200, out);
});
