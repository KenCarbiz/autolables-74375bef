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

// Market Days Supply (/mds/car) — active inventory ÷ 45-day sales rate for the
// car's ymm in the local market. It DOES serve on the Basic tier, so it's on by
// default; set ENRICH_INCLUDE_MDS=false to skip it on a plan that doesn't.
const INCLUDE_MDS = (Deno.env.get("ENRICH_INCLUDE_MDS") || "true").toLowerCase() === "true";

// 429-aware GET with exponential backoff. MarketCheck throttles per second; a
// throttled call that we treat as "no data" silently nulls a signal (comps,
// days-supply) and marks the car incomplete. Retry a couple of times with
// growing delay so a transient rate-limit doesn't cost us the data. Returns
// null only on transport error or a persistent throttle.
async function mcFetch(url: string, timeoutMs: number): Promise<Response | null> {
  const backoff = [1200, 2500];
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 && attempt < backoff.length) { await new Promise((r) => setTimeout(r, backoff[attempt])); continue; }
      return res;
    } catch {
      // A timeout or transient network error: retry with backoff instead of
      // giving up. This is what left Days Supply (the slowest call) randomly
      // grey on a few cars during a big bulk run — the call timed out once and
      // we bailed. Only return null after the retries are exhausted.
      if (attempt < backoff.length) { await new Promise((r) => setTimeout(r, backoff[attempt])); continue; }
      return null;
    }
  }
  return null;
}

