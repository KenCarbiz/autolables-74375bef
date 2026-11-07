import { supabase } from "@/integrations/supabase/client";
import {
  CONDITION_VALUES,
  clampPage,
  hasDerivedFilter,
  matchesDerivedFilters,
  rangeFor,
  resolveVehicleFacts,
  type HubDocRow,
  type HubFilters,
  type HubInspectionRow,
  type HubListing,
  type HubRowLike,
} from "@/lib/admin/documentsHubModel";

// Read-only data layer for the Documents & Service hub vehicle table. Every
// call is a tenant-scoped select; nothing here writes, generates or prints.
//
// With only search and condition filters the page is a PostgREST range over
// vehicle_listings with count:'exact'. generated_documents carries no foreign
// key to vehicle_listings, so document, status and blocker filters cannot be a
// server-side join. Those resolve from one bounded read of the tenant's active
// vehicles, documents and inspections; when any of those reads is cut off by
// its cap the result says so (`complete: false`) instead of showing a clipped
// total.

export const SNAPSHOT_VEHICLE_CAP = 1000;
export const SNAPSHOT_ROW_CAP = 5000;
const STOCK_CHUNK = 100;

export const LISTING_COLUMNS = "id, vin, ymm, condition, status, open_recall_count, vehicle_file_id, updated_at";
const DOC_COLUMNS = "id, vehicle_id, document_type, document_status, version, template_id, template_version, created_at, approved_at, published_at, superseded_at, rejection_reason";
const INSPECTION_COLUMNS = "id, vehicle_listing_id, status, result, signed_at, created_at, inspector_name, form_type";
export const HUB_DOC_TYPES = ["window", "factory_sticker", "buyers_guide"];

interface Result<T> {
  data: T | null;
  error: unknown;
  count?: number | null;
}

type Query = PromiseLike<Result<unknown>> & Record<string, (...args: unknown[]) => Query>;
export interface HubDb {
  from: (table: string) => { select: (columns: string, options?: { count?: "exact"; head?: boolean }) => Query };
}

export const liveDb = (): HubDb => supabase as unknown as HubDb;

export interface HubRow extends HubRowLike {
  key: string;
}

export interface HubPage {
  rows: HubRow[];
  /** Exact number of vehicles matching the filters. */
  total: number;
  /** The page actually served, after clamping to the last page. */
  page: number;
  mode: "range" | "resolved";
}

export class HubReadError extends Error {
  constructor(public readonly reason: "failed" | "incomplete", message: string) {
    super(message);
    this.name = "HubReadError";
  }
}

const unwrap = <T,>(r: Result<T>, what: string): { data: T; count: number | null } => {
  if (r.error || r.data === null || r.data === undefined) throw new HubReadError("failed", `${what} could not be read.`);
  return { data: r.data, count: r.count ?? null };
};

const sanitizeSearch = (q: string): string => q.replace(/[%,()*\\]/g, " ").trim();

async function stockFileIds(db: HubDb, tenantId: string, q: string): Promise<string[]> {
  const res = (await db.from("vehicle_files").select("id").eq("tenant_id", tenantId).ilike("stock_number", `%${q}%`).limit(200)) as Result<Array<{ id: string }>>;
  if (res.error || !Array.isArray(res.data)) return [];
  return res.data.map((r) => r.id);
}

function listingQuery(db: HubDb, tenantId: string, f: HubFilters, fileIds: string[]): Query {
  let query = db.from("vehicle_listings").select(LISTING_COLUMNS, { count: "exact" }).eq("tenant_id", tenantId).is("archived_at", null);
  if (f.condition !== "all") query = query.in("condition", CONDITION_VALUES[f.condition]);
  const q = sanitizeSearch(f.q);
  if (q) {
    const parts = [`vin.ilike.%${q}%`, `ymm.ilike.%${q}%`];
    if (fileIds.length) parts.push(`vehicle_file_id.in.(${fileIds.join(",")})`);
    query = query.or(parts.join(","));
  }
  return query.order("updated_at", { ascending: false });
}

