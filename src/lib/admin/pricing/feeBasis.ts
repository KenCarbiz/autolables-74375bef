import { resolveDocFeeTreatment } from "@/lib/market/priceBasis";

// The fee basis contract shared by the Admin preview, the fee review, the
// saved recalculation and the reconciliation report. Mirrors doc_fee_basis
// and doc_fee_row_plan in supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql.
//
//   includes_fee  `price` is the advertised total (source). A fee change keeps
//                 it; advertised_price_before_doc = price - fee is derived;
//                 website_sale_price is an observation and is never rewritten.
//   before_fee    advertised_price_before_doc is the source. A fee change keeps
//                 it; website_sale_price = before-fee + fee is derived.
//   conflict      the two basis settings contradict each other; nothing is
//                 recalculated until a person corrects them.
//
// An includes_fee row whose stored split already disagrees with its total is
// split_mismatch: left exactly as stored and reported, because which of the
// two is the newer observation is not knowable here.

export type FeeBasis = "includes_fee" | "before_fee" | "conflict";
export type FeeBasisSource = "advertised_includes_doc_fee" | "advertised_excludes_doc_fee" | "price_display_mode" | "settings_conflict";

export function resolveFeeBasis(settings: unknown): { basis: FeeBasis; source: FeeBasisSource } {
  const t = resolveDocFeeTreatment(settings);
  if (t.conflict) return { basis: "conflict", source: "settings_conflict" };
  if (t.advertisedIncludesDocFee != null) {
    return {
      basis: t.advertisedIncludesDocFee ? "includes_fee" : "before_fee",
      source: t.source === "excludes_setting" ? "advertised_excludes_doc_fee" : "advertised_includes_doc_fee",
    };
  }
  const mode = settings && typeof settings === "object" ? (settings as { price_display_mode?: unknown }).price_display_mode : null;
  return { basis: mode === "website_sale_price" ? "includes_fee" : "before_fee", source: "price_display_mode" };
}

export interface StoredPriceRow {
  price: number | null;
  advertisedBeforeDoc: number | null;
  websiteSalePrice: number | null;
  docFee: number | null;
}

export type FeePlanStatus = "change" | "unchanged" | "no_basis" | "split_mismatch" | "invalid" | "conflict";

export interface FeePlan {
  status: FeePlanStatus;
  sellingBefore: number | null;
  sellingAfter: number | null;
  totalBefore: number | null;
  totalAfter: number | null;
  /** The row as the recalculation would store it. */
  after: StoredPriceRow;
  /** A stored observation that disagrees with the advertised total; kept and reported, never resolved here. */
  sourceMismatch: boolean;
}

const cents = (n: number): number => Math.round(n * 100);
export const roundFee = (n: number | null | undefined): number => (n == null || !Number.isFinite(n) ? 0 : cents(n) / 100);
const sub = (a: number, b: number): number => (cents(a) - cents(b)) / 100;
const add = (a: number, b: number): number => (cents(a) + cents(b)) / 100;
const differs = (a: number | null, b: number | null): boolean => (a == null || b == null ? a !== b : cents(a) !== cents(b));

export function planFeeChange(basis: FeeBasis, row: StoredPriceRow, fee: number): FeePlan {
  const f = roundFee(fee);
  const none = (status: FeePlanStatus): FeePlan => ({ status, sellingBefore: null, sellingAfter: null, totalBefore: null, totalAfter: null, after: row, sourceMismatch: false });
  if (basis === "conflict") return none("conflict");
  if (basis === "includes_fee") {
    if (row.price == null || !Number.isFinite(row.price) || row.price <= 0) return none("no_basis");
    const sellingAfter = sub(row.price, f);
    const sourceMismatch = row.websiteSalePrice != null && differs(row.websiteSalePrice, row.price);
    const base = {
      sellingBefore: sub(row.price, row.docFee ?? 0),
      sellingAfter,
      totalBefore: row.price,
      totalAfter: row.price,
      sourceMismatch,
    };
    if (row.advertisedBeforeDoc != null && differs(add(row.advertisedBeforeDoc, row.docFee ?? 0), row.price)) {
      return { ...base, status: "split_mismatch", sellingBefore: row.advertisedBeforeDoc, sellingAfter: row.advertisedBeforeDoc, after: row };
    }
    if (sellingAfter <= 0) return { ...base, status: "invalid", after: row };
    const changed = differs(row.docFee, f) || differs(row.advertisedBeforeDoc, sellingAfter);
    return { ...base, status: changed ? "change" : "unchanged", after: { ...row, docFee: f, advertisedBeforeDoc: sellingAfter } };
  }
  if (row.advertisedBeforeDoc == null || !Number.isFinite(row.advertisedBeforeDoc)) return none("no_basis");
  const totalAfter = add(row.advertisedBeforeDoc, f);
  const base = {
    sellingBefore: row.advertisedBeforeDoc,
    sellingAfter: row.advertisedBeforeDoc,
    totalBefore: row.websiteSalePrice,
    totalAfter,
    sourceMismatch: row.price != null && differs(row.price, row.advertisedBeforeDoc),
  };
  if (row.advertisedBeforeDoc <= 0) return { ...base, status: "invalid", after: row };
  const changed = differs(row.docFee, f) || differs(row.websiteSalePrice, totalAfter);
  return { ...base, status: changed ? "change" : "unchanged", after: { ...row, docFee: f, websiteSalePrice: totalAfter } };
}

export const describeFeeBasis = (basis: FeeBasis): string =>
  basis === "includes_fee"
    ? "Advertised prices include the fee: each advertised total is kept and the fee is taken out of the vehicle price."
    : basis === "before_fee"
      ? "Advertised prices exclude the fee: each vehicle price is kept and the fee is added on top."
      : "The fee basis settings contradict each other. Nothing can be applied until one is corrected.";
