// ──────────────────────────────────────────────────────────────────────
// marketcheck-comps — comparable active listings + price stats for a vehicle,
// for the Passport V2 "Comparable Vehicles" detail page. Server-side only.
//
// Invoked on demand (NOT on every passport view) so MarketCheck quota is only
// spent when a shopper actually opens the comp set.
//
// Body: { slug: string }
// Returns: { count, median, comparables: [...], checkedAt }
//          or { available: false, reason } when MarketCheck isn't configured
//          or has no comps — the page then shows an honest pending state.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient } from "../_shared/supabase.ts";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";

// deno-lint-ignore no-explicit-any
const num = (v: any): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "supabase not configured" });

    const { slug } = await req.json().catch(() => ({}));
    if (!slug || typeof slug !== "string") return json(400, { error: "slug required" });

    if (!MC_KEY) return json(200, { available: false, reason: "marketcheck_not_configured" });

    const admin = adminClient();

    // ── Rate limit per IP: caps unauthenticated MarketCheck quota burn.
    // Public passport shoppers legitimately hit this on demand, so we cap at
    // 20 comp-lookups / 5min and 80 / hour per source IP (mirrors the shape
    // used by public-listing-view). The 12h per-slug cache below still absorbs
    // repeat calls on the same vehicle for free.
    const clientIp = (req.headers.get("cf-connecting-ip") ||
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      req.headers.get("x-real-ip") || "unknown");
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const oneHrAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const [rl5, rl60] = await Promise.all([
      admin.from("audit_log").select("id", { head: true, count: "exact" })
        .eq("action", "mc_comps_lookup").eq("ip_address", clientIp).gte("created_at", fiveMinAgo),
      admin.from("audit_log").select("id", { head: true, count: "exact" })
        .eq("action", "mc_comps_lookup").eq("ip_address", clientIp).gte("created_at", oneHrAgo),
    ]);
    if ((rl5.count ?? 0) >= 20 || (rl60.count ?? 0) >= 80) {
      return json(429, { error: "rate_limited", retry_after: 300 }, { "Retry-After": "300" });
    }
    admin.from("audit_log").insert({ action: "mc_comps_lookup", entity_type: "listing", entity_id: slug.slice(0, 120), ip_address: clientIp })
      .then(() => undefined, () => undefined);

    // Resolve the listing (slug, then VIN fallback) — mirror public-listing-view.
    let { data } = await admin.rpc("get_vehicle_listing_by_slug", { _slug: slug });
    let row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      const { data: byVin } = await admin.from("vehicle_listings").select("slug").eq("vin", slug.toUpperCase()).limit(1);
      const alt = Array.isArray(byVin) ? byVin[0] : byVin;
      if (alt?.slug) { ({ data } = await admin.rpc("get_vehicle_listing_by_slug", { _slug: alt.slug })); row = Array.isArray(data) ? data[0] : data; }
    }
    if (!row) return json(404, { error: "not_found" });

    // ── Quota guard: serve a recent cached comp set instead of re-hitting the
    // paid MarketCheck API. This is what stops unauthenticated repeat calls from
    // draining quota — MarketCheck is spent at most once per vehicle per TTL.
    const cacheSlug = String(row.slug || slug);
    const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // comps move slowly
    const respond = async (payload: Record<string, unknown>) => {
      await admin.from("marketcheck_comps_cache")
        .upsert({ slug: cacheSlug, tenant_id: row.tenant_id ?? null, payload, cached_at: new Date().toISOString() }, { onConflict: "slug" })
        .then(() => undefined, () => undefined);
      return json(200, payload);
    };
    {
      const { data: hit } = await admin.from("marketcheck_comps_cache")
        .select("payload, cached_at").eq("slug", cacheSlug).maybeSingle();
      if (hit?.payload && hit.cached_at && (Date.now() - new Date(hit.cached_at as string).getTime()) < CACHE_TTL_MS) {
        return json(200, { ...(hit.payload as Record<string, unknown>), cached: true });
      }
    }

    const ymm = String(row.ymm || "").trim();
    const [year, make, ...model] = ymm.split(/\s+/);
    const dealer = (row.dealer_snapshot || {}) as Record<string, unknown>;
    const zip = String(dealer.zip || row.vehicle_zip || "").trim();
    const trim = String(row.trim || "").trim();
    const normDealer = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const ownName = normDealer(dealer.name ?? dealer.display_name);
    const subjectVin = String(row.vin || "").toUpperCase();

    // Same equipment level wherever possible (trim-matched), and never the
    // dealer's own rooftop — a mismatched comp set reads as "off" and sends
    // shoppers elsewhere. Try trim-matched first; relax to model-level only if
    // that yields nothing usable.
    const priceForBand = num(row.price);
    const buildParams = (useTrim: boolean) => {
      const p = new URLSearchParams({ api_key: MC_KEY, car_type: row.condition === "new" ? "new" : "used", rows: "20", sort_by: "price", sort_order: "asc", stats: "price" });
      if (year && /^\d{4}$/.test(year)) p.set("year", year);
      if (make) p.set("make", make);
      if (model.length) p.set("model", model.join(" "));
      if (useTrim && trim) p.set("trim", trim);
      if (zip) { p.set("zip", zip); p.set("radius", "150"); }
      // Scope the search UPWARD from our price (mirrors vehicle-enrich's
      // banding): a price-ascending unbounded search returns the 20 CHEAPEST
      // cars in the market, which the value filter below then discards.
      if (priceForBand) p.set("price_range", `${Math.round(priceForBand)}-${Math.round(priceForBand * 1.35)}`);
      return p;
    };
    const usable = (b: { listings?: unknown }) => (Array.isArray(b?.listings) ? b.listings : [])
      .filter((l: Record<string, unknown>) => {
        if (String(l.vin || "").toUpperCase() === subjectVin) return false;
        const cn = normDealer((l.dealer as Record<string, unknown>)?.name ?? l.seller_name);
        if (ownName && cn && (cn.includes(ownName) || ownName.includes(cn))) return false;
        if (Number(l.dist) === 0) return false;
        return true;
      });

    const fetchPass = async (useTrim: boolean) => {
      const res = await fetch(`${MC_BASE}/search/car/active?${buildParams(useTrim).toString()}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { ok: false as const, status: res.status, b: {} as Record<string, unknown> };
      // deno-lint-ignore no-explicit-any
      const b: any = await res.json().catch(() => ({}));
      return { ok: true as const, status: res.status, b };
    };

    let pass = await fetchPass(true);
    if (!pass.ok) return json(200, { available: false, reason: `provider_${pass.status}` });
    let filtered = usable(pass.b);
    if (filtered.length === 0 && trim) { pass = await fetchPass(false); filtered = pass.ok ? usable(pass.b) : filtered; }
    const b = pass.b;

    const mapped = filtered.map((l: Record<string, unknown>) => ({
      vin: l.vin ?? null,
      price: num(l.price),
      miles: num(l.miles),
      heading: (l.heading as string) ?? ymm,
      trim: ((l.build as Record<string, unknown>)?.trim as string) ?? null,
      drivetrain: ((l.build as Record<string, unknown>)?.drivetrain as string) ?? null,
      dealer: [(l.dealer as Record<string, unknown>)?.city, (l.dealer as Record<string, unknown>)?.state].filter(Boolean).join(", "),
      distance: num(l.dist),
      dom: num(l.dom) ?? num((l as Record<string, unknown>).dom_active),
    }));

    // ── Value-building comp strategy (mirrors src/lib/compStrategy.ts) ──
    // Comps are sales support: by default only show comps priced at or above
    // this vehicle (up to a 1.35x sanity ceiling), similar mileage, same trim/
    // drivetrain where both sides are known. Dealers can widen the strategy
    // in admin. Filtering only removes real comps — never fabricates.
    const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", row.tenant_id).maybeSingle();
    const cs = { compStrategy: "value_building", minimumCompPriceRatio: 1.0, maximumCompPriceRatio: 1.35, includeLowerPricedComps: false, lowerPricedCompTolerancePercent: 3, requireSimilarMileageBand: true, mileageBandPercent: 25, requireSameTrimWhenAvailable: true, requireSameDrivetrainWhenAvailable: true, ...(((prof?.settings as Record<string, unknown>)?.comp_settings as Record<string, unknown>) || {}) } as Record<string, never> & {
      compStrategy: string; minimumCompPriceRatio: number; maximumCompPriceRatio: number; includeLowerPricedComps: boolean;
      lowerPricedCompTolerancePercent: number; requireSimilarMileageBand: boolean; mileageBandPercent: number;
      requireSameTrimWhenAvailable: boolean; requireSameDrivetrainWhenAvailable: boolean;
    };
    const ourPrice = num(row.price);
    const ourMiles = num(row.mileage);
    const mcAttrs = (row.mc_attributes || {}) as Record<string, unknown>;
    const ourDrivetrain = String(mcAttrs.drivetrain || mcAttrs.drive_type || "");
    const normalize = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const normDt = (s: unknown) => {
      const v = normalize(s);
      if (/^(4wd|4x4|fourwheeldrive)$/.test(v)) return "4wd";
      if (/^(awd|allwheeldrive)$/.test(v)) return "awd";
      if (/^(fwd|frontwheeldrive)$/.test(v)) return "fwd";
      if (/^(rwd|rearwheeldrive)$/.test(v)) return "rwd";
      return v;
    };
    const inBand = (m: number | null) => m == null || ourMiles == null || Math.abs(m - ourMiles) <= ourMiles * (cs.mileageBandPercent / 100);
    const valueFiltered = cs.compStrategy === "all_comps" ? mapped : mapped.filter((c) => {
      let priceOk = true;
      if (ourPrice != null && c.price != null) {
        if (cs.compStrategy === "value_building") {
          const floor = cs.includeLowerPricedComps ? ourPrice * (1 - cs.lowerPricedCompTolerancePercent / 100) : ourPrice * cs.minimumCompPriceRatio;
          priceOk = c.price >= floor && c.price <= ourPrice * cs.maximumCompPriceRatio;
        } else {
          priceOk = c.price >= ourPrice * 0.8 && c.price <= ourPrice * cs.maximumCompPriceRatio;
        }
      }
      const mileageOk = !cs.requireSimilarMileageBand || inBand(c.miles);
      const trimOk = cs.compStrategy !== "value_building" || !cs.requireSameTrimWhenAvailable || !trim || !c.trim || normalize(c.trim) === normalize(trim);
      const dtOk = cs.compStrategy !== "value_building" || !cs.requireSameDrivetrainWhenAvailable || !ourDrivetrain || !c.drivetrain || normDt(c.drivetrain) === normDt(ourDrivetrain);
      return priceOk && mileageOk && trimOk && dtOk;
    });
    const scoreComp = (c: typeof mapped[number]) => {
      let s = 0;
      if (trim && c.trim && normalize(c.trim) === normalize(trim)) s += 30;
      if (ourDrivetrain && c.drivetrain && normDt(c.drivetrain) === normDt(ourDrivetrain)) s += 20;
      if (c.miles != null && ourMiles != null && inBand(c.miles)) s += 20;
      if (ourPrice != null && c.price != null && c.price >= ourPrice) s += 25;
      if (ourPrice != null && c.price != null && c.price > ourPrice) s += 10;
      if (c.distance != null && c.distance <= 25) s += 10;
      if (c.dom != null && c.dom <= 90) s += 5;
      return s;
    };
    const comparables = valueFiltered.sort((a, b2) => scoreComp(b2) - scoreComp(a)).slice(0, 8);

    const nf = typeof b?.num_found === "number" ? b.num_found : parseInt(String(b?.num_found ?? ""), 10);
    const count = Number.isFinite(nf) ? nf : comparables.length;
    const stats = b?.stats?.price || {};
    const median = num(stats.median) ?? num(stats.mean);

    if (count === 0 && mapped.length === 0) return await respond({ available: false, reason: "no_comps" });
    if (comparables.length === 0) return await respond({ available: false, reason: "no_value_comps" });

    return await respond({ available: true, count, median, comparables, ourPrice, strategy: cs.compStrategy, checkedAt: new Date().toISOString() });
  } catch (err) {
    return json(200, { available: false, reason: err instanceof Error ? err.message : "unknown" });
  }
});
