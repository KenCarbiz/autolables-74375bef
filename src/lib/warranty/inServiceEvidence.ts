// When a used vehicle's factory warranty started. Only a date recorded at
// delivery (a dealer-entered or documented in-service date) can start the
// clock. Listing history tells us when a VIN was first advertised or first
// seen in a feed, which is not delivery, so a stored date equal to one of
// those was inferred and is treated as no date at all.

const day = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 10) : null;

/** Every date the listing history could have supplied as a stand-in. */
export function listingHistoryProxyDates(history: unknown): Set<string> {
  const h = (history && typeof history === "object" ? history : {}) as Record<string, unknown>;
  const out = new Set<string>();
  for (const v of [h.inServiceDate, h.firstSeen, h.firstNewListingSeen]) {
    const d = day(v);
    if (d) out.add(d);
  }
  for (const e of Array.isArray(h.entries) ? (h.entries as unknown[]) : []) {
    const d = day((e as Record<string, unknown> | null)?.first_seen);
    if (d) out.add(d);
  }
  return out;
}

/** The stored in-service date when it is not a listing-history proxy, else null. */
export function verifiedInServiceDate(stored: unknown, history: unknown): string | null {
  const d = day(stored);
  if (!d) return null;
  return listingHistoryProxyDates(history).has(d) ? null : d;
}
