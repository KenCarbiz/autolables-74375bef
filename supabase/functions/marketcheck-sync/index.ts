import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// marketcheck-sync
//
// Per-tenant, super-admin-governed inventory pull from MarketCheck's
// Inventory Search API (https://api.marketcheck.com/v2/search/car/active),
// scoped to each dealer's OWN website domain. Config lives in
// public.marketcheck_sync_config (allowed | enabled | source | schedule |
// max_vehicles). Runs HOURLY via cron; each tenant fires at its run_hour on
// its cadence (nightly | weekly | biweekly | monthly).
//
// For every active used + new listing it:
//   1. upserts a vehicle_files row (the inventory-of-record / addendum hub) —
//      NEW VINs create a fresh file ready for the disclosure addendum flow;
//   2. upserts vehicle_listings (price + sticker record / public packet);
//   3. appends an advertised_prices snapshot (source_channel='website',
//      captured_by='marketcheck') when the price moved — the feed the
//      price-integrity gate reconciles the addendum against.
//
// Contract:
//   POST /functions/v1/marketcheck-sync
//   Body: {}                       // cron: all tenants due this hour
//         { tenant_id, force:true } // manual "Sync now" from Admin (JWT)
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
// Dealer-scoped LISTINGS come from the syndication endpoint. The plain
// inventory-search endpoint forces rows=0 (analytics mode) whenever a dealer
// scope like `source` is passed, which is why a domain-only query returns no
// cars. Syndication is keyed on MarketCheck's internal dealer_id.
const MC_BASE = "https://api.marketcheck.com/v2";
const SYND_ENDPOINT = `${MC_BASE}/dealerships/inventory`;
const SEARCH_ENDPOINT = `${MC_BASE}/search/car/active`;
const DEALERS_ENDPOINT = `${MC_BASE}/dealers/car`;
const DEALER_DETAILS = `${MC_BASE}/dealer/car`;
const ROWS = 50;

// MarketCheck exposes a dealer's cars through different endpoints keyed on
// different identifiers, and the id returned by Dealer Search is NOT the same
// as the mc_dealer_id / mc_rooftop_id the syndication feed wants (and the plain
// Inventory Search drops into analytics mode when dealer-scoped). So we try a
// small matrix of (endpoint, id-parameter) until one returns real listings.
const FETCH_COMBOS: Array<{ feed: string; base: string; param: string }> = [
  { feed: "syndication", base: SYND_ENDPOINT, param: "mc_dealer_id" },
  { feed: "syndication", base: SYND_ENDPOINT, param: "mc_rooftop_id" },
  { feed: "syndication", base: SYND_ENDPOINT, param: "dealer_id" },
  { feed: "search", base: SEARCH_ENDPOINT, param: "dealer_id" },
  { feed: "search", base: SEARCH_ENDPOINT, param: "seller_id" },
];

// Resolve a MarketCheck dealer_id for a dealer's website domain. The Dealers
// Search endpoint only filters by GEOGRAPHY (zip/state/radius) — there is no
// domain filter — so we search the dealer's area, then EXACT-match the domain
// against each dealer's source / inventory_url. Returns null (with a clear
// diagnostic) rather than guessing the wrong rooftop.
async function resolveDealerId(
  source: string, zip?: string | null, state?: string | null,
): Promise<{ id: string | null; found: number; status: number; matchedName?: string | null }> {
  try {
    const geo = zip ? `&zip=${encodeURIComponent(zip)}&radius=20`
      : state ? `&state=${encodeURIComponent(state)}` : "";
    const url = `${DEALERS_ENDPOINT}?api_key=${encodeURIComponent(MC_KEY)}&rows=50${geo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { id: null, found: 0, status: res.status };
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json().catch(() => ({}));
    const dealers: any[] = Array.isArray(data?.dealers) ? data.dealers : [];
    const host = (s: unknown) => toSourceHost(String(s || ""));
    const hit = dealers.find((d) =>
      host(d?.source) === source || host(d?.inventory_url) === source || host(d?.website) === source);
    const id = hit ? String(hit.id ?? hit.dealer_id ?? hit.mc_dealer_id ?? "") : "";
    return { id: id || null, found: dealers.length, status: res.status, matchedName: hit?.seller_name ?? null };
  } catch {
    return { id: null, found: 0, status: 0 };
  }
}

// Pull one page from a specific endpoint + id-parameter combo.
async function fetchCombo(
  combo: { base: string; param: string }, id: string, start: number,
): Promise<{ listings: MCListing[]; numFound: number; http: number }> {
  const url = `${combo.base}?api_key=${encodeURIComponent(MC_KEY)}`
    + `&${combo.param}=${encodeURIComponent(id)}&rows=${ROWS}&start=${start}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { listings: [], numFound: 0, http: res.status };
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json().catch(() => ({}));
    const listings: MCListing[] = Array.isArray(data?.listings) ? data.listings : [];
    const numFound = typeof data?.num_found === "number" ? data.num_found : listings.length;
    return { listings, numFound, http: res.status };
  } catch {
    return { listings: [], numFound: 0, http: 0 };
  }
}

