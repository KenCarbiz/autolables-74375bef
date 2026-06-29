// ──────────────────────────────────────────────────────────────────────
// marketcheck-comps — comparable active listings + price stats for a vehicle,
// for the Passport V2 "Comparable Vehicles" detail page. Server-side only.
//
// Invoked on demand (NOT on every passport view) so MarketCheck quota is only
// spent when a shopper actually opens the comp set.
//
// Body: { slug: string }
// Returns: { count, startingAt, median, comparables: [...], checkedAt }
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

    // Resolve the listing (slug, then VIN fallback) — mirror public-listing-view.
    let { data } = await admin.rpc("get_vehicle_listing_by_slug", { _slug: slug });
    let row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      const { data: byVin } = await admin.from("vehicle_listings").select("slug").eq("vin", slug.toUpperCase()).limit(1);
      const alt = Array.isArray(byVin) ? byVin[0] : byVin;
      if (alt?.slug) { ({ data } = await admin.rpc("get_vehicle_listing_by_slug", { _slug: alt.slug })); row = Array.isArray(data) ? data[0] : data; }
    }
    if (!row) return json(404, { error: "not_found" });

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
    const buildParams = (useTrim: boolean) => {
      const p = new URLSearchParams({ api_key: MC_KEY, car_type: row.condition === "new" ? "new" : "used", rows: "20", sort_by: "price", sort_order: "asc", stats: "price" });
      if (year && /^\d{4}$/.test(year)) p.set("year", year);
      if (make) p.set("make", make);
      if (model.length) p.set("model", model.join(" "));
      if (useTrim && trim) p.set("trim", trim);
      if (zip) { p.set("zip", zip); p.set("radius", "150"); }
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

    const comparables = filtered
      .slice(0, 8)
      .map((l: Record<string, unknown>) => ({
        vin: l.vin ?? null,
        price: num(l.price),
        miles: num(l.miles),
        heading: (l.heading as string) ?? ymm,
        trim: ((l.build as Record<string, unknown>)?.trim as string) ?? null,
        dealer: [(l.dealer as Record<string, unknown>)?.city, (l.dealer as Record<string, unknown>)?.state].filter(Boolean).join(", "),
        distance: num(l.dist),
      }));

    const nf = typeof b?.num_found === "number" ? b.num_found : parseInt(String(b?.num_found ?? ""), 10);
    const count = Number.isFinite(nf) ? nf : comparables.length;
    const stats = b?.stats?.price || {};
    const startingAt = num(stats.min) ?? (comparables.length ? num(comparables[0].price) : null);
    const median = num(stats.median) ?? num(stats.mean);

    if (count === 0 && comparables.length === 0) return json(200, { available: false, reason: "no_comps" });

    return json(200, { available: true, count, startingAt, median, comparables, checkedAt: new Date().toISOString() });
  } catch (err) {
    return json(200, { available: false, reason: err instanceof Error ? err.message : "unknown" });
  }
});