// ── MarketCheck: predicted market value + range ────────────────
async function fetchPredict(vin: string, miles: number | null, carType: string, zip: string | null) {
  try {
    // predict/car/price requires car_type and a location (zip, or city+state) —
    // with only vin+miles MarketCheck returns 400. Supply both.
    const p = new URLSearchParams({ api_key: MC_KEY, vin, car_type: carType === "new" ? "new" : "used" });
    if (miles != null) p.set("miles", String(miles));
    if (zip) p.set("zip", zip);
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
async function fetchComps(ymm: string | null, condition: string, zip: string | null, listingPrice: number | null, subjectVin: string, subjectTrim: string | null, dealerName: string | null) {
  try {
    if (!ymm) return null;
    const parts = ymm.split(/\s+/);
    const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
    // Normalized dealer name for same-rooftop exclusion (so we never show the
    // customer the dealer's OWN cars as comparables).
    const normDealer = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const ownName = normDealer(dealerName);
    const trim = String(subjectTrim || "").trim();
    const make = year ? parts[1] : parts[0];
    const model = year ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
    const carType = condition === "new" ? "new" : "used";

    // One MarketCheck active-search pass. Returns null only on transport error.
    // NOTE: we do NOT request the `stats` facet — on the Basic plan a search of a
    // large local market (e.g. an INFINITI dealer's own QX60/QX80, 140+ in 100mi)
    // returns the count but ZERO listing records when stats are requested. We
    // compute the price/DOM stats ourselves from the returned listings instead.
    const run = async (opts: { useYear: boolean; band: boolean; useTrim: boolean }) => {
      const p = new URLSearchParams({ api_key: MC_KEY, car_type: carType, rows: "50", sort_by: "price", sort_order: "asc", start: "0" });
      if (opts.useYear && year) p.set("year", year);
      if (make) p.set("make", make);
      if (model) p.set("model", model);
      // Trim-match so comps are the SAME equipment level (e.g. QX60 LUXE vs
      // LUXE), not the whole model line — a mismatched comp set reads as "off"
      // and sends shoppers elsewhere. Tried first, relaxed only if it's empty.
      if (opts.useTrim && trim) p.set("trim", trim);
      if (zip) { p.set("zip", zip); p.set("radius", "100"); }
      // A price band shrinks a big-inventory model into a set small enough that
      // MarketCheck returns the actual listings (not just the aggregate count).
      if (opts.band && listingPrice && listingPrice > 0) {
        p.set("price_range", `${Math.round(listingPrice * 0.65)}-${Math.round(listingPrice * 1.35)}`);
      }
      const res = await mcFetch(`${MC_BASE}/search/car/active?${p.toString()}`, 12000);
      if (!res) return null;
      if (!res.ok) return { rows: [] as unknown[], rawCount: 0, numFound: null as number | null, http: res.status };
      // deno-lint-ignore no-explicit-any
      const b: any = await res.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      const all: any[] = Array.isArray(b?.listings) ? b.listings : [];
      // deno-lint-ignore no-explicit-any
      const rows: any[] = all.filter((l: any) => {
        if (String(l.vin || "").toUpperCase() === subjectVin) return false;
        // Drop the dealer's own rooftop (name match) and any same-location lot
        // (dist 0) so a shopper never sees this dealer's own cars as comps.
        const cn = normDealer((l.dealer as any)?.name ?? l.seller_name);
        if (ownName && cn && (cn.includes(ownName) || ownName.includes(cn))) return false;
        if (Number(l.dist) === 0) return false;
        return true;
      });
      return { rows, rawCount: all.length, numFound: num(b?.num_found), http: res.status };
    };

    // Tightest first — same trim + year + price band, so comps are like-for-like
    // — then progressively relax (drop trim, then band, then year) only when the
    // tighter pass yields no usable comps. The winning tier is persisted so the
    // client can caveat a trim-blind comp set instead of presenting it as exact.
    let tier = trim ? "trim_year_band" : "year_band";
    let r = await run({ useYear: true, band: true, useTrim: true });
    if (r && r.rows.length === 0) { r = (await run({ useYear: true, band: true, useTrim: false })) ?? r; tier = "year_band"; }
    if (r && r.rows.length === 0) { r = (await run({ useYear: true, band: false, useTrim: false })) ?? r; tier = "year"; }
    if (r && r.rows.length === 0) { r = (await run({ useYear: false, band: true, useTrim: false })) ?? r; tier = "band"; }
    if (r && r.rows.length === 0) { r = (await run({ useYear: false, band: false, useTrim: false })) ?? r; tier = "model"; }
    if (!r) return null;
    const debug = { num_found: r.numFound, listings_returned: r.rawCount, http: r.http, radius: zip ? 100 : null };

    // The rows arrive price-ASCENDING, so an unfiltered slice stores the
    // CHEAPEST page of the market — exactly the sample a value-building
    // customer surface must not run its math on. Store the at-or-above-price
    // comps first (mirrors compStrategy's minimum ratio of 1.0); cheaper rows
    // only pad a thin set and stay available for honest aggregate stats.
    // deno-lint-ignore no-explicit-any
    const rowPrice = (l: any) => num(l.price);
    const atOrAbove = listingPrice != null ? r.rows.filter((l) => (rowPrice(l) ?? 0) >= listingPrice) : r.rows;
    const belowRows = listingPrice != null ? r.rows.filter((l) => (rowPrice(l) ?? 0) < listingPrice && (rowPrice(l) ?? 0) > 0) : [];
    const sampleRows = [...atOrAbove, ...belowRows.reverse()].slice(0, 16);

    const comparables = sampleRows.map((l) => ({
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

    // Stats computed from ALL returned rows (not the value-floored stored
    // sample, which deliberately skews at-or-above price) so any "market
    // average" a surface derives stays honest.
    // deno-lint-ignore no-explicit-any
    const allPrices = r.rows.map((l: any) => num(l.price)).filter((n): n is number => n != null && n > 0).sort((a, z) => a - z);
    const prices = allPrices;
    const doms = (r.rows.map((l) => num(l.dom)).filter((n): n is number => n != null && n > 0));
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
    const mean = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
    const avgDom = doms.length ? Math.round(doms.reduce((a, b) => a + b, 0) / doms.length) : null;
    const stats = { min: prices[0] ?? null, mean, median, max: prices[prices.length - 1] ?? null };
    const milesAll = r.rows.map((l) => num(l.miles)).filter((n): n is number => n != null && n > 0);
    const milesMean = milesAll.length ? Math.round(milesAll.reduce((a, b) => a + b, 0) / milesAll.length) : null;
    const domsSorted = [...doms].sort((a, z) => a - z);
    const domMedian = domsSorted.length ? domsSorted[Math.floor(domsSorted.length / 2)] : null;
    // Price-cut signal across the full returned sample: MarketCheck rows carry
    // ref_price (prior price) and price_change_percent when a listing has
    // moved. Cuts among competitors are urgency evidence for OUR car.
    let cutTotal = 0, cutCount = 0;
    for (const l of r.rows) {
      const pct = num(l.price_change_percent);
      const ref = num(l.ref_price);
      const cur = rowPrice(l);
      if (pct == null && ref == null) continue;
      cutTotal++;
      if ((pct != null && pct < 0) || (pct == null && ref != null && cur != null && cur < ref)) cutCount++;
    }
    const count = r.numFound ?? comparables.length;

    // True market rank: count the listings priced UNDER ours across the FULL
    // winning-tier search (rows=1, we only read num_found) — the 16-row page
    // must never be the percentile denominator. Falls back to the page-derived
    // number only when the count call fails.
    let cheaperCount: number | null = null;
    if (listingPrice != null && listingPrice > 0 && count > 0) {
      const cp = new URLSearchParams({ api_key: MC_KEY, car_type: carType, rows: "1", start: "0" });
      const banded = tier === "trim_year_band" || tier === "year_band" || tier === "band";
      if ((tier === "trim_year_band" || tier === "year_band" || tier === "year") && year) cp.set("year", year);
      if (make) cp.set("make", make);
      if (model) cp.set("model", model);
      if (tier === "trim_year_band" && trim) cp.set("trim", trim);
      if (zip) { cp.set("zip", zip); cp.set("radius", "100"); }
      const floor = banded ? Math.round(listingPrice * 0.65) : 1;
      cp.set("price_range", `${floor}-${Math.max(Math.round(listingPrice) - 1, 1)}`);
      const res = await mcFetch(`${MC_BASE}/search/car/active?${cp.toString()}`, 10000);
      if (res && res.ok) {
        // deno-lint-ignore no-explicit-any
        const cb: any = await res.json().catch(() => ({}));
        cheaperCount = num(cb?.num_found);
      }
    }
    const sampleCheaper = listingPrice != null && allPrices.length
      ? allPrices.filter((n) => n < listingPrice).length : null;
    const cheaper = cheaperCount ?? sampleCheaper;
    // Percentile only from the market-wide count: the sample fallback mixes a
    // 50-row-page numerator with a whole-market denominator, which understates
    // the rank. Better null (honest pending) than a fabricated number.
    const percentile = listingPrice != null && cheaperCount != null && count > 0
      ? Math.min(100, Math.round((cheaperCount / count) * 100)) : null;

    // Trim scarcity: how many of THIS trim exist in the same geometry. When
    // the winning tier already trim-matched, similar_count IS the trim count;
    // otherwise one rows=1 count call answers it.
    let trimCount: number | null = null;
    try {
      if (tier === "trim_year_band") {
        trimCount = count;
      } else if (trim) {
        const tp = new URLSearchParams({ api_key: MC_KEY, car_type: carType, rows: "1", start: "0" });
        if ((tier === "year_band" || tier === "year") && year) tp.set("year", year);
        if (make) tp.set("make", make);
        if (model) tp.set("model", model);
        tp.set("trim", trim);
        if (zip) { tp.set("zip", zip); tp.set("radius", "100"); }
        if ((tier === "year_band" || tier === "band") && listingPrice && listingPrice > 0) {
          tp.set("price_range", `${Math.round(listingPrice * 0.65)}-${Math.round(listingPrice * 1.35)}`);
        }
        const tres = await mcFetch(`${MC_BASE}/search/car/active?${tp.toString()}`, 10000);
        if (tres && tres.ok) {
          // deno-lint-ignore no-explicit-any
          const tb: any = await tres.json().catch(() => ({}));
          trimCount = num(tb?.num_found);
        }
      }
    } catch { /* trim scarcity optional */ }

    const meta = {
      similar_count: count,
      search_radius: zip ? 100 : null,
      price_percentile: percentile,
      cheaper_count: cheaper,
      rank_basis: cheaperCount != null ? "market" : "sample",
      relaxation_tier: tier,
      trim_matched: tier === "trim_year_band",
      avg_dom: avgDom,
      market_days_supply: null as number | null,  // filled by fetchMds when the plan supports it
      inventory_count: count,
      price_stats: { mean, median },
      miles_mean: milesMean,
      dom_median: domMedian,
      ...(cutTotal > 0 ? { comp_price_cut_count: cutCount, comp_price_cut_total: cutTotal } : {}),
      ...(trimCount != null ? { trim_count: trimCount } : {}),
      checked_at: new Date().toISOString(),
    };
    // median (fallback to mean) lets the caller backfill market_value when
    // MarketCheck's price prediction has no value for an older/rare car.
    return { comparables, meta, stats, debug, median: median ?? mean };
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
    // Do NOT derive an owner count from listing history. Distinct dealer/seller
    // spells count how many DEALERS relisted the VIN, not personal ownership
    // changes — a wholesale/auction chain inflates this to 12-50 "owners". A
    // true owner count only comes from a title history (CARFAX/AutoCheck), which
    // this feed is not. Leave it null so the Passport reads honestly.
    const firstSeen = entries.find((e) => e.first_seen)?.first_seen ?? null;
    // In-service date ≈ first time this VIN appeared as a NEW car (warranty
    // clock starts at first retail sale; first-new-listing is the closest
    // defensible proxy available from listing data).
    const firstNew = entries.find((e) => String(e.inventory_type || "").toLowerCase() === "new");
    const inServiceDate = firstNew?.first_seen ?? firstSeen;
    return {
      available: true,
      entries: entries.map(({ _ts, ...e }) => e),
      owners: null,
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
    const carType = condition === "new" ? "new" : "used";
    const run = async (opts: { useYear: boolean; useZip: boolean }) => {
      const p = new URLSearchParams({ api_key: MC_KEY, car_type: carType });
      if (opts.useYear && year) p.set("year", year);
      if (make) p.set("make", make);
      if (model) p.set("model", model);
      if (opts.useZip && zip) { p.set("zip", zip); p.set("radius", "100"); }
      const res = await mcFetch(`${MC_BASE}/mds/car?${p.toString()}`, 15000);
      if (!res || !res.ok) return null;
      // deno-lint-ignore no-explicit-any
      const b: any = await res.json().catch(() => ({}));
      const mds = num(b.mds ?? b.market_days_supply ?? b.days_supply);
      const count = num(b.count ?? b.inventory_count ?? b.total);
      return mds != null ? { mds, count } : null;
    };
    // Days supply needs a recent SALES rate, which a thin/slow local same-year
    // market may not have (a CPO model sitting 160 days, or a direct-sale brand
    // like Tesla). Broaden the basis: same-year-local → all-years-local →
    // national, so a computable figure lands wherever one exists.
    const r = (await run({ useYear: true, useZip: true }))
      ?? (await run({ useYear: false, useZip: true }))
      ?? (await run({ useYear: false, useZip: false }));
    if (!r) return null;
    return { mds: r.mds, count: r.count, checked_at: new Date().toISOString() };
  } catch { return null; }
}

// ── MarketCheck: recently-SOLD stats for this model in the dealer's state ──
// /sales/car ignores model/year/trim — it aggregates at make+state level only —
// so real model-scoped sold data comes from /search/car/recents, which honors
// year+make+model+state and returns recently-delisted (sold) listings. Ladder:
// model+year+state → model+state → make-level /sales/car (diagnostics only;
// the client never displays make scope). Only the count and medians are kept —
// market_meta ships to anonymous shoppers, so no listing rows, dealer names,
// VINs, URLs, or min/max/mean ever leave this function.
async function fetchSoldStats(ymm: string | null, condition: string, state: string | null) {
  try {
    if (!ymm || !state) return null;
    const parts = ymm.split(/\s+/);
    const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
    const make = year ? parts[1] : parts[0];
    const model = year ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
    if (!make || !model) return null;
    const carType = condition === "new" ? "new" : "used";
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, z) => a - z);
      return s.length ? s[Math.floor(s.length / 2)] : null;
    };
    const finish = (r: { count: number; price_median: number | null; dom_median: number | null; miles_median: number | null }, scope: string) => ({
      count: r.count,
      price_median: r.price_median,
      dom_median: r.dom_median,
      miles_median: r.miles_median,
      scope,
      state,
      window_days: 90,
      checked_at: new Date().toISOString(),
      source: scope === "make_state" ? "marketcheck_sales" : "marketcheck_recents",
    });
    const run = async (useYear: boolean) => {
      const p = new URLSearchParams({ api_key: MC_KEY, car_type: carType, make, model, state, rows: "50", start: "0" });
      if (useYear && year) p.set("year", year);
      const res = await mcFetch(`${MC_BASE}/search/car/recents?${p.toString()}`, 12000);
      if (!res || !res.ok) return null;
      // deno-lint-ignore no-explicit-any
      const b: any = await res.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      const rows: any[] = Array.isArray(b?.listings) ? b.listings : [];
      const count = num(b?.num_found) ?? rows.length;
      const vals = (field: string) =>
        // deno-lint-ignore no-explicit-any
        rows.map((l: any) => num(l?.[field])).filter((n): n is number => n != null && n > 0);
      return { count, price_median: median(vals("price")), dom_median: median(vals("dom")), miles_median: median(vals("miles")) };
    };
    const r1 = await run(true);
    if (r1 && r1.count >= 5) return finish(r1, "model_year_state");
    const r2 = await run(false);
    if (r2 && r2.count >= 5) return finish(r2, "model_state");
    // Still thin at model scope: one make-level /sales/car call. Use the
    // response's *_stats medians directly (this endpoint returns aggregates).
    const sp = new URLSearchParams({ api_key: MC_KEY, car_type: carType, make, state });
    const sres = await mcFetch(`${MC_BASE}/sales/car?${sp.toString()}`, 12000);
    if (sres && sres.ok) {
      // deno-lint-ignore no-explicit-any
      const sb: any = await sres.json().catch(() => ({}));
      const count = num(sb?.count ?? sb?.num_found ?? sb?.sales_count);
      if (count != null && count > 0) {
        return finish({
          count,
          price_median: num(sb?.price_stats?.median),
          dom_median: num(sb?.dom_stats?.median),
          miles_median: num(sb?.miles_stats?.median),
        }, "make_state");
      }
    }
    // Make-level also failed: a thin model-scoped answer still beats nothing
    // (the estimate branch stays live because count < 5).
    if (r2 && r2.count > 0) return finish(r2, "model_state");
    if (r1 && r1.count > 0) return finish(r1, "model_year_state");
    return null;
  } catch { return null; }
}

// ── Recall lookup: MarketCheck (VIN-specific) → NHTSA (free) fallback ──
// MarketCheck recalls come from the licensed 3rd-party AutoRecalls product,
// which returns nothing until that product's terms are accepted in the
// MarketCheck portal — so it silently failed for most cars. NHTSA's public
// recallsByVehicle API is free, needs no key, and is the same source the
// publish gate uses, so we fall back to it (model-level) whenever the
// MarketCheck VIN call doesn't answer. Result: the recall signal always lands.
async function fetchRecalls(vin: string, ymm: string | null) {
  try {
    const res = await mcFetch(`${MC_BASE}/recall/car/${encodeURIComponent(vin)}?api_key=${encodeURIComponent(MC_KEY)}`, 10000);
    if (res && res.ok) {
      // deno-lint-ignore no-explicit-any
      const b: any = await res.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      const list: any[] = Array.isArray(b?.recalls) ? b.recalls : Array.isArray(b) ? b : [];
      // A valid MarketCheck response (even an empty "no recalls" one) is
      // authoritative and VIN-specific — prefer it over the model-level fallback.
      if (Array.isArray(b?.recalls) || Array.isArray(b)) {
        const open = list.filter((r) => !String(r.status || r.recall_status || "").toLowerCase().includes("close"));
        return {
          recall_status: list.length === 0 ? "clear" : open.length ? "open_recalls" : "clear",
          open_recall_count: open.length,
          recall_payload: { campaigns: list, checked_at: new Date().toISOString(), source: "marketcheck" },
        };
      }
    }
  } catch { /* fall through to NHTSA */ }
  return await fetchNhtsaRecalls(ymm);
}

// ── NHTSA recallsByVehicle (free, model-level) ─────────────────
async function fetchNhtsaRecalls(ymm: string | null) {
  try {
    if (!ymm) return null;
    const parts = ymm.split(/\s+/);
    const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
    const make = year ? parts[1] : parts[0];
    const model = year ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
    if (!year || !make || !model) return null;
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    // NHTSA returns a non-200 (or empty) for vehicles it has no record of —
    // typical for brand-new model years (2026/2027). That means no recalls are
    // on file, which is "clear", NOT unknown. Returning null here was leaving the
    // recall signal grey for every new car; treat no-record as clear instead.
    if (!res.ok) {
      return { recall_status: "clear", open_recall_count: 0, recall_payload: { campaigns: [], checked_at: new Date().toISOString(), source: "nhtsa", note: `no_nhtsa_record_http_${res.status}` } };
    }
    // deno-lint-ignore no-explicit-any
    const b: any = await res.json().catch(() => ({}));
    // NHTSA's modern recalls API uses lowercase `results`; older shape used `Results`.
    // deno-lint-ignore no-explicit-any
    const list: any[] = Array.isArray(b?.results) ? b.results : Array.isArray(b?.Results) ? b.Results : [];
    return {
      recall_status: list.length === 0 ? "clear" : "open_recalls",
      open_recall_count: list.length,
      recall_payload: {
        // deno-lint-ignore no-explicit-any
        campaigns: list.map((r: any) => ({
          campaign: r.NHTSACampaignNumber ?? r.CampaignNumber ?? null,
          component: r.Component ?? null,
          summary: r.Summary ?? null,
          consequence: r.Consequence ?? null,
          remedy: r.Remedy ?? null,
        })),
        checked_at: new Date().toISOString(),
        source: "nhtsa",
      },
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

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string; zip?: string; sources?: "all" | "marketcheck" | "blackbook" };
  // Which providers to run: "all" (default), "marketcheck" (skip Black Book),
  // or "blackbook" (skip the MarketCheck chain — fills only Black Book values).
  const sources = body.sources === "marketcheck" || body.sources === "blackbook" ? body.sources : "all";
  const wantMC = sources !== "blackbook";
  const wantBB = sources !== "marketcheck";
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
    .select("id, vin, ymm, trim, condition, price, mileage, dealer_snapshot")
    .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  if (!row) return json(404, { error: "listing_not_found" });

  const miles = num(row.mileage);
  const price = num(row.price);
  const condition = String(row.condition || "used");
  // Resolve a ZIP for the geo-bounded comps/MDS search. dealer_snapshot.zip is
  // empty in practice, so fall back to the dealer profile's saved zip. Without a
  // zip the search runs nationwide, and on the Basic plan (100-mile radius cap)
  // a no-geo search returns the aggregate count but ZERO listing records — which
  // is exactly why Comparables came back empty for every car.
  // deno-lint-ignore no-explicit-any
  let zip: string | null = body.zip || (row.dealer_snapshot as any)?.zip || null;
  // Operating state scopes the sold-stats (recents/sales) lookups; same
  // snapshot-then-profile fallback as zip. No state → sold stats skip entirely.
  // deno-lint-ignore no-explicit-any
  let dealerState: string | null = String((row.dealer_snapshot as any)?.state || "").trim().toUpperCase() || null;
  if (!zip || !dealerState) {
    const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
    const pset = (prof?.settings || {}) as Record<string, string>;
    if (!zip) zip = pset.dealer_zip || pset.zip || pset.doc_fee_zip || null;
    if (!dealerState) dealerState = (pset.dealer_state || pset.doc_fee_state || "").trim().toUpperCase() || null;
  }

  const ymm = (row.ymm as string | null) || null;
  const subjectTrim = (row.trim as string | null) || null;
  // The dealer's own rooftop name, so we never show the customer the dealer's
  // OWN inventory as "competition" in the comp set.
  // deno-lint-ignore no-explicit-any
  const dealerName = ((row.dealer_snapshot as any)?.name as string | null)
    || ((row.dealer_snapshot as any)?.display_name as string | null) || null;

  // Black Book is a separate provider with its own rate limit, so it runs
  // alongside the MarketCheck chain rather than competing with it.
  const blackbookP = wantBB ? fetchBlackBook(vin, miles, zip) : Promise.resolve(null);

  // MarketCheck calls run STRICTLY one-at-a-time. Firing them in parallel
  // bursts past MarketCheck's per-second limit and the heaviest call (comps
  // search) was the one getting throttled and dropped — the same model would
  // land comps on one VIN and not the next. Serialized + the browser's
  // one-VIN-at-a-time loop means a single MarketCheck request in flight at any
  // moment, which can't trip the RPS limit. (fetchRecalls tries MarketCheck
  // then falls back to free NHTSA.) Skipped entirely on a Black-Book-only run.
  const predict = wantMC ? await fetchPredict(vin, miles, condition, zip) : null;
  const comps = wantMC ? await fetchComps(ymm, condition, zip, price, vin, subjectTrim, dealerName) : null;
  const mds = wantMC && INCLUDE_MDS ? await fetchMds(ymm, condition, zip) : null;
  const soldStats = wantMC ? await fetchSoldStats(ymm, condition, dealerState) : null;
  const history = wantMC ? await fetchHistory(vin) : null;
  const recalls = wantMC ? await fetchRecalls(vin, ymm) : null;
  const blackbook = await blackbookP;

  const patch: Record<string, unknown> = { enriched_at: new Date().toISOString() };

  if (predict?.market_value != null) {
    const mv = predict.market_value;
    const belowMarket = price != null && mv != null ? Math.round(mv - price) : 0;
    const position = price == null || mv == null ? "unknown" : price <= mv * 0.97 ? "below_market" : price >= mv * 1.03 ? "above_market" : "at_market";
    patch.market_value = mv;
    patch.market_position = position;
    patch.market_checked_at = new Date().toISOString();
    patch.market_payload = { marketValue: mv, low: predict.low, high: predict.high, belowMarket, position, checked_at: new Date().toISOString(), raw: predict.raw };
  } else if (comps?.median != null && comps.median > 0) {
    // Fallback: MarketCheck has no predicted price for this VIN (older/rarer
    // car). Use the median of the local comparable listings as the market value
    // so the signal lands instead of staying grey.
    const mv = comps.median;
    const belowMarket = price != null ? Math.round(mv - price) : 0;
    const position = price == null ? "unknown" : price <= mv * 0.97 ? "below_market" : price >= mv * 1.03 ? "above_market" : "at_market";
    patch.market_value = mv;
    patch.market_position = position;
    patch.market_checked_at = new Date().toISOString();
    patch.market_payload = { marketValue: mv, belowMarket, position, source: "comps_median", checked_at: new Date().toISOString() };
  }
  if (comps) {
    // Only overwrite comparables when this pass actually returned listings, so a
    // transient empty result never clobbers a previously-good comp set.
    if (comps.comparables.length > 0) patch.comparables = comps.comparables;
    // Fold the regional Market Days Supply into market_meta so the Passport's
    // demand/trend surfaces have a real figure instead of a null placeholder.
    patch.market_meta = mds?.mds != null
      ? { ...comps.meta, market_days_supply: mds.mds, inventory_count: mds.count ?? comps.meta.inventory_count }
      : comps.meta;
  } else if (mds?.mds != null) {
    patch.market_meta = { market_days_supply: mds.mds, inventory_count: mds.count, checked_at: mds.checked_at };
  }
  if (soldStats) {
    patch.market_meta = { ...((patch.market_meta as Record<string, unknown> | undefined) ?? {}), sold_stats: soldStats };
  }
  if (patch.market_meta) {
    // MDS = active inventory ÷ 45-day sales rate, so units sold in the last
    // 45 days ≈ inventory * 45 / MDS — a real velocity figure for the market.
    // Real model-scoped sold data (count >= 5) supersedes this estimate, and
    // the estimate only runs off the MDS call's OWN inventory count — the
    // comps-search count is a different geometry and inflates the figure.
    const mm = patch.market_meta as Record<string, unknown>;
    const realSold = soldStats != null && soldStats.count >= 5 && soldStats.scope !== "make_state";
    if (!realSold && mds?.mds != null && mds.mds > 0 && mds.count != null && mds.count > 0) {
      mm.sold_45d_estimate = Math.round((mds.count * 45) / mds.mds);
    }
  }
  if (history) {
    patch.history_payload = history;
    if (history.inServiceDate) patch.in_service_date = history.inServiceDate;
  }
  if (recalls) { patch.recall_status = recalls.recall_status; patch.open_recall_count = recalls.open_recall_count; patch.recall_payload = recalls.recall_payload; }
  if (blackbook) patch.blackbook = blackbook;

  // Persist (each column already migrated; isolate so a missing column can't 500).
  try { await admin.from("vehicle_listings").update(patch).eq("id", row.id); } catch { /* column not migrated yet */ }

  // Value-history snapshot for the price/market timeline — only when MarketCheck
  // ran (a Black-Book-only pass shouldn't append a price/market snapshot).
  if (wantMC && (price != null || patch.market_value != null)) {
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
      // Raw MarketCheck comps response, to diagnose empty Comparables: if
      // num_found > 0 but listings_returned == 0, the plan is withholding the
      // listing records (aggregate-only) — not a parameter problem.
      comps_num_found: comps?.debug?.num_found ?? null,
      comps_listings_returned: comps?.debug?.listings_returned ?? null,
      comps_http: comps?.debug?.http ?? null,
      market_days_supply: mds?.mds ?? null,
      sold_stats_count: soldStats?.count ?? null,
      sold_stats_scope: soldStats?.scope ?? null,
      history: history?.available ? (history.entries?.length ?? 0) : 0,
      owners: history?.owners ?? null,
      in_service_date: history?.inServiceDate ?? null,
      recalls: !!recalls,
      open_recalls: recalls?.open_recall_count ?? null,
      blackbook: !!blackbook,
    },
  });
});
