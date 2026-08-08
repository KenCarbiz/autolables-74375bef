import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { artifactPostsIdle, autoPreload, ensureComplianceDrafts, ensureReadyToken } from "../_shared/intake-autoprovision.ts";
import { newCallMeter, recordCall, estimateCost } from "../_shared/mcCost.ts";
import {
  classifyListing, isStrictRooftop, normStreet, normZip, prunePreflight,
  type ListingIdentity, type Rooftop,
} from "../_shared/rooftopMatch.ts";

// Artifact posts are queued and paced, so they can still be in flight when the
// handler returns. Without this the isolate is torn down mid-queue and the
// last vehicles of a feed silently lose their documents — serialising the
// posts makes that MORE likely, not less, so the two changes belong together.
function drainArtifactPosts(): void {
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(artifactPostsIdle());
}


// ──────────────────────────────────────────────────────────────
// marketcheck-sync
//
// Per-tenant, super-admin-governed inventory pull from MarketCheck's
// Dealership Inventory Syndication API
// (https://api.marketcheck.com/v2/dealerships/inventory, owned=true), scoped
// to each dealer's OWN website domain. The Inventory Search API
// (/v2/search/car/active) is used only to resolve a domain to its dealer_id
// and to grab a diagnostic sample. Config lives in
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
// Keys on mc_attributes that belong to the VIN decode (marketcheck-specs), not
// to the syndication feed. The feed never carries them, so they must survive a
// sync verbatim or the decode is lost and re-billed.
const DECODE_OWNED_KEYS = [
  "build_sheet",
  "base_msrp", "delivery_charges", "total_msrp",
  "specs_source", "specs_strict_attempted", "specs_decoded_at",
  "specs_attempts", "specs_attempted_at", "specs_no_build_sheet",
] as const;

function decodeOwned(prior: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of DECODE_OWNED_KEYS) {
    if (prior[k] !== undefined && prior[k] !== null) out[k] = prior[k];
  }
  return out;
}

const MC_BASE = "https://api.marketcheck.com/v2";
const SYND_ENDPOINT = `${MC_BASE}/dealerships/inventory`;
const SEARCH_ENDPOINT = `${MC_BASE}/search/car/active`;
const DEALERS_ENDPOINT = `${MC_BASE}/dealers/car`;
const DEALER_DETAILS = `${MC_BASE}/dealer/car`;
// NEW dealership directory — resolves a domain to the canonical mc_* ids. The
// old /dealers/car id space collides with other dealers in the syndication
// feed (a legacy id can match a different rooftop), so we resolve via this.
const DEALERSHIPS_ENDPOINT = `${MC_BASE}/dealerships/car`;
const ROWS = 50;             // Inventory Search max page (used only for the diagnostic sample)
const SYND_MAX_ROWS = 1500;  // Dealership Syndication allows up to 1500/page (Free plan caps at 10)

// A full rooftop inventory (with price + stock) comes ONLY from the Dealership
// Inventory Syndication endpoint, and only with owned=true (otherwise it returns
// duplicate non-owned copies that carry no price/stock). Per the docs, owned= is
// honored only with source, dealer_id, or mc_website_id — so we only append it
// for those params.
// owned=true asks for listings MarketCheck attributes as PHYSICALLY OWNED by the
// requested dealership. The default is owned=false, which includes syndicated
// and non-attributed records — i.e. sibling stores' cars. It applies to every
// dealer-identity parameter on the syndication endpoint, so it is sent with all
// of them. (mc_rooftop_id was previously excluded, which meant our single best
// identifier was the one running unowned.)
const OWNED_PARAMS = new Set([
  "source", "dealer_id", "mc_website_id", "mc_dealer_id", "mc_rooftop_id", "mc_location_id",
]);

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

// Low-level MarketCheck GET. Coerces num_found (the syndication feed returns it
// as a string) and returns the listings array + http status.
// Per-run call meter. Operator-facing only: these are public list prices, not a
// bill, and the figures never reach a dealer-visible surface.
let callMeter = newCallMeter();

async function mcFetch(base: string, query: string): Promise<{ listings: MCListing[]; numFound: number; http: number }> {
  const url = `${base}?api_key=${encodeURIComponent(MC_KEY)}&${query}`;
  recordCall(callMeter, base);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { listings: [], numFound: 0, http: res.status };
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json().catch(() => ({}));
    const listings: MCListing[] = Array.isArray(data?.listings) ? data.listings : [];
    const nf = typeof data?.num_found === "number" ? data.num_found : parseInt(String(data?.num_found ?? ""), 10);
    const numFound = Number.isFinite(nf) ? nf : listings.length;
    return { listings, numFound, http: res.status };
  } catch {
    return { listings: [], numFound: 0, http: 0 };
  }
}

// Intake auto-provisioning (hub token + draft docs + fire-and-forget renders)
// is shared across every ingest path; failures are recorded to
// vehicle_exceptions, never swallowed, and never block the sync loop.

// One page of a rooftop's inventory from the syndication feed. owned=true drops
// the duplicate non-owned copies that have no price/stock, but it's only honored
// for source/dealer_id/mc_website_id — so append it only for those params.
const syndPage = (
  param: string, value: string, rows: number, start: number,
  opts?: { carType?: "new" | "used" | "certified"; owned?: boolean },
) => {
  // opts.owned=false deliberately omits owned=true: the unowned feed includes
  // syndicated and non-attributed records, which is where a segment that lost
  // its physically-owned attribution (see the new-car coverage backstop) lives.
  const owned = (opts?.owned ?? OWNED_PARAMS.has(param)) ? "&owned=true" : "";
  const carType = opts?.carType ? `&car_type=${opts.carType}` : "";
  // append_api_key=false keeps the secret out of image/VDP URLs in the payload.
  // include_non_vin_listings=false: a VIN-less row cannot be deduplicated or
  // enriched, and has no place in a strict inventory pipeline.
  return mcFetch(
    SYND_ENDPOINT,
    `${param}=${encodeURIComponent(value)}${owned}${carType}&rows=${rows}&start=${start}` +
    `&append_api_key=false&include_non_vin_listings=false`,
  );
};

interface Dealership {
  name: string; state: string; http: number;
  // Canonical syndication probes (param -> value), highest-confidence first.
  probes: Array<{ param: string; value: string }>;
}

// Resolve a rooftop from its website domain via the NEW Dealerships Search API
// (/v2/dealerships/car?inventory_url=...). This returns the canonical mc_* ids
// (mc_website_id, mc_dealer_id, mc_rooftop_id) that the syndication feed scopes
// on correctly — unlike the legacy /dealers/car id, which collides with other
// dealers in the syndication id space (the root cause of wrong-rooftop pulls).
async function resolveDealership(domain: string): Promise<Dealership> {
  const empty: Dealership = { name: "", state: "", http: 0, probes: [] };
  if (!domain) return empty;
  try {
    const url = `${DEALERSHIPS_ENDPOINT}?api_key=${encodeURIComponent(MC_KEY)}&inventory_url=${encodeURIComponent(domain)}&rows=5`;
    recordCall(callMeter, DEALERSHIPS_ENDPOINT);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ...empty, http: res.status };
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const rows: any[] = Array.isArray(data?.mc_dealerships) ? data.mc_dealerships
      : Array.isArray(data?.dealerships) ? data.dealerships : [];
    const host = (s: unknown) => toSourceHost(String(s || ""));
    // Never fall back to rows[0]: for a group domain that is an arbitrary
    // sibling rooftop, and its ids would then be trusted downstream.
    const hit = rows.find((d) => host(d?.inventory_url) === domain);
    if (!hit) return { ...empty, http: res.status };
    const probes: Array<{ param: string; value: string }> = [];
    const push = (param: string, v: unknown) => { const s = String(v ?? "").trim(); if (s) probes.push({ param, value: s }); };
    // Order matters and is the crux of rooftop isolation. mc_rooftop_id is the
    // physical retail rooftop — the narrowest boundary MarketCheck exposes.
    // mc_location_id (address) is next. mc_website_id and mc_dealer_id are
    // business/site identities a dealer group can share across stores, so they
    // are last-resort only. Group ids are never probed at all.
    push("mc_rooftop_id", hit.mc_rooftop_id);
    push("mc_location_id", hit.mc_location_id);
    push("mc_website_id", hit.mc_website_id);
    push("mc_dealer_id", hit.mc_dealer_id);
    return {
      name: String(hit.seller_name ?? hit.name ?? ""),
      state: String(hit.state ?? "").trim().toUpperCase(),
      http: res.status, probes,
    };
  } catch {
    return empty;
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
  // MarketCheck's own listing identifier. Required by /v2/listing/car/{id},
  // which is the only source of extra.options / features / seller_comments —
  // the syndication feed usually omits them. Captured now so the id exists
  // whenever that call is worth making; costs nothing at sync time.
  id?: string;
  vin?: string; price?: number | string; msrp?: number | string;
  stock_no?: string; miles?: number; source?: string;
  inventory_type?: string; is_certified?: boolean; vdp_url?: string;
  exterior_color?: string; interior_color?: string; base_ext_color?: string; base_int_color?: string;
  // Market & history signals MarketCheck carries on each active listing that
  // we previously ignored — days-on-market, price-change, listing age, and
  // the CARFAX badge flags (not the full report).
  dom?: number; dom_active?: number; dom_180?: number;
  price_change_percent?: number | string; ref_price?: number | string; ref_miles?: number;
  first_seen_at?: number | string; last_seen_at?: number | string; scraped_at?: number | string;
  carfax_1_owner?: boolean; carfax_clean_title?: boolean;
  seller_type?: string; in_transit?: boolean;
  // OEM equipment / options & packages when the feed carries them.
  extra?: { features?: unknown[]; options?: unknown[]; [k: string]: unknown };
  // deno-lint-ignore no-explicit-any
  options?: any; features?: any;
  build?: { year?: number; make?: string; model?: string; trim?: string;
    engine?: string; engine_size?: number | string; engine_block?: string;
    transmission?: string; drivetrain?: string; fuel_type?: string;
    body_type?: string; doors?: number; cylinders?: number; vehicle_type?: string;
    city_mpg?: number | string; highway_mpg?: number | string; combined_mpg?: number | string;
    powertrain_type?: string; std_seating?: number | string; made_in?: string;
    overall_height?: string; overall_length?: string; overall_width?: string;
    // deno-lint-ignore no-explicit-any
    [k: string]: any };
  media?: { photo_links?: string[]; photo_links_cached?: string[] };
  // deno-lint-ignore no-explicit-any
  dealer?: any;
}

