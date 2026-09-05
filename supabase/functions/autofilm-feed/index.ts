import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// autofilm-feed
//
// Read-only vehicle list endpoint for AutoFilm.io's nightly
// ingest. One call per page walks the dealer's entire live lot
// ordered by VIN, with a total count up front, so AutoFilm can
// back its pricing block and Window Sticker button with real
// AutoLabels data.
//
// Contract:
//   GET /functions/v1/autofilm-feed?tenant_id=<uuid>[&cursor=<vin>][&limit=500]
//   Headers: x-lookup-secret: <AUTOLABELS_LOOKUP_SECRET>
//   (same shared credential vehicle-lookup already validates)
//
// Returns: {
//   total: number,           // live vehicles for the tenant
//   next_cursor: string | null, // pass back as ?cursor= to continue
//   vehicles: [{ vin, ymm, trim, condition, mileage, stock_number,
//     status, price, advertised_price_before_doc, doc_fee,
//     website_sale_price, dealer_discount, retail_cash, market_value,
//     market_position, hero_image_url, photo_count,
//     passport_url, oem_sticker_url, factory_sticker_url, updated_at }]
// }
//
// Security model:
//   - Shared-secret key, timing-safe compared. Read-only; the key
//     alone can enumerate one tenant's published inventory but
//     cannot write anything.
//   - tenant_id is required and scopes every query; a leaked key
//     cannot pivot across tenants beyond enumeration by guessable
//     UUID, so treat the key as the tenant-scoped credential.
//   - Only live rows (status published/active, not archived) are
//     returned — the lot AutoFilm should mirror.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lookup-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const feedSecret = Deno.env.get("AUTOFILM_FEED_SECRET");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "server misconfigured" });
    if (!feedSecret) return json(503, { error: "feed not enabled" });

    const key = req.headers.get("x-autofilm-key") ?? "";
    if (!timingSafeEqual(key, feedSecret)) return json(401, { error: "unauthorized" });

    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      return json(400, { error: "tenant_id must be a uuid" });
    }
    const cursor = (url.searchParams.get("cursor") ?? "").toUpperCase();
    if (cursor && !/^[A-HJ-NPR-Z0-9]{17}$/.test(cursor)) {
      return json(400, { error: "cursor must be a 17-character VIN" });
    }
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isInteger(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const admin = createClient(supabaseUrl, serviceKey);

    const base = () =>
      admin
        .from("vehicle_listings")
        .select(
          "vin, ymm, trim, condition, mileage, status, price," +
          " advertised_price_before_doc, doc_fee, website_sale_price," +
          " dealer_discount, retail_cash, market_value, market_position," +
          " hero_image_url, photo_count, slug, oem_sticker_url," +
          " factory_sticker_url, mc_attributes, updated_at",
        )
        .eq("tenant_id", tenantId)
        .is("archived_at", null)
        .in("status", ["published", "active"]);

    const { count, error: countErr } = await base()
      .select("vin", { count: "exact", head: true });
    if (countErr) return json(500, { error: countErr.message });

    let pageQuery = base().order("vin", { ascending: true }).limit(limit + 1);
    if (cursor) pageQuery = pageQuery.gt("vin", cursor);
    const { data, error } = await pageQuery;
    if (error) return json(500, { error: error.message });

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const vehicles = rows.slice(0, limit).map((r) => ({
      vin: r.vin,
      ymm: r.ymm,
      trim: r.trim,
      condition: r.condition,
      mileage: r.mileage,
      status: r.status,
      stock_number: (r.mc_attributes as Record<string, unknown> | null)?.stock_no ?? null,
      price: r.price,
      advertised_price_before_doc: r.advertised_price_before_doc,
      doc_fee: r.doc_fee,
      website_sale_price: r.website_sale_price,
      dealer_discount: r.dealer_discount,
      retail_cash: r.retail_cash,
      market_value: r.market_value,
      market_position: r.market_position,
      hero_image_url: r.hero_image_url,
      photo_count: r.photo_count,
      passport_url: r.slug ? `https://autolabels.io/v/${r.slug}` : null,
      oem_sticker_url: r.oem_sticker_url,
      factory_sticker_url: r.factory_sticker_url,
      updated_at: r.updated_at,
    }));

    return json(200, {
      total: count ?? 0,
      next_cursor: hasMore ? vehicles[vehicles.length - 1]?.vin ?? null : null,
      vehicles,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
