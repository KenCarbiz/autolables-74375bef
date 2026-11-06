import { supabase } from "@/integrations/supabase/client";
import type { StoreEnrichmentPolicy, StoreProviderUsage } from "@/lib/inventoryNetwork/api";
import type { ScopeListing, ScopeStore } from "./storeScope";
import { readAllPages } from "./paging";

// Dealer-member reads for the per-store inventory screens. Every table here is
// readable by the tenant's own accepted members through existing RLS
// (drizzle 0006: "Members read own group stores/inventory/usage/policy"), so
// no new grant is needed. None of these reads calls a provider.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TenantStore extends ScopeStore {
  tenant_id: string;
  updated_at?: string | null;
  subscription_status: string;
  inventory_feed_enabled: boolean;
  inventory_sharing_enabled: boolean;
  listing_sync_enabled: boolean;
  street?: string | null;
  city: string | null;
  state: string | null;
  website?: string | null;
}

export interface StoreVehicle {
  id: string; store_id: string; vin: string; stock_number: string | null;
  condition: "new" | "used" | "cpo"; certified: boolean;
  year: number | null; make: string | null; model: string | null; trim: string | null; mileage: number | null;
  feed_price: number | null; feed_price_status: "known" | "unknown" | "zero";
  presence: string; last_seen_at: string; enrichment_status: string; listing_id: string | null;
}

export interface TenantListing extends ScopeListing {
  vin: string; ymm: string | null; condition: string | null; status: string; updated_at: string;
}

const unwrap = <T,>(res: { data: T | null; error: { message?: string } | null }): T => {
  if (res.error) throw new Error(res.error.message || "Read failed");
  return (res.data ?? ([] as unknown)) as T;
};

export async function listTenantStores(tenantId: string): Promise<TenantStore[]> {
  return unwrap<TenantStore[]>(await db.from("dealer_stores")
    .select("id,tenant_id,display_name,is_primary_inventory_store,status,updated_at,subscription_status,inventory_feed_enabled,inventory_sharing_enabled,listing_sync_enabled,street,city,state,website,provider_ids")
    .eq("tenant_id", tenantId).order("display_name"));
}

export async function listStorePolicies(storeIds: string[]): Promise<StoreEnrichmentPolicy[]> {
  if (!storeIds.length) return [];
  return unwrap<StoreEnrichmentPolicy[]>(await db.from("store_enrichment_policies").select("*").in("store_id", storeIds));
}

export interface StoreFeedState {
  store_id: string; last_applied_at: string | null; last_failure_at: string | null; last_failure_reason: string | null;
}

export interface StoreSourceMapping { store_id: string; source_dealer_id: string; status: string; approved_at: string | null }

/** Every feed vehicle of one store, read completely (paged by id, count-verified). */
export async function listStoreVehicles(storeId: string): Promise<StoreVehicle[]> {
  const { rows } = await readAllPages<StoreVehicle>((from, to) => db.from("store_inventory")
    .select("id,store_id,vin,stock_number,condition,certified,year,make,model,trim,mileage,feed_price,feed_price_status,presence,last_seen_at,enrichment_status,listing_id", { count: "exact" })
    .eq("store_id", storeId).in("presence", ["present", "missing", "retirement_review"])
    .order("id", { ascending: true }).range(from, to));
  return rows.sort((a, b) => (b.last_seen_at || "").localeCompare(a.last_seen_at || "") || a.id.localeCompare(b.id));
}

/** This month's ledger for one store, read completely. */
export async function listStoreUsageThisMonth(storeId: string, now = new Date()): Promise<StoreProviderUsage[]> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { rows } = await readAllPages<StoreProviderUsage>((from, to) => db.from("store_provider_usage").select("*", { count: "exact" })
    .eq("store_id", storeId).gte("at", start).order("id", { ascending: true }).range(from, to));
  return rows;
}

/**
 * Feed state and vAuto mapping status. Both tables are readable by platform
 * administrators only; for anyone else RLS returns no row, which the screen
 * shows as "not visible to your role", never as "no feed".
 */
export async function getStoreFeedState(storeId: string): Promise<{ state: StoreFeedState | null; mappings: StoreSourceMapping[] }> {
  const [st, mp] = await Promise.all([
    db.from("inventory_store_state").select("store_id,last_applied_at,last_failure_at,last_failure_reason").eq("store_id", storeId).maybeSingle(),
    db.from("inventory_source_mappings").select("store_id,source_dealer_id,status,approved_at").eq("store_id", storeId).in("status", ["pending", "approved"]),
  ]);
  if (st.error) throw new Error(st.error.message || "Read failed");
  if (mp.error) throw new Error(mp.error.message || "Read failed");
  return { state: st.data ?? null, mappings: mp.data ?? [] };
}
