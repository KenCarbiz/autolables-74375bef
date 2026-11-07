import type { FeedRow } from "@/lib/inventoryScope/groupInventory";

// Synthetic six-rooftop group shaped like a real dealer group: one primary
// store whose working set is listings, five child stores that exist only as
// feed rows. Counts are parameters so a test can use a handful or thousands.

export const TENANT = "t1";

export interface FixtureStore { id: string; name: string; primary: boolean; feed: number }

export const SIX_STORES: FixtureStore[] = [
  { id: "st-infiniti", name: "Harte INFINITI", primary: true, feed: 6 },
  { id: "st-george-infiniti", name: "George Harte INFINITI", primary: false, feed: 5 },
  { id: "st-george-nissan", name: "George Harte Nissan", primary: false, feed: 8 },
  { id: "st-harte-nissan", name: "Harte Nissan", primary: false, feed: 7 },
  { id: "st-vw", name: "Harte Volkswagen of Meriden", primary: false, feed: 6 },
  { id: "st-hyundai", name: "Harte Hyundai of Old Saybrook", primary: false, feed: 7 },
];

const MAKES: Record<string, [string, string[]]> = {
  "st-infiniti": ["INFINITI", ["QX60", "QX80", "Q50"]],
  "st-george-infiniti": ["INFINITI", ["QX50", "QX55", "Q60"]],
  "st-george-nissan": ["Nissan", ["Rogue", "Altima", "Pathfinder"]],
  "st-harte-nissan": ["Nissan", ["Sentra", "Frontier", "Kicks"]],
  "st-vw": ["Volkswagen", ["Atlas", "Tiguan", "Jetta"]],
  "st-hyundai": ["Hyundai", ["Tucson", "Santa Fe", "Elantra"]],
};

let serial = 0;
export const resetSerial = () => { serial = 0; };
export const nextVin = () => `1HGCM82633A${String(++serial).padStart(6, "0")}`;

export function feedRow(storeId: string, i: number, over: Partial<FeedRow> = {}): FeedRow {
  const [make, models] = MAKES[storeId] ?? ["Ford", ["F-150"]];
  const condition = i % 7 === 0 ? "cpo" : i % 3 === 0 ? "new" : "used";
  return {
    id: `${storeId}-inv-${i}`, store_id: storeId, tenant_id: TENANT, vin: nextVin(), stock_number: `${storeId.slice(3, 5).toUpperCase()}${100 + i}`,
    condition, certified: condition === "cpo", year: 2022 + (i % 5), make, model: models[i % models.length], trim: i % 2 ? "Luxe" : "Sport",
    mileage: condition === "new" ? 12 : 8000 + i * 731, msrp: 52000, feed_price: 40000 + i * 250, feed_price_status: "known",
    exterior_color: "Black", photos: i % 4 === 0 ? [] : [`https://img.example/${storeId}/${i}.jpg`], photo_count: i % 4 === 0 ? 0 : 1,
    presence: "present", last_seen_at: "2026-11-05T12:00:00.000Z", listing_id: null, has_open_conflict: false, ...over,
  };
}

export function feedRowsFor(stores: FixtureStore[]): FeedRow[] {
  resetSerial();
  return stores.flatMap((s) => Array.from({ length: s.feed }, (_, i) => feedRow(s.id, i + 1)));
}

export const dealerStoreRows = (stores: FixtureStore[] = SIX_STORES) =>
  stores.map((s) => ({ id: s.id, tenant_id: TENANT, display_name: s.name, is_primary_inventory_store: s.primary, status: "active", provider_ids: {} }));

export function accessPayload(rows: FeedRow[], stores: FixtureStore[] = SIX_STORES, over: { allowed?: boolean; reason?: string } = {}) {
  const allowed = over.allowed ?? true;
  return {
    tenant_id: TENANT, allowed, reason: over.reason ?? (allowed ? "tenant_owner" : "not_permitted"),
    stores: allowed ? [...stores].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name)).map((s) => {
      const mine = rows.filter((r) => r.store_id === s.id);
      const present = mine.filter((r) => r.presence === "present");
      return {
        store_id: s.id, name: s.name, primary: s.primary, feed_present: present.length,
        new: present.filter((r) => r.condition === "new").length, used: present.filter((r) => r.condition === "used").length,
        cpo: present.filter((r) => r.condition === "cpo").length, absent: mine.length - present.length, listings_total: s.primary ? 4 : 0,
      };
    }) : [],
  };
}

/** The rows function as the server answers it: filtered to the requested stores, ordered, paged, with the total. */
export function rowsResponder(all: FeedRow[]) {
  return (args: unknown) => {
    const a = args as { p_store_ids: string[]; p_offset: number; p_limit: number };
    const mine = all.filter((r) => a.p_store_ids.includes(r.store_id)).sort((x, y) => x.store_id.localeCompare(y.store_id) || x.id.localeCompare(y.id));
    return { data: { tenant_id: TENANT, total: mine.length, offset: a.p_offset, rows: mine.slice(a.p_offset, a.p_offset + a.p_limit) }, error: null };
  };
}