// Coerce a MarketCheck price (sometimes a numeric string) to a sane number.
const toPrice = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return sane(n) ? n : null;
};

// ── Rooftop ownership validation ───────────────────────────────────────────
// A single mc_dealer_id can span many rooftops, and sibling stores in a dealer
// group syndicate each other's cars, so a pull MUST be validated per listing.
//
// The decisive signal is the rooftop's STREET ADDRESS. Domain and state cannot
// separate siblings: group rooftops share a state, and a listing that carries no
// host signal used to fall through to a state comparison — which passes every
// dealer in Connecticut. Street + ZIP is the only field that identifies one
// physical rooftop, so when it is configured it is authoritative and a listing
// that cannot be positively matched to it is never ingested.
const listingHosts = (l: MCListing): string[] => {
  const out: string[] = [];
  // deno-lint-ignore no-explicit-any
  const d: any = l?.dealer || {};
  for (const v of [l.source, l.vdp_url, d.website, d.source, d.inventory_url]) {
    const h = toSourceHost(String(v || ""));
    if (h) out.push(h);
  }
  return out;
};
// deno-lint-ignore no-explicit-any
const listingState = (l: MCListing): string => String((l?.dealer as any)?.state || "").trim().toUpperCase();

// Address/host normalization and the ownership decision live in
// _shared/rooftopMatch.ts so they are unit-tested rather than only exercised
// against live inventory each night.
const listingIdentity = (l: MCListing): ListingIdentity => ({
  hosts: listingHosts(l),
  // deno-lint-ignore no-explicit-any
  rooftopId: String((l as any)?.mc_dealership?.mc_rooftop_id ?? "").trim() || undefined,
  // deno-lint-ignore no-explicit-any
  locationId: String((l as any)?.mc_dealership?.mc_location_id ?? "").trim() || undefined,
  // deno-lint-ignore no-explicit-any
  state: String((l?.dealer as any)?.state || "").trim().toUpperCase(),
  // deno-lint-ignore no-explicit-any
  street: normStreet((l?.dealer as any)?.street),
  // deno-lint-ignore no-explicit-any
  zip: normZip((l?.dealer as any)?.zip),
});

interface SyncConfig {
  tenant_id: string; allowed: boolean; enabled: boolean; source: string;
  max_vehicles: number; frequency: string; day_of_week: number; run_hour: number;
  last_run_at: string | null;
  dealer_id?: string | null;
  // The identifier that resolved this rooftop on the last run, cached so we can
  // skip the multi-call probe (metered MarketCheck plans charge per call).
  last_status?: { mc_param?: string; mc_value?: string } | null;
  // Pinned scope + verified rooftop (20260801210000). Empty until a run validates.
  mc_scope_param?: string; mc_scope_value?: string;
  rooftop_street?: string; rooftop_zip?: string; rooftop_name?: string;
  strict_rooftop?: boolean; last_good_count?: number;
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

  // ── Inventory sync instrumentation ────────────────────────────────
  // Persist one inventory_sync_runs row per tenant-run (with error rows)
  // wrapped so a logging failure never breaks the sync itself. Status
  // semantics: 'failed' (source error / no feed / exception) MUST stay
  // distinct from 'empty_valid' (source ok, legitimately zero cars).
  // deno-lint-ignore no-explicit-any
  const logSyncRun = async (row: {
    tenant_id: string; started_at: string; status: "success" | "partial" | "failed" | "empty_valid" | "skipped";
    num_found?: number; seen?: number; new_vehicles?: number; updated_vehicles?: number;
    prices_recorded?: number; removed?: number; http_status?: number | null;
    matched_dealer?: string | null; error_summary?: string | null; raw: any;
    errors?: Array<{ vin?: string | null; code?: string; message?: string }>;
  }) => {
    try {
      const { data: run, error } = await admin.from("inventory_sync_runs").insert({
        tenant_id: row.tenant_id, source: "marketcheck",
        started_at: row.started_at, finished_at: new Date().toISOString(),
        status: row.status,
        num_found: row.num_found ?? 0, seen: row.seen ?? 0,
        new_vehicles: row.new_vehicles ?? 0, updated_vehicles: row.updated_vehicles ?? 0,
        prices_recorded: row.prices_recorded ?? 0, removed: row.removed ?? 0,
        http_status: row.http_status ?? null,
        matched_dealer: row.matched_dealer ?? null,
        error_summary: row.error_summary ?? null,
        raw: row.raw ?? null,
      }).select("id").maybeSingle();
      if (error || !run?.id) return;
      const errs = (row.errors || []).filter((e) => (e.message || e.code));
      if (errs.length) {
        await admin.from("inventory_sync_errors").insert(errs.map((e) => ({
          sync_run_id: run.id, tenant_id: row.tenant_id,
          vin: e.vin ?? null, code: e.code ?? null, message: e.message ?? null,
        }))).then(() => undefined, () => undefined);
      }
    } catch { /* logging is best-effort */ }
  };

