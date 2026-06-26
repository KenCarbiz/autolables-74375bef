import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// vehicle-enrich — pull EVERYTHING for one VIN at ingest and persist it.
//
// Called per vehicle as it lands in inventory (from marketcheck-sync) and
// from Admin "re-enrich". For a (tenant_id, vin) it gathers, in parallel:
//   • MarketCheck predict/car/price  → market value, low/high, position
//   • MarketCheck search/car/active  → comparables + price stats + market_meta
//                                       (percentile, radius, similar_count, avg_dom)
//   • MarketCheck recalls (VIN)      → recall status + campaigns
//   • Black Book (blackbook-values)  → trade/retail/wholesale by condition
// then writes market_payload, market_value, market_position, market_checked_at,
// market_meta, comparables, recall_status/open_recall_count/recall_payload,
// blackbook, enriched_at, and appends a vehicle_value_history snapshot.
//
// Everything is best-effort and isolated — a failing provider leaves the rest
// intact and the column simply stays null (the Passport shows an honest
// pending state). Never throws back into the caller's ingest loop.
//
// Auth: service-role bearer OR the shared MARKETCHECK_CRON_SECRET header.
// Body: { tenant_id, vin, zip?, force? }  (zip refines comp/value geography)
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
const num = (v: any): number | null => { if (v == null) return null; const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };

