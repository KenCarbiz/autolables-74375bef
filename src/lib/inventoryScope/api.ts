import { supabase } from "@/integrations/supabase/client";
import type { StoreEnrichmentPolicy, StoreProviderUsage } from "@/lib/inventoryNetwork/api";
import type { ScopeListing, ScopeStore } from "./storeScope";

// Dealer-member reads for the per-store inventory screens. Every table here is
// readable by the tenant's own accepted members through existing RLS
// (drizzle 0006: "Members read own group stores/inventory/usage/policy"), so
// no new grant is needed. None of these reads calls a provider.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TenantStore extends ScopeStore {
  subscription_status: string;
  inventory_feed_enabled: boolean;
  inventory_sharing_enabled: boolean;
  listing_sync_enabled: boolean;
  city: string | null;
  state: string | null;
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
    .select("id,display_name,is_primary_inventory_store,status,subscription_status,inventory_feed_enabled,inventory_sharing_enabled,listing_sync_enabled,city,state,provider_ids")
    .eq("tenant_id", tenantId).order("display_name"));
}

export async function listStorePolicies(storeIds: string[]): Promise<StoreEnrichmentPolicy[]> {
  if (!storeIds.length) return [];
  return unwrap<StoreEnrichmentPolicy[]>(await db.from("store_enrichment_policies").select("*").in("store_id", storeIds));
}

const LISTING_COLS = "id,vin,ymm,condition,status,updated_at,owning_store_id";

/**
 * Active tenant listings with the identity needed to place each one in a store.
 * The MarketCheck dealer id is read as a single JSON path, never the payload.
 */
export async function listScopedListings(tenantId: string): Promise<{ rows: TenantListing[]; dealerIdRead: boolean }> {
  const run = (cols: string) => db.from("vehicle_listings").select(cols).eq("tenant_id", tenantId).neq("status", "archived").limit(2000);
  const withDealer = await run(`${LISTING_COLS},mc_dealer_id:mc_raw->dealer->>id`);
  if (!withDealer.error) return { rows: withDealer.data ?? [], dealerIdRead: true };
  return { rows: unwrap<TenantListing[]>(await run(LISTING_COLS)), dealerIdRead: false };
}

export async function listStoreVehicles(storeId: string): Promise<StoreVehicle[]> {
  return unwrap<StoreVehicle[]>(await db.from("store_inventory")
    .select("id,store_id,vin,stock_number,condition,certified,year,make,model,trim,mileage,feed_price,feed_price_status,presence,last_seen_at,enrichment_status,listing_id")
    .eq("store_id", storeId).in("presence", ["present", "missing", "retirement_review"])
    .order("last_seen_at", { ascending: false }).limit(1000));
}

export async function listStoreUsageThisMonth(storeId: string, now = new Date()): Promise<StoreProviderUsage[]> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return unwrap<StoreProviderUsage[]>(await db.from("store_provider_usage").select("*")
    .eq("store_id", storeId).gte("at", start).order("at", { ascending: false }).limit(1000));
}
