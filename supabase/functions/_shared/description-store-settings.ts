// Per-store description settings over the dealership defaults.
//
// A dealership (tenant) keeps one description_settings row. A rooftop
// (dealer_stores row) may override a fixed list of keys in
// description_store_settings, proposed in
// supabase/proposed/20261109000000_description_store_settings.sql and NOT yet
// applied. Until it is applied the loader finds no table and every store uses
// the dealership row, exactly as today.
//
// The disclosure may carry {conveyance_fee}; it is rendered with the vehicle's
// own stored fee so the text always states the fee actually charged.

import { renderDisclosure } from "./vauto-export-gate.ts";

/** The only keys a store may override. Anything else stays dealership-wide. */
export const STORE_OVERRIDABLE_KEYS = [
  "required_legal_text",
  "cta_template",
  "brand_voice",
  "prohibited_phrases",
  "review_mode",
  "review_mode_by_class",
  "enabled_channels",
  "primary_city",
  "state",
] as const;

export type StoreOverridableKey = typeof STORE_OVERRIDABLE_KEYS[number];

export interface StoreSettingsRow {
  store_id: string;
  version: number;
  overrides: Record<string, unknown>;
}

/** Store values win key by key; a key the store has not set keeps the dealership value. */
export function applyStoreOverrides<T extends Record<string, unknown>>(tenant: T, store: StoreSettingsRow | null): T & { _store_id?: string; _store_version?: number } {
  if (!store) return { ...tenant };
  const merged: Record<string, unknown> = { ...tenant };
  for (const key of STORE_OVERRIDABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(store.overrides ?? {}, key) && store.overrides[key] !== undefined) merged[key] = store.overrides[key];
  }
  return { ...(merged as T), _store_id: store.store_id, _store_version: store.version };
}

/** Fills {conveyance_fee} in the disclosure from the vehicle's stored fee. */
export function renderVehicleSettings<T extends Record<string, unknown>>(settings: T, listing: Record<string, unknown> | null): T {
  const legal = String(settings.required_legal_text ?? "");
  if (!legal.includes("{")) return settings;
  const fee = listing?.doc_fee == null ? null : Number(listing.doc_fee);
  return { ...settings, required_legal_text: renderDisclosure(legal, Number.isFinite(fee) ? fee : null).text };
}

const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST202"]);

// deno-lint-ignore no-explicit-any
export async function loadStoreSettings(admin: any, tenantId: string, storeId: string | null | undefined): Promise<StoreSettingsRow | null> {
  if (!storeId) return null;
  const { data, error } = await admin.from("description_store_settings")
    .select("store_id, version, overrides").eq("tenant_id", tenantId).eq("store_id", storeId).maybeSingle();
  if (error) {
    if (MISSING_TABLE.has(String(error.code))) return null;
    throw new Error(`store description settings unreadable: ${error.message ?? error.code}`);
  }
  return data ? { store_id: String(data.store_id), version: Number(data.version) || 0, overrides: (data.overrides ?? {}) as Record<string, unknown> } : null;
}
