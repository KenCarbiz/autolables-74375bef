// ──────────────────────────────────────────────────────────────────────
// The stock number a vehicle is known by on the lot.
//
// vehicle_listings has no stock_number column — the number arrives on the
// MarketCheck payload and gets filed in three different places depending on
// which path wrote it: mc_attributes.stock_no from the feed, the sticker
// snapshot's own stock_number when a document was generated, and the decoded
// block for records that came in through the decoder. Every reader that picked
// one or two of those showed "no stock number" for cars the other readers could
// find by it — the Command Palette searches sticker_snapshot->>stock_number,
// the Vehicle File header read only the other two, so a QX80 you could look up
// by stock number displayed none.
// ──────────────────────────────────────────────────────────────────────

interface StockSources {
  mc_attributes?: Record<string, unknown> | null;
  sticker_snapshot?: Record<string, unknown> | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/**
 * The vehicle's stock number, or null when no source carries one.
 *
 * Feed first: the DMS number on the syndication payload is the one the
 * dealership actually writes on the car. A snapshot value can be older than
 * the feed (it was frozen when a document was filed).
 */
export function vehicleStockNumber(vehicle: StockSources | null | undefined): string | null {
  if (!vehicle) return null;
  const mc = (vehicle.mc_attributes || {}) as Record<string, unknown>;
  const snap = (vehicle.sticker_snapshot || {}) as Record<string, unknown>;
  const decoded = (snap.decoded || {}) as Record<string, unknown>;
  const dealer = (mc.dealer || {}) as Record<string, unknown>;
  return (
    str(mc.stock_no)
    || str(dealer.stock_no)
    || str(snap.stock_number)
    || str(snap.stock)
    || str(decoded.stock_number)
    || str(decoded.stock)
    || null
  ) || null;
}
