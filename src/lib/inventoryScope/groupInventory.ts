import { supabase } from "@/integrations/supabase/client";
import { normalizeCondition, type Condition } from "./storeScope";

// Read-only multi-dealership view. Group-wide inventory is read through two
// SECURITY DEFINER functions that check the caller on the server (platform
// admin, tenant owner, or an explicit grant). This module fails closed in the
// same way as primaryInventory.ts: a count, tenant or store that cannot be
// verified throws GroupInventoryError and the screen shows an error with Retry,
// never a partial total. Nothing here writes, transfers, adopts or publishes.

export const GROUP_ACCESS_RPC = "inventory_group_view_access";
export const GROUP_ROWS_RPC = "inventory_group_view_rows";
export const GROUP_PAGE_SIZE = 500;

export type GroupFailureCode =
  | "access_unverified"
  | "access_denied"
  | "rows_unreadable"
  | "count_unverified"
  | "wrong_tenant"
  | "unexpected_store"
  | "malformed_row"
  | "registry_mismatch";

export class GroupInventoryError extends Error {
  constructor(public readonly code: GroupFailureCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "GroupInventoryError";
  }
}

export const GROUP_FAILURE_COPY: Record<GroupFailureCode, { title: string; detail: string }> = {
  access_unverified: { title: "Dealership access could not be verified", detail: "The server did not confirm which dealerships this account may view together." },
  access_denied: { title: "Dealership view not permitted", detail: "This account is not allowed to view several dealerships together." },
  rows_unreadable: { title: "Dealership vehicles could not be loaded", detail: "The vehicle list for the selected dealerships could not be read." },
  count_unverified: { title: "Dealership totals could not be verified", detail: "The vehicles read did not match the server's counts, so no partial list is shown." },
  wrong_tenant: { title: "Dealership view failed a safety check", detail: "A vehicle from another account was returned, so nothing is shown." },
  unexpected_store: { title: "Dealership view failed a safety check", detail: "A vehicle from a dealership that was not selected was returned, so nothing is shown." },
  malformed_row: { title: "Dealership vehicles could not be verified", detail: "A vehicle record was incomplete, so no partial list is shown." },
  registry_mismatch: { title: "Dealership list does not match", detail: "The dealerships offered for this account differ from the store registry, so the combined view is not shown." },
};

export const groupFailureOf = (e: unknown): { code: GroupFailureCode; title: string; detail: string } => {
  const code: GroupFailureCode = e instanceof GroupInventoryError ? e.code : "rows_unreadable";
  return { code, ...GROUP_FAILURE_COPY[code] };
};

// ── Access ───────────────────────────────────────────────────────────────

export interface GroupStore {
  storeId: string;
  name: string;
  primary: boolean;
  feedPresent: number;
  new: number;
  used: number;
  cpo: number;
  absent: number;
  listingsTotal: number;
}

export type GroupAccess =
  | { status: "unavailable" }
  | { status: "denied"; reason: string }
  | { status: "allowed"; reason: string; stores: GroupStore[] };

const MISSING_FN_CODES = new Set(["PGRST202", "42883"]);
export const isMissingFunction = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (MISSING_FN_CODES.has(e.code || "") || /could not find the function|does not exist/i.test(e.message || ""));

const asCount = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new GroupInventoryError("access_unverified", "store count missing or invalid");
  return v;
};

