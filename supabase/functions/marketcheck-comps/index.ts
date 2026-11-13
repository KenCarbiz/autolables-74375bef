// ──────────────────────────────────────────────────────────────────────
// marketcheck-comps — comparable active listings + price stats for a vehicle,
// for the Passport V2 "Comparable Vehicles" detail page. Server-side only.
//
// A public Passport load never spends provider credits (change order 2026-10-27,
// guardrail "public Passport page loads cannot spend provider credits"): an
// anonymous caller is served the cached comp set, or the honest pending state.
// Only a signed-in member of the listing's tenant, a platform admin or the
// service role may buy a refresh on a cache miss.
//
// Body: { slug: string }
// Returns: { count, median, comparables: [...], checkedAt }
//          or { available: false, reason } when MarketCheck isn't configured
//          or has no comps — the page then shows an honest pending state.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient } from "../_shared/supabase.ts";
import { admitProviderCall, recordProviderCall } from "../_shared/providerBudget.ts";
import { properMedian, trimCohortOutliers, splitCohortRows, describeCohort } from "../_shared/compCohort.ts";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";

// deno-lint-ignore no-explicit-any
const num = (v: any): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// An anonymous shopper may see a comp set up to a week old; older than that it
// is no longer a fair picture of the market and the page shows pending.
const PUBLIC_STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

