// vehicle-lookup
// Read-only lookup for sister apps (AutoFilm). Auth is a shared secret in the
// `x-lookup-secret` header; scope is always a tenant id (matched against
// tenant_id OR store_id). Two modes on one route, so the caller needs no second
// URL and no second credential:
//
//   SEARCH  ?tenant=<id>&q=<vin|stock|slug>
//           Up to 5 candidates, best match first. Unchanged.
//
//   LIST    ?tenant=<id>&q=*&page=<0-based>&limit=<n>
//           The whole lot, VIN-sorted, with a tenant-wide `total` so the caller
//           can prove it missed nothing. q may also be "%" or omitted.
//           { total, page, limit, has_more, matches[] }
//
// Both carry a canonical passport_url of https://autolabels.io/v/<slug>.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lookup-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const PASSPORT_BASE = "https://autolabels.io/v";

const COLS = [
  "id", "vin", "slug", "ymm", "trim", "mileage", "condition", "price",
  "status", "published_at", "hero_image_url", "photos", "photo_count",
  "tenant_id", "store_id", "mc_attributes", "key_specs", "features",
  "certification", "recall_status", "open_recall_count", "closed_recall_count",
  "market_value", "market_position", "market_payload", "history_report_url",
  "warranty_info", "epa_economy", "payment_estimate", "in_service_date",
  "website_sale_price", "retail_cash", "dealer_discount", "doc_fee",
  "advertised_price_before_doc", "website_price_term",
  "factory_sticker_url", "oem_sticker_url", "description",
  "available_accessories", "service_records",
].join(", ");

const splitYmm = (ymm: string | null): { year?: number; make?: string; model?: string } => {
  if (!ymm) return {};
  const parts = ymm.trim().split(/\s+/);
  const year = /^\d{4}$/.test(parts[0]) ? Number(parts[0]) : undefined;
  const make = year ? parts[1] : parts[0];
  const model = year ? parts.slice(2).join(" ") : parts.slice(1).join(" ");
  return { year, make, model: model || undefined };
};

const pickStock = (r: any): string | null => {
  const mc = r.mc_attributes || {};
  const ks = r.key_specs || {};
  return (
    mc.stock ?? mc.stock_number ?? mc.stockNumber ??
    ks.stock ?? ks.stock_number ?? ks.stockNumber ??
    null
  );
};

// Photos are stored either as bare URL strings or as { url } objects.
const normalizePhotos = (photos: unknown): string[] => {
  if (!Array.isArray(photos)) return [];
  return photos
    .map((p: any) => (typeof p === "string" ? p : p?.url))
    .filter((u: unknown): u is string => typeof u === "string" && u.length > 0);
};

const compact = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
};

const shape = (r: any, stockFromFiles?: string | null) => {
  const { year, make, model } = splitYmm(r.ymm);
  const slug = r.slug || r.vin || "";
  const photos = normalizePhotos(r.photos);
  const stock = pickStock(r) ?? stockFromFiles ?? null;

  return compact({
    // Identity
    vin: r.vin ?? null,
    year: year ?? null,
    make: make ?? null,
    model: model ?? null,
    trim: r.trim ?? null,
    ymm: r.ymm ?? null,
    condition: r.condition ?? null,
    stock,
    in_service_date: r.in_service_date ?? null,

    // Mileage
    mileage: r.mileage ?? null,

    // Pricing
    price: r.price ?? null,
    website_sale_price: r.website_sale_price ?? null,
    retail_cash: r.retail_cash ?? null,
    dealer_discount: r.dealer_discount ?? null,
    doc_fee: r.doc_fee ?? null,
    advertised_price_before_doc: r.advertised_price_before_doc ?? null,
    website_price_term: r.website_price_term ?? null,
    payment_estimate: r.payment_estimate ?? null,

    // Images
    hero_image_url: r.hero_image_url ?? null,
    photos,
    photo_count: r.photo_count ?? (photos.length || null),

    // Trust/value signals
    certification: r.certification ?? null,
    recall_status: r.recall_status ?? null,
    open_recall_count: r.open_recall_count ?? null,
    closed_recall_count: r.closed_recall_count ?? null,
    market_position: r.market_position ?? null,
    market_value: r.market_value ?? null,
    market_payload: r.market_payload ?? null,
    history_report_url: r.history_report_url ?? null,
    warranty_info: r.warranty_info ?? null,
    epa_economy: r.epa_economy ?? null,
    key_specs: r.key_specs ?? null,
    features: r.features ?? null,
    factory_sticker_url: r.factory_sticker_url ?? null,
    oem_sticker_url: r.oem_sticker_url ?? null,
    description: r.description ?? null,
    available_accessories: r.available_accessories ?? null,

    // Status + passport
    status: r.status ?? null,
    slug: r.slug ?? null,
    passport_url: slug ? `${PASSPORT_BASE}/${slug}` : null,
  });
};