// The Dealer Search id is a dealer-record id; the inventory feeds want mc_*
// ids. Read the dealer record to harvest every usable identifier so the combo
// matrix has the right number to try.
async function resolveMcIds(id: string): Promise<{ ids: string[]; name: string; listingCount: number | null; http: number }> {
  try {
    const url = `${DEALER_DETAILS}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(MC_KEY)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ids: [], name: "", listingCount: null, http: res.status };
    // deno-lint-ignore no-explicit-any
    const d: any = await res.json().catch(() => ({}));
    const obj = (d?.dealer ?? d ?? {}) as Record<string, unknown>;
    const ids: string[] = [];
    for (const k of ["mc_dealer_id", "mc_rooftop_id", "mc_location_id", "mc_website_id", "dealer_id", "id"]) {
      const v = obj[k];
      if (v != null && String(v).trim()) ids.push(String(v).trim());
    }
    return {
      ids: [...new Set(ids)],
      name: String(obj.seller_name ?? obj.name ?? ""),
      listingCount: typeof obj.listing_count === "number" ? obj.listing_count : null,
      http: res.status,
    };
  } catch {
    return { ids: [], name: "", listingCount: null, http: 0 };
  }
}

const normVin = (s: unknown) => String(s || "").toUpperCase().trim();
// Accept any plausible retail price. A missing / "call for price" / 0 value
// stays null (we can't show a price that isn't published), but don't drop
// legitimately cheap or very expensive units.
const sane = (n: unknown): n is number => typeof n === "number" && n >= 100 && n <= 10_000_000;

const toSourceHost = (raw: string): string => {
  let s = (raw || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return s.split("/")[0].split("?")[0].split("#")[0];
};

interface MCListing {
  vin?: string; price?: number | string; msrp?: number | string;
  stock_no?: string; miles?: number;
  inventory_type?: string; is_certified?: boolean; vdp_url?: string;
  build?: { year?: number; make?: string; model?: string; trim?: string };
  // deno-lint-ignore no-explicit-any
  dealer?: any;
}

// Coerce a MarketCheck price (sometimes a numeric string) to a sane number.
const toPrice = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return sane(n) ? n : null;
};

interface SyncConfig {
  tenant_id: string; allowed: boolean; enabled: boolean; source: string;
  max_vehicles: number; frequency: string; day_of_week: number; run_hour: number;
  last_run_at: string | null;
  dealer_id?: string | null;
}

const makeSlug = (vin: string, ymm: string | undefined) => {
  const seed = `${(ymm || "veh").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${vin.slice(-6).toLowerCase()}`;
  return seed.replace(/^-+|-+$/g, "").slice(0, 64);
};

// Is this tenant due to run in the current UTC hour, given its cadence?
const isDue = (cfg: SyncConfig, now: Date): boolean => {
  if (now.getUTCHours() !== cfg.run_hour) return false;
  const last = cfg.last_run_at ? new Date(cfg.last_run_at).getTime() : 0;
  const hoursSince = (now.getTime() - last) / 3.6e6;
  const dow = now.getUTCDay();
  switch (cfg.frequency) {
    case "nightly":  return hoursSince >= 20;
    case "weekly":   return dow === cfg.day_of_week && hoursSince >= 6 * 24;
    case "biweekly": return dow === cfg.day_of_week && hoursSince >= 13 * 24;
    case "monthly":  return dow === cfg.day_of_week && hoursSince >= 27 * 24;
    default:         return false;
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Missing Supabase env vars" });
  if (!MC_KEY) return json(200, { error: "not_configured", note: "Set MARKETCHECK_API_KEY_1" });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { tenant_id?: string; force?: boolean; lookup?: boolean; zip?: string; state?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  // ── Auth gate: service-role (cron) or a tenant admin/member JWT (manual). ──
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const isCron = auth === serviceKey;
  if (!isCron) {
    const { data: ures, error: uerr } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (uerr || !userId) return json(401, { error: "authentication required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    // A global dealer lookup is not tenant-scoped — it just searches MarketCheck
    // by geography. Any authenticated user may run it (it powers both the
    // platform tenant drawer and the dealer's own Admin setup card).
    if (body.lookup) {
      // ok — authenticated is enough
    } else {
      if (!body.tenant_id) return json(400, { error: "tenant_id required" });
      if (!isAdmin) {
        const { data: membership } = await admin.from("tenant_members")
          .select("tenant_id").eq("user_id", userId).eq("tenant_id", body.tenant_id).maybeSingle();
        if (!membership) return json(403, { error: "not a member of this tenant" });
      }
    }
  }

  // ── Dealer lookup: list MarketCheck dealers in an area so the operator can
  // find the right rooftop's dealer_id (Dealers Search only filters by geo). ──
  if (body.lookup) {
    const zip = (body.zip || "").trim();
    const state = (body.state || "").trim();
    if (!zip && !state) return json(400, { error: "zip_or_state_required" });
    const geo = zip ? `&zip=${encodeURIComponent(zip)}&radius=25` : `&state=${encodeURIComponent(state)}`;
    const url = `${DEALERS_ENDPOINT}?api_key=${encodeURIComponent(MC_KEY)}&rows=50${geo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return json(200, { ok: false, http: res.status, dealers: [] });
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const dealers = (Array.isArray(data?.dealers) ? data.dealers : []).map((d: any) => ({
      id: String(d.id ?? d.dealer_id ?? d.mc_dealer_id ?? ""),
      name: d.seller_name ?? d.name ?? "",
      domain: toSourceHost(d.source ?? d.inventory_url ?? d.website ?? ""),
      city: d.city ?? "", state: d.state ?? "", listings: d.listing_count ?? d.inventory_count ?? null,
    })).filter((d: { id: string }) => d.id);
    return json(200, { ok: true, http: res.status, dealers });
  }

  // ── Pick configs: allowed + enabled, and either a website domain OR a
  // resolved dealer_id (a dealer chosen from the finder has an id but may have
  // no domain). Manual run targets one tenant and bypasses the schedule (force).
  // Cron runs all tenants due this hour. ──
  const baseCols = "tenant_id, allowed, enabled, source, max_vehicles, frequency, day_of_week, run_hour, last_run_at";
  const mkQuery = (cols: string) => {
    let q = admin.from("marketcheck_sync_config").select(cols)
      .eq("allowed", true).eq("enabled", true);
    if (body.tenant_id) q = q.eq("tenant_id", body.tenant_id);
    return q;
  };
  // Prefer reading dealer_id (manual override); fall back if the column hasn't
  // been migrated yet.
  let { data: configs, error: cErr } = await mkQuery(baseCols + ", dealer_id");
  if (cErr && /dealer_id/i.test(cErr.message || "")) {
    ({ data: configs, error: cErr } = await mkQuery(baseCols));
  }
  if (cErr) return json(500, { error: cErr.message });

  const now = new Date();
  const due = (configs || [])
    .filter((c: SyncConfig) => toSourceHost(c.source) || (c.dealer_id || "").trim())
    .filter((c: SyncConfig) => (body.force && body.tenant_id) ? true : isDue(c, now));

  let tenantsSynced = 0, newVehicles = 0, listingsUpserted = 0, pricesRecorded = 0, seen = 0;
  const errors: Array<{ tenant_id: string; error: string }> = [];
  const diagnostics: Array<Record<string, unknown>> = [];

  for (const cfg of due as SyncConfig[]) {
    const source = toSourceHost(cfg.source);
    const manualDealerId = (cfg.dealer_id || "").trim();
    // A domain OR a chosen dealer_id is enough — the finder gives an id even
    // when MarketCheck has no website on file for the rooftop.
    if (!source && !manualDealerId) continue;
    let tenantSeen = 0, tenantNew = 0, tenantPrices = 0;
    let firstWriteErr: string | null = null;
    const liveVins = new Set<string>();
    try {
      // Latest website price per VIN — only append a snapshot when it moved.
      const { data: priceRows } = await admin.from("advertised_prices")
        .select("vin, advertised_price, captured_at")
        .eq("tenant_id", cfg.tenant_id).eq("source_channel", "website")
        .order("captured_at", { ascending: false }).limit(5000);
      const latestWebsite = new Map<string, number>();
      for (const r of (priceRows || []) as Array<{ vin: string; advertised_price: number }>) {
        const v = normVin(r.vin);
        if (!latestWebsite.has(v)) latestWebsite.set(v, r.advertised_price);
      }

      // Resolve the dealer's MarketCheck dealer_id: a manual override wins;
      // otherwise look it up by the dealer's area + exact domain match.
      let dealerId = (cfg.dealer_id || "").trim();
      let resolveInfo: { id: string | null; found: number; status: number; matchedName?: string | null } | null = null;
      if (!dealerId) {
        const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", cfg.tenant_id).maybeSingle();
        const s = (prof?.settings || {}) as Record<string, string>;
        const zip = s.dealer_zip || s.dealer_postal_code || "";
        const state = s.dealer_state || s.doc_fee_state || "";
        resolveInfo = await resolveDealerId(source, zip, state);
        dealerId = resolveInfo.id || "";
      }
      if (!dealerId) {
        diagnostics.push({
          tenant_id: cfg.tenant_id, source, dealers_in_area: resolveInfo?.found ?? 0,
          dealers_http: resolveInfo?.status ?? null, error: "no_dealer_id",
          note: `No MarketCheck dealer in the area matched "${source}". Set the dealership's ZIP in Branding & Setup, or paste the MarketCheck dealer ID for this rooftop.`,
        });
        continue;
      }

      const maxPages = Math.ceil(cfg.max_vehicles / ROWS) + 1;
      let numFound = 0;
      let httpStatus = 0;

      // Build the id candidates: the saved id, plus the mc_* ids from the dealer
      // record (the saved id is a dealer-record id, not the mc_* id the feeds
      // want). Then probe the (endpoint, param) matrix on page 0 and lock onto
      // the first combo that returns real cars. Every attempt is recorded so a
      // zero pull is debuggable from the response.
      const mc = await resolveMcIds(dealerId);
      const idCandidates = [...new Set([dealerId, ...mc.ids])];
      const attempts: Array<Record<string, unknown>> = [];
      let chosen: { base: string; param: string; id: string } | null = null;
      let firstPage: { listings: MCListing[]; numFound: number; http: number } = { listings: [], numFound: 0, http: 0 };
      probe_loop:
      for (const cid of idCandidates) {
        for (const combo of FETCH_COMBOS) {
          const r = await fetchCombo(combo, cid, 0);
          attempts.push({ feed: combo.feed, param: combo.param, id: cid, http: r.http, num_found: r.numFound, got: r.listings.length });
          if (r.listings.length > 0) { chosen = { base: combo.base, param: combo.param, id: cid }; firstPage = r; break probe_loop; }
        }
      }
      httpStatus = chosen ? firstPage.http : (attempts[0]?.http as number ?? 0);
      const probe = {
        chosen: chosen ? { param: chosen.param, id: chosen.id } : null,
        mc_ids: mc.ids, dealer_record: mc.name, dealer_listing_count: mc.listingCount,
        attempts,
      };

      outer:
      for (let page = 0; page < maxPages; page++) {
        {
          if (tenantSeen >= cfg.max_vehicles) break;
          if (!chosen) break;
          const pageData = page === 0
            ? firstPage
            : await fetchCombo(chosen, chosen.id, page * ROWS);
          const listings: MCListing[] = pageData.listings;
          numFound = pageData.numFound || numFound;
          if (listings.length === 0) break;

          for (const l of listings) {
            if (tenantSeen >= cfg.max_vehicles) break outer;
            const vin = normVin(l.vin);
            if (!vin || vin.length < 11) continue;
            tenantSeen++; seen++;
            liveVins.add(vin);
            const price = toPrice(l.price);
            const stockNo = String(l.stock_no ?? (l.dealer && l.dealer.stock_no) ?? "").trim();
            const b = l.build || {};
            const ymm = [b.year, b.make, b.model].filter(Boolean).join(" ") || null;
            const condition = l.is_certified ? "cpo" : (l.inventory_type === "new" ? "new" : "used");
            const miles = typeof l.miles === "number" ? Math.round(l.miles) : 0;

            // 1) vehicle_files — the inventory-of-record / addendum hub. NEW
            // VINs create a fresh file; existing files only refresh inventory
            // fields (never deal_status / customer data).
            const { data: vf } = await admin.from("vehicle_files")
              .select("id").eq("tenant_id", cfg.tenant_id).eq("vin", vin).maybeSingle();
            if (vf) {
              await admin.from("vehicle_files").update({
                year: String(b.year || ""), make: b.make || "", model: b.model || "",
                trim: b.trim || "", stock_number: stockNo, condition, mileage: miles,
                feed_source: "marketcheck",
              }).eq("id", vf.id);
            } else {
              const { error } = await admin.from("vehicle_files").insert({
                tenant_id: cfg.tenant_id, vin,
                year: String(b.year || ""), make: b.make || "", model: b.model || "",
                trim: b.trim || "", stock_number: stockNo, condition, mileage: miles,
                feed_source: "marketcheck",
              });
              if (!error) { tenantNew++; newVehicles++; }
            }

            // 2) vehicle_listings — sticker / public packet + lot price view.
            // NOTE: vehicle_listings has no stock_number column (that lives on
            // vehicle_files); including it fails the whole write.
            const { data: vl } = await admin.from("vehicle_listings")
              .select("id").eq("tenant_id", cfg.tenant_id).eq("vin", vin).maybeSingle();
            const patch: Record<string, unknown> = {
              tenant_id: cfg.tenant_id, vin, ymm, trim: b.trim || null,
              mileage: miles || null, condition, price, feed_source: "marketcheck",
            };
            if (vl) {
              const { error } = await admin.from("vehicle_listings").update(patch).eq("id", vl.id);
              if (!error) listingsUpserted++; else if (!firstWriteErr) firstWriteErr = error.message;
            } else {
              const { error } = await admin.from("vehicle_listings").insert({
                ...patch, store_id: cfg.tenant_id, slug: makeSlug(vin, ymm || undefined), status: "draft", sticker_snapshot: {},
              });
              if (!error) listingsUpserted++; else if (!firstWriteErr) firstWriteErr = error.message;
            }

            // 3) advertised_prices — website price snapshot on change.
            if (price != null) {
              const prev = latestWebsite.get(vin);
              if (prev == null || Math.abs(prev - price) >= 1) {
                const { error } = await admin.from("advertised_prices").insert({
                  tenant_id: cfg.tenant_id, store_id: "", vin,
                  source_url: l.vdp_url || "", source_channel: "website",
                  advertised_price: price, captured_by: "marketcheck",
                  notes: prev == null
                    ? `MarketCheck ${l.inventory_type || ""} · $${price.toLocaleString()}`
                    : `MarketCheck ${l.inventory_type || ""} · $${prev.toLocaleString()} → $${price.toLocaleString()}`,
                });
                if (!error) { tenantPrices++; pricesRecorded++; latestWebsite.set(vin, price); }
              }
            }
          }
          if ((page + 1) * ROWS >= numFound) break;
        }
      }

      // Replace-on-sync: prune MarketCheck cars that left the feed. Only when we
      // pulled the FULL inventory (not capped) and got a real result, so a
      // partial/failed pull never deletes good cars.
      let pruned: { listings_deleted?: number; files_deleted?: number } | null = null;
      if (!firstWriteErr && liveVins.size > 0 && numFound > 0 && tenantSeen >= numFound) {
        const { data: pr } = await admin.rpc("marketcheck_prune_inventory", {
          _tenant_id: cfg.tenant_id, _live_vins: Array.from(liveVins),
        });
        pruned = (pr || null) as { listings_deleted?: number; files_deleted?: number } | null;
      }

      tenantsSynced++;
      const status = { ran_at: now.toISOString(), seen: tenantSeen, new_vehicles: tenantNew, prices_recorded: tenantPrices, dealer_id: dealerId, num_found: numFound, http: httpStatus, removed: pruned?.listings_deleted ?? 0 };
      diagnostics.push({ tenant_id: cfg.tenant_id, source, dealer_id: dealerId, matched_dealer: resolveInfo?.matchedName ?? "(manual id)", resolved: !cfg.dealer_id, num_found: numFound, http: httpStatus, seen: tenantSeen, listings_written: listingsUpserted, removed: pruned?.listings_deleted ?? 0, write_error: firstWriteErr, ...probe });
      await admin.from("marketcheck_sync_config")
        .update({ last_run_at: now.toISOString(), last_status: status })
        .eq("tenant_id", cfg.tenant_id);
      await admin.from("audit_log").insert({
        action: "marketcheck_sync", entity_type: "tenant", entity_id: cfg.tenant_id,
        store_id: cfg.tenant_id, details: { source, ...status },
      }).then(() => undefined, () => undefined);
    } catch (err) {
      errors.push({ tenant_id: cfg.tenant_id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return json(200, {
    ok: true, tenants_due: due.length, tenants_synced: tenantsSynced,
    listings_seen: seen, new_vehicles: newVehicles,
    listings_upserted: listingsUpserted, prices_recorded: pricesRecorded, errors, diagnostics,
  });
});