export function parseGroupAccess(tenantId: string, data: unknown): GroupAccess {
  const r = data as { tenant_id?: unknown; allowed?: unknown; reason?: unknown; stores?: unknown } | null;
  if (!r || typeof r !== "object" || String(r.tenant_id ?? "") !== tenantId || typeof r.allowed !== "boolean") {
    throw new GroupInventoryError("access_unverified", "access report missing or for another account");
  }
  if (!r.allowed) return { status: "denied", reason: typeof r.reason === "string" ? r.reason : "not_permitted" };
  if (!Array.isArray(r.stores)) throw new GroupInventoryError("access_unverified", "store list missing");
  const seen = new Set<string>();
  const stores: GroupStore[] = (r.stores as Array<Record<string, unknown>>).map((s) => {
    if (!s || typeof s.store_id !== "string" || !s.store_id || typeof s.name !== "string") throw new GroupInventoryError("access_unverified", "store row without an id");
    if (seen.has(s.store_id)) throw new GroupInventoryError("access_unverified", "duplicate store row");
    seen.add(s.store_id);
    return {
      storeId: s.store_id, name: s.name, primary: s.primary === true,
      feedPresent: asCount(s.feed_present), new: asCount(s.new), used: asCount(s.used), cpo: asCount(s.cpo),
      absent: asCount(s.absent), listingsTotal: asCount(s.listings_total),
    };
  });
  return { status: "allowed", reason: typeof r.reason === "string" ? r.reason : "allowed", stores };
}

export async function fetchGroupAccess(tenantId: string): Promise<GroupAccess> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let res: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    res = await db.rpc(GROUP_ACCESS_RPC, { p_tenant_id: tenantId });
  } catch (e) {
    throw new GroupInventoryError("access_unverified", e instanceof Error ? e.message : String(e));
  }
  if (res.error) {
    if (isMissingFunction(res.error)) return { status: "unavailable" };
    if (res.error.code === "42501") return { status: "denied", reason: "not_permitted" };
    throw new GroupInventoryError("access_unverified", res.error.message);
  }
  return parseGroupAccess(tenantId, res.data);
}

/** The offered stores must be exactly the store registry the screen already verified. */
export function verifyAccessStores(access: Extract<GroupAccess, { status: "allowed" }>, registryStoreIds: readonly string[], registryPrimaryId: string | null): void {
  const offered = access.stores.map((s) => s.storeId).sort();
  const known = [...registryStoreIds].sort();
  if (offered.length !== known.length || offered.some((id, i) => id !== known[i])) throw new GroupInventoryError("registry_mismatch", "store lists differ");
  const primary = access.stores.find((s) => s.primary)?.storeId ?? null;
  if (primary !== registryPrimaryId) throw new GroupInventoryError("registry_mismatch", "primary store differs");
}

// ── Feed rows ────────────────────────────────────────────────────────────

export type FeedPresence = "present" | "missing" | "retirement_review";

export interface FeedRow {
  id: string;
  store_id: string;
  tenant_id: string;
  vin: string;
  stock_number: string | null;
  condition: Condition;
  certified: boolean;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  msrp: number | null;
  feed_price: number | null;
  feed_price_status: "known" | "unknown" | "zero";
  exterior_color: string | null;
  photos: unknown[];
  photo_count: number;
  presence: FeedPresence;
  last_seen_at: string | null;
  listing_id: string | null;
  has_open_conflict: boolean;
}

const PRESENCES = new Set(["present", "missing", "retirement_review"]);
const PRICE_STATUSES = new Set(["known", "unknown", "zero"]);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseFeedRow(tenantId: string, allowedStores: ReadonlySet<string>, raw: unknown): FeedRow {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") throw new GroupInventoryError("malformed_row");
  if (r.tenant_id !== tenantId) throw new GroupInventoryError("wrong_tenant");
  const storeId = str(r.store_id);
  if (!storeId || !allowedStores.has(storeId)) throw new GroupInventoryError("unexpected_store");
  const id = str(r.id);
  const vin = str(r.vin);
  const condition = normalizeCondition(r.condition as string);
  if (!id || !vin || !condition || !PRESENCES.has(String(r.presence)) || !PRICE_STATUSES.has(String(r.feed_price_status))) {
    throw new GroupInventoryError("malformed_row", id ?? "row without an id");
  }
  return {
    id, store_id: storeId, tenant_id: tenantId, vin: vin.trim().toUpperCase(), stock_number: str(r.stock_number), condition,
    certified: r.certified === true, year: numOrNull(r.year), make: str(r.make), model: str(r.model), trim: str(r.trim),
    mileage: numOrNull(r.mileage), msrp: numOrNull(r.msrp), feed_price: numOrNull(r.feed_price),
    feed_price_status: r.feed_price_status as FeedRow["feed_price_status"], exterior_color: str(r.exterior_color),
    photos: Array.isArray(r.photos) ? r.photos : [], photo_count: numOrNull(r.photo_count) ?? 0,
    presence: r.presence as FeedPresence, last_seen_at: str(r.last_seen_at), listing_id: str(r.listing_id),
    has_open_conflict: r.has_open_conflict === true,
  };
}