// ── List mode ─────────────────────────────────────────────────────────
//
// AutoFilm needs "tell me about this lot", not "tell me about this VIN". The
// search path above answers the second question and caps at 5, which read as a
// clean answer for weeks — a 132-car lot syncing as 5 cars looks exactly like a
// 5-car dealership.
//
// The list rows are the LISTING ROW ITSELF, minus a denylist, rather than a
// projection picked field by field. A projection drifts the first time somebody
// adds a column, and the drift is silent: a field the feed forgot looks
// identical to a vehicle that has no value for it. Allow-by-default inverts
// that — a new column reaches AutoFilm on its own, and the only way to withhold
// one is to name it here deliberately.
const LIST_DENY = new Set([
  // Credential.
  "install_token",
  // Internal actors and operational notes — not the sister app's business and
  // never a customer's.
  "created_by", "assigned_agent_id",
  "recall_override_by", "recall_override_at", "recall_override_notes",
  "price_parse_notes",
  // Licensed or bulky provider payloads. Black Book in particular is paid
  // valuation data; redistributing it to another product is a licensing
  // question, and AutoFilm renders none of it.
  "blackbook", "mc_raw", "market_payload", "comparables",
  "history_payload", "recall_payload",
]);

const MAX_LIST_LIMIT = 500;
const DEFAULT_LIST_LIMIT = 200;

// A page renders in a browser, so an http URL is a mixed-content block. Dropped
// rather than upgraded — guessing that a host serves TLS is how you trade a
// blocked image for a broken one.
const httpsOnly = (u: unknown): string | null =>
  typeof u === "string" && /^https:\/\//i.test(u.trim()) ? u.trim() : null;

// The window sticker AutoFilm can persist and re-serve.
//
// Deliberately NOT the generated factory sticker's PDF: that one is filed in a
// private bucket and served through short-lived signed URLs, so a stored copy
// would open fine the day it syncs and return InvalidJWT a week later — the
// exact failure the dealer side just had to be fixed for. The OEM document is
// signed for five years and is the genuine Monroney, so it is the one that
// travels. Everything else routes to the passport documents page, which mints
// its own URL per view and carries the reproduction disclosure that a raw PDF
// deep link would strip.
const windowStickerUrl = (r: any): string | null => httpsOnly(r.oem_sticker_url);

const documentsUrl = (slug: string | null): string | null =>
  slug ? `${PASSPORT_BASE}/${slug}/documents` : null;

