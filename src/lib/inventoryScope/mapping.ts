import { supabase } from "@/integrations/supabase/client";
import type { TenantStore } from "./api";
import { MC_DEALER_KEY, type ScopeListing } from "./storeScope";

// Mapping a provider (MarketCheck) dealer id to a rooftop changes which
// dealership's inventory a listing is counted in. The screen builds a plan
// first (current and proposed mapping, conflicts, the listings that move) and
// saves only after an explicit confirmation, through one server function that
// checks platform-admin rights, rejects a dealer id already mapped to another
// store (any tenant), and records the actor, time, previous and new mapping
// and the evidence. Undoing a mapping is the same function with "unmap".

export const MAP_RPC = "inv_admin_map_provider_dealer";
export const DEALER_ID_RE = /^[0-9]{1,12}$/;

export type MappingAction = "map" | "unmap";

export type MappingConflict =
  | { code: "invalid_dealer_id" }
  | { code: "store_not_found" }
  | { code: "store_inactive"; store: string }
  | { code: "mapped_to_other_store"; store: string }
  | { code: "already_mapped" }
  | { code: "not_mapped" };

export interface MappingPlan {
  action: MappingAction;
  dealerId: string;
  store: TenantStore | null;
  previous: string[];
  next: string[];
  conflicts: MappingConflict[];
  /** Listings with no owning store that carry this dealer id: they move between review and the store. */
  affected: number;
}

export const mappedDealerIds = (s: Pick<TenantStore, "provider_ids">): string[] => {
  const v = s.provider_ids?.[MC_DEALER_KEY];
  return (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map((x) => String(x).trim()).filter(Boolean);
};

export function planMapping(stores: TenantStore[], rows: readonly ScopeListing[], dealerIdRaw: string, storeId: string, action: MappingAction): MappingPlan {
  const dealerId = String(dealerIdRaw ?? "").trim();
  const store = stores.find((s) => s.id === storeId) ?? null;
  const previous = store ? mappedDealerIds(store) : [];
  const conflicts: MappingConflict[] = [];
  if (!DEALER_ID_RE.test(dealerId)) conflicts.push({ code: "invalid_dealer_id" });
  if (!store) conflicts.push({ code: "store_not_found" });
  else if (action === "map" && store.status !== "active") conflicts.push({ code: "store_inactive", store: store.display_name });
  if (action === "map") {
    const other = stores.find((s) => s.id !== storeId && mappedDealerIds(s).includes(dealerId));
    if (other) conflicts.push({ code: "mapped_to_other_store", store: other.display_name });
    if (previous.includes(dealerId)) conflicts.push({ code: "already_mapped" });
  } else if (!previous.includes(dealerId)) conflicts.push({ code: "not_mapped" });
  const next = action === "map" ? Array.from(new Set([...previous, dealerId])) : previous.filter((d) => d !== dealerId);
  const affected = rows.filter((r) => !String(r.owning_store_id ?? "").trim() && String(r.mc_dealer_id ?? "").trim() === dealerId).length;
  return { action, dealerId, store, previous, next, conflicts, affected };
}

export const CONFLICT_TEXT = (c: MappingConflict): string => {
  switch (c.code) {
    case "invalid_dealer_id": return "The provider dealer id must be digits only.";
    case "store_not_found": return "Choose a store of this account.";
    case "store_inactive": return `${c.store} is inactive. Activate it before mapping inventory to it.`;
    case "mapped_to_other_store": return `This dealer id is already mapped to ${c.store}. One provider dealer id can belong to one rooftop only; unmap it there first.`;
    case "already_mapped": return "This dealer id is already mapped to this store.";
    case "not_mapped": return "This dealer id is not mapped to this store.";
  }
};

export interface MappingEvidence {
  provider_dealer_name: string | null;
  provider_dealer_website: string | null;
  provider_dealer_address: string | null;
  source: string;
  feed_vehicles_at_store: number;
  confirmed_destination: string;
}

export class MappingUnavailableError extends Error {}

const SERVER_TEXT: Array<[RegExp, string]> = [
  [/platform_admin_required|not authorized|42501/i, "Only a platform administrator can change rooftop mappings."],
  [/provider_dealer_id_mapped_to_other_store/, "This dealer id is already mapped to another store. Nothing was changed."],
  [/expected_updated_at_required/, "This store's version could not be read. Reload and review the mapping again."],
  [/store_changed_since_loaded/, "This store changed since the page loaded. Reload and review the mapping again."],
  [/already_mapped/, "This dealer id is already mapped to this store."],
  [/not_mapped/, "This dealer id is not mapped to this store."],
  [/reason_required/, "Enter the reason for this change (at least 10 characters)."],
  [/evidence_required|destination_not_confirmed/, "Confirm the destination store and the evidence before saving."],
];

/** Saves through the server function only. There is no client-side fallback. */
export async function saveMapping(plan: MappingPlan, evidence: MappingEvidence, reason: string, expectedUpdatedAt: string | null): Promise<{ affected_listings?: number }> {
  if (plan.conflicts.length || !plan.store) throw new Error("The mapping has unresolved conflicts.");
  if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    throw new Error("This store's version could not be read. Reload and review the mapping again.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(MAP_RPC, {
    p_store_id: plan.store.id, p_dealer_id: plan.dealerId, p_action: plan.action,
    p_expected_updated_at: expectedUpdatedAt, p_evidence: evidence, p_reason: reason.trim(),
  });
  if (error) {
    const code = String(error.code ?? "");
    if (code === "PGRST202" || code === "42883") throw new MappingUnavailableError("Rooftop mapping is turned off until its database change is applied. Nothing was changed.");
    const raw = String(error.message ?? "");
    for (const [re, text] of SERVER_TEXT) if (re.test(raw) || re.test(code)) throw new Error(text);
    throw new Error("The mapping was not saved. Nothing was changed.");
  }
  return (data ?? {}) as { affected_listings?: number };
}
