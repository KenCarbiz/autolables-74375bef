// Pure decision logic for the multi-rooftop autofilm-feed (contract v1,
// 2026-11-20). No I/O: owner resolution, duplicate reporting, row mapping and
// the stores report all live here so tests can execute them.
//
// Feed availability is not listing publication and not a subscription. Nothing
// here reads subscription_status, listing_sync_enabled or any billing field.

import { normalizePhotos } from "./lotFeedRow.ts";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FeedStore {
  id: string;
  display_name: string;
  legal_name?: string | null;
  city?: string | null;
  state?: string | null;
  status?: string | null;
  is_primary_inventory_store: boolean;
  inventory_feed_enabled: boolean;
}

export interface StoreRef {
  id: string;
  display_name: string;
  city: string | null;
  state: string | null;
}

export interface ListingMeta {
  id: string;
  vin: string;
  owning_store_id?: string | null;
  /** vehicle_listings.store_id is TEXT; legacy rows carry the tenant id. */
  store_id?: string | null;
  updated_at?: string | null;
}

export interface FeedMeta {
  id: string;
  vin: string;
  store_id: string;
  last_seen_at?: string | null;
  updated_at?: string | null;
  /** Only 'present' rows count anywhere; when absent the caller already filtered. */
  presence?: string | null;
}

const isPresent = (f: FeedMeta): boolean => f.presence === undefined || f.presence === null || f.presence === "present";

export type OwnerSource = "listing" | "feed";

export interface Owned {
  vin: string;
  source: OwnerSource;
  store_id: string | null;
  listing?: ListingMeta;
  feed?: FeedMeta;
}

export interface DuplicateReport {
  vin: string;
  owner: { store_id: string | null; source: OwnerSource };
  losers: Array<{ store_id: string | null; source: OwnerSource }>;
}

export const storeRef = (s: FeedStore): StoreRef => ({
  id: s.id,
  display_name: s.display_name,
  city: s.city ?? null,
  state: s.state ?? null,
});

/** The store a legacy listing belongs to when it names none: the primary
 *  inventory store, else the only store the tenant has, else unresolved. */
export function defaultStore(stores: FeedStore[]): FeedStore | null {
  const primaries = stores.filter((s) => s.is_primary_inventory_store);
  if (primaries.length === 1) return primaries[0];
  if (primaries.length === 0 && stores.length === 1) return stores[0];
  return null;
}

/**
 * Which store a listing belongs to (contract rule 2, location truth first).
 *  1. owning_store_id when it names one of the tenant's stores,
 *  2. else the one store whose present feed carries this VIN (several: fall
 *     through, never guess),
 *  3. else a text store_id naming a tenant store,
 *  4. else the default store (primary, or the sole store).
 * presentStoreIds are stores with a presence='present' feed row for the VIN.
 */
export function resolveListingStore(
  l: Pick<ListingMeta, "owning_store_id" | "store_id">,
  stores: FeedStore[],
  presentStoreIds: string[] = [],
): string | null {
  const ids = new Set(stores.map((s) => s.id));
  const owning = (l.owning_store_id ?? "").trim().toLowerCase();
  if (owning && ids.has(owning)) return owning;
  const present = [...new Set(presentStoreIds.map((x) => x.toLowerCase()))].filter((x) => ids.has(x));
  if (present.length === 1) return present[0];
  const text = (l.store_id ?? "").trim().toLowerCase();
  if (text && ids.has(text)) return text;
  return defaultStore(stores)?.id ?? null;
}

const ts = (v?: string | null): number => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * One VIN, one owning store per tenant (contract rule 3).
 *  (a) a live listing's resolved store,
 *  (b) the primary inventory store,
 *  (c) the store whose feed saw the VIN most recently, ties by store id.
 * Appearances that lose are reported, never served. A feed row in the same
 * store as the winning listing is the same car, not a duplicate.
 */
