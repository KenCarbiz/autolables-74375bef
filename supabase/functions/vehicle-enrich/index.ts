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

// Market Days Supply is plan-gated on MarketCheck — it returns nothing on the
// Basic tier (the Data Health "Days supply" column stays empty for every car),
// so firing it on every enrich just burns ~1/6 of the per-VIN call budget for
// data that never lands. Off by default; set ENRICH_INCLUDE_MDS=true only on a
// plan that actually serves /mds/car.
const INCLUDE_MDS = (Deno.env.get("ENRICH_INCLUDE_MDS") || "false").toLowerCase() === "true";

// One 429-aware GET. MarketCheck throttles per second; on a 429 we wait briefly
// and retry once so a transient rate-limit doesn't get mistaken for "no data"
// and silently null out a signal — which would mark the car incomplete and
// trigger a wasteful full re-pull, the opposite of what we want on a metered
// (Basic) plan. Returns null on transport error or a persistent 429.
async function mcFetch(url: string, timeoutMs: number): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      return res;
    } catch { return null; }
  }
  return null;
}

// ── MarketCheck: predicted market value + range ────────────────
async function fetchPredict(vin: string, miles: number | null) {
  try {
    const p = new URLSearchParams({ api_key: MC_KEY, vin });
    if (miles != null) p.set("miles", String(miles));
    const res = await mcFetch(`${MC_BASE}/predict/car/price?${p.toString()}`, 10000);
    if (!res || !res.ok) return null;
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
// Comparables are SIMILAR cars (same year/make/model in the tenant's market),
// NOT the subject VIN — searching active listings by `vin` returns only that
// one car, which is why this used to come back empty. Search by ymm, then drop
// the subject VIN from the results.
async function fetchComps(ymm: string | null, condition: string, zip: string | null, listingPrice: number | null, subjectVin: string) {
  try {
    if (!ymm) return null;
    const parts = ymm.split(/\s+/);
    const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
    const make = year ? parts[1] : parts[0];
    const model = year ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
    const carType = condition === "new" ? "new" : "used";

    // One MarketCheck active-search pass. Returns null on transport error so the
    // caller can distinguish "no listings" (retry wider) from "request failed".
    const run = async (opts: { useYear: boolean; useZip: boolean }) => {
      const p = new URLSearchParams({ api_key: MC_KEY, car_type: carType, rows: "25", sort_by: "price", sort_order: "asc", stats: "price,dom" });
      if (opts.useYear && year) p.set("year", year);
      if (make) p.set("make", make);
      if (model) p.set("model", model);
      if (opts.useZip && zip) { p.set("zip", zip); p.set("radius", "150"); }
      const res = await mcFetch(`${MC_BASE}/search/car/active?${p.toString()}`, 10000);
      if (!res || !res.ok) return null;
      // deno-lint-ignore no-explicit-any
      const b: any = await res.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      const rows: any[] = (Array.isArray(b?.listings) ? b.listings : []).filter((l: any) => String(l.vin || "").toUpperCase() !== subjectVin);
      return { b, rows, radius: opts.useZip && zip ? 150 : null };
    };

    // Prefer local same-year comps; widen to national, then to all model years,
    // so an oddball used trade-in (off-brand, rare config) still gets a price set
    // instead of an empty Comparables column.
    let r = await run({ useYear: true, useZip: true });
    if (r && r.rows.length === 0) r = (await run({ useYear: true, useZip: false })) ?? r;
    if (r && r.rows.length === 0) r = (await run({ useYear: false, useZip: false })) ?? r;
    if (!r) return null;

    const comparables = r.rows.slice(0, 16).map((l) => ({
      vin: l.vin ?? null,
      ymm: l.heading ?? ([l.build?.year, l.build?.make, l.build?.model].filter(Boolean).join(" ") || null),
      trim: l.build?.trim ?? null,
      miles: num(l.miles),
      price: num(l.price),
      dist: num(l.dist),
      dealer: l.dealer?.name ?? l.seller_name ?? null,
      dom: num(l.dom),
      image: l.media?.photo_links?.[0] ?? null,
    })).filter((c) => c.price != null);
    const stats = r.b?.stats?.price || {};
    const domStats = r.b?.stats?.dom || {};
    const count = num(r.b?.num_found) ?? comparables.length;
    const cheaper = listingPrice != null ? comparables.filter((c) => c.price != null && (c.price as number) < listingPrice).length : null;
    const percentile = listingPrice != null && comparables.length ? Math.round((cheaper! / comparables.length) * 100) : null;
    const meta = {
      similar_count: count,
      search_radius: r.radius,                 // null = widened to national fallback
      price_percentile: percentile,            // % of comps priced below this vehicle
      avg_dom: num(domStats.mean ?? domStats.median),
      market_days_supply: null as number | null,  // filled by fetchMds when the plan supports it
      inventory_count: count,
      checked_at: new Date().toISOString(),
    };
    return { comparables, meta, stats };
  } catch { return null; }
}

// ── MarketCheck: VIN listing history ───────────────────────────
// GET /v2/history/car/{vin} → every past listing of this VIN (price, miles,
// seller_type, inventory_type, dealer, source, vdp_url, first/last seen). We
// derive an honest ownership/listing timeline, a real price+miles history, and
// an estimated in-service date (first time the VIN was ever seen new). All
// best-effort — absent data stays null and the Passport shows a pending state.
async function fetchHistory(vin: string) {
  try {
    const res = await mcFetch(`${MC_BASE}/history/car/${encodeURIComponent(vin)}?api_key=${encodeURIComponent(MC_KEY)}`, 12000);
    if (!res || !res.ok) return null;
    // deno-lint-ignore no-explicit-any
    const b: any = await res.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const raw: any[] = Array.isArray(b?.listings) ? b.listings : Array.isArray(b) ? b : [];
    if (!raw.length) return { available: false, entries: [], owners: null, inServiceDate: null, firstSeen: null };
    // deno-lint-ignore no-explicit-any
    const ts = (l: any) => Number(l.last_seen_at ?? l.first_seen_at ?? l.seen_at ?? 0) || (l.last_seen_at_date ? Date.parse(l.last_seen_at_date) / 1000 : 0);
    const entries = raw.map((l) => ({
      price: num(l.price),
      miles: num(l.miles),
      seller_type: l.seller_type ?? null,
      inventory_type: l.inventory_type ?? null,
      dealer: l.dealer?.name ?? l.seller_name ?? null,
      source: l.source ?? null,
      vdp_url: l.vdp_url ?? null,
      first_seen: l.first_seen_at_date ?? (l.first_seen_at ? new Date(Number(l.first_seen_at) * 1000).toISOString() : null),
      last_seen: l.last_seen_at_date ?? (l.last_seen_at ? new Date(Number(l.last_seen_at) * 1000).toISOString() : null),
      _ts: ts(l),
    })).sort((a, z) => a._ts - z._ts);
    // Ownership estimate: count distinct dealer/seller spells across time (a
    // new seller after a prior one implies a change of hands). Honest floor of 1.
    let owners = 0;
    let prevDealer: string | null = null;
    for (const e of entries) {
      const who = (e.dealer || e.seller_type || "").toString().trim().toLowerCase();
      if (who && who !== prevDealer) { owners++; prevDealer = who; }
    }
    const firstSeen = entries.find((e) => e.first_seen)?.first_seen ?? null;
    // In-service date ≈ first time this VIN appeared as a NEW car (warranty
    // clock starts at first retail sale; first-new-listing is the closest
    // defensible proxy available from listing data).
    const firstNew = entries.find((e) => String(e.inventory_type || "").toLowerCase() === "new");
    const inServiceDate = firstNew?.first_seen ?? firstSeen;
    return {
      available: true,
      entries: entries.map(({ _ts, ...e }) => e),
      owners: owners > 0 ? owners : 1,
      inServiceDate,
      firstSeen,
      checked_at: new Date().toISOString(),
      source: "marketcheck",
    };
  } catch { return null; }
}

// ── MarketCheck: Market Days Supply for this ymm in the tenant's market ──
// GET /v2/mds/car scoped by ymm + zip + radius → how fast comparable cars sell
// regionally (lower MDS = hotter demand). Shares Inventory-Search params.
async function fetchMds(ymm: string | null, condition: string, zip: string | null) {
  try {
    if (!ymm) return null;
    const parts = ymm.split(/\s+/);
    const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
    const make = year ? parts[1] : parts[0];
    const model = year ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
    const p = new URLSearchParams({ api_key: MC_KEY, car_type: condition === "new" ? "new" : "used" });
    if (year) p.set("year", year);
    if (make) p.set("make", make);
    if (model) p.set("model", model);
    if (zip) { p.set("zip", zip); p.set("radius", "150"); }
    const res = await mcFetch(`${MC_BASE}/mds/car?${p.toString()}`, 10000);
    if (!res || !res.ok) return null;
    // deno-lint-ignore no-explicit-any
    const b: any = await res.json().catch(() => ({}));
    return {
      mds: num(b.mds ?? b.market_days_supply ?? b.days_supply),
      count: num(b.count ?? b.inventory_count ?? b.total),
      checked_at: new Date().toISOString(),
    };
  } catch { return null; }
}

// ── MarketCheck: VIN recall lookup ─────────────────────────────
async function fetchRecalls(vin: string) {
  try {
    const res = await mcFetch(`${MC_BASE}/recall/car/${encodeURIComponent(vin)}?api_key=${encodeURIComponent(MC_KEY)}`, 10000);
    if (!res || !res.ok) return null;
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

  if (!MC_KEY) return json(200, { ok: false, reason: "marketcheck_not_configured" });

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string; zip?: string };
  const tenantId = body.tenant_id;
  const vin = (body.vin || "").trim().toUpperCase();
  if (!tenantId || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return json(400, { error: "tenant_id and valid vin required" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Auth gate ───────────────────────────────────────────────
  // Accepted credentials, matching marketcheck-sync:
  //   - service-role bearer (the internal sync → enrich call)
  //   - x-cron-secret header (pg_cron)
  //   - a real user JWT for a platform admin OR a member of this tenant
  //     (the per-VIN "Re-pull market data" button calls this from the browser)
  const authToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const secret = req.headers.get("x-cron-secret") || "";
  const isServiceRole = !!SERVICE_KEY && authToken === SERVICE_KEY;
  const hasCronSecret = !!CRON_SECRET && secret === CRON_SECRET;
  if (!isServiceRole && !hasCronSecret) {
    const { data: ures, error: uerr } = await admin.auth.getUser(authToken);
    const userId = ures?.user?.id;
    if (uerr || !userId) return json(401, { error: "authentication required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId)
        .not("accepted_at", "is", null).maybeSingle();
      if (!membership) return json(403, { error: "not a member of this tenant" });
    }
  }

  const { data: row } = await admin.from("vehicle_listings")
    .select("id, vin, ymm, condition, price, mileage, dealer_snapshot")
    .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  if (!row) return json(404, { error: "listing_not_found" });

  const miles = num(row.mileage);
  const price = num(row.price);
  const condition = String(row.condition || "used");
  // deno-lint-ignore no-explicit-any
  const zip = body.zip || (row.dealer_snapshot as any)?.zip || null;

  const ymm = (row.ymm as string | null) || null;

  const [predict, comps, mds, history, recalls, blackbook] = await Promise.all([
    fetchPredict(vin, miles),
    fetchComps(ymm, condition, zip, price, vin),
    INCLUDE_MDS ? fetchMds(ymm, condition, zip) : Promise.resolve(null),
    fetchHistory(vin),
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
  if (comps) {
    patch.comparables = comps.comparables;
    // Fold the regional Market Days Supply into market_meta so the Passport's
    // demand/trend surfaces have a real figure instead of a null placeholder.
    patch.market_meta = mds?.mds != null
      ? { ...comps.meta, market_days_supply: mds.mds, inventory_count: mds.count ?? comps.meta.inventory_count }
      : comps.meta;
  } else if (mds?.mds != null) {
    patch.market_meta = { market_days_supply: mds.mds, inventory_count: mds.count, checked_at: mds.checked_at };
  }
  if (history) {
    patch.history_payload = history;
    if (history.inServiceDate) patch.in_service_date = history.inServiceDate;
  }
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
    pulled: {
      predict: !!predict,
      comparables: comps?.comparables.length ?? 0,
      market_days_supply: mds?.mds ?? null,
      history: history?.available ? (history.entries?.length ?? 0) : 0,
      owners: history?.owners ?? null,
      in_service_date: history?.inServiceDate ?? null,
      recalls: !!recalls,
      open_recalls: recalls?.open_recall_count ?? null,
      blackbook: !!blackbook,
    },
  });
});