  let body: { tenant_id?: string; force?: boolean; lookup?: boolean; zip?: string; state?: string; enrich?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  // ── Auth gate ───────────────────────────────────────────────
  // Every request must authenticate. Accepted credentials:
  //   - service-role bearer (manual admin / direct ops)
  //   - x-cron-secret header (the pg_cron schedule sends this)
  //   - a real user JWT (tenant member or platform admin)
  // The previous "anon-key + empty body = batch" bypass is removed so
  // anonymous callers can no longer trigger paid MarketCheck quota.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const isServiceRole = !!serviceKey && auth === serviceKey;
  const cronSecret = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
  const hasCronSecret = !!cronSecret && (req.headers.get("x-cron-secret") || "") === cronSecret;
  const isBatchCron = isServiceRole || hasCronSecret;

  if (!isBatchCron) {
    // Require a real user JWT — anon/publishable keys are rejected.
    const { data: ures, error: uerr } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (uerr || !userId) return json(401, { error: "authentication required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (body.lookup) {
      // global dealer lookup — any authenticated user
    } else {
      if (!body.tenant_id) return json(400, { error: "tenant_id required" });
      if (!isAdmin) {
        const { data: membership } = await admin.from("tenant_members")
          .select("tenant_id").eq("user_id", userId).eq("tenant_id", body.tenant_id)
          .not("accepted_at", "is", null).maybeSingle();
        if (!membership) return json(403, { error: "not a member of this tenant" });
      }
    }
  }


  // Visibility — record every cron/batch invocation so "did the scheduler
  // actually reach the function?" is answerable from the audit log without
  // net._http_response access. Best-effort; never blocks the sync.
  if (isServiceRole || isBatchCron || hasCronSecret) {
    const jwtRole = (() => {
      try {
        const p = auth.split(".")[1];
        return p ? String(JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).role || "unknown") : "none";
      } catch { return "unknown"; }
    })();
    try {
      await admin.from("audit_log").insert({
        action: "marketcheck_sync_invoked",
        entity_type: "marketcheck_sync",
        entity_id: body.tenant_id || "batch",
        details: {
          is_batch: isBatchCron, tenant_id: body.tenant_id ?? null, force: !!body.force,
          auth_kind: isServiceRole ? "service_role" : hasCronSecret ? "cron_secret" : "batch_key",
          key_role: jwtRole, at: new Date().toISOString(),
        },
      });
    } catch { /* audit is best-effort */ }
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
  const baseCols = "tenant_id, allowed, enabled, source, max_vehicles, frequency, day_of_week, run_hour, last_run_at, last_status, mc_scope_param, mc_scope_value, rooftop_street, rooftop_zip, rooftop_name, strict_rooftop, last_good_count";
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
  // Vehicles to fully enrich (MarketCheck pricing/comps/recalls + Black Book)
  // after the inventory pull. Bounded per run to respect provider rate limits.
  const enrichQueue: { tenant_id: string; vin: string; zip?: string }[] = [];
  // Enrichment runs INLINE in this invocation after the inventory pull, so the
  // cap must leave the function enough wall-clock to finish — a 113-car ingest
  // plus 40 enrich calls (6 MarketCheck requests each) overran the edge limit
  // and the enrich pass got killed mid-run. Keep it small; bulk backfill is the
  // client "Re-pull incomplete" loop, and the nightly chips away the rest.
  const ENRICH_CAP = Number(Deno.env.get("ENRICH_PER_RUN") || "10");

  for (const cfg of due as SyncConfig[]) {
    // Meter each tenant's run independently — the loop can cover many tenants.
    callMeter = newCallMeter();
    const source = toSourceHost(cfg.source);
    const manualDealerId = (cfg.dealer_id || "").trim();
    // A domain OR a chosen dealer_id is enough — the finder gives an id even
    // when MarketCheck has no website on file for the rooftop.
    if (!source && !manualDealerId) continue;
    let tenantSeen = 0, tenantNew = 0, tenantPrices = 0;
    let firstWriteErr: string | null = null;
    const liveVins = new Set<string>();
    const updatedListingIds: string[] = [];
    const runStartedAt = new Date().toISOString();

    // ── Phase 2.3 reconciliation / change-detection state ─────────────────
    // All change/exception writes go through emitException + emitChange helpers
    // wrapped in try/catch so a logging failure NEVER breaks the ingest loop.
    // Capped per invocation so the first deploy can't flood the table for the
    // whole existing lot.
    const EXC_CAP = 300;
    let excInserts = 0;
    const stockMap = new Map<string, string[]>();     // live stock_number -> vins seen
    const priorExistingVins = new Set<string>();       // vehicle_listings VINs before this pull
    const previouslyRemovedVins = new Set<string>();   // VINs with a prior 'removed_from_feed' change
    const authorityRules = new Map<string, { conflict_behavior?: string | null }>();
    // deno-lint-ignore no-explicit-any
    const emitException = async (row: any) => {
      if (excInserts >= EXC_CAP) return null;
      try {
        // Upsert-like: if an open/in_progress exception of this (vin, type) exists,
        // refresh it (partial-unique index enforces the invariant).
        const { data: existing } = await admin.from("vehicle_exceptions")
          .select("id").eq("tenant_id", row.tenant_id).eq("vin", row.vin)
          .eq("exception_type", row.exception_type).in("status", ["open", "in_progress"])
          .maybeSingle();
        if (existing?.id) {
          await admin.from("vehicle_exceptions").update({
            severity: row.severity, title: row.title, explanation: row.explanation ?? null,
            source_values: row.source_values ?? null, recommended_action: row.recommended_action ?? null,
            requires_new_document: !!row.requires_new_document,
            stock_number: row.stock_number ?? null, vehicle_listing_id: row.vehicle_listing_id ?? null,
          }).eq("id", existing.id);
          return existing.id as string;
        }
        const { data: ins } = await admin.from("vehicle_exceptions").insert(row).select("id").maybeSingle();
        if (ins?.id) excInserts++;
        return (ins?.id as string) || null;
      } catch { return null; }
    };
    // deno-lint-ignore no-explicit-any
    const emitChange = async (row: any) => {
      try { await admin.from("vehicle_change_history").insert(row); } catch { /* best-effort */ }
    };
    const applyAuthority = (fieldKey: string, base: { severity: string; requires_new_document?: boolean }):
      { skip: boolean; severity: string; requires_new_document: boolean } => {
      const rule = authorityRules.get(fieldKey);
      const beh = String(rule?.conflict_behavior || "").trim().toLowerCase();
      if (beh === "ignore") return { skip: true, severity: base.severity, requires_new_document: !!base.requires_new_document };
      if (beh === "block_generation") return { skip: false, severity: "high", requires_new_document: true };
      return { skip: false, severity: base.severity, requires_new_document: !!base.requires_new_document };
    };
    try {
      const { data: rules } = await admin.from("source_authority_rules")
        .select("field_key, conflict_behavior").eq("tenant_id", cfg.tenant_id);
      for (const r of (rules || []) as Array<{ field_key: string; conflict_behavior?: string | null }>) {
        if (r?.field_key) authorityRules.set(r.field_key, { conflict_behavior: r.conflict_behavior ?? null });
      }
    } catch { /* rules table optional */ }
    try {
      const { data: existingRows } = await admin.from("vehicle_listings")
        .select("vin").eq("tenant_id", cfg.tenant_id).limit(20000);
      for (const r of (existingRows || []) as Array<{ vin: string }>) {
        if (r.vin) priorExistingVins.add(normVin(r.vin));
      }
    } catch { /* diff best-effort */ }
    try {
      const { data: removedRows } = await admin.from("vehicle_change_history")
        .select("vin").eq("tenant_id", cfg.tenant_id).eq("field_key", "_lifecycle")
        .eq("new_value", "removed_from_feed").limit(5000);
      for (const r of (removedRows || []) as Array<{ vin: string }>) {
        if (r.vin) previouslyRemovedVins.add(normVin(r.vin));
      }
    } catch { /* first run — no history yet */ }
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

      // Read the dealer profile once: state backstops ownership validation, zip
      // helps resolve the rooftop when nothing is saved.
      const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", cfg.tenant_id).maybeSingle();
      const pset = (prof?.settings || {}) as Record<string, string>;
      let dealerState = (pset.dealer_state || pset.doc_fee_state || "").trim().toUpperCase();
      // Doc/conveyance fee for this tenant (e.g. $895 at Harte INFINITI). The
      // feed `price` is the advertised price BEFORE doc; the website sale price
      // is advertised + this fee. Added exactly once, never subtracted.
      const tenantDocFee = String(pset.doc_fee_enabled) === "true"
        ? (Number(pset.doc_fee_amount) || 0)
        : 0;
      // Whether this dealer's advertised/feed price ALREADY includes the doc fee
      // (Harte: yes). When true we must NOT add the fee again — the feed price is
      // the fee-inclusive website price and the before-doc amount is derived.
      const advertisedInclDocFee = String(pset.advertised_includes_doc_fee) === "true";
      // Tenant ZIP anchors every enrichment pull's comps + Market Days Supply to
      // this dealer's local market radius (not a national average).
      const tenantZip = (pset.dealer_zip || "").trim();

      // The rooftop this tenant IS. Street + ZIP come from the dealership
      // profile the dealer already maintains, so no extra configuration is
      // needed for the address assertion to take effect. When both are present
      // the pull runs strict: only cars positively at this address are kept.
      const rooftop: Rooftop = {
        // When the pinned scope IS a rooftop id, every returned row must carry
        // it. That is the tenancy invariant the API filter cannot guarantee.
        rooftopId: (cfg.mc_scope_param === "mc_rooftop_id" ? (cfg.mc_scope_value || "").trim() : "") || undefined,
        domain: source,
        state: dealerState,
        street: normStreet(cfg.rooftop_street || pset.dealer_address),
        zip: normZip(cfg.rooftop_zip || pset.dealer_zip),
      };
      // strict_rooftop defaults true; it only bites once an address exists, so a
      // tenant that has not configured one is never locked out of syncing.
      const strict = cfg.strict_rooftop !== false && isStrictRooftop(rooftop);
      let rejected = 0;
      // True once every page of the feed has been fetched. Prune requires it.
      let feedWalked = false;
      // New units ingested this run — the signal the coverage backstop watches.
      let newTypeSeen = 0;
      // Only tenants that have ever carried new inventory get the backstop, so
      // a used-only independent never spends extra metered calls probing for a
      // segment it does not sell. Archived rows count: the failure mode is
      // exactly that every new unit got pruned into 'archived'.
      let tenantSellsNew = false;
      try {
        const { data: newRow } = await admin.from("vehicle_listings")
          .select("id").eq("tenant_id", cfg.tenant_id).eq("condition", "new")
          .limit(1).maybeSingle();
        tenantSellsNew = !!newRow;
      } catch { /* coverage backstop is optional */ }

      // Resolve the rooftop from its website domain via the NEW Dealerships
      // Search API, which returns the canonical mc_* ids the syndication feed
      // scopes on correctly (the legacy /dealers/car id collides with other
      // dealers). source=<domain> stays the primary, trusted scope.
      const manualId = (cfg.dealer_id || "").trim();
      if (!source && !manualId) {
        diagnostics.push({
          tenant_id: cfg.tenant_id, source, error: "no_dealer_id",
          note: "No MarketCheck rooftop matched. Set the dealership's website domain in Branding & Setup.",
        });
        continue;
      }

      const dealership = source ? await resolveDealership(source) : { name: "", state: "", http: 0, probes: [] as Array<{ param: string; value: string }> };
      const verifiedName = dealership.name;
      if (!dealerState && dealership.state) dealerState = dealership.state;

      const synRows = Math.min(SYND_MAX_ROWS, Math.max(50, cfg.max_vehicles));
      let numFound = 0;
      let httpStatus = 0;

      const attempts: Array<Record<string, unknown>> = [];
      const hits: Array<{ param: string; value: string; r: { listings: MCListing[]; numFound: number; http: number }; purity: number }> = [];
      // Validate every feed against the dealer's domain/state. source= and the
      // mc_website_id resolved from the domain are trusted single-rooftop scopes;
      // any other id must be predominantly THIS rooftop's cars or it's rejected.
      // Every identifier earns its place on sampled purity — including source
      // and mc_website_id, which used to be accepted unconditionally. That
      // blanket trust is why a wrong feed could win once and then stick.
      const minPurity = strict ? 0.95 : 0.6;
      const recordHit = (param: string, value: string, r: { listings: MCListing[]; numFound: number; http: number }, label: string) => {
        let match = 0, mismatch = 0, unknown = 0;
        for (const l of r.listings) {
          const c = classifyListing(listingIdentity(l), rooftop);
          if (c === "match") match++; else if (c === "mismatch") mismatch++; else unknown++;
        }
        const decided = match + mismatch;
        const purity = decided === 0 ? 0 : match / decided;
        // new_units makes a segment gap visible in the admin card: a feed that
        // answers with cars but zero new units is how the whole new-car lot
        // silently vanished on 2026-08-01.
        const newUnits = r.listings.filter((l) => String(l.inventory_type || "").toLowerCase() === "new").length;
        attempts.push({ feed: label, param, id: value, http: r.http, num_found: r.numFound, got: r.listings.length, new_units: newUnits, match, mismatch, unknown, purity: Math.round(purity * 100) / 100 });
        if (r.listings.length > 0 && match > 0 && purity >= minPurity) hits.push({ param, value, r, purity });
      };

      // A pinned scope is the whole point of consistency: once a feed has been
      // proven against this rooftop, every later run uses that same feed and
      // nothing else. It is still re-validated each night — but if it stops
      // validating the run FAILS rather than quietly falling back to a guess,
      // because a silent fallback is exactly how the wrong store's cars arrived.
      const pinnedParam = (cfg.mc_scope_param || "").trim();
      const pinnedValue = (cfg.mc_scope_value || "").trim();
      let sample = { listings: [] as MCListing[], numFound: 0, http: 0 };
      let pinBroken = false;

      if (pinnedParam && pinnedValue) {
        const r = await syndPage(pinnedParam, pinnedValue, synRows, 0);
        recordHit(pinnedParam, pinnedValue, r, "syndication(pinned)");
        if (hits.length === 0) pinBroken = true;
      } else {
        // Nothing pinned yet — probe, highest-confidence first, then pin the winner.
        const probeList: Array<{ param: string; value: string }> = [];
        // Rooftop ids first (narrowest), then the domain, then a manual legacy
        // dealer_id. source= is a shared-domain risk, so it never outranks a
        // resolved rooftop.
        probeList.push(...dealership.probes);
        if (source) probeList.push({ param: "source", value: source });
        if (manualId) probeList.push({ param: "dealer_id", value: manualId });

        for (const p of probeList) {
          if (hits.length > 0) break;   // stop at the first validated scope
          const r = await syndPage(p.param, p.value, synRows, 0);
          recordHit(p.param, p.value, r, "syndication");
        }
        if (hits.length === 0) {
          sample = await mcFetch(SEARCH_ENDPOINT, `dealer_id=${encodeURIComponent(manualId || source)}&rows=${ROWS}&start=0`);
          attempts.push({ feed: "search(sample)", param: "dealer_id", id: manualId || source, http: sample.http, num_found: sample.numFound, got: sample.listings.length });
        }
      }

      // A pinned feed that no longer proves out is an alert, not a fallback.
      if (pinBroken) {
        await admin.from("marketcheck_sync_config").update({
          last_run_at: now.toISOString(),
          last_status: {
            ran_at: now.toISOString(), seen: 0, error: "pinned_scope_failed_validation",
            note: `Pinned feed ${pinnedParam}=${pinnedValue} no longer matches ${rooftop.street} ${rooftop.zip}. Inventory left untouched. Clear the pin to re-resolve.`,
            mc_param: pinnedParam, mc_value: pinnedValue, attempts: attempts.slice(0, 8),
          },
        }).eq("tenant_id", cfg.tenant_id);
        diagnostics.push({ tenant_id: cfg.tenant_id, source, error: "pinned_scope_failed_validation", mc_param: pinnedParam, mc_value: pinnedValue });
        continue;
      }

      // Prefer source, then mc_website_id, then purity, then count.
      const rank = (p: string) => p === "source" ? 2 : p === "mc_website_id" ? 1 : 0;
      hits.sort((a, b) => {
        const rr = rank(b.param) - rank(a.param);
        if (rr !== 0) return rr;
        if (b.purity !== a.purity) return b.purity - a.purity;
        return (b.r.numFound || b.r.listings.length) - (a.r.numFound || a.r.listings.length);
      });
      const best = hits[0] || null;
      const chosen: { param: string; value: string } | null = best ? { param: best.param, value: best.value } : null;
      const firstPage = best ? best.r : { listings: [] as MCListing[], numFound: 0, http: 0 };
      httpStatus = best ? firstPage.http : ((attempts[0]?.http as number) ?? 0);
      const probe = {
        chosen: chosen ? { feed: "syndication", param: chosen.param, id: chosen.value, purity: best?.purity } : null,
        dealer_record: verifiedName, dealership_http: dealership.http, attempts,
      };
      // No VALIDATED feed → ingest nothing, and persist WHY so the card shows it.
      if (!chosen) {
        const contaminated = attempts.some((a) => (a.got as number) > 0 && a.feed !== "search(sample)");
        const note = contaminated
          ? `The syndication feed returned cars, but none matched ${source || "this rooftop"}${dealerState ? ` / ${dealerState}` : ""} — wrong or over-broad id. Confirm the website domain.`
          : sample.listings.length > 0
            ? "Only the Inventory Search analytics sample answered (no price/stock) — the syndication feed returned no owned cars for this rooftop."
            : `No MarketCheck feed returned cars for ${source || "this rooftop"}. Confirm the website domain and the key's plan.`;
        diagnostics.push({
          tenant_id: cfg.tenant_id, source, dealer_record: verifiedName,
          error: contaminated ? "no_owned_match" : (sample.listings.length > 0 ? "search_sample_only" : "no_listings"),
          attempts, note,
        });
        await admin.from("marketcheck_sync_config").update({
          last_run_at: now.toISOString(),
          last_status: { ran_at: now.toISOString(), seen: 0, new_vehicles: 0, prices_recorded: 0, error: contaminated ? "no_owned_match" : "no_listings", note, matched_dealer: verifiedName, attempts: attempts.slice(0, 8) },
        }).eq("tenant_id", cfg.tenant_id);
        await logSyncRun({
          tenant_id: cfg.tenant_id, started_at: runStartedAt, status: "failed",
          http_status: (attempts[0]?.http as number) ?? 0, matched_dealer: verifiedName || null,
          error_summary: note, raw: { error: contaminated ? "no_owned_match" : (sample.listings.length > 0 ? "search_sample_only" : "no_listings"), attempts, source, dealer_record: verifiedName, note },
          errors: [{ code: contaminated ? "no_owned_match" : "no_listings", message: note }],
        });
        continue;
      }

      // The full per-listing ingest (files + listings + prices + change
      // detection), shared by the primary feed walk and the new-car coverage
      // backstop below. rtOverride lets the backstop validate against the
      // address-only rooftop (rooftop-id equality relaxed) while everything
      // else stays identical.
      const ingestListing = async (l: MCListing, rtOverride?: Rooftop): Promise<"capped" | "skipped" | "ok"> => {
        if (tenantSeen >= cfg.max_vehicles) return "capped";
        const rawVin = String(l.vin || "").toUpperCase().trim();
        const vin = normVin(l.vin);
        // Invalid VIN (fails 17-char/format check): log an exception then skip.
        const validVin = /^[A-HJ-NPR-Z0-9]{17}$/.test(rawVin);
        if (!validVin) {
          try {
            if (rawVin) {
              await emitException({
                tenant_id: cfg.tenant_id, vin: rawVin, exception_type: "invalid_vin",
                severity: "high", title: `Invalid VIN "${rawVin}"`,
                explanation: "VIN failed 17-character format check. The feed row was skipped.",
                source_values: { vin: rawVin, source: "marketcheck" },
                recommended_action: "Confirm the VIN with the source system; the listing was not ingested.",
                status: "open",
              });
            }
          } catch { /* best-effort */ }
          if (!vin || vin.length < 11) return "skipped";
        }
        if (!vin || vin.length < 11) return "skipped";
        // With a verified rooftop address, a car must positively match it.
        // Unproven listings are dropped rather than assumed ours — that
        // assumption is what let sibling stores drift in.
        const rt = rtOverride ?? rooftop;
        const rtStrict = cfg.strict_rooftop !== false && isStrictRooftop(rt);
        const own = classifyListing(listingIdentity(l), rt);
        if (own === "mismatch" || (rtStrict && own !== "match")) { rejected++; return "skipped"; }
        tenantSeen++; seen++;
        liveVins.add(vin);
        const price = toPrice(l.price);
        const stockNo = String(l.stock_no ?? (l.dealer && l.dealer.stock_no) ?? "").trim();
        const b = l.build || {};
        const ymm = [b.year, b.make, b.model].filter(Boolean).join(" ") || null;
        const condition = l.is_certified ? "cpo" : (l.inventory_type === "new" ? "new" : "used");
        if (condition === "new") newTypeSeen++;
        const miles = typeof l.miles === "number" ? Math.round(l.miles) : 0;
        if (stockNo) {
          const arr = stockMap.get(stockNo) || [];
          if (!arr.includes(vin)) arr.push(vin);
          stockMap.set(stockNo, arr);
        }

        // ── Change detection — capture prior state before any write ──
        // deno-lint-ignore no-explicit-any
        let priorListing: any = null;
        // deno-lint-ignore no-explicit-any
        let priorFile: any = null;
        try {
          const { data: pl } = await admin.from("vehicle_listings")
            .select("id, price, mileage, condition, ymm")
            .eq("tenant_id", cfg.tenant_id).eq("vin", vin).maybeSingle();
          priorListing = pl || null;
          const { data: pf } = await admin.from("vehicle_files")
            .select("id, stock_number, condition, mileage")
            .eq("tenant_id", cfg.tenant_id).eq("vin", vin).maybeSingle();
          priorFile = pf || null;
        } catch { /* diff best-effort */ }


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
          tenant_id: cfg.tenant_id, vin, condition, feed_source: "marketcheck",
          // Keep the VDP url even when the feed carried no price, so the
          // advertised-price crawler can seed a first price off the dealer's
          // own page (Your Price / <Dealer> Deal).
          source_url: l.vdp_url || null,
        };
        // Only set inventory fields the feed actually carried. A feed row
        // that reappears WITHOUT a price/mileage/ymm must never null out a
        // good value on an existing listing — and a nulled price would also
        // disable the FTC advertised-price guard, which reads
        // vehicle_listings.price as the feed baseline.
        if (ymm) patch.ymm = ymm;
        if (b.trim) patch.trim = b.trim;
        if (miles) patch.mileage = miles;
        // Price/doc-fee breakdown: the feed price is advertised-before-doc;
        // website sale price = advertised + the tenant doc fee (added once).
        // The nightly advertised-price crawl refines these from the live VDP.
        if (price != null) {
          patch.price = price;
          patch.doc_fee = tenantDocFee;
          if (advertisedInclDocFee && tenantDocFee > 0) {
            // Feed price is the fee-INCLUSIVE website price; derive before-doc.
            patch.advertised_price_before_doc = price - tenantDocFee;
            patch.website_sale_price = price;
            patch.price_parse_notes = "From MarketCheck feed; advertised price includes the tenant doc fee (not added again).";
          } else {
            // Feed price is BEFORE doc; website sale price adds the fee once.
            patch.advertised_price_before_doc = price;
            patch.website_sale_price = price + tenantDocFee;
            patch.price_parse_notes = "From MarketCheck feed; sale price = advertised + tenant doc fee.";
          }
          patch.price_source_url = l.vdp_url || null;
          patch.price_parse_status = "ok";
          patch.price_last_verified_at = new Date().toISOString();
        }
        // First-pass photos from the feed; the crawler later upgrades the
        // hero to the dealer's own og:image. Only set hero when present so we
        // never null out a better image captured by a previous run.
        // Prefer the dealer's own website photos (photo_links); fall back to
        // MarketCheck's cached copies only when the dealer set is missing.
        const gallery: string[] = (l.media?.photo_links?.length ? l.media.photo_links : l.media?.photo_links_cached) || [];
        if (gallery[0]) patch.hero_image_url = gallery[0];
        if (vl) {
          const { error } = await admin.from("vehicle_listings").update(patch).eq("id", vl.id);
          if (!error) {
            listingsUpserted++;
            updatedListingIds.push(vl.id);
            // A VIN that left the feed is retired, not deleted, so a car
            // that comes back is an UPDATE now where it used to be a fresh
            // INSERT. Without this it would keep the archived status it was
            // given on the way out and stay invisible to its own dealer.
            await admin.rpc("marketcheck_revive_listing", { _tenant_id: cfg.tenant_id, _vin: vin })
              .then(({ error: e }) => { if (e) console.warn("revive_failed", vin, e.message); });
            // Back-fill the Get-Ready hub token for cars that predate this
            // feature or were first ingested by another path (autocurb-sync,
            // manual add) so they never fall out of the get-ready flow.
            await ensureReadyToken(admin, cfg.tenant_id, vin, ymm, vl.id);
            // Backfill the compliance drafts for existing inventory
            // (idempotent) — with the render target, so a draft newly
            // created on this resync path also gets its form PDFs instead
            // of sitting file-less forever.
            await ensureComplianceDrafts(admin, cfg.tenant_id, vin, { supabaseUrl, serviceKey });
          } else if (!firstWriteErr) firstWriteErr = error.message;
        } else {
          const ins = await admin.from("vehicle_listings").insert({
            ...patch, store_id: cfg.tenant_id, slug: makeSlug(vin, ymm || undefined), status: "draft", sticker_snapshot: {},
          }).select("id").maybeSingle();
          if (!ins.error) {
            listingsUpserted++;
            // New car → auto-preload its Get-Ready QR + OEM window sticker.
            await autoPreload(admin, supabaseUrl, serviceKey, {
              tenantId: cfg.tenant_id, vin, ymm, listingId: ins.data?.id ?? null,
              emailTitle: String(pset.title_email_on_intake) !== "false",
            });
          } else if (!firstWriteErr) firstWriteErr = ins.error.message;
        }

        // Best-effort enrichment (full gallery + structured feed attributes),
        // isolated so a not-yet-migrated column can never break the core
        // listing write above.
        try {
          // Capture the entire MarketCheck build object so every data point
          // the feed carries (mpg, engine size, seating, dimensions, …) is
          // retained for any surface that needs it later, then layer the
          // normalized aliases the app reads on top.
          // Preserve options/features previously decoded by "Pull factory
          // options" (marketcheck-specs) — the syndication feed usually omits
          // them, so writing null on every sync was wiping that decoded data.
          const { data: priorRow } = await admin.from("vehicle_listings")
            .select("mc_attributes").eq("tenant_id", cfg.tenant_id).eq("vin", vin).maybeSingle();
          const priorMc = (priorRow?.mc_attributes || {}) as Record<string, unknown>;
          const mcAttrs = {
            ...(b as Record<string, unknown>),
            msrp: toPrice(l.msrp), exterior_color: l.exterior_color || null,
            interior_color: l.interior_color || null,
            base_ext_color: l.base_ext_color || null, base_int_color: l.base_int_color || null,
            engine: b.engine || null, transmission: b.transmission || null,
            drivetrain: b.drivetrain || null, fuel_type: b.fuel_type || null,
            body_type: b.body_type || null, doors: b.doors ?? null,
            cylinders: b.cylinders ?? null, vehicle_type: b.vehicle_type || null,
            city_mpg: b.city_mpg ?? null, highway_mpg: b.highway_mpg ?? null,
            engine_size: b.engine_size ?? null,
            // Alias to the keys the passport's specs/highlights actually read.
            seating: (b as Record<string, unknown>).std_seating ?? (b as Record<string, unknown>).seating ?? null,
            horsepower: (b as Record<string, unknown>).horsepower ?? (b as Record<string, unknown>).engine_power ?? null,
            // Market & history signals (days-on-market, price movement,
            // listing age, CARFAX badge flags, seller type).
            dom: l.dom ?? null, dom_active: l.dom_active ?? null, dom_180: l.dom_180 ?? null,
            price_change_percent: l.price_change_percent ?? null,
            ref_price: toPrice(l.ref_price), ref_miles: l.ref_miles ?? null,
            first_seen_at: l.first_seen_at ?? null, last_seen_at: l.last_seen_at ?? null,
            scraped_at: l.scraped_at ?? null,
            carfax_1_owner: l.carfax_1_owner ?? null, carfax_clean_title: l.carfax_clean_title ?? null,
            seller_type: l.seller_type || null, in_transit: l.in_transit ?? null,
            vdp_url: l.vdp_url || null,
            // Survives the rebuild only because it is named here.
            mc_listing_id: l.id ?? priorMc.mc_listing_id ?? null,
            // OEM equipment / options & packages when present in the feed.
            features: ((l.extra?.features ?? l.features) ?? priorMc.features) ?? null,
            options: ((l.extra?.options ?? l.options) ?? priorMc.options) ?? null,
            // Everything the VIN decode owns. mcAttrs is rebuilt from
            // scratch rather than spread over the prior value, so a key
            // that is not named here is DESTROYED on every sync.
            //
            // Carrying only options/features forward was not enough: the
            // syndication feed never carries a build sheet, so every night
            // this wiped build_sheet and the lifted factory pricing that
            // marketcheck-specs had written. The window sticker gates on
            // exactly that key, so the whole fleet fell back to
            // "awaiting_build_sheet: no saved NeoVIN build sheet on this
            // listing yet" — while vehicle_facts, which is an append-only
            // ledger, kept showing the same vehicle's MSRP as VERIFIED.
            //
            // It also wiped specs_attempts/specs_decoded_at, so the sweeps
            // saw an undecoded VIN again and RE-PAID the provider for an
            // answer we already had, every single night.
            ...decodeOwned(priorMc),
          };
          const enrich: Record<string, unknown> = { mc_attributes: mcAttrs };
          if (gallery.length) { enrich.photos = gallery; enrich.photo_count = gallery.length; }
          await admin.from("vehicle_listings").update(enrich)
            .eq("tenant_id", cfg.tenant_id).eq("vin", vin);
        } catch { /* photos / mc_attributes columns may not be migrated yet */ }

        // Keep the complete feed payload on the car and append a value
        // snapshot so the customer's value can be tracked over time.
        // Best-effort: the mc_raw column / history table may not exist yet.
        await admin.from("vehicle_listings").update({ mc_raw: l })
          .eq("tenant_id", cfg.tenant_id).eq("vin", vin)
          .then(() => undefined, () => undefined);
        // Skip the snapshot when the price hasn't moved since the last
        // capture — a nightly sync of an unchanged lot was appending an
        // identical row per car per run, bloating the timeline table.
        const { data: lastSnap } = await admin.from("vehicle_value_history")
          .select("listing_price, market_value")
          .eq("tenant_id", cfg.tenant_id).eq("vin", vin)
          .order("captured_at", { ascending: false }).limit(1)
          .then((r) => r, () => ({ data: null }));
        const last = Array.isArray(lastSnap) ? lastSnap[0] as { listing_price?: number | null; market_value?: number | null } | undefined : undefined;
        const lastPrice = last?.listing_price != null ? Number(last.listing_price) : null;
        const samePrice = last !== undefined && lastPrice === (price ?? null) && last.market_value == null;
        if (!samePrice) {
          await admin.from("vehicle_value_history").insert({
            tenant_id: cfg.tenant_id, vin, source: "marketcheck_sync",
            listing_price: price ?? null, payload: l, captured_at: new Date().toISOString(),
          }).then(() => undefined, () => undefined);
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
            // New or price-changed VIN → queue a full enrichment pull,
            // ZIP-anchored to the tenant's local market.
            if (enrichQueue.length < ENRICH_CAP) enrichQueue.push({ tenant_id: cfg.tenant_id, vin, zip: tenantZip || undefined });
          }
        }

        // ── Emit change_history + exceptions ──────────────────────
        // Wrapped so a logging failure never breaks the ingest loop.
        try {
          // Resolve the current listing id (for the FK on change_history).
          const listingId = priorListing?.id
            || (await admin.from("vehicle_listings").select("id")
              .eq("tenant_id", cfg.tenant_id).eq("vin", vin).maybeSingle()).data?.id
            || null;

          if (!priorListing) {
            // Brand-new VIN — or a reappearance of a previously-removed one.
            if (previouslyRemovedVins.has(vin)) {
              await emitChange({
                tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin,
                field_key: "_lifecycle", previous_value: "removed_from_feed",
                new_value: "relisted", source: "marketcheck", change_origin: "automatic",
              });
              await emitException({
                tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin, stock_number: stockNo || null,
                exception_type: "relisted", severity: "low",
                title: `${ymm || vin} is back on the feed`,
                explanation: "This VIN was previously removed from the feed and is now live again.",
                source_values: { price, miles, condition }, recommended_action: "Confirm status and refresh price/label if needed.",
                status: "open",
              });
            } else {
              await emitChange({
                tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin,
                field_key: "_lifecycle", previous_value: null,
                new_value: "new_vehicle", source: "marketcheck", change_origin: "automatic",
              });
              await emitException({
                tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin, stock_number: stockNo || null,
                exception_type: "new_vehicle", severity: "info",
                title: `${ymm || vin} added to inventory`,
                explanation: "First time this VIN has been seen from the feed.",
                source_values: { price, miles, condition },
                recommended_action: "Generate required documents (window sticker, addendum, buyers guide).",
                status: "open",
              });
            }
          } else {
            // Field-level diff on an existing listing.
            const prevPriceRaw = priorListing.price;
            const prevPrice = prevPriceRaw == null ? null : Number(prevPriceRaw);
            if (price != null && prevPrice != null && Math.abs(prevPrice - price) >= 1) {
              const a = applyAuthority("price", { severity: "medium", requires_new_document: true });
              if (!a.skip) {
                const ex = await emitException({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin, stock_number: stockNo || null,
                  exception_type: "price_change", severity: a.severity,
                  title: `Price ${price > prevPrice ? "raised" : "lowered"}: $${prevPrice.toLocaleString()} → $${price.toLocaleString()}`,
                  explanation: `The advertised price for ${ymm || vin} moved.`,
                  source_values: { previous: prevPrice, next: price, source: "marketcheck" },
                  recommended_action: "Regenerate & reprint the price label / addendum.",
                  requires_new_document: a.requires_new_document, status: "open",
                });
                await emitChange({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin,
                  field_key: "price", previous_value: String(prevPrice), new_value: String(price),
                  source: "marketcheck", change_origin: "automatic",
                  requires_new_document: a.requires_new_document, created_exception_id: ex,
                });
              }
            }

            const prevMilesRaw = priorListing.mileage;
            const prevMiles = prevMilesRaw == null ? null : Number(prevMilesRaw);
            if (miles > 0 && prevMiles != null && prevMiles !== miles) {
              const rolledBack = miles < prevMiles - 50;
              const type = rolledBack ? "mileage_rollback" : "mileage_change";
              const base = { severity: rolledBack ? "high" : "low", requires_new_document: rolledBack };
              const a = applyAuthority("mileage", base);
              if (!a.skip) {
                const ex = await emitException({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin, stock_number: stockNo || null,
                  exception_type: type, severity: a.severity,
                  title: rolledBack
                    ? `Mileage decreased: ${prevMiles.toLocaleString()} → ${miles.toLocaleString()}`
                    : `Mileage updated: ${prevMiles.toLocaleString()} → ${miles.toLocaleString()}`,
                  explanation: rolledBack
                    ? "Odometer reading dropped from the last sync. Verify the source before publishing."
                    : "Odometer reading changed on the feed.",
                  source_values: { previous: prevMiles, next: miles, source: "marketcheck" },
                  recommended_action: rolledBack ? "Verify the odometer with the source system and update the disclosure if needed."
                    : "Confirm the update and refresh printed materials on next print.",
                  requires_new_document: a.requires_new_document, status: "open",
                });
                await emitChange({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin,
                  field_key: "mileage", previous_value: String(prevMiles), new_value: String(miles),
                  source: "marketcheck", change_origin: "automatic",
                  requires_new_document: a.requires_new_document, created_exception_id: ex,
                });
              }
            }

            const prevCondition = priorListing.condition || null;
            if (prevCondition && prevCondition !== condition) {
              const a = applyAuthority("condition", { severity: "medium", requires_new_document: true });
              if (!a.skip) {
                const ex = await emitException({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin, stock_number: stockNo || null,
                  exception_type: condition === "cpo" || prevCondition === "cpo" ? "certification_change" : "vehicle_type_change",
                  severity: a.severity,
                  title: `Vehicle type changed: ${prevCondition} → ${condition}`,
                  explanation: "The feed reports a different new/used/CPO classification than the last run.",
                  source_values: { previous: prevCondition, next: condition, source: "marketcheck" },
                  recommended_action: "Confirm the correct classification; regenerate documents that vary by type.",
                  requires_new_document: a.requires_new_document, status: "open",
                });
                await emitChange({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin,
                  field_key: "condition", previous_value: prevCondition, new_value: condition,
                  source: "marketcheck", change_origin: "automatic",
                  requires_new_document: a.requires_new_document, created_exception_id: ex,
                });
              }
            }

            const prevStock = String(priorFile?.stock_number ?? "").trim();
            if (stockNo && prevStock && prevStock !== stockNo) {
              const a = applyAuthority("stock_number", { severity: "low" });
              if (!a.skip) {
                const ex = await emitException({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin, stock_number: stockNo,
                  exception_type: "stock_number_change", severity: a.severity,
                  title: `Stock # changed: ${prevStock} → ${stockNo}`,
                  explanation: "The DMS stock number on the feed changed for this VIN.",
                  source_values: { previous: prevStock, next: stockNo }, recommended_action: "Confirm the stock number in the DMS.",
                  requires_new_document: a.requires_new_document, status: "open",
                });
                await emitChange({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin,
                  field_key: "stock_number", previous_value: prevStock, new_value: stockNo,
                  source: "marketcheck", change_origin: "automatic",
                  requires_new_document: a.requires_new_document, created_exception_id: ex,
                });
              }
            }
          }

          // Missing required fields (used vehicles need price + mileage).
          if (condition === "used") {
            if (price == null) {
              const a = applyAuthority("price", { severity: "medium" });
              if (!a.skip) {
                await emitException({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin, stock_number: stockNo || null,
                  exception_type: "missing_required_field", severity: a.severity,
                  title: `Missing price on used vehicle ${ymm || vin}`,
                  explanation: "The feed row has no advertised price. A used vehicle must be published with a price.",
                  source_values: { field: "price", source: "marketcheck" },
                  recommended_action: "Set the advertised price at the source (DMS / website).",
                  requires_new_document: a.requires_new_document, status: "open",
                });
              }
            }
            if (!miles) {
              const a = applyAuthority("mileage", { severity: "medium" });
              if (!a.skip) {
                await emitException({
                  tenant_id: cfg.tenant_id, vehicle_listing_id: listingId, vin, stock_number: stockNo || null,
                  exception_type: "missing_required_field", severity: a.severity,
                  title: `Missing mileage on used vehicle ${ymm || vin}`,
                  explanation: "The feed row has no odometer reading for a used vehicle.",
                  source_values: { field: "mileage", source: "marketcheck" },
                  recommended_action: "Enter the odometer reading at the source system.",
                  requires_new_document: a.requires_new_document, status: "open",
                });
              }
            }
          }
        } catch { /* change detection is best-effort */ }
        return "ok";
      };

      // Page by the ACTUAL number of rows returned, not the requested size — a
      // low-tier MarketCheck key silently caps rows (e.g. to 10) even when we
      // ask for more, so we must advance `start` by what we really got and keep
      // going until we've covered num_found (or hit the per-run cap).
      let start = 0;
      let pageGuard = 0;
      pages:
      while (tenantSeen < cfg.max_vehicles && pageGuard < 500) {
        pageGuard++;
        const pageData = start === 0
          ? firstPage
          : await syndPage(chosen.param, chosen.value, synRows, start);
        const listings: MCListing[] = pageData.listings;
        numFound = pageData.numFound || numFound;
        if (listings.length === 0) break;

        for (const l of listings) {
          if (await ingestListing(l) === "capped") break pages;
        }

        start += listings.length;
        if (start >= numFound) { feedWalked = true; break; }
      }

      // ── New-car coverage backstop ─────────────────────────────────────
      // MarketCheck's owned attribution can silently drop an entire segment:
      // on 2026-08-01 the owned feed for this rooftop lost every new unit
      // (120 -> 56 cars with no query change on our side), the nightly kept
      // syncing used/CPO, and the prune archived the whole new-car lot. When
      // a tenant that has ever carried new inventory walks a FULL feed with
      // zero new units, probe the other scopes with car_type=new — ending
      // with the unowned feed, which includes syndicated/non-attributed
      // records and is where units that lost the physically-owned flag live.
      // Every row still passes the strict street+ZIP ownership check; only
      // the rooftop-id equality is relaxed, because MarketCheck re-attributes
      // rooftop ids and the street address is the physical truth.
      const primaryNewUnits = newTypeSeen;
      let supplementalNew: Record<string, unknown> | null = null;
      if (feedWalked && newTypeSeen === 0 && tenantSellsNew && tenantSeen < cfg.max_vehicles) {
        const addrRooftop: Rooftop = { ...rooftop, rooftopId: undefined };
        const tried: Array<Record<string, unknown>> = [];
        const supProbes: Array<{ param: string; value: string; owned: boolean }> = [];
        const pushProbe = (param: string, value: string, owned: boolean) => {
          if (!value) return;
          // The primary feed was walked in full, so re-probing the chosen
          // scope owned is provably empty.
          if (param === chosen.param && value === chosen.value && owned) return;
          if (supProbes.some((p) => p.param === param && p.value === value && p.owned === owned)) return;
          supProbes.push({ param, value, owned });
        };
        for (const p of dealership.probes) pushProbe(p.param, p.value, true);
        if (source) pushProbe("source", source, true);
        if (source) pushProbe("source", source, false);
        pushProbe(chosen.param, chosen.value, false);
        for (const p of supProbes.slice(0, 5)) {
          const r = await syndPage(p.param, p.value, synRows, 0, { carType: "new", owned: p.owned });
          // The unowned feed can return several copies per VIN; prefer the
          // copy with a price and the dealer's own VDP so its url/price wins.
          const score = (x: MCListing) => (toPrice(x.price) != null ? 2 : 0) + (source && listingHosts(x).includes(source) ? 1 : 0);
          const rowsSorted = [...r.listings].sort((a, b) => score(b) - score(a));
          let matched = 0, ingested = 0;
          let capped = false;
          for (const l of rowsSorted) {
            // car_type=new asked, but never trust the filter: only new units,
            // never a VIN the primary walk already ingested.
            if (String(l.inventory_type || "").toLowerCase() !== "new") continue;
            const v = normVin(l.vin);
            if (!v || liveVins.has(v)) continue;
            const own = classifyListing(listingIdentity(l), addrRooftop);
            if (own === "mismatch" || (cfg.strict_rooftop !== false && isStrictRooftop(addrRooftop) && own !== "match")) continue;
            matched++;
            const res = await ingestListing(l, addrRooftop);
            if (res === "capped") { capped = true; break; }
            if (res === "ok") ingested++;
          }
          tried.push({ param: p.param, id: p.value, owned: p.owned, http: r.http, num_found: r.numFound, got: r.listings.length, matched, ingested });
          if (ingested > 0 || capped) {
            supplementalNew = { param: p.param, id: p.value, owned: p.owned, ingested, attempts: tried };
            break;
          }
        }
        if (!supplementalNew) supplementalNew = { exhausted: true, attempts: tried };
      }

      // ── Duplicate stock_number across live VINs ────────────────────
      try {
        for (const [stock, vins] of stockMap.entries()) {
          if (vins.length < 2) continue;
          for (const v of vins) {
            const a = applyAuthority("stock_number", { severity: "medium" });
            if (a.skip) continue;
            await emitException({
              tenant_id: cfg.tenant_id, vin: v, stock_number: stock,
              exception_type: "duplicate_stock", severity: a.severity,
              title: `Stock # ${stock} used on ${vins.length} live VINs`,
              explanation: `Multiple live vehicles share stock number ${stock}: ${vins.join(", ")}. Stock numbers should be unique.`,
              source_values: { stock, vins }, recommended_action: "Reassign one of the vehicles a unique stock number at the source.",
              status: "open",
            });
          }
        }
      } catch { /* dupe scan best-effort */ }

      // ── Removed-from-feed detection (before the prune deletes the rows) ──
      // Only run when we pulled a FULL inventory successfully. Failed/partial
      // pulls never mark cars as removed — the prune guard already blocks that.
      try {
        // Same correction as prune: completeness is "we walked every page",
        // not "we kept as many cars as the raw feed reported".
        const fullSuccess = !firstWriteErr && liveVins.size > 0 && numFound > 0 && feedWalked;
        if (fullSuccess && priorExistingVins.size > 0) {
          for (const v of priorExistingVins) {
            if (liveVins.has(v)) continue;
            if (excInserts >= EXC_CAP) break;
            const a = applyAuthority("_lifecycle", { severity: "low" });
            if (a.skip) continue;
            const ex = await emitException({
              tenant_id: cfg.tenant_id, vin: v, exception_type: "removed_from_feed",
              severity: a.severity, title: `${v} left the inventory feed`,
              explanation: "The VIN was present on the previous pull but is absent from a successful full pull. This does NOT mark the car as sold.",
              source_values: { source: "marketcheck" },
              recommended_action: "Confirm whether the vehicle was sold, moved, or is a source glitch.",
              status: "open",
            });
            await emitChange({
              tenant_id: cfg.tenant_id, vin: v,
              field_key: "_lifecycle", previous_value: "live", new_value: "removed_from_feed",
              source: "marketcheck", change_origin: "automatic", created_exception_id: ex,
            });
          }
        }
      } catch { /* removed detection best-effort */ }


      // Replace-on-sync: prune MarketCheck cars that left the feed. Only when we
      // pulled the FULL inventory (not capped) and got a real result, so a
      // partial/failed pull never deletes good cars.
      //
      // Two gates, because prune is the only destructive step:
      //  1. feedWalked — we fetched every page, so liveVins is the whole lot.
      //     (tenantSeen >= numFound can no longer be the test: numFound counts
      //     the raw feed, tenantSeen counts only cars proven to be ours.)
      //  2. Collapse breaker — if a validated feed suddenly returns far fewer
      //     cars than the last good run, treat it as a feed fault and skip the
      //     prune. Better to carry a stale car for a day than to delete a live
      //     lot because a feed hiccuped.
      let pruned: { listings_deleted?: number; files_deleted?: number } | null = null;
      const lastGood = Number(cfg.last_good_count || 0);
      const pruneSkipped = prunePreflight({
        feedWalked, matched: tenantSeen, liveVins: liveVins.size,
        lastGoodCount: lastGood, writeError: !!firstWriteErr,
      });
      const collapsed = !!pruneSkipped?.startsWith("inventory_collapsed");

      if (!pruneSkipped) {
        const { data: pr } = await admin.rpc("marketcheck_prune_inventory", {
          _tenant_id: cfg.tenant_id, _live_vins: Array.from(liveVins),
        });
        pruned = (pr || null) as { listings_deleted?: number; files_deleted?: number } | null;
      }

      // Pin the feed that just proved itself, and record the healthy count the
      // collapse breaker measures against. Only on a clean full walk.
      const cleanRun = !firstWriteErr && feedWalked && !collapsed && tenantSeen > 0;
      if (cleanRun && chosen.param && chosen.value) {
        try {
          await admin.rpc("marketcheck_pin_scope", {
            _tenant_id: cfg.tenant_id, _param: chosen.param, _value: chosen.value,
            _name: verifiedName || "", _count: tenantSeen,
          });
        } catch { /* pinning is best-effort; the run itself already succeeded */ }
      }

      // Self-healing enrichment: the price-change gate above only queues new or
      // re-priced VINs, so a car whose enrichment failed once (or predates the
      // enrichment feature) would otherwise stay empty forever. Top up the queue
      // with this tenant's never-enriched VINs, capped per run, so the nightly
      // steadily backfills the whole lot instead of only churning fresh cars.
      if (enrichQueue.length < ENRICH_CAP) {
        const { data: stale } = await admin.from("vehicle_listings")
          .select("vin").eq("tenant_id", cfg.tenant_id).is("enriched_at", null)
          .limit(ENRICH_CAP - enrichQueue.length);
        for (const s of (stale || []) as Array<{ vin: string }>) {
          const v = normVin(s.vin);
          if (v && enrichQueue.length < ENRICH_CAP && !enrichQueue.some((e) => e.vin === v && e.tenant_id === cfg.tenant_id)) {
            enrichQueue.push({ tenant_id: cfg.tenant_id, vin: v, zip: tenantZip || undefined });
          }
        }
      }

      // Description Intelligence for UPDATED vehicles (new inserts are covered by
      // autoPreload above). Fire-and-forget by design — a description failure must
      // never block or slow inventory ingestion. The orchestrator is idempotent
      // on (tenant, vehicle, source_data_version, config_version), and anything
      // missed here is picked up by the nightly reconcile sweep.
      for (const vehicleId of updatedListingIds.slice(0, 200)) {
        try {
          fetch(`${supabaseUrl}/functions/v1/description-orchestrate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ action: "orchestrate", tenant_id: cfg.tenant_id, vehicle_id: vehicleId, reason: "feed_update" }),
            signal: AbortSignal.timeout(20000),
          }).catch(() => { /* best-effort */ });
        } catch { /* description best-effort */ }
      }

      tenantsSynced++;
      const status = { ran_at: now.toISOString(), seen: tenantSeen, new_vehicles: tenantNew, prices_recorded: tenantPrices, dealer_id: manualId, num_found: numFound, http: httpStatus, removed: pruned?.listings_deleted ?? 0, mc_param: chosen.param, mc_value: chosen.value, matched_dealer: verifiedName, rooftop_strict: strict, rooftop_street: rooftop.street, rooftop_zip: rooftop.zip, rejected_other_rooftop: rejected, feed_walked: feedWalked, prune_skipped: pruneSkipped, pinned: cleanRun,
        new_units: { primary_feed: primaryNewUnits, total: newTypeSeen }, supplemental_new: supplementalNew,
        // Operator-only. Public list prices, so an estimate rather than a bill.
        api_usage: estimateCost(callMeter, 30) };
      diagnostics.push({ tenant_id: cfg.tenant_id, source, dealer_id: manualId, matched_dealer: verifiedName || "(by domain)", resolved: !cfg.dealer_id, num_found: numFound, http: httpStatus, seen: tenantSeen, listings_written: listingsUpserted, removed: pruned?.listings_deleted ?? 0, write_error: firstWriteErr, ...probe });
      await admin.from("marketcheck_sync_config")
        .update({ last_run_at: now.toISOString(), last_status: status })
        .eq("tenant_id", cfg.tenant_id);
      await admin.from("audit_log").insert({
        action: "marketcheck_sync", entity_type: "tenant", entity_id: cfg.tenant_id,
        store_id: cfg.tenant_id, details: { source, ...status },
      }).then(() => undefined, () => undefined);

      // Distinct status classification:
      //   'failed'      → a write error surfaced this run (firstWriteErr set)
      //   'empty_valid' → chosen feed responded fine, but returned zero cars
      //   'partial'     → capped by max_vehicles / didn't reach num_found (no prune)
      //   'success'     → covered the full inventory (prune guard would have run)
      const runStatus: "success" | "partial" | "failed" | "empty_valid" =
        firstWriteErr ? "failed"
          : (numFound === 0 && tenantSeen === 0) ? "empty_valid"
          : (tenantSeen < numFound || tenantSeen >= cfg.max_vehicles) ? "partial"
          : "success";
      await logSyncRun({
        tenant_id: cfg.tenant_id, started_at: runStartedAt, status: runStatus,
        num_found: numFound, seen: tenantSeen, new_vehicles: tenantNew,
        updated_vehicles: Math.max(0, listingsUpserted - tenantNew),
        prices_recorded: tenantPrices, removed: pruned?.listings_deleted ?? 0,
        http_status: httpStatus, matched_dealer: verifiedName || null,
        error_summary: firstWriteErr,
        raw: { source, dealer_id: manualId, mc_param: chosen.param, mc_value: chosen.value, ...probe, pruned, new_units: { primary_feed: primaryNewUnits, total: newTypeSeen }, supplemental_new: supplementalNew },
        errors: firstWriteErr ? [{ code: "write_error", message: firstWriteErr }] : [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ tenant_id: cfg.tenant_id, error: msg });
      await logSyncRun({
        tenant_id: cfg.tenant_id, started_at: runStartedAt, status: "failed",
        seen: tenantSeen, new_vehicles: tenantNew, prices_recorded: tenantPrices,
        error_summary: msg, raw: { exception: msg },
        errors: [{ code: "exception", message: msg }],
      });
    }
  }

  // ── Full enrichment pass (best-effort, capped, SEQUENTIAL) ──
  // Each VIN's enrich fans out ~6-8 MarketCheck requests; running several VINs
  // concurrently pushed past MarketCheck's rate limit and comps/history came
  // back partial. Process one VIN at a time so each gets the full dataset.
  //
  // This inline pass is bounded by the edge wall-clock (hence ENRICH_CAP ≈ 10),
  // so it only chips away a slice per run — that is the NIGHTLY cron path. A
  // manual "Re-pull full inventory" passes enrich:false because the browser
  // then orchestrates a complete, rate-limit-safe enrich loop over EVERY VIN
  // (no wall-clock limit, with live progress) — see MarketcheckDataHealthCard.
  const runInlineEnrich = body.enrich !== false;
  let enriched = 0;
  for (const e of runInlineEnrich ? enrichQueue : []) {
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/vehicle-enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, "x-cron-secret": cronSecret },
        body: JSON.stringify(e), signal: AbortSignal.timeout(30000),
      });
      if (r.ok) enriched++;
    } catch { /* best-effort — a failed enrich leaves the listing's prior data intact */ }
  }

  // Once-daily full enrichment sweep. The inline pass above only covers new /
  // re-priced cars (kept for immediacy); this self-chaining sweep backfills the
  // entire inventory one VIN at a time on the shared MarketCheck key. Fire in a
  // single configurable UTC hour; the sweep's cursor makes repeat triggers safe.
  try {
    const sweepHour = Number(Deno.env.get("ENRICH_SWEEP_HOUR_UTC") || "8");
    if (new Date().getUTCHours() === sweepHour) {
      fetch(`${supabaseUrl}/functions/v1/enrich-sweep`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, "x-cron-secret": cronSecret },
        body: "{}", signal: AbortSignal.timeout(15000),
      }).catch(() => { /* best-effort */ });
    }
  } catch { /* best-effort */ }

  // Once-daily Get-Ready nudge digest. This runs hourly, so fire only in a single
  // UTC hour; the nudge function self-throttles per tenant. Reuses our valid
  // service-role context instead of a separate cron with its own auth.
  try {
    if (new Date().getUTCHours() === 14) {
      fetch(`${supabaseUrl}/functions/v1/get-ready-nudges`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, "x-cron-secret": cronSecret },
        body: "{}", signal: AbortSignal.timeout(20000),
      }).catch(() => { /* best-effort */ });
    }
  } catch { /* best-effort */ }

  drainArtifactPosts();
  return json(200, {
    ok: true, tenants_due: due.length, tenants_synced: tenantsSynced,
    listings_seen: seen, new_vehicles: newVehicles,
    listings_upserted: listingsUpserted, prices_recorded: pricesRecorded,
    enrich_queued: enrichQueue.length, enriched, errors, diagnostics,
  });
});
