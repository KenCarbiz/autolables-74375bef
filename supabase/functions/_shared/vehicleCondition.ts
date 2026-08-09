// ──────────────────────────────────────────────────────────────────────
// New / used / CPO, decided the same way for every feed.
//
// CPO is a grade of USED. A car cannot be both factory-new and certified
// pre-owned, so "is it new" has to be asked before "is it certified" —
// otherwise a provider that sets a certification flag on a new unit buries it
// in the CPO bucket, and the dealer's new-car count reads zero.
//
// The four DMS normalizers in dms-webhook already ask in that order. The
// MarketCheck sync asked the other way round, which is why a new car arriving
// with a truthy certification flag was stored as CPO, never counted toward
// the new-unit total, and re-buried on every nightly run.
// ──────────────────────────────────────────────────────────────────────

export type VehicleCondition = "new" | "used" | "cpo";

/**
 * Provider flags are not reliably booleans. Syndication feeds emit 1/0,
 * "true"/"false" and "Y"/"N" for the same field, and the string "false" is
 * truthy in JS — enough on its own to push a whole feed into CPO.
 */
export const isTruthyFlag = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    // "t"/"f" is how Postgres and PostgREST render a boolean as text.
    return s === "true" || s === "1" || s === "y" || s === "yes" || s === "t";
  }
  return false;
};

/** True when the feed says this unit is factory-new. Case-insensitive: the
 *  same field arrives as "new", "New" and "NEW" across providers. */
export const isNewInventoryType = (v: unknown): boolean =>
  String(v ?? "").trim().toLowerCase() === "new";

/**
 * Classify one listing.
 *
 * Order is the whole point: new wins over certified, and only a unit that is
 * not new can be graded CPO.
 */
export function classifyCondition(input: {
  inventoryType?: unknown;
  certified?: unknown;
}): VehicleCondition {
  if (isNewInventoryType(input.inventoryType)) return "new";
  return isTruthyFlag(input.certified) ? "cpo" : "used";
}