export function resolveOwners(
  listings: ListingMeta[],
  feed: FeedMeta[],
  stores: FeedStore[],
  serveFeed = true,
): { owned: Owned[]; duplicates: DuplicateReport[] } {
  feed = feed.filter(isPresent);
  const presentByVin = new Map<string, string[]>();
  for (const f of feed) {
    const a = presentByVin.get(f.vin);
    if (a) a.push(f.store_id); else presentByVin.set(f.vin, [f.store_id]);
  }
  type Cand = { source: OwnerSource; store_id: string | null; listing?: ListingMeta; feed?: FeedMeta };
  const byVin = new Map<string, Cand[]>();
  const push = (vin: string, c: Cand) => {
    const arr = byVin.get(vin);
    if (arr) arr.push(c); else byVin.set(vin, [c]);
  };
  for (const l of listings) {
    if (!l.vin) continue;
    push(l.vin, { source: "listing", store_id: resolveListingStore(l, stores, presentByVin.get(l.vin) ?? []), listing: l });
  }
  for (const f of serveFeed ? feed : []) {
    if (!f.vin) continue;
    push(f.vin, { source: "feed", store_id: f.store_id, feed: f });
  }
  const primary = defaultStore(stores)?.id ?? null;
  const owned: Owned[] = [];
  const duplicates: DuplicateReport[] = [];

  for (const vin of [...byVin.keys()].sort()) {
    const cands = byVin.get(vin)!;
    const listingCands = cands
      .filter((c) => c.source === "listing")
      .sort((a, b) => ts(b.listing?.updated_at) - ts(a.listing?.updated_at) || String(a.listing?.id).localeCompare(String(b.listing?.id)));
    const feedCands = cands
      .filter((c) => c.source === "feed")
      .sort((a, b) => {
        const ap = a.store_id === primary ? 0 : 1;
        const bp = b.store_id === primary ? 0 : 1;
        if (ap !== bp) return ap - bp;
        const dt = ts(b.feed?.last_seen_at) - ts(a.feed?.last_seen_at);
        if (dt !== 0) return dt;
        return String(a.store_id).localeCompare(String(b.store_id));
      });
    const winner = listingCands[0] ?? feedCands[0];
    owned.push({
      vin,
      source: winner.source,
      store_id: winner.store_id,
      listing: winner.listing,
      feed: winner.source === "feed" ? winner.feed : feedCands.find((c) => c.store_id === winner.store_id)?.feed,
    });
    const losers = cands.filter((c) => c !== winner).filter((c) => {
      // Same store as the winner: the same car seen twice, not a second owner.
      if (c.store_id === winner.store_id) return false;
      return true;
    });
    // A second listing in the winner's own store is a data defect worth a line
    // even though the store matches; it is dropped from serving either way.
    const extraListings = listingCands.slice(1).filter((c) => c.store_id === winner.store_id && winner.source === "listing");
    const all = [...losers, ...extraListings];
    if (all.length) {
      duplicates.push({
        vin,
        owner: { store_id: winner.store_id, source: winner.source },
        losers: all.map((c) => ({ store_id: c.store_id, source: c.source })),
      });
    }
  }
  return { owned, duplicates };
}

/** Store id and dealer-visible window sticker facts a feed row never has. */
export interface FeedInventoryRow {
  id: string;
  store_id: string;
  vin: string;
  stock_number?: string | null;
  condition?: string | null;
  certified?: boolean | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  body?: string | null;
  drivetrain?: string | null;
  engine?: string | null;
  transmission?: string | null;
  fuel?: string | null;
  mileage?: number | null;
  msrp?: number | string | null;
  feed_price?: number | string | null;
  feed_price_status?: string | null;
  exterior_color?: string | null;
  interior_color?: string | null;
  photos?: unknown;
  description?: string | null;
  inventory_date?: string | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
}

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/**
 * A feed-only record: what store_inventory has, nothing it does not. The
 * sticker, passport and documents keys are present and null so AutoFilm can
 * never claim an artifact the car does not have. A blank or zero feed price is
 * not a price.
 */
export function shapeFeedRow(r: FeedInventoryRow, store: StoreRef | null): Record<string, unknown> {
  return {
    vin: r.vin,
    year: r.year ?? null,
    make: r.make ?? null,
    model: r.model ?? null,
    trim: r.trim ?? null,
    stock_number: r.stock_number ?? null,
    stock: r.stock_number ?? null,
    condition: r.condition ?? null,
    certified: r.certified === true,
    body_style: r.body ?? null,
    drivetrain: r.drivetrain ?? null,
    engine: r.engine ?? null,
    transmission: r.transmission ?? null,
    fuel_type: r.fuel ?? null,
    mileage: r.mileage ?? null,
    msrp: numOrNull(r.msrp),
    price: r.feed_price_status === "known" ? numOrNull(r.feed_price) : null,
    exterior_color: r.exterior_color ?? null,
    interior_color: r.interior_color ?? null,
    description: r.description ?? null,
    photos: normalizePhotos(r.photos),
    inventory_date: r.inventory_date ?? null,
    feed_last_seen_at: r.last_seen_at ?? null,
    passport_url: null,
    documents_url: null,
    window_sticker_url: null,
    window_sticker_kind: null,
    detail_version: null,
    store,
    availability_source: "feed" as const,
  };
}

/** Additive fields on a listing-backed row. Existing fields are untouched. */
export function annotateListingRow(row: Record<string, unknown>, store: StoreRef | null): Record<string, unknown> {
  row.store = store;
  row.availability_source = "listing";
  return row;
}

export interface ListParams {
  storeId: string | null;
  includeFeed: boolean;
}

/** True when the response must carry the additive multi-store fields. Absent
 *  both params the legacy path runs and the response is today's, unchanged. */
export const isExtendedList = (p: ListParams): boolean => p.storeId !== null || p.includeFeed;

export function parseListParams(sp: URLSearchParams):
  | { ok: true; value: ListParams & { stores: boolean } }
  | { ok: false; error: string } {
  const raw = (sp.get("store_id") ?? "").trim();
  if (sp.has("store_id") && !UUID_RE.test(raw)) return { ok: false, error: "store_id must be a uuid" };
  const inc = (sp.get("include_feed") ?? "").trim();
  const st = (sp.get("stores") ?? "").trim();
  return {
    ok: true,
    value: {
      storeId: raw ? raw.toLowerCase() : null,
      includeFeed: inc === "1" || inc.toLowerCase() === "true",
      stores: st === "1" || st.toLowerCase() === "true",
    },
  };
}

