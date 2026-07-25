// ──────────────────────────────────────────────────────────────────────
// VIN case is not guaranteed at rest, so a VIN-keyed read and the write it
// offers must agree about which spellings count as the same car.
//
// dms-webhook (index.ts:245) and autocurb-sync (index.ts:205) write the
// provider's string verbatim into vehicle_listings, and InventoryModern's
// "Send to Get-Ready" (:95) hands that same string straight to createGetReady —
// while StartGetReadyModal (:141) and the create_draft_get_ready RPC uppercase.
// So both spellings really do exist in get_ready_records.vin.
//
// Reads therefore ask for both spellings; writes normalise, so nothing new is
// stored in a second spelling.
// ──────────────────────────────────────────────────────────────────────

export const vinKey = (vin: string): string => vin.trim().toUpperCase();

export const vinKeys = (vin: string): string[] =>
  Array.from(new Set([vin, vinKey(vin)].filter(Boolean)));
