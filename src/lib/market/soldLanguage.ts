// ── What an inferred sale may be called ────────────────────────────────────
//
// MarketCheck infers a sale from a listing leaving the market. The number it
// carries is the last price the dealer ADVERTISED before the listing
// disappeared. Nobody paid that number, and we do not know what anybody paid.
//
// The change order (§5) makes the vocabulary a rule, applied to column names,
// analytics, manager screens, Passport copy, AutoCurb consumption, docs and
// tests: an inferred-sold figure is never a transaction price. This module is
// the approved vocabulary and the guard that enforces it.

export const APPROVED_SOLD_PHRASES = [
  "last observed advertised price",
  "last advertised price",
  "inferred sold listing",
  "inferred sold",
  "inferred market exit",
  "left the market",
  "advertised price before inferred sale",
] as const;

/** Wording that asserts a real transaction. Forbidden on inferred-sold evidence. */
export const FORBIDDEN_SOLD_PHRASES = [
  "transaction price",
  "actual sale price",
  "final sale amount",
  "final sale price",
  "customer paid",
  "customers paid",
  "paid price",
  "sold for",
  "sold price",
  "sale price of similar",
  "recently sold for",
] as const;

const normalize = (s: unknown): string => String(s ?? "").toLowerCase().replace(/\s+/g, " ");

/** A negated mention ("is not a transaction price") is a disclaimer, not a claim. */
const NEGATED = /\b(not|never|isn't|is not|aren't|are not|no)\b[^.]{0,40}\b(transaction price|actual sale price|final sale (amount|price)|customer(s)? paid|paid price|sold for|sold price)/;

export interface SoldWordingCheck {
  ok: boolean;
  offending: string[];
}

/** Check one piece of copy that was built on inferred-sold evidence. */
export function checkInferredSoldWording(copy: unknown): SoldWordingCheck {
  const text = normalize(copy);
  if (!text) return { ok: true, offending: [] };
  if (NEGATED.test(text)) return { ok: true, offending: [] };
  const offending = FORBIDDEN_SOLD_PHRASES.filter((p) => text.includes(p));
  return { ok: offending.length === 0, offending: [...offending] };
}

/** Throws on a transaction-price claim, so a generator cannot emit one unnoticed. */
export function assertInferredSoldWording(copy: unknown): string {
  const check = checkInferredSoldWording(copy);
  if (!check.ok) {
    throw new Error(`inferred-sold evidence described as a transaction: ${check.offending.join(", ")}`);
  }
  return String(copy ?? "");
}

/** The one label for the figure itself, for columns, charts and tables. */
export const INFERRED_SOLD_PRICE_LABEL = "last advertised price before inferred sale";

/** Column and key names that may hold the figure. Anything else is a naming defect. */
export const INFERRED_SOLD_COLUMN_NAMES = [
  "last_advertised_price",
  "inferred_sold_price_median",
  "inferred_sold_count",
  "inferred_sold_at",
] as const;

export const FORBIDDEN_COLUMN_FRAGMENTS = ["transaction_price", "actual_sale_price", "final_sale", "customer_paid", "sold_for"] as const;

export const isAcceptableSoldColumnName = (name: string): boolean =>
  !FORBIDDEN_COLUMN_FRAGMENTS.some((f) => name.toLowerCase().includes(f));