const shapeListRow = (r: any, stockFromFiles?: string | null) => {
  const { year, make, model } = splitYmm(r.ymm);
  const slug = r.slug || null;
  const mc = (r.mc_attributes || {}) as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (LIST_DENY.has(k)) continue;
    out[k] = v;
  }

  // Derived on top of the row, never in place of it.
  out.year = year ?? null;
  out.make = make ?? null;
  out.model = model ?? null;
  out.photos = normalizePhotos(r.photos);
  out.stock = pickStock(r) ?? stockFromFiles ?? null;
  out.stock_number = out.stock;
  out.passport_url = slug ? `${PASSPORT_BASE}/${slug}` : null;
  out.documents_url = documentsUrl(slug);

  // The four the passport shows and the feed never carried.
  out.window_sticker_url = windowStickerUrl(r);
  // MSRP is not a column; the passport reads it off mc_attributes and so does
  // this, from the same place, so the two cannot disagree.
  out.msrp = typeof mc.msrp === "number" ? mc.msrp : null;
  out.market_value = r.market_value ?? null;
  // Stated, never computed. A savings figure derived from msrp - price would be
  // our arithmetic presented as the dealership's claim.
  out.savings = r.dealer_discount ?? null;

  return out;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const secret = Deno.env.get("AUTOLABELS_LOOKUP_SECRET");
    const provided = req.headers.get("x-lookup-secret");
    if (!secret || !provided || provided !== secret) {
      return json(401, { matches: [], error: "unauthorized" });
    }

    let tenant = "";
    let q = "";
    let pageRaw: string | null = null;
    let limitRaw: string | null = null;
    if (req.method === "GET") {
      const url = new URL(req.url);
      tenant = url.searchParams.get("tenant") || "";
      q = url.searchParams.get("q") || "";
      pageRaw = url.searchParams.get("page");
      limitRaw = url.searchParams.get("limit");
    } else {
      const body = await req.json().catch(() => ({}));
      tenant = body.tenant || "";
      q = body.q || "";
      pageRaw = body.page != null ? String(body.page) : null;
      limitRaw = body.limit != null ? String(body.limit) : null;
      if (!tenant || !q) {
        const url = new URL(req.url);
        tenant ||= url.searchParams.get("tenant") || "";
        q ||= url.searchParams.get("q") || "";
        pageRaw ??= url.searchParams.get("page");
        limitRaw ??= url.searchParams.get("limit");
      }
    }

    tenant = tenant.trim();
    q = q.trim().toUpperCase();

    // "*" and "%" are the wildcards AutoFilm already sends. A bare tenant with
    // no q means the same thing and is accepted rather than refused — asking
    // for a whole lot without naming a vehicle is the point of list mode.
    const wantsList = q === "*" || q === "%" || q === "";
    if (!tenant) return json(200, { matches: [], error: "missing tenant" });
    if (!wantsList && !q) return json(200, { matches: [], error: "missing tenant or q" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tenantFilter = `tenant_id.eq.${tenant},store_id.eq.${tenant}`;

    if (wantsList) {
      const page = Math.max(0, Number.parseInt(pageRaw ?? "0", 10) || 0);
      const asked = Number.parseInt(limitRaw ?? "", 10);
      const limit = Math.min(
        Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_LIST_LIMIT,
        MAX_LIST_LIMIT,
      );
      const from = page * limit;

      // The count is over the WHOLE tenant, not the page. Without it a short
      // read is indistinguishable from a small lot, which is precisely how a
      // five-row cap passed for a complete answer.
      const countRes = await (supabase as any)
        .from("vehicle_listings")
        .select("id", { count: "exact", head: true })
        .or(tenantFilter);
      if (countRes.error) {
        return json(200, { matches: [], total: null, error: countRes.error.message });
      }
      const total = countRes.count ?? 0;

      // Sorted by VIN, which does not move. Ordering by recency or price lets a
      // vehicle cross a page boundary between requests and land on neither
      // page — a miss that leaves the run looking clean.
      const rowsRes = await (supabase as any)
        .from("vehicle_listings")
        .select("*")
        .or(tenantFilter)
        .order("vin", { ascending: true })
        .range(from, from + limit - 1);
      if (rowsRes.error) {
        return json(200, { matches: [], total, error: rowsRes.error.message });
      }
      const rows = (rowsRes.data as any[]) || [];

      // vehicle_listings has no stock_number column; the DMS number lives on
      // vehicle_files. Backfilled per page so a caller keying on stock always
      // gets one where the dealer records it.
      const stockByVin = new Map<string, string>();
      const vins = rows.map((r) => r.vin).filter(Boolean);
      if (vins.length) {
        const filesRes = await (supabase as any)
          .from("vehicle_files")
          .select("vin, stock_number")
          .or(tenantFilter)
          .in("vin", vins);
        for (const f of (filesRes?.data as any[]) || []) {
          if (f.vin && f.stock_number) stockByVin.set(f.vin, f.stock_number);
        }
      }

      return json(200, {
        total,
        page,
        limit,
        // Derived from the count, so it stays honest even when the page size
        // was capped below what the caller asked for.
        has_more: from + rows.length < total,
        matches: rows.map((r) => shapeListRow(r, stockByVin.get(r.vin) ?? null)),
      });
    }

    const rowsById = new Map<string, any>();
    const addRows = (rows: any[] | null | undefined) => {
      if (!rows) return;
      for (const r of rows) {
        const k = r.id || r.vin || r.slug || Math.random().toString();
        if (!rowsById.has(k)) rowsById.set(k, r);
      }
    };

    const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn(); } catch { return null; }
    };

    const isFullVin = q.length === 17;

    // 1) Full VIN exact
    if (isFullVin) {
      const res = await safe(() => (supabase as any)
        .from("vehicle_listings")
        .select(COLS)
        .or(tenantFilter)
        .eq("vin", q)
        .limit(5));
      addRows(res?.data);
    }

    // 2) Partial VIN or slug
    if (rowsById.size < 5) {
      const like = `%${q}%`;
      const res = await safe(() => (supabase as any)
        .from("vehicle_listings")
        .select(COLS)
        .or(tenantFilter)
        .or(`vin.ilike.${like},slug.ilike.${like}`)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10));
      addRows(res?.data);
    }

    // 3) Stock number in JSON attributes
    if (rowsById.size < 5) {
      for (const key of ["stock", "stock_number"]) {
        const mc = await safe(() => (supabase as any)
          .from("vehicle_listings")
          .select(COLS)
          .or(tenantFilter)
          .contains("mc_attributes", { [key]: q })
          .limit(5));
        addRows(mc?.data);
        const ks = await safe(() => (supabase as any)
          .from("vehicle_listings")
          .select(COLS)
          .or(tenantFilter)
          .contains("key_specs", { [key]: q })
          .limit(5));
        addRows(ks?.data);
      }
    }

    // 4) Stock lookup via vehicle_files → resolve to vin, then re-query listings
    const stockByVin = new Map<string, string>();
    if (rowsById.size < 5) {
      const filesRes = await safe(() => (supabase as any)
        .from("vehicle_files")
        .select("vin, stock_number, tenant_id, store_id")
        .or(tenantFilter)
        .ilike("stock_number", `%${q}%`)
        .limit(5));
      const files = (filesRes?.data as any[]) || [];
      for (const f of files) if (f.vin && f.stock_number) stockByVin.set(f.vin, f.stock_number);
      const vins = files.map((f: any) => f.vin).filter(Boolean);
      if (vins.length) {
        const res = await safe(() => (supabase as any)
          .from("vehicle_listings")
          .select(COLS)
          .or(tenantFilter)
          .in("vin", vins)
          .limit(5));
        addRows(res?.data);
      }
    }

    // Also backfill stock from vehicle_files for any matched vins (so callers
    // that key on stock# always get one when the dealer records it in files).
    const matchedVins = Array.from(rowsById.values()).map((r) => r.vin).filter(Boolean);
    if (matchedVins.length) {
      const filesRes = await safe(() => (supabase as any)
        .from("vehicle_files")
        .select("vin, stock_number")
        .or(tenantFilter)
        .in("vin", matchedVins));
      for (const f of (filesRes?.data as any[]) || []) {
        if (f.vin && f.stock_number && !stockByVin.has(f.vin)) stockByVin.set(f.vin, f.stock_number);
      }
    }

    // Prefer published rows, then most-recent
    const rows = Array.from(rowsById.values()).sort((a: any, b: any) => {
      const ap = a.status === "published" ? 0 : 1;
      const bp = b.status === "published" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (b.published_at || "").localeCompare(a.published_at || "");
    });

    return json(200, {
      matches: rows.slice(0, 5).map((r) => shape(r, stockByVin.get(r.vin) ?? null)),
    });
  } catch (e) {
    return json(200, { matches: [], error: (e as Error).message });
  }
});