// ── MarketCheck: predicted market value + range ────────────────
async function fetchPredict(vin: string, miles: number | null) {
  try {
    const p = new URLSearchParams({ api_key: MC_KEY, vin });
    if (miles != null) p.set("miles", String(miles));
    const res = await fetch(`${MC_BASE}/predict/car/price?${p.toString()}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    // deno-lint-ignore no-explicit-any
    const b: any = await res.json().catch(() => ({}));
    return {
      market_value: num(b.predicted_price ?? b.price ?? b.market_price ?? b.mean_price ?? b.price_stats?.mean),
      low: num(b.price_range?.lower_bound ?? b.price_range?.low ?? b.min_price ?? b.price_stats?.min),
      high: num(b.price_range?.upper_bound ?? b.price_range?.high ?? b.max_price ?? b.price_stats?.max),
      raw: b,
    };
  } catch { return null; }
}

// ── MarketCheck: comparable active listings + price stats + market context ──
async function fetchComps(vin: string, condition: string, zip: string | null, listingPrice: number | null) {
  try {
    const p = new URLSearchParams({ api_key: MC_KEY, car_type: condition === "new" ? "new" : "used", rows: "20", sort_by: "price", sort_order: "asc", stats: "price,dom" });
    p.set("vin", vin);
    const radius = 150;
    if (zip) { p.set("zip", zip); p.set("radius", String(radius)); }
    const res = await fetch(`${MC_BASE}/search/car/active?${p.toString()}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    // deno-lint-ignore no-explicit-any
    const b: any = await res.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const rows: any[] = Array.isArray(b?.listings) ? b.listings : [];
    const comparables = rows.slice(0, 16).map((l) => ({
      vin: l.vin ?? null,
      ymm: l.heading ?? [l.build?.year, l.build?.make, l.build?.model].filter(Boolean).join(" ") || null,
      trim: l.build?.trim ?? null,
      miles: num(l.miles),
      price: num(l.price),
      dist: num(l.dist),
      dealer: l.dealer?.name ?? l.seller_name ?? null,
      dom: num(l.dom),
      image: l.media?.photo_links?.[0] ?? null,
    })).filter((c) => c.price != null);
    const stats = b?.stats?.price || {};
    const domStats = b?.stats?.dom || {};
    const count = num(b?.num_found) ?? comparables.length;
    const cheaper = listingPrice != null ? comparables.filter((c) => c.price != null && (c.price as number) < listingPrice).length : null;
    const percentile = listingPrice != null && comparables.length ? Math.round((cheaper! / comparables.length) * 100) : null;
    const meta = {
      similar_count: count,
      search_radius: zip ? radius : null,
      price_percentile: percentile,           // % of comps priced below this vehicle
      avg_dom: num(domStats.mean ?? domStats.median),
      market_days_supply: null as number | null,  // requires MarketCheck stats plan; left null when absent
      inventory_count: count,
      checked_at: new Date().toISOString(),
    };
    return { comparables, meta, stats };
  } catch { return null; }
}

// ── MarketCheck: VIN recall lookup ─────────────────────────────
async function fetchRecalls(vin: string) {
  try {
    const res = await fetch(`${MC_BASE}/recall/car/${encodeURIComponent(vin)}?api_key=${encodeURIComponent(MC_KEY)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    // deno-lint-ignore no-explicit-any
    const b: any = await res.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const list: any[] = Array.isArray(b?.recalls) ? b.recalls : Array.isArray(b) ? b : [];
    const open = list.filter((r) => !String(r.status || r.recall_status || "").toLowerCase().includes("close"));
    return {
      recall_status: list.length === 0 ? "clear" : open.length ? "open_recalls" : "clear",
      open_recall_count: open.length,
      recall_payload: { campaigns: list, checked_at: new Date().toISOString(), source: "marketcheck" },
    };
  } catch { return null; }
}

// ── Black Book via blackbook-values ────────────────────────────
async function fetchBlackBook(vin: string, miles: number | null, zip: string | null) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/blackbook-values`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ vin, mileage: miles ?? 0, zip }),
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return null;
    const b = await res.json().catch(() => null);
    return b && b.available ? b : null;
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const auth = req.headers.get("authorization") || "";
  const secret = req.headers.get("x-cron-secret") || "";
  const ok = (SERVICE_KEY && auth === `Bearer ${SERVICE_KEY}`) || (CRON_SECRET && secret === CRON_SECRET);
  if (!ok) return json(401, { error: "unauthorized" });
  if (!MC_KEY) return json(200, { ok: false, reason: "marketcheck_not_configured" });

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string; zip?: string };
  const tenantId = body.tenant_id;
  const vin = (body.vin || "").trim().toUpperCase();
  if (!tenantId || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return json(400, { error: "tenant_id and valid vin required" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: row } = await admin.from("vehicle_listings")
    .select("id, vin, ymm, condition, price, mileage, dealer_snapshot")
    .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  if (!row) return json(404, { error: "listing_not_found" });

  const miles = num(row.mileage);
  const price = num(row.price);
  const condition = String(row.condition || "used");
  // deno-lint-ignore no-explicit-any
  const zip = body.zip || (row.dealer_snapshot as any)?.zip || null;

  const [predict, comps, recalls, blackbook] = await Promise.all([
    fetchPredict(vin, miles),
    fetchComps(vin, condition, zip, price),
    fetchRecalls(vin),
    fetchBlackBook(vin, miles, zip),
  ]);

  const patch: Record<string, unknown> = { enriched_at: new Date().toISOString() };

  if (predict?.market_value != null) {
    const mv = predict.market_value;
    const belowMarket = price != null && mv != null ? Math.round(mv - price) : 0;
    const position = price == null || mv == null ? "unknown" : price <= mv * 0.97 ? "below_market" : price >= mv * 1.03 ? "above_market" : "at_market";
    patch.market_value = mv;
    patch.market_position = position;
    patch.market_checked_at = new Date().toISOString();
    patch.market_payload = { marketValue: mv, low: predict.low, high: predict.high, belowMarket, position, checked_at: new Date().toISOString(), raw: predict.raw };
  }
  if (comps) { patch.comparables = comps.comparables; patch.market_meta = comps.meta; }
  if (recalls) { patch.recall_status = recalls.recall_status; patch.open_recall_count = recalls.open_recall_count; patch.recall_payload = recalls.recall_payload; }
  if (blackbook) patch.blackbook = blackbook;

  // Persist (each column already migrated; isolate so a missing column can't 500).
  try { await admin.from("vehicle_listings").update(patch).eq("id", row.id); } catch { /* column not migrated yet */ }

  // Value-history snapshot for the price/market timeline.
  if (price != null || patch.market_value != null) {
    await admin.from("vehicle_value_history").insert({
      tenant_id: tenantId, vin, source: "vehicle_enrich",
      listing_price: price, market_value: patch.market_value ?? null,
      below_market: (patch.market_payload as { belowMarket?: number } | undefined)?.belowMarket ?? null,
      position: (patch.market_payload as { position?: string } | undefined)?.position ?? null,
      captured_at: new Date().toISOString(),
    }).then(() => undefined, () => undefined);
  }

  return json(200, {
    ok: true, vin,
    pulled: { predict: !!predict, comparables: comps?.comparables.length ?? 0, recalls: !!recalls, blackbook: !!blackbook },
  });
});
