import { supabase } from "@/integrations/supabase/client";
import { listTenantStores, type TenantStore } from "./api";
import { IncompleteReadError, readAllPages, type PageResult } from "./paging";
import { buildRegistry, isSingleRooftop, resolveListingScope, summarizeScopes, type ScopeListing, type ScopeSummary, type StoreRegistry } from "./storeScope";

// The dealer Inventory screens read the tenant's listings through this module
// only. It fails closed: if the store registry, the scope columns, the row
// count or the tenant of any row cannot be verified, it throws and the screen
// shows an error with Retry. It never falls back to the unscoped, mixed list.

export type ScopeFailureCode =
  | "registry_unreadable"
  | "registry_incomplete"
  | "no_primary_store"
  | "multiple_primary_stores"
  | "scope_columns_unavailable"
  | "listings_unreadable"
  | "count_unverified"
  | "wrong_tenant";

export class InventoryScopeError extends Error {
  constructor(public readonly code: ScopeFailureCode, detail?: string) {
    super(detail || code);
    this.name = "InventoryScopeError";
  }
}

export const SCOPE_FAILURE_COPY: Record<ScopeFailureCode, { title: string; detail: string }> = {
  registry_unreadable: { title: "Store list could not be read", detail: "Inventory is not shown, because it cannot be separated by dealership without the store list." },
  registry_incomplete: { title: "Store list is incomplete", detail: "Some vehicles belong to a store this account cannot see, so inventory cannot be separated safely." },
  no_primary_store: { title: "No primary dealership is set", detail: "This account has several stores and none is marked as the primary dealership. A platform administrator sets it in Inventory network." },
  multiple_primary_stores: { title: "More than one primary dealership is set", detail: "Exactly one store can be the primary dealership. A platform administrator corrects it in Inventory network." },
  scope_columns_unavailable: { title: "Store ownership could not be read", detail: "The fields that place each vehicle in a store are not available, so inventory is not shown." },
  listings_unreadable: { title: "Inventory could not be loaded", detail: "The vehicle list could not be read." },
  count_unverified: { title: "Inventory total could not be verified", detail: "The vehicles read did not match the database count, so no partial list is shown." },
  wrong_tenant: { title: "Inventory failed a safety check", detail: "A vehicle from another account was returned, so nothing is shown." },
};

export const SCOPE_SELECT = "tenant_id,owning_store_id,mc_dealer_id:mc_raw->dealer->>id";

export type RooftopMode = "multi_rooftop" | "single_rooftop";

export interface ScopedInventory<T> {
  mode: RooftopMode;
  registry: StoreRegistry;
  stores: TenantStore[];
  /** Every verified row of the tenant, for the per-store and review views. */
  rows: T[];
  /** Rows of the primary dealership only (all rows for a single-rooftop tenant). */
  primaryRows: T[];
  summary: ScopeSummary;
  /** Rows read for the tenant, verified against the database count. */
  totalRead: number;
}

type ScopedRow = ScopeListing & { tenant_id?: string | null };

const hasScopeColumns = (r: object) => "tenant_id" in r && "owning_store_id" in r && "mc_dealer_id" in r;

/** Pure: place verified rows. Throws InventoryScopeError on anything it cannot verify. */
export function scopeInventory<T extends ScopedRow>(tenantId: string, stores: TenantStore[], rows: T[]): ScopedInventory<T> {
  for (const r of rows) {
    if (!hasScopeColumns(r)) throw new InventoryScopeError("scope_columns_unavailable");
    if (r.tenant_id !== tenantId) throw new InventoryScopeError("wrong_tenant");
  }
  if (stores.some((s) => s.tenant_id !== tenantId)) throw new InventoryScopeError("wrong_tenant");
  const tenantStores = stores;
  const registry = buildRegistry(tenantStores);
  if (tenantStores.length === 0) {
    if (rows.some((r) => r.owning_store_id)) throw new InventoryScopeError("registry_incomplete");
  } else {
    const primaries = tenantStores.filter((s) => s.is_primary_inventory_store).length;
    if (primaries === 0 && tenantStores.length > 1) throw new InventoryScopeError("no_primary_store");
    if (primaries > 1) throw new InventoryScopeError("multiple_primary_stores");
  }
  const mode: RooftopMode = isSingleRooftop(registry) ? "single_rooftop" : "multi_rooftop";
  const primaryRows = rows.filter((r) => resolveListingScope(r, registry).kind === "primary");
  return { mode, registry, stores: tenantStores, rows, primaryRows, summary: summarizeScopes(rows, registry), totalRead: rows.length };
}

const isSchemaErr = (e: { message?: string; code?: string } | null) =>
  !!e && (/column|does not exist|schema cache/i.test(e.message || "") || ["42703", "PGRST204", "PGRST100", "42P01"].includes(e.code || ""));

export interface LoadInventoryOptions {
  tenantId: string;
  /** Display column sets, richest first. The scope columns are added to every set. */
  columnSets: string[];
  includeArchived: boolean;
  pageSize?: number;
}

/**
 * Reads every listing of the tenant (paged, ordered by id, verified against an
 * exact count) and the store registry, then scopes them. Throws
 * InventoryScopeError; never returns an unscoped list.
 */
export async function loadScopedInventory<T extends ScopedRow & { id: string }>(opts: LoadInventoryOptions): Promise<ScopedInventory<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let stores: TenantStore[];
  try {
    stores = await listTenantStores(opts.tenantId);
  } catch (e) {
    throw new InventoryScopeError("registry_unreadable", e instanceof Error ? e.message : undefined);
  }
  const page = (cols: string) => (from: number, to: number): PromiseLike<PageResult<T>> => {
    let q = db.from("vehicle_listings").select(`${cols},${SCOPE_SELECT}`, { count: "exact" }).eq("tenant_id", opts.tenantId);
    if (!opts.includeArchived) q = q.neq("status", "archived");
    return q.order("id", { ascending: true }).range(from, to);
  };
  let rows: T[] | null = null;
  let schemaFailures = 0;
  for (const cols of opts.columnSets) {
    try {
      rows = (await readAllPages<T>(page(cols), opts.pageSize)).rows;
      break;
    } catch (e) {
      if (e instanceof IncompleteReadError) throw new InventoryScopeError("count_unverified", e.message);
      const err = e as { message?: string; code?: string };
      if (isSchemaErr(err)) { schemaFailures += 1; continue; }
      throw new InventoryScopeError("listings_unreadable", err?.message);
    }
  }
  if (!rows) throw new InventoryScopeError(schemaFailures ? "scope_columns_unavailable" : "listings_unreadable");
  return scopeInventory(opts.tenantId, stores, rows);
}

export const scopeFailureOf = (e: unknown): { code: ScopeFailureCode; title: string; detail: string } => {
  const code: ScopeFailureCode = e instanceof InventoryScopeError ? e.code : "listings_unreadable";
  return { code, ...SCOPE_FAILURE_COPY[code] };
};

/** Split a list for `.in()` filters so a large inventory never builds an oversized URL. */
export function chunk<T>(xs: readonly T[], n = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