/**
 * Reads every feed row of the requested stores, one page at a time, and
 * verifies the result against the server's own per-store counts. Throws
 * GroupInventoryError on anything it cannot verify.
 */
export async function loadFeedRows(
  tenantId: string,
  access: Extract<GroupAccess, { status: "allowed" }>,
  storeIds: readonly string[],
  pageSize = GROUP_PAGE_SIZE,
): Promise<FeedRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const wanted = [...new Set(storeIds)];
  const offered = new Map(access.stores.map((s) => [s.storeId, s]));
  if (wanted.length === 0 || wanted.some((id) => !offered.has(id))) throw new GroupInventoryError("unexpected_store", "store not offered by the server");
  const allowed = new Set(wanted);
  const rows: FeedRow[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  for (let offset = 0; ; offset += pageSize) {
    let res: { data: unknown; error: { code?: string; message?: string } | null };
    try {
      res = await db.rpc(GROUP_ROWS_RPC, { p_tenant_id: tenantId, p_store_ids: wanted, p_offset: offset, p_limit: pageSize });
    } catch (e) {
      throw new GroupInventoryError("rows_unreadable", e instanceof Error ? e.message : String(e));
    }
    if (res.error) throw new GroupInventoryError(res.error.code === "42501" ? "access_denied" : "rows_unreadable", res.error.message);
    const page = res.data as { tenant_id?: unknown; total?: unknown; rows?: unknown } | null;
    if (!page || typeof page !== "object" || !Array.isArray(page.rows) || typeof page.total !== "number" || !Number.isInteger(page.total)) {
      throw new GroupInventoryError("count_unverified", "page without a total");
    }
    if (page.tenant_id !== tenantId) throw new GroupInventoryError("wrong_tenant");
    if (total === null) total = page.total;
    else if (page.total !== total) throw new GroupInventoryError("count_unverified", `total changed from ${total} to ${page.total} while reading`);
    for (const raw of page.rows) {
      const row = parseFeedRow(tenantId, allowed, raw);
      if (seen.has(row.id)) throw new GroupInventoryError("count_unverified", "the same vehicle came back twice");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length >= total) break;
    if (page.rows.length === 0) throw new GroupInventoryError("count_unverified", `read ${rows.length} of ${total}`);
  }
  if (rows.length !== total) throw new GroupInventoryError("count_unverified", `read ${rows.length} of ${total}`);

  for (const id of wanted) {
    const s = offered.get(id)!;
    const mine = rows.filter((r) => r.store_id === id);
    const present = mine.filter((r) => r.presence === "present");
    const counts = {
      present: present.length,
      new: present.filter((r) => r.condition === "new").length,
      used: present.filter((r) => r.condition === "used").length,
      cpo: present.filter((r) => r.condition === "cpo").length,
      absent: mine.length - present.length,
    };
    if (counts.present !== s.feedPresent || counts.new !== s.new || counts.used !== s.used || counts.cpo !== s.cpo || counts.absent !== s.absent) {
      throw new GroupInventoryError("count_unverified", `${s.name}: rows read do not match the server counts`);
    }
  }
  return rows;
}

// ── Merge ────────────────────────────────────────────────────────────────

export type DisplayStatus = "published" | "draft" | "archived" | "feed_only" | "missing_from_feed" | "review";

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  published: "Published",
  draft: "Draft",
  archived: "Archived",
  feed_only: "Feed only",
  missing_from_feed: "Missing from feed",
  review: "Needs review",
};

export interface ListingInput {
  id: string;
  vin: string;
  ymm: string | null;
  trim: string | null;
  mileage?: number | null;
  condition: string | null;
  price: number | null;
  status: "draft" | "published" | "archived";
  stock_number?: string | null;
  hero_image_url?: string | null;
}

