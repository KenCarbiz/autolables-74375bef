// ──────────────────────────────────────────────────────────────────────
// marketcheck-market-pricing — per-VIN market value + price position via
// MarketCheck's price-prediction API. Server-side only. Compares the dealer's
// listing price to the predicted market value and classifies the position
// (great_deal / good_deal / fair_deal / above_market). Single-VIN + batch.
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

const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
// deno-lint-ignore no-explicit-any
const num = (v: any): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

interface Listing { price: number | null; mileage: number | null; ymm: string | null; condition: string | null; }

interface MarketResult {
  vin: string; checkedAt: string;
  listingPrice: number | null; marketValue: number | null;
  low: number | null; high: number | null;
  position: "great_deal" | "good_deal" | "fair_deal" | "above_market" | "unknown";
  belowMarket: number; // market - listing (positive = priced below market)
  rawProvider: "marketcheck_predict";
}

const classify = (listing: number | null, market: number | null): { position: MarketResult["position"]; belowMarket: number } => {
  if (!listing || !market || market <= 0) return { position: "unknown", belowMarket: 0 };
  const pct = (listing - market) / market;
  const position =
    pct <= -0.06 ? "great_deal" :
    pct <= -0.02 ? "good_deal" :
    pct < 0.03 ? "fair_deal" :
    "above_market";
  return { position, belowMarket: Math.round(market - listing) };
};

// MarketCheck price prediction. VIN + miles + parsed year/make/model when we
// have them; one retry on a transient failure.
async function fetchMarket(vin: string, l: Listing): Promise<MarketResult | { error: string }> {
  const [year, make, ...model] = (l.ymm || "").trim().split(/\s+/);
  const params = new URLSearchParams({ api_key: MC_KEY, vin });
  params.set("car_type", l.condition === "new" ? "new" : "used");
  if (l.mileage) params.set("miles", String(l.mileage));
  if (year && /^\d{4}$/.test(year)) params.set("year", year);
  if (make) params.set("make", make);
  if (model.length) params.set("model", model.join(" "));
  const url = `${MC_BASE}/predict/car/price?${params.toString()}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.status === 429) { if (attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; } return { error: "rate_limited" }; }
      if (!res.ok) { if (attempt === 0) { await new Promise((r) => setTimeout(r, 600)); continue; } return { error: `provider_error_${res.status}` }; }
      // deno-lint-ignore no-explicit-any
      const b: any = await res.json().catch(() => ({}));
      const market = num(b.predicted_price ?? b.price ?? b.market_price ?? b.mean_price ?? b.price_stats?.mean);
      const low = num(b.price_range?.lower_bound ?? b.price_range?.low ?? b.min_price ?? b.price_stats?.min);
      const high = num(b.price_range?.upper_bound ?? b.price_range?.high ?? b.max_price ?? b.price_stats?.max);
      const { position, belowMarket } = classify(l.price, market);
      return {
        vin, checkedAt: new Date().toISOString(), listingPrice: l.price, marketValue: market,
        low, high, position, belowMarket, rawProvider: "marketcheck_predict",
      };
    } catch (_e) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 600)); continue; }
      return { error: "timeout_or_network" };
    }
  }
  return { error: "unknown" };
}

// deno-lint-ignore no-explicit-any
const persist = async (admin: any, tenantId: string | null, vin: string, m: MarketResult) => {
  let q = admin.from("vehicle_listings").update({
    market_value: m.marketValue,
    market_position: m.position,
    market_checked_at: m.checkedAt,
    market_payload: m,
  }).eq("vin", vin);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  try { await q; } catch { /* market_* columns may not be migrated yet */ }
};

// deno-lint-ignore no-explicit-any
const getListing = async (admin: any, tenantId: string | null, vin: string): Promise<Listing | null> => {
  let q = admin.from("vehicle_listings").select("price, mileage, ymm, condition").eq("vin", vin);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  return (data as Listing) || null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!MC_KEY) return json(200, { position: "unknown", error: "not_configured", note: "Set MARKETCHECK_API_KEY_1" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body.tenant_id || null;

  // ── Auth gate: service-role (cron) bypasses; otherwise require a
  // signed-in tenant member or platform admin for the requested tenant.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth !== serviceKey) {
    const { data: ures, error: uerr } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (uerr || !userId) return json(401, { error: "authentication required" });
    if (!tenantId) return json(400, { error: "tenant_id required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
      if (!membership) return json(403, { error: "not a member of this tenant" });
    }
  }


  if (body.batch) {
    if (!tenantId) return json(400, { error: "tenant_id required for batch" });
    const force = !!body.force;
    const { data: vehicles } = await admin.from("vehicle_listings")
      .select("vin, price, mileage, ymm, condition, market_checked_at").eq("tenant_id", tenantId).limit(1000);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let checked = 0, greatDeals = 0, errors = 0, skipped = 0;
    for (const v of (vehicles || []) as Array<Listing & { vin: string; market_checked_at: string | null }>) {
      const vin = (v.vin || "").toUpperCase();
      if (!validVin(vin) || !v.price) { skipped++; continue; }
      if (!force && v.market_checked_at && new Date(v.market_checked_at).getTime() > dayAgo) { skipped++; continue; }
      const r = await fetchMarket(vin, v);
      if ("error" in r) { errors++; if (r.error === "rate_limited") break; }
      else { await persist(admin, tenantId, vin, r); checked++; if (r.position === "great_deal") greatDeals++; }
      await new Promise((res) => setTimeout(res, 250));
    }
    return json(200, { batch: true, checked, greatDeals, errors, skipped });
  }

  const vin = String(body.vin || "").toUpperCase().trim();
  if (!validVin(vin)) return json(400, { position: "unknown", error: "invalid_vin" });
  const listing = await getListing(admin, tenantId, vin);
  if (!listing) return json(404, { position: "unknown", error: "listing_not_found" });
  if (!listing.price) return json(200, { vin, position: "unknown", error: "no_listing_price" });

  const r = await fetchMarket(vin, listing);
  if ("error" in r) return json(200, { vin, position: "unknown", error: r.error });
  await persist(admin, tenantId, vin, r);
  return json(200, r);
});