async function readStock(db: HubDb, tenantId: string, listings: HubListing[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(listings.map((l) => l.vehicle_file_id).filter((x): x is string => !!x)));
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += STOCK_CHUNK) {
    const res = (await db.from("vehicle_files").select("id, stock_number").eq("tenant_id", tenantId).in("id", ids.slice(i, i + STOCK_CHUNK))) as Result<Array<{ id: string; stock_number: string | null }>>;
    if (res.error || !Array.isArray(res.data)) continue;
    for (const r of res.data) if (r.stock_number) out[r.id] = r.stock_number;
  }
  return out;
}

async function readPageEvidence(db: HubDb, tenantId: string, ids: string[]): Promise<{ docs: HubDocRow[]; inspections: HubInspectionRow[] }> {
  if (!ids.length) return { docs: [], inspections: [] };
  const [d, i] = await Promise.all([
    db.from("generated_documents").select(DOC_COLUMNS).eq("tenant_id", tenantId).in("vehicle_id", ids).in("document_type", HUB_DOC_TYPES) as PromiseLike<Result<HubDocRow[]>>,
    db.from("safety_inspections").select(INSPECTION_COLUMNS).eq("tenant_id", tenantId).in("vehicle_listing_id", ids).is("voided_at", null) as PromiseLike<Result<HubInspectionRow[]>>,
  ]);
  return { docs: unwrap(d, "Documents").data, inspections: unwrap(i, "Inspections").data };
}

export function buildRows(listings: HubListing[], docs: HubDocRow[], inspections: HubInspectionRow[], stock: Record<string, string>): HubRow[] {
  const docsBy = new Map<string, HubDocRow[]>();
  for (const d of docs) if (d.vehicle_id) (docsBy.get(d.vehicle_id) ?? docsBy.set(d.vehicle_id, []).get(d.vehicle_id)!).push(d);
  const inspBy = new Map<string, HubInspectionRow[]>();
  for (const r of inspections) if (r.vehicle_listing_id) (inspBy.get(r.vehicle_listing_id) ?? inspBy.set(r.vehicle_listing_id, []).get(r.vehicle_listing_id)!).push(r);
  return listings.map((listing) => ({
    key: listing.id,
    listing,
    stock: listing.vehicle_file_id ? stock[listing.vehicle_file_id] ?? null : null,
    facts: resolveVehicleFacts(listing, docsBy.get(listing.id) ?? [], inspBy.get(listing.id) ?? []),
  }));
}

/** Search, condition and 25/50/100 paging on the server, with the exact total from count:'exact'. */
export async function loadRangePage(db: HubDb, tenantId: string, f: HubFilters): Promise<HubPage> {
  const q = sanitizeSearch(f.q);
  const fileIds = q ? await stockFileIds(db, tenantId, q) : [];
  const read = async (page: number) => {
    const { from, to } = rangeFor(page, f.size);
    return (await listingQuery(db, tenantId, f, fileIds).range(from, to)) as Result<HubListing[]>;
  };
  let page = f.page;
  let res = await read(page);
  let { data, count } = unwrap(res, "Vehicles");
  const total = count ?? data.length;
  const clamped = clampPage(page, total, f.size);
  if (clamped !== page && total > 0) {
    page = clamped;
    res = await read(page);
    ({ data } = unwrap(res, "Vehicles"));
  }
  const [stock, evidence] = await Promise.all([readStock(db, tenantId, data), readPageEvidence(db, tenantId, data.map((l) => l.id))]);
  return { rows: buildRows(data, evidence.docs, evidence.inspections, stock), total, page, mode: "range" };
}

export interface HubSnapshot {
  listings: HubListing[];
  docs: HubDocRow[];
  inspections: HubInspectionRow[];
  stock: Record<string, string>;
  /** False when a read hit its cap, so counts built from it would be partial. */
  complete: boolean;
  totalActive: number;
}