async function callerMayRefresh(req: Request, admin: ReturnType<typeof adminClient>, tenantId: string | null): Promise<boolean> {
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return false;
  if (SERVICE_KEY && auth === SERVICE_KEY) return true;
  const { data: ures, error: uerr } = await admin.auth.getUser(auth).catch(() => ({ data: null, error: true }));
  const userId = ures?.user?.id;
  if (uerr || !userId) return false;
  const { data: isAdmin } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (isAdmin) return true;
  if (!tenantId) return false;
  const { data: membership } = await admin.from("tenant_members").select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
  return !!membership;
}

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
    // A payload cached before the cohort fix was built from a price band at or
    // above our own price. It may still be shown as a list, but its median and
    // count carry no claim.
    const legacySafe = (p: Record<string, unknown>): Record<string, unknown> =>
      p.cohort ? p : { ...p, median: null, count: null, legacyBiasedSelection: true };
    const respond = async (payload: Record<string, unknown>) => {
      await admin.from("marketcheck_comps_cache")
        .upsert({ slug: cacheSlug, tenant_id: row.tenant_id ?? null, payload, cached_at: new Date().toISOString() }, { onConflict: "slug" })
        .then(() => undefined, () => undefined);
      return json(200, payload);
    };
    const { data: hit } = await admin.from("marketcheck_comps_cache")
      .select("payload, cached_at").eq("slug", cacheSlug).maybeSingle();
    const cacheAgeMs = hit?.payload && hit.cached_at ? Date.now() - new Date(hit.cached_at as string).getTime() : null;
    if (cacheAgeMs != null && cacheAgeMs < CACHE_TTL_MS) {
      return json(200, { ...legacySafe(hit!.payload as Record<string, unknown>), cached: true });
    }
    if (!(await callerMayRefresh(req, admin, row.tenant_id ?? null))) {
      if (cacheAgeMs != null && cacheAgeMs < PUBLIC_STALE_MAX_MS) {
        return json(200, { ...legacySafe(hit!.payload as Record<string, unknown>), cached: true, stale: true });
      }
      return json(200, { available: false, reason: "not_cached" });
    }

    const ymm = String(row.ymm || "").trim();
    const [year, make, ...model] = ymm.split(/\s+/);
    const dealer = (row.dealer_snapshot || {}) as Record<string, unknown>;
    const zip = String(dealer.zip || row.vehicle_zip || "").trim();
    const trim = String(row.trim || "").trim();
    const subjectVin = String(row.vin || "").toUpperCase();
    const dealerName = (dealer.name ?? dealer.display_name) as string | null ?? null;

    // Price-independent cohort: year / make / model / trim / radius / mileage
    // band only. The comp set must never be shaped by our asking price, so no
    // price_range is sent and no price ratio is applied afterwards. Rows are
    // the nearest ones (sort_by dist; a provider rejection retries once with
    // the provider default order). Dealers' comp_settings may still narrow the
    // cohort by mileage band, trim and drivetrain, none of which depend on
    // price; their value_building / price-ratio settings are intentionally
    // ignored here because they filter comparables by our own price.
    const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", row.tenant_id).maybeSingle();
    const cset = (((prof?.settings as Record<string, unknown>)?.comp_settings as Record<string, unknown>) || {}) as Record<string, unknown>;
    const bandNum = Number(cset.mileageBandPercent);
    const bandPercent: number | null = cset.requireSimilarMileageBand === false ? null : (Number.isFinite(bandNum) && bandNum > 0 ? bandNum : 25);
    const sameTrimRule = cset.requireSameTrimWhenAvailable !== false;
    const sameDtRule = cset.requireSameDrivetrainWhenAvailable !== false;
    const ourMiles = num(row.mileage);
    const carType = row.condition === "new" ? "new" : "used";
    const milesBand = carType === "used" && bandPercent != null && ourMiles != null && ourMiles > 0
      ? `${Math.max(0, Math.floor(ourMiles * (1 - bandPercent / 100)))}-${Math.ceil(ourMiles * (1 + bandPercent / 100))}`
      : null;
    const buildParams = (useTrim: boolean, sortByDist: boolean) => {
      const p = new URLSearchParams({ api_key: MC_KEY, car_type: carType, rows: "50" });
      if (zip && sortByDist) { p.set("sort_by", "dist"); p.set("sort_order", "asc"); }
      if (year && /^\d{4}$/.test(year)) p.set("year", year);
      if (make) p.set("make", make);
      if (model.length) p.set("model", model.join(" "));
      if (useTrim && trim) p.set("trim", trim);
      if (zip) { p.set("zip", zip); p.set("radius", "150"); }
      if (milesBand) p.set("miles_range", milesBand);
      return p;
    };

    let sortBasis = zip ? "distance" : "provider_default";
    const fetchPass = async (useTrim: boolean) => {
      const call = async (sortByDist: boolean) => {
        const url = `${MC_BASE}/search/car/active?${buildParams(useTrim, sortByDist).toString()}`;
        // A public page may not spend the month's reserve: a denied call reads
        // as the provider declining, and the page shows its honest pending state.
        const gate = await admitProviderCall(admin, { url, caller: "marketcheck-comps", tenantId: row.tenant_id ?? null, vin: subjectVin || null });
        if (!gate.admitted) return { ok: false as const, status: 0, b: {} as Record<string, unknown>, budgetDenied: true as const };
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        await recordProviderCall(admin, gate.eventId, res.status, res.status === 429 ? await res.clone().text().catch(() => "") : null);
        if (!res.ok) return { ok: false as const, status: res.status, b: {} as Record<string, unknown>, budgetDenied: false as const };
        // deno-lint-ignore no-explicit-any
        const b: any = await res.json().catch(() => ({}));
        return { ok: true as const, status: res.status, b };
      };
      let out = await call(!!zip && sortBasis === "distance");
      if (!out.ok && !out.budgetDenied && out.status >= 400 && out.status < 500 && zip && sortBasis === "distance") {
        sortBasis = "provider_default";
        out = await call(false);
      }
      return out;
    };

    let pass = await fetchPass(true);
    if (!pass.ok) return json(200, { available: false, reason: pass.budgetDenied ? "budget_denied" : `provider_${pass.status}` });
    let usedTrim = !!trim;
    // deno-lint-ignore no-explicit-any
    const listingsOf = (b: any): Record<string, unknown>[] => (Array.isArray(b?.listings) ? b.listings : []);
    let split = splitCohortRows(listingsOf(pass.b), subjectVin, dealerName);
    if (split.rows.length === 0 && trim) {
      pass = await fetchPass(false);
      usedTrim = false;
      if (pass.ok) split = splitCohortRows(listingsOf(pass.b), subjectVin, dealerName);
    }
    const b = pass.b;
    const filtered = split.rows;

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

    const ourDrivetrain = String(((row.mc_attributes || {}) as Record<string, unknown>).drivetrain || ((row.mc_attributes || {}) as Record<string, unknown>).drive_type || "");
    const normalize = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const normDt = (s: unknown) => {
      const v = normalize(s);
      if (/^(4wd|4x4|fourwheeldrive)$/.test(v)) return "4wd";
      if (/^(awd|allwheeldrive)$/.test(v)) return "awd";
      if (/^(fwd|frontwheeldrive)$/.test(v)) return "fwd";
      if (/^(rwd|rearwheeldrive)$/.test(v)) return "rwd";
      return v;
    };
    const trimOk = (c: { trim: string | null }) => !sameTrimRule || !trim || !c.trim || normalize(c.trim) === normalize(trim);
    const dtOk = (c: { drivetrain: string | null }) => !sameDtRule || !ourDrivetrain || !c.drivetrain || normDt(c.drivetrain) === normDt(ourDrivetrain);
    const qualified = mapped.filter((c) => trimOk(c) && dtOk(c));
    const trimmed = trimCohortOutliers(qualified);
    const analysed = trimmed.analysed;
    const sortedPrices = analysed.map((c) => c.price as number).sort((a, z) => a - z);
    const median = properMedian(sortedPrices);
    const scoreComp = (c: typeof mapped[number]) => {
      let sc = 0;
      if (trim && c.trim && normalize(c.trim) === normalize(trim)) sc += 30;
      if (ourDrivetrain && c.drivetrain && normDt(c.drivetrain) === normDt(ourDrivetrain)) sc += 20;
      if (c.distance != null && c.distance <= 25) sc += 10;
      return sc;
    };
    const comparables = [...analysed].sort((a, b2) => scoreComp(b2) - scoreComp(a) || (a.distance ?? 1e9) - (b2.distance ?? 1e9)).slice(0, 8);

    const nf = typeof b?.num_found === "number" ? b.num_found : parseInt(String(b?.num_found ?? ""), 10);
    const totalMatches = Number.isFinite(nf) ? nf : null;
    const rawListings = listingsOf(b).length;

    if ((totalMatches ?? 0) === 0 && mapped.length === 0) return await respond({ available: false, reason: "no_comps" });
    if (analysed.length === 0) return await respond({ available: false, reason: "no_comps_analyzed" });

    const cohort = describeCohort({
      totalMatches, returned: rawListings, analysed: analysed.length, sortBasis,
      radius: zip ? 150 : null, year: year && /^\d{4}$/.test(year) ? year : null,
      trim: usedTrim && trim ? trim : null,
      milesBand: milesBand ? { percent: bandPercent, range: milesBand } : null,
      subject: split.subjectCount, own: split.ownRows.length,
      unpriced: trimmed.unpriced, mismatch: mapped.length - qualified.length, outliers: trimmed.outliers,
      outlierRule: trimmed.rule,
    });
    // `count` keeps its old name for cached-payload readers but is total
    // provider matches; `analyzedCount` is the records the median is built on.
    return await respond({
      available: true, count: totalMatches ?? analysed.length, totalMatches, analyzedCount: analysed.length,
      median, medianBasis: "median asking price of the analyzed cohort rows", comparables, ourPrice: num(row.price),
      strategy: "price_independent_cohort", cohort, checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json(200, { available: false, reason: err instanceof Error ? err.message : "unknown" });
  }
});