export interface DisplayRow<L extends ListingInput = ListingInput> {
  key: string;
  source: "listing" | "feed";
  storeId: string;
  storeName: string;
  vin: string;
  stock: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  condition: Condition | null;
  price: number | null;
  status: DisplayStatus;
  thumbnail: string | null;
  listingId: string | null;
  inventoryId: string | null;
  conflict: boolean;
  listing: L | null;
  feed: FeedRow | null;
}

export const normVin = (v: string | null | undefined): string => String(v ?? "").trim().toUpperCase();

export const feedPrice = (r: Pick<FeedRow, "feed_price" | "feed_price_status">): number | null =>
  r.feed_price_status === "known" && r.feed_price !== null && r.feed_price > 0 ? r.feed_price : null;

const listingPrice = (p: number | null | undefined): number | null => (typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null);

export function firstPhoto(photos: readonly unknown[]): string | null {
  for (const p of photos) {
    if (typeof p === "string" && p.trim()) return p;
    const o = p as { url?: unknown; src?: unknown; href?: unknown } | null;
    const u = o && typeof o === "object" ? (o.url ?? o.src ?? o.href) : null;
    if (typeof u === "string" && u.trim()) return u;
  }
  return null;
}

export const feedPhotoUrls = (photos: readonly unknown[]): string[] =>
  photos.map((p) => firstPhoto([p])).filter((u): u is string => !!u);

const splitYmm = (ymm: string | null): { year: number | null; make: string | null; model: string | null } => {
  const t = (ymm || "").trim().split(/\s+/).filter(Boolean);
  const year = t[0] && /^(19|20)\d{2}$/.test(t[0]) ? Number(t[0]) : null;
  const rest = year ? t.slice(1) : t;
  return { year, make: rest[0] ?? null, model: rest.length > 1 ? rest.slice(1).join(" ") : null };
};

export const feedTitle = (r: Pick<FeedRow, "year" | "make" | "model">): string | null =>
  [r.year, r.make, r.model].filter((x) => x !== null && x !== undefined && x !== "").join(" ") || null;

export interface MergeInput<L extends ListingInput> {
  stores: readonly GroupStore[];
  selectedStoreIds: readonly string[];
  /** The primary dealership's listings from loadScopedInventory (never another store's, never the review bucket). */
  primaryStoreId: string | null;
  listings: readonly L[];
  feed: readonly FeedRow[];
}

/**
 * Pure. One row per vehicle record of the selected stores. A feed row and the
 * same store's working listing for the same VIN become one row (the listing is
 * kept). A VIN present under two different stores is never merged: it shows on
 * both, marked for review. A feed-only vehicle is never labelled Published and
 * a missing price stays null.
 */