export async function loadSnapshot(db: HubDb, tenantId: string): Promise<HubSnapshot> {
  const [l, d, i] = await Promise.all([
    db.from("vehicle_listings").select(LISTING_COLUMNS, { count: "exact" }).eq("tenant_id", tenantId).is("archived_at", null).order("updated_at", { ascending: false }).range(0, SNAPSHOT_VEHICLE_CAP - 1) as PromiseLike<Result<HubListing[]>>,
    db.from("generated_documents").select(DOC_COLUMNS, { count: "exact" }).eq("tenant_id", tenantId).in("document_type", HUB_DOC_TYPES).range(0, SNAPSHOT_ROW_CAP - 1) as PromiseLike<Result<HubDocRow[]>>,
    db.from("safety_inspections").select(INSPECTION_COLUMNS, { count: "exact" }).eq("tenant_id", tenantId).is("voided_at", null).range(0, SNAPSHOT_ROW_CAP - 1) as PromiseLike<Result<HubInspectionRow[]>>,
  ]);
  const listings = unwrap(l, "Vehicles");
  const docs = unwrap(d, "Documents");
  const inspections = unwrap(i, "Inspections");
  const stock = await readStock(db, tenantId, listings.data);
  const totalActive = listings.count ?? listings.data.length;
  return {
    listings: listings.data,
    docs: docs.data,
    inspections: inspections.data,
    stock,
    complete: totalActive <= listings.data.length && (docs.count ?? 0) <= docs.data.length && (inspections.count ?? 0) <= inspections.data.length,
    totalActive,
  };
}

export const snapshotRows = (s: HubSnapshot): HubRow[] => buildRows(s.listings, s.docs, s.inspections, s.stock);

const matchesSearch = (row: HubRow, q: string, stockMatches: ReadonlySet<string>): boolean => {
  const needle = q.toLowerCase();
  if (!needle) return true;
  const l = row.listing;
  return l.vin.toLowerCase().includes(needle) || (l.ymm ?? "").toLowerCase().includes(needle) || (row.stock ?? "").toLowerCase().includes(needle) || (!!l.vehicle_file_id && stockMatches.has(l.vehicle_file_id));
};

const conditionMatches = (row: HubRow, f: HubFilters): boolean => f.condition === "all" || CONDITION_VALUES[f.condition].includes(String(row.listing.condition ?? "").toLowerCase());

/** Filters and pages resolved rows. The total is the exact size of the matched set, never an estimate. */
export function pageFromRows(all: HubRow[], f: HubFilters): HubPage {
  const q = sanitizeSearch(f.q);
  const matched = all.filter((r) => conditionMatches(r, f) && matchesSearch(r, q, new Set()) && matchesDerivedFilters(r, f));
  const page = clampPage(f.page, matched.length, f.size);
  const { from, to } = rangeFor(page, f.size);
  return { rows: matched.slice(from, to + 1), total: matched.length, page, mode: "resolved" };
}

export async function loadResolvedPage(db: HubDb, tenantId: string, f: HubFilters, snapshot?: HubSnapshot): Promise<HubPage> {
  const snap = snapshot ?? (await loadSnapshot(db, tenantId));
  if (!snap.complete) throw new HubReadError("incomplete", "This dealership has more vehicles or records than the filters can resolve exactly. Clear the document, status and blocker filters, or narrow by search or condition.");
  return pageFromRows(snapshotRows(snap), f);
}

export async function loadHubPage(db: HubDb, tenantId: string, f: HubFilters): Promise<HubPage> {
  return hasDerivedFilter(f) ? loadResolvedPage(db, tenantId, f) : loadRangePage(db, tenantId, f);
}

export interface VehicleHistory {
  docs: HubDocRow[];
  inspections: HubInspectionRow[];
}

/** Every version of every document for one vehicle, including superseded ones, read when its side panel opens. */
export async function loadVehicleHistory(db: HubDb, tenantId: string, vehicleId: string): Promise<VehicleHistory> {
  const [d, i] = await Promise.all([
    db.from("generated_documents").select(DOC_COLUMNS).eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(100) as PromiseLike<Result<HubDocRow[]>>,
    db.from("safety_inspections").select(INSPECTION_COLUMNS).eq("tenant_id", tenantId).eq("vehicle_listing_id", vehicleId).is("voided_at", null).order("created_at", { ascending: false }).limit(25) as PromiseLike<Result<HubInspectionRow[]>>,
  ]);
  return { docs: unwrap(d, "Document versions").data, inspections: unwrap(i, "Inspections").data };
}
