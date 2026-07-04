import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveCustomerPassportRouting, type PassportAgent } from "../_shared/passport-routing.ts";
import { matchIihsAward, type IihsAward } from "../_shared/iihs-awards.ts";

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

    const { slug, session } = await req.json().catch(() => ({}));
    if (!slug || typeof slug !== "string") return json(400, { error: "slug required" });
    const sessionId = typeof session === "string" ? session.slice(0, 80) : "";

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
        // Price-drop watch opt-in is on unless the dealer turned it off.
        row.price_drop_watch = s.price_drop_watch_enabled !== false;
        // Customer-facing price display mode (advertised_before_doc default vs
        // website_sale_price). Lets the passport show the dealer's chosen price.
        if (s.price_display_mode) row.price_display_mode = s.price_display_mode;
        // Today's Price page wording mode + custom copy (compliance-safe
        // defaults resolve client-side when absent).
        if (s.todays_price_mode) row.todays_price_mode = s.todays_price_mode;
        if (s.todays_price_custom) row.todays_price_custom = s.todays_price_custom;
        // Store-wide packet module template; per-vehicle packet_modules
        // overrides it (see the curation enforcement before the response).
        if (s.packet_module_defaults && typeof s.packet_module_defaults === "object") {
          row.packet_defaults = s.packet_module_defaults;
        }
        // Dealer-branded warranty programs (lifetime powertrain, dealer CPO)
        // flagged for the passport warranty panel, filtered to this vehicle's
        // condition. Included vs available mode rides along for the badge.
        try {
          const progs = Array.isArray(s.dealer_programs) ? s.dealer_programs as Record<string, unknown>[] : [];
          const cond = String((row.condition as string) || "").toLowerCase();
          // Mirrors matchesCondition in src/lib/dealerPrograms.ts: missing
          // appliesTo = all, and "used" subsumes "cpo".
          const applies = (a: unknown) => {
            const v = String(a || "all").toLowerCase();
            if (v === "all") return true;
            if (v === "used") return cond === "used" || cond === "cpo";
            return v === cond;
          };
          const cov = progs
            .filter((p) => p && p.enabled !== false && p.isWarranty === true && p.showOnWarrantyPanel === true &&
              (String(p.title || "").trim() || String(p.offer || "").trim()) && applies(p.appliesTo))
            .map((p) => ({
              title: String(p.title || ""),
              coverage: String(p.coverage || ""),
              term_years: typeof p.termYears === "number" ? p.termYears : null,
              term_miles: typeof p.termMiles === "number" ? p.termMiles : null,
              lifetime: p.lifetime === true,
              mode: p.mode === "available" ? "available" : "included",
              offer: String(p.offer || ""),
              disclosure: String(p.disclosure || ""),
            }));
          if (cov.length) row.dealer_coverage = cov;
        } catch { /* dealer coverage optional */ }
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

        // ── Dealer-paid vehicle history report link (CARFAX / AutoCheck).
        // Used/CPO only; the URL is dealer-provided (harvested from their own
        // VDP or entered manually), never constructed here. Allowlisted hosts
        // only, and the dealer kill switch hides every link at once.
        try {
          const hCond = String((row.condition as string) || "").toLowerCase();
          if (["used", "cpo", "demo"].includes(hCond) && s.history_report_links_enabled !== false) {
            const url = String((row.history_report_url as string) || "").trim();
            if (/^https:\/\/(www\.)?(carfax\.com|cfx\.link|autocheck\.com)\//i.test(url)) {
              row.history_report = { url, provider: /autocheck\.com/i.test(url) ? "autocheck" : "carfax" };
            }
          }
        } catch { /* history link must never break the payload */ }

        // ── IIHS Top Safety Pick — permission-gated (the dealer flips the
        // enable flag only after IIHS grants written permission) and
        // dealer-verified per model. Text-only statement, never a logo.
        try {
          if (s.iihs_awards_enabled === true || String(s.iihs_awards_enabled) === "true") {
            const award = matchIihsAward((s.iihs_awards ?? null) as IihsAward[] | null, (row.ymm as string) || "");
            if (award) row.iihs_award = award;
          }
        } catch { /* award must never break the payload */ }

        // ── Contact routing: resolve WHO this shopper reaches (agent / BDC /
        // store) server-side and attach only the result. The roster, priority
        // ladder, and rotation memory never reach the anonymous client.
        try {
          const agents = (Array.isArray(s.passport_agents) ? s.passport_agents : []) as PassportAgent[];
          const assignments = (s.vehicle_agent_assignments ?? {}) as Record<string, string>;
          const assignedAgentId =
            (row.assigned_agent_id as string) || assignments[String(row.vin || "").toUpperCase()] || assignments[String(row.vin || "")] || null;
          const routing = resolveCustomerPassportRouting(
            { ...(s.passport_contact_routing ?? {}), dealershipDefaultContact: {
              salesPhone: ((s.passport_contact_routing as Record<string, Record<string, string>> | undefined)?.dealershipDefaultContact?.salesPhone) || (s.dealer_phone as string) || "",
              salesEmail: ((s.passport_contact_routing as Record<string, Record<string, string>> | undefined)?.dealershipDefaultContact?.salesEmail) || (s.view_notify_email as string) || "",
            } },
            {
              agents,
              assignedAgentId,
              rotationState: (s.passport_rotation_state ?? {}) as Record<string, string>,
              now: new Date(),
            },
          );
          // Strip internal email before it ships to an anonymous page.
          row.contact_routing = { ...routing, email: undefined };
        } catch { /* routing must never break the listing payload */ }

        // ── Factory warranty for new / CPO cars. The dealer verifies OEM
        // warranty terms per brand in admin; here we match the listing's make
        // and, when the listing itself carries no warranty_info, synthesize it
        // so the passport shows the factory coverage. New cars have no prior
        // in-service date — the full term carries forward from the listing
        // date, so we stamp published_at/created_at/today as the start. Only
        // VERIFIED terms are used.
        const ymm = String((row.ymm as string) || "").toUpperCase();
        const cond = String((row.condition as string) || "").toLowerCase();
        const hasWarranty = row.warranty_info && Object.keys(row.warranty_info as object).length > 0;
        if (ymm && (cond === "new" || cond === "cpo") && !hasWarranty) {
          // deno-lint-ignore no-explicit-any
          const warranties: any[] = Array.isArray(s.oem_factory_warranties) ? s.oem_factory_warranties as any[] : [];
          const w = warranties.find((x) => {
            const b = String(x?.brand || "").trim().toUpperCase();
            return b.length > 1 && x?.verified === true && ymm.includes(b);
          });
          if (w) {
            // A new, unregistered car's factory clock hasn't started — coverage
            // begins at delivery — so its warranty start always rolls forward to
            // today. Used/CPO keep their real in-service (publish) date.
            const start = cond === "new"
              ? new Date().toISOString()
              : ((row.published_at as string) || (row.created_at as string) || new Date().toISOString());
            // Unlimited (sentinel -1) or unset miles → omit the cap so the
            // passport renders a time-only term and never does negative-mile math.
            const finiteMiles = (n: unknown) => { const v = Number(n); return v > 0 ? v : undefined; };
            // A CPO buyer is a subsequent owner, so use the transferred terms
            // where the make reduces them (e.g. Hyundai/Kia 10/100 → 5/60).
            const subsequent = cond === "cpo";
            const bMonths = subsequent && w.basic_transfer_months ? w.basic_transfer_months : w.basic_months;
            const bMiles = subsequent && w.basic_transfer_miles ? w.basic_transfer_miles : w.basic_miles;
            const ptMonths = subsequent && w.powertrain_transfer_months ? w.powertrain_transfer_months : w.powertrain_months;
            const ptMiles = subsequent && w.powertrain_transfer_miles ? w.powertrain_transfer_miles : w.powertrain_miles;
            row.warranty_info = {
              factory_months: Number(bMonths) || undefined,
              factory_miles: finiteMiles(bMiles),
              powertrain_months: Number(ptMonths) || undefined,
              powertrain_miles: finiteMiles(ptMiles),
              in_service_date: String(start).slice(0, 10),
            };
            // Full coverage breakdown for the passport's factory-warranty
            // slide-out (bumper-to-bumper, powertrain, corrosion, roadside,
            // hybrid/EV battery, maintenance). Owner-resolved powertrain/basic;
            // other lines pass through. Miles use the -1 unlimited sentinel.
            const numOrU = (n: unknown) => { const v = Number(n); return v === -1 ? -1 : v > 0 ? v : undefined; };
            row.oem_warranty = {
              brand: w.brand,
              verified: true,
              owner: subsequent ? "subsequent" : "original",
              basic_months: Number(bMonths) || undefined,
              basic_miles: numOrU(bMiles),
              powertrain_months: Number(ptMonths) || undefined,
              powertrain_miles: numOrU(ptMiles),
              corrosion_months: Number(w.corrosion_months) || undefined,
              corrosion_miles: numOrU(w.corrosion_miles),
              roadside_months: Number(w.roadside_months) || undefined,
              roadside_miles: numOrU(w.roadside_miles),
              ev_battery_months: Number(w.ev_battery_months) || undefined,
              ev_battery_miles: numOrU(w.ev_battery_miles),
              maintenance_months: Number(w.maintenance_months) || undefined,
              maintenance_miles: numOrU(w.maintenance_miles),
              notes: w.notes || undefined,
            };
          }
        }

        // ── CPO program details for CPO listings (matched OEM-by-brand, plus
        // any dealer-certified program). Surfaced on the passport CPO block.
        if (cond === "cpo") {
          // deno-lint-ignore no-explicit-any
          const programs: any[] = Array.isArray(s.cpo_programs) ? s.cpo_programs as any[] : [];
          const matched = programs.filter((p) => {
            if (!p?.enabled || p?.show_on_passport === false) return false;
            if (p?.kind === "dealer") return true;
            const b = String(p?.brand || "").trim().toUpperCase();
            return b.length > 1 && ymm.includes(b);
          });
          if (matched.length) row.cpo_programs = matched;
        }
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

    // ── Customer-safe reconditioning & inspection summary (iPacket parity).
    // The service/prep/detail/install sign-offs are tenant-scoped; expose only
    // shopper-appropriate facts (what was done, dates, photos) — never names,
    // notes, signatures, or IPs. service-docs is a public bucket, so the photo
    // URLs load for anonymous shoppers.
    try {
      if (row.vin && row.tenant_id) {
        const vinU = String(row.vin).toUpperCase();
        const pubUrl = (p: unknown): string | null => {
          const s = typeof p === "string" ? p : (p && typeof p === "object" ? (p as { url?: string }).url : null);
          if (!s) return null;
          if (/^https?:\/\//i.test(s)) return s;
          return `${supabaseUrl}/storage/v1/object/public/service-docs/${String(s).replace(/^\/+/, "")}`;
        };
        const [insp, prep, detail, installs] = await Promise.all([
          admin.from("safety_inspections").select("form_type, result, signed_at").eq("vin", vinU).eq("tenant_id", row.tenant_id).eq("status", "signed").order("signed_at", { ascending: false }).limit(1),
          admin.from("prep_sign_offs").select("install_photos, accessories_installed, signed_at, inspection_passed").eq("vehicle_vin", vinU).eq("tenant_id", row.tenant_id).eq("listing_unlocked", true).order("signed_at", { ascending: false }).limit(1),
          // Every signed detail/install sign-off — many parties (detail, parts,
          // service, outside vendors) can each sign off their own work.
          admin.from("detail_signoffs").select("detail_types, installs, photos, is_third_party, provider_company, signed_at").eq("vin", vinU).eq("tenant_id", row.tenant_id).eq("status", "signed").order("signed_at", { ascending: false }).limit(50),
          // Tenant-scoped (same-VIN cars at other dealers must not leak) and
          // is_verified only — an install isn't "proven" to the shopper without
          // both a photo and the installer's signature.
          admin.from("install_proofs").select("product_name, installer_company, photo_path, installed_at").eq("vehicle_vin", vinU).eq("tenant_id", row.tenant_id).eq("is_verified", true).order("installed_at", { ascending: false }).limit(20),
        ]);
        const inspRow = (insp.data || [])[0] as { form_type?: string; result?: string; signed_at?: string } | undefined;
        const prepRow = (prep.data || [])[0] as { install_photos?: unknown[]; accessories_installed?: unknown[]; signed_at?: string; inspection_passed?: boolean } | undefined;
        const detailRows = (detail.data || []) as { detail_types?: unknown[]; installs?: unknown[]; photos?: unknown[]; is_third_party?: boolean; provider_company?: string; signed_at?: string }[];
        const installRows = (installs.data || []) as { product_name?: string; installer_company?: string; photo_path?: string; installed_at?: string }[];

        const labelOf = (v: unknown): string | null =>
          typeof v === "string" ? v : (v && typeof v === "object" ? ((v as { label?: string; name?: string }).label || (v as { name?: string }).name || null) : null);

        const items: string[] = [];
        const detailThirdParty: { product: string; company: string }[] = [];
        for (const dr of detailRows) {
          (Array.isArray(dr.detail_types) ? dr.detail_types : []).forEach((t) => { const l = labelOf(t); if (l) items.push(l); });
          (Array.isArray(dr.installs) ? dr.installs : []).forEach((i) => { const l = labelOf(i); if (l) { items.push(l); if (dr.is_third_party && dr.provider_company) detailThirdParty.push({ product: l, company: dr.provider_company }); } });
        }
        (Array.isArray(prepRow?.accessories_installed) ? prepRow!.accessories_installed : []).forEach((a) => {
          const name = labelOf(a);
          if (name) items.push(name);
        });
        installRows.forEach((i) => { if (i.product_name) items.push(i.product_name); });

        const photos = [
          ...(Array.isArray(prepRow?.install_photos) ? prepRow!.install_photos : []),
          ...detailRows.flatMap((dr) => Array.isArray(dr.photos) ? dr.photos : []),
          ...installRows.map((i) => i.photo_path),
        ].map(pubUrl).filter((u): u is string => !!u).slice(0, 12);

        const inspectionType = inspRow
          ? (/k.?208/i.test(inspRow.form_type || "") ? "Connecticut K-208 safety inspection"
             : /pdi|pre.?delivery/i.test(inspRow.form_type || "") ? "Pre-delivery inspection"
             : "Multi-point inspection")
          : null;

        const recon = {
          inspection: inspRow ? { type: inspectionType, passed: (inspRow.result || "").toLowerCase() !== "fail", date: inspRow.signed_at || null } : null,
          detailed: detailRows.length > 0,
          detailDate: detailRows[0]?.signed_at || null,
          workItems: Array.from(new Set(items)).slice(0, 24),
          thirdParty: [
            ...detailThirdParty,
            ...installRows.filter((i) => i.installer_company).map((i) => ({ product: i.product_name || "Accessory", company: i.installer_company as string })),
          ],
          photos,
        };
        if (recon.inspection || recon.detailed || recon.workItems.length || recon.photos.length) row.recon = recon;
      }
    } catch { /* recon optional — module shows a pending state */ }

    // ── Same-rooftop alternatives ─────────────────────────────────────────
    // The passport never merchandises other dealers' cars, so every "similar
    // vehicles" module shows the tenant's OWN published stock, tiered:
    //   1. same model — ANY condition (a new car's pre-owned twin, and vice
    //      versa, is the strongest cross-shop we can offer);
    //   2. same make;
    //   3. competitive set — same body type or price band from the rest of the
    //      lot, when nothing closer exists.
    // Package data from each sibling's build_sheet lets the client position
    // alternatives as higher/lower-equipped.
    try {
      if (row.tenant_id) {
        const { data: sibs } = await admin
          .from("vehicle_listings")
          .select("slug, ymm, trim, price, mileage, condition, hero_image_url, mc_attributes, key_specs")
          .eq("tenant_id", row.tenant_id)
          .eq("status", "published")
          .neq("id", row.id)
          .limit(80);
        if (sibs?.length) {
          const words = (ymm: unknown) => String(ymm || "").toLowerCase().replace(/^\s*(19|20)\d{2}\s+/, "").split(/\s+/).filter(Boolean);
          const cur = words(row.ymm);
          const overlap = (a: string[], b: string[]) => a.filter((w) => b.includes(w)).length;
          // deno-lint-ignore no-explicit-any
          const bodyOf = (s: any) => String(s?.mc_attributes?.body_type ?? s?.key_specs?.body_style ?? s?.key_specs?.body ?? "").toLowerCase().trim();
          // deno-lint-ignore no-explicit-any
          const summarize = (mc: any) => {
            const sh = mc && typeof mc === "object" ? mc.build_sheet : null;
            if (!sh || typeof sh !== "object") return { package_count: null, option_value: null, top_packages: [] as string[] };
            const pkgs = Array.isArray(sh.packages) ? sh.packages : [];
            const opts = Array.isArray(sh.options) ? sh.options : [];
            const msrps = [...pkgs, ...opts].map((p: { msrp?: unknown }) => Number(p?.msrp)).filter((n: number) => Number.isFinite(n) && n > 0);
            return {
              package_count: pkgs.length,
              option_value: msrps.length ? msrps.reduce((a: number, b: number) => a + b, 0) : null,
              top_packages: pkgs.slice(0, 3).map((p: { name?: unknown }) => String(p?.name || "")).filter(Boolean),
            };
          };
          const price = Number(row.price) || null;
          const curBody = bodyOf(row);
          const scored = (sibs as Record<string, unknown>[]).map((s) => {
            const ov = overlap(cur, words(s.ymm));
            const sPrice = Number(s.price) || null;
            const priceGap = price != null && sPrice != null ? Math.abs(sPrice - price) : Number.MAX_SAFE_INTEGER;
            const inBand = price != null && sPrice != null && priceGap <= price * 0.25;
            const sameBody = !!curBody && bodyOf(s) === curBody;
            const tier = ov >= 2 ? 1 : ov >= 1 ? 2 : (sameBody || inBand) ? 3 : 0;
            return { s, tier, priceGap };
          }).filter((x) => x.tier > 0);
          // Prefer closer tiers; only reach into the competitive set when the
          // closer tiers are thin.
          const ranked = scored
            .sort((a, b) => a.tier - b.tier || a.priceGap - b.priceGap)
            .slice(0, 6)
            .map(({ s, tier }) => ({
              slug: s.slug, ymm: s.ymm, trim: s.trim, price: s.price, mileage: s.mileage,
              condition: s.condition, image: s.hero_image_url || null,
              same_model: tier === 1, tier,
              ...summarize(s.mc_attributes),
            }));
          if (ranked.length) row.dealer_similar = ranked;
        }
      }
    } catch { /* alternatives optional — module hides when absent */ }

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

    // ── #2 "Your packet was viewed" notification ────────────────────────────
    // When the dealer has opted in, email the configured recipient that a
    // shopper opened this vehicle's packet. Deduped to once per shopper session
    // (or, with no session, once per VIN / 6h) so the salesperson gets a real
    // heads-up without being buried by repeat opens, refreshes, or scrapers.
    try {
      if (row.tenant_id) {
        const { data: prof } = await admin
          .from("dealer_profiles").select("settings").eq("tenant_id", row.tenant_id).maybeSingle();
        const s = (prof?.settings ?? {}) as Record<string, unknown>;
        const enabled = s.view_notify_enabled === true || String(s.view_notify_enabled) === "true";
        const recipients = String(s.view_notify_email || "")
          .split(/[\n,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
        if (enabled && recipients.length && row.vin) {
          const vinU = String(row.vin).toUpperCase();
          const sinceIso = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
          let dq = admin.from("audit_log").select("id", { head: true, count: "exact" })
            .eq("action", "packet_view_notified").eq("entity_id", row.id).gte("created_at", sinceIso);
          if (sessionId) dq = admin.from("audit_log").select("id", { head: true, count: "exact" })
            .eq("action", "packet_view_notified").eq("entity_id", row.id)
            .contains("details", { session: sessionId });
          const { count: already } = await dq;
          if (!already) {
            const title = [row.year, row.make, row.model, row.trim].filter(Boolean).join(" ").trim() || "your vehicle";
            const priceNum = typeof row.price === "number" ? row.price : Number(row.price);
            const priceStr = Number.isFinite(priceNum) && priceNum > 0
              ? `$${Math.round(priceNum).toLocaleString("en-US")}` : "";
            const origin = (req.headers.get("origin") || "").replace(/\/$/, "");
            const packetUrl = `${origin || "https://autolabels.io"}/v/${encodeURIComponent(row.slug || vinU)}`;
            const stockStr = (row.mc_attributes && (row.mc_attributes as Record<string, unknown>).stock_no) || row.stock_number || "";
            const html = `
              <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
                <p style="font-size:15px;margin:0 0 4px">A shopper just opened the digital packet for:</p>
                <h2 style="font-size:20px;margin:8px 0 2px">${title}</h2>
                ${priceStr ? `<p style="font-size:15px;color:#2563EB;font-weight:700;margin:0 0 2px">${priceStr}</p>` : ""}
                <p style="font-size:13px;color:#475569;margin:0 0 16px">VIN ${vinU}${stockStr ? ` &middot; Stock ${stockStr}` : ""}</p>
                <a href="${packetUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:11px 18px;border-radius:12px;font-weight:600;font-size:14px">View the packet</a>
                <p style="font-size:12px;color:#94A3B8;margin:18px 0 0">You're receiving this because packet-view alerts are on for this dealership. Turn them off in AutoLabels &rarr; Admin.</p>
              </div>`;
            await fetch(`${supabaseUrl}/functions/v1/send-email`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
              body: JSON.stringify({ to: recipients, subject: `Packet viewed: ${title}`, html }),
            }).catch(() => {});
            await admin.from("audit_log").insert({
              action: "packet_view_notified", entity_type: "vehicle_listing", entity_id: row.id,
              store_id: row.store_id || null, details: { vin: vinU, session: sessionId || null, recipients: recipients.length },
            });
          }
        }
      }
    } catch { /* notification is best-effort; never block the shopper view */ }

    // ── Official OEM brochure link from the global harvest cache: exact
    // model year first, otherwise the nearest within two model years.
    try {
      const parts = String((row.ymm as string) || "").trim().split(/\s+/);
      const yr = Number.parseInt(parts[0] || "", 10) || null;
      const mk = parts[1] || "";
      const md = parts.slice(2).join(" ");
      if (mk && md) {
        const { data: bl } = await admin
          .from("oem_brochure_links")
          .select("url, title, year")
          .ilike("make", mk).ilike("model", md)
          .order("year", { ascending: false, nullsFirst: false })
          .limit(6);
        const rows = (bl || []) as { url: string; title: string | null; year: number | null }[];
        const pick = (yr ? rows.find((r) => r.year === yr) : rows[0]) ||
          rows.find((r) => r.year != null && yr != null && Math.abs(r.year - yr) <= 2) ||
          (!yr ? rows[0] : undefined);
        if (pick) row.oem_brochure = { url: pick.url, title: pick.title, year: pick.year };
      }
    } catch { /* brochure link optional */ }

    // ── Packet curation enforcement. A module the dealer excluded must not
    // ship in the public payload at all — client gating alone would still
    // leak the data to anyone reading the response. Per-vehicle override
    // wins, then the store template, then visible.
    try {
      const perVehicle = (row.packet_modules ?? null) as Record<string, boolean> | null;
      const storeDefaults = (row.packet_defaults ?? null) as Record<string, boolean> | null;
      const vis = (id: string): boolean => {
        const v = perVehicle?.[id];
        if (typeof v === "boolean") return v;
        const d = storeDefaults?.[id];
        if (typeof d === "boolean") return d;
        return true;
      };
      if (!vis("historyReport")) { delete row.history_report; delete row.history_report_url; }
      if (!vis("brochure")) delete row.oem_brochure;
      if (!vis("recon")) delete row.recon;
      if (!vis("videos")) delete row.videos;
      if (!vis("description")) delete row.description;
      if (!vis("marketValue")) delete row.value_history;
      if (!vis("warranty")) {
        delete row.warranty_info; delete row.oem_warranty; delete row.cpo_programs;
        delete row.service_records; delete row.available_accessories; delete row.dealer_coverage;
      }
      const docs = Array.isArray(row.documents) ? row.documents as { type?: string }[] : [];
      if (!vis("documents")) {
        row.documents = vis("oemSticker") ? docs.filter((d) => d?.type === "window_sticker") : [];
      } else if (!vis("oemSticker")) {
        row.documents = docs.filter((d) => d?.type !== "window_sticker");
      }
      // Photos off = no gallery; the single lead photo stays so the packet
      // header is never an empty frame.
      if (!vis("photos") && Array.isArray(row.photos)) {
        row.photos = (row.photos as unknown[]).slice(0, 1);
      }
    } catch { /* curation is best-effort shaping; never block the shopper view */ }

    return json(200, { listing: row });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});
