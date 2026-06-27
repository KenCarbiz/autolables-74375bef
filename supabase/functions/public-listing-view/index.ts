import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// public-listing-view
//
// Rate-limited proxy in front of the anon /v/:slug shopper portal.
// Shoppers still load the public page, but the page calls this
// function to fetch the listing data instead of hitting the DB
// directly. That keeps RLS simple and lets us throttle abusive
// clients (competitor scrapers, credential stuffing bots).
//
// Contract:
//   POST /functions/v1/public-listing-view
//   Body: { slug: string }
//   Returns: { listing } on success,
//            { error: "rate_limited", retry_after } with 429, or
//            { error: "not_found" } with 404.
//
// Rate limits (per client IP):
//   - 30 distinct listing_viewed events per 5 minutes, OR
//   - 120 events per hour.
// Enforced via a simple SQL COUNT against public.audit_log.
//
// Every successful view is:
//   1. Inserted into audit_log as "listing_viewed" so it counts
//      toward the next request's rate check.
//   2. Passed through increment_listing_view so dealer sees the
//      view_count tick.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });

const clientIp = (req: Request) =>
  req.headers.get("cf-connecting-ip") ||
  (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
  req.headers.get("x-real-ip") ||
  "unknown";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase not configured" });

    const { slug } = await req.json().catch(() => ({}));
    if (!slug || typeof slug !== "string") return json(400, { error: "slug required" });

    const ip = clientIp(req);
    const ua = req.headers.get("user-agent") || "";
    const admin = createClient(supabaseUrl, serviceKey);

    // ── Rate limit: 30 views / 5min, 120 views / hour per IP
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const oneHrAgo = new Date(Date.now() - 60 * 60_000).toISOString();

    const [fiveMinRes, oneHrRes] = await Promise.all([
      admin
        .from("audit_log")
        .select("id", { head: true, count: "exact" })
        .eq("action", "listing_viewed")
        .eq("ip_address", ip)
        .gte("created_at", fiveMinAgo),
      admin
        .from("audit_log")
        .select("id", { head: true, count: "exact" })
        .eq("action", "listing_viewed")
        .eq("ip_address", ip)
        .gte("created_at", oneHrAgo),
    ]);
    const fiveMinCount = fiveMinRes.count ?? 0;
    const oneHrCount = oneHrRes.count ?? 0;

    if (fiveMinCount >= 30 || oneHrCount >= 120) {
      return json(429, { error: "rate_limited", retry_after: 300 }, { "Retry-After": "300" });
    }

    // ── Fetch the listing
    let lookupSlug = slug;
    const { data, error } = await admin.rpc("get_vehicle_listing_by_slug", { _slug: slug });
    if (error) return json(500, { error: error.message });
    let row = Array.isArray(data) ? data[0] : data;

    // Canonical Passport URLs are /v/{VIN}. Newer listings store the VIN as
    // their slug so the RPC matches directly; older listings carry a legacy
    // slug. When the direct match misses, treat the slug as a VIN: resolve it
    // to the listing's stored slug and retry — keeping the RPC as the single
    // source of the returned shape.
    if (!row) {
      const { data: byVin } = await admin
        .from("vehicle_listings")
        .select("slug")
        .eq("vin", slug.toUpperCase())
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(1);
      const alt = Array.isArray(byVin) ? byVin[0] : byVin;
      if (alt?.slug && alt.slug !== slug) {
        lookupSlug = alt.slug;
        const retry = await admin.rpc("get_vehicle_listing_by_slug", { _slug: alt.slug });
        row = Array.isArray(retry.data) ? retry.data[0] : retry.data;
      }
    }
    if (!row) return json(404, { error: "not_found" });

    // ── Attach the dealer's passport sticky-button config (service role reads
    // dealer_profiles past RLS) so the anonymous passport can render it.
    try {
      if (row.tenant_id) {
        const { data: prof } = await admin
          .from("dealer_profiles").select("settings").eq("tenant_id", row.tenant_id).maybeSingle();
        const s = (prof?.settings ?? {}) as Record<string, unknown>;
        if (s.sticky_bottom_buttons) row.sticky_bottom_buttons = s.sticky_bottom_buttons;
        // Dealer-entered passport trust content (badges + multi-source reviews).
        const trust = {
          years_in_business: (s.dealer_years_in_business as string) || "",
          satisfaction: (s.dealer_satisfaction as string) || "",
          bbb_rating: (s.dealer_bbb_rating as string) || "",
          google_rating: (s.dealer_google_rating as string) || "",
          google_count: (s.dealer_google_count as string) || "",
          certifications: (s.dealer_certifications as string) || "",
          storefront_url: (s.dealer_storefront_url as string) || "",
          review_sources: (s.dealer_review_sources as string) || "",
          advisor_name: (s.dealer_advisor_name as string) || "",
          advisor_title: (s.dealer_advisor_title as string) || "",
          advisor_photo: (s.dealer_advisor_photo as string) || "",
          advisor_response: (s.dealer_advisor_response as string) || "",
          family_owned: (s.dealer_family_owned as string) || "",
          service_location: (s.dealer_service_location as string) || "",
          service_address: (s.dealer_service_address as string) || "",
          delivery: (s.dealer_delivery as string) || "",
          financing: (s.dealer_financing as string) || "",
          amenities: (s.dealer_amenities as string) || "",
          services: (s.dealer_services as string) || "",
          hours: (s.dealer_hours as string) || "",
          mobile_cta_variant: (s.mobile_slideout_cta_variant as string) || "",
        };
        if (Object.values(trust).some((v) => v)) row.dealer_trust = trust;
      }
    } catch { /* config optional — passport falls back to its default bar */ }

    // ── Dealer identity for the passport header/footer. dealer_snapshot is only
    // written at publish time and is usually empty; fill name/logo/phone/website/
    // address from the dealer's onboarding profile so the page shows the real
    // dealership instead of "the dealership". Only real values — fields the
    // dealer hasn't entered stay blank (no placeholders).
    try {
      const snap = (row.dealer_snapshot ?? {}) as Record<string, unknown>;
      if (row.tenant_id && Object.keys(snap).length === 0) {
        const { data: ob } = await admin
          .from("onboarding_profiles")
          .select("display_name, phone, website, logo_url, stores")
          .eq("tenant_id", row.tenant_id).maybeSingle();
        if (ob) {
          const store = (Array.isArray(ob.stores) && ob.stores.length ? ob.stores[0] : {}) as Record<string, unknown>;
          row.dealer_snapshot = {
            name: ob.display_name || null,
            phone: ob.phone || store.phone || null,
            logo_url: ob.logo_url || null,
            website: ob.website || null,
            address: store.address || store.street || null,
            city: store.city || null, state: store.state || null, zip: store.zip || store.postal_code || null,
          };
        }
      }
    } catch { /* dealer identity optional */ }

    // ── Attach real captured price/market history for this VIN (Passport V2
    // Price History). Read-only, service role; oldest→newest, capped.
    try {
      if (row.vin) {
        const { data: hist } = await admin
          .from("vehicle_value_history")
          .select("captured_at, market_value, listing_price, below_market, position")
          .eq("vin", String(row.vin).toUpperCase())
          .order("captured_at", { ascending: true })
          .limit(60);
        if (Array.isArray(hist) && hist.length) row.value_history = hist;
      }
    } catch { /* history optional — Passport shows a pending state */ }

    // ── Bump view count + record audit event
    await Promise.all([
      admin.rpc("increment_listing_view", { _slug: lookupSlug }),
      admin.from("audit_log").insert({
        action: "listing_viewed",
        entity_type: "vehicle_listing",
        entity_id: row.id,
        store_id: row.store_id || null,
        ip_address: ip,
        user_agent: ua,
        details: { slug: lookupSlug, requested: slug },
      }),
    ]);

    return json(200, { listing: row });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});