/** Does this store belong to the tenant? Anything else is a 400, not a 404, so
 *  a caller cannot probe which store ids exist elsewhere. */
export const storeBelongs = (storeId: string, stores: FeedStore[]): boolean =>
  stores.some((s) => s.id === storeId.toLowerCase());

/**
 * The ordered, filtered list the page is cut from. Feed rows are admitted only
 * from stores with inventory_feed_enabled, and only when include_feed is on;
 * listings are always admitted.
 */
export function planList(args: {
  listings: ListingMeta[];
  feed: FeedMeta[];
  stores: FeedStore[];
  params: ListParams;
  updatedSince?: string | null;
}): { owned: Owned[]; duplicates: DuplicateReport[]; unresolved: { count: number; vins: string[] } } {
  const { listings, stores, params, updatedSince } = args;
  const enabled = feedEnabledIds(stores);
  const feed = args.feed.filter((f) => enabled.has(f.store_id));
  const all = resolveOwners(listings, feed, stores, params.includeFeed);
  const since = updatedSince ? Date.parse(updatedSince) : null;
  const fresh = (o: Owned) => {
    if (since === null) return true;
    const t = o.source === "listing" ? ts(o.listing?.updated_at) : ts(o.feed?.updated_at);
    return t >= since;
  };
  const sid = params.storeId;
  const owned = all.owned.filter((o) => (sid === null || o.store_id === sid) && fresh(o));
  const duplicates = sid === null
    ? all.duplicates
    : all.duplicates.filter((d) => d.owner.store_id === sid || d.losers.some((l) => l.store_id === sid));
  return { owned, duplicates, unresolved: unresolvedListings(listings, args.feed, stores) };
}

/** Stores whose feed is served and counted: enabled and active. One definition
 *  so a slice and the STORES report cannot disagree. */
export const feedEnabledIds = (stores: FeedStore[]): Set<string> =>
  new Set(stores.filter((s) => s.inventory_feed_enabled && (s.status ?? "active") === "active").map((s) => s.id));

export const UNRESOLVED_VIN_CAP = 50;

/** Listings whose store cannot be resolved. They have no slice of their own, so
 *  they are reported rather than left to vanish from every store_id view. */
export function unresolvedListings(listings: ListingMeta[], feed: FeedMeta[], stores: FeedStore[]): { count: number; vins: string[] } {
  const enabled = feedEnabledIds(stores);
  const { owned } = resolveOwners(listings, feed.filter((f) => enabled.has(f.store_id)), stores, false);
  const un = owned.filter((o) => o.source === "listing" && o.store_id === null).map((o) => o.vin);
  return { count: un.length, vins: un.slice(0, UNRESOLVED_VIN_CAP) };
}

export interface StoresReportRow {
  id: string;
  display_name: string;
  legal_name: string | null;
  city: string | null;
  state: string | null;
  is_primary: boolean;
  inventory_feed_enabled: boolean;
  feed_last_seen_at: string | null;
  feed_count: number;
  duplicate_vins: number;
}

/**
 * STORES mode. feed_count is the number of present feed rows the feed would
 * serve for the store (0 when its feed is not enabled). duplicate_vins is the
 * number of VINs the store appears on but does not own.
 */
export function buildStoresReport(args: {
  stores: FeedStore[];
  feed: FeedMeta[];
  listings: ListingMeta[];
}): StoresReportRow[] {
  const { stores, listings } = args;
  const enabled = feedEnabledIds(stores);
  const feed = args.feed.filter((f) => enabled.has(f.store_id) && isPresent(f));
  const { duplicates } = resolveOwners(listings, feed, stores);
  const lost = new Map<string, number>();
  for (const d of duplicates) {
    for (const sid of new Set(d.losers.map((l) => l.store_id))) {
      if (sid && sid !== d.owner.store_id) lost.set(sid, (lost.get(sid) ?? 0) + 1);
    }
  }
  return [...stores]
    .sort((a, b) => Number(b.is_primary_inventory_store) - Number(a.is_primary_inventory_store) || a.display_name.localeCompare(b.display_name))
    .map((s) => {
      const mine = feed.filter((f) => f.store_id === s.id);
      let last: string | null = null;
      for (const f of mine) if (f.last_seen_at && (!last || ts(f.last_seen_at) > ts(last))) last = f.last_seen_at;
      return {
        id: s.id,
        display_name: s.display_name,
        legal_name: s.legal_name ?? null,
        city: s.city ?? null,
        state: s.state ?? null,
        is_primary: s.is_primary_inventory_store,
        inventory_feed_enabled: s.inventory_feed_enabled,
        feed_last_seen_at: last,
        feed_count: mine.length,
        duplicate_vins: lost.get(s.id) ?? 0,
      };
    });
}