export function mergeGroupRows<L extends ListingInput>(input: MergeInput<L>): DisplayRow<L>[] {
  const selected = new Set(input.selectedStoreIds);
  const nameOf = new Map(input.stores.map((s) => [s.storeId, s.name]));
  const order = new Map(input.stores.map((s, i) => [s.storeId, i]));
  const out: DisplayRow<L>[] = [];
  const feedByStoreVin = new Map<string, FeedRow>();
  for (const f of input.feed) {
    if (selected.has(f.store_id)) feedByStoreVin.set(`${f.store_id}|${normVin(f.vin)}`, f);
  }
  const consumed = new Set<string>();

  if (input.primaryStoreId && selected.has(input.primaryStoreId)) {
    const storeId = input.primaryStoreId;
    for (const l of input.listings) {
      const fk = `${storeId}|${normVin(l.vin)}`;
      const f = consumed.has(fk) ? undefined : feedByStoreVin.get(fk);
      if (f) consumed.add(fk);
      const parsed = splitYmm(l.ymm);
      out.push({
        key: `listing:${l.id}`, source: "listing", storeId, storeName: nameOf.get(storeId) ?? "Unknown dealership",
        vin: normVin(l.vin), stock: l.stock_number || f?.stock_number || null,
        year: f?.year ?? parsed.year, make: f?.make ?? parsed.make, model: f?.model ?? parsed.model, trim: l.trim ?? f?.trim ?? null,
        mileage: l.mileage ?? f?.mileage ?? null, condition: normalizeCondition(l.condition) ?? f?.condition ?? null,
        price: listingPrice(l.price), status: l.status,
        thumbnail: l.hero_image_url || (f ? firstPhoto(f.photos) : null),
        listingId: l.id, inventoryId: f?.id ?? null, conflict: f?.has_open_conflict === true, listing: l, feed: f ?? null,
      });
    }
  }

  for (const f of input.feed) {
    if (!selected.has(f.store_id) || consumed.has(`${f.store_id}|${normVin(f.vin)}`)) continue;
    out.push({
      key: `feed:${f.id}`, source: "feed", storeId: f.store_id, storeName: nameOf.get(f.store_id) ?? "Unknown dealership",
      vin: normVin(f.vin), stock: f.stock_number, year: f.year, make: f.make, model: f.model, trim: f.trim, mileage: f.mileage,
      condition: f.condition, price: feedPrice(f),
      status: f.presence === "present" ? "feed_only" : "missing_from_feed",
      thumbnail: firstPhoto(f.photos), listingId: null, inventoryId: f.id, conflict: f.has_open_conflict, listing: null, feed: f,
    });
  }

  const storesByVin = new Map<string, Set<string>>();
  for (const r of out) {
    const set = storesByVin.get(r.vin) ?? new Set<string>();
    set.add(r.storeId);
    storesByVin.set(r.vin, set);
  }
  for (const r of out) {
    if ((storesByVin.get(r.vin)?.size ?? 0) > 1) r.conflict = true;
    if (r.conflict) r.status = "review";
  }

  return out.sort((a, b) =>
    (order.get(a.storeId) ?? 0) - (order.get(b.storeId) ?? 0) || a.vin.localeCompare(b.vin) || a.key.localeCompare(b.key));
}

export interface GroupCounts { total: number; new: number; used: number; cpo: number; unknown: number; listings: number; feedOnly: number; missing: number; review: number }

export function countDisplayRows(rows: readonly DisplayRow[]): GroupCounts {
  const c: GroupCounts = { total: 0, new: 0, used: 0, cpo: 0, unknown: 0, listings: 0, feedOnly: 0, missing: 0, review: 0 };
  for (const r of rows) {
    c.total += 1;
    if (r.condition) c[r.condition] += 1; else c.unknown += 1;
    if (r.source === "listing") c.listings += 1;
    if (r.status === "feed_only") c.feedOnly += 1;
    if (r.status === "missing_from_feed") c.missing += 1;
    if (r.status === "review") c.review += 1;
  }
  return c;
}

/** Per-store row counts of a merged selection, for the dropdown. */
export function countByStore(rows: readonly DisplayRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.storeId, (m.get(r.storeId) ?? 0) + 1);
  return m;
}

// ── Selection ────────────────────────────────────────────────────────────

export const SELECTION_KEY_PREFIX = "autolabels:inventory-dealerships:v1";
export const selectionKey = (userId: string | null | undefined, tenantId: string): string => `${SELECTION_KEY_PREFIX}:${userId || "anon"}:${tenantId}`;

export function readStoredSelection(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export function writeStoredSelection(key: string, ids: readonly string[] | null): void {
  try {
    if (ids === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage unavailable: the selection simply does not persist */
  }
}

/** The stored choice limited to stores that exist now; empty or unset means the primary store only. */
export function resolveSelection(stored: readonly string[] | null, stores: readonly GroupStore[]): { ids: string[]; primaryOnly: boolean } {
  const primary = stores.find((s) => s.primary)?.storeId ?? null;
  const known = new Set(stores.map((s) => s.storeId));
  const kept = (stored ?? []).filter((id) => known.has(id));
  const ids = kept.length > 0 ? [...new Set(kept)] : primary ? [primary] : [];
  return { ids, primaryOnly: !!primary && ids.length === 1 && ids[0] === primary };
}
