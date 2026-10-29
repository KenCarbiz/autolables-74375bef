import { parseConfiguredBoolean } from "@/lib/market/priceBasis";

// The fee basis contract shared by the Admin preview, the fee review and the
// reconciliation reports. Mirrors doc_fee_basis, doc_fee_row_plan,
// doc_fee_evidence_contradicts and doc_fee_change_review in
// supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql, rule for rule.
//
//   includes_fee  `price` is the authoritative advertised total. A fee change
//                 keeps it and rederives advertised_price_before_doc = price -
//                 fee; website_sale_price is kept as stored.
//   before_fee    advertised_price_before_doc is the authoritative vehicle
//                 price. A fee change keeps it; website_sale_price = before-fee
//                 + fee is derived.
//   unconfigured  the dealership has not stated its basis, or the setting is
//                 unreadable. The display mode is never used to guess it.
//   conflict      the two basis settings contradict each other.
//
// A fee change is refused for the whole dealership while the basis is not
// decided or any vehicle in scope carries a pricing conflict.

export type FeeBasis = "includes_fee" | "before_fee" | "unconfigured" | "conflict";
export type FeeBasisSource = "advertised_includes_doc_fee" | "advertised_excludes_doc_fee" | "not_set" | "unreadable_setting" | "settings_conflict";

export const isDecidedBasis = (b: FeeBasis): b is "includes_fee" | "before_fee" => b === "includes_fee" || b === "before_fee";

const present = (bag: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(bag, key) && bag[key] != null;

export function resolveFeeBasis(settings: unknown): { basis: FeeBasis; source: FeeBasisSource } {
  const bag = settings != null && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  const hasInc = present(bag, "advertised_includes_doc_fee");
  const hasExc = present(bag, "advertised_excludes_doc_fee");
  const inc = hasInc ? parseConfiguredBoolean(bag.advertised_includes_doc_fee) : null;
  const exc = hasExc ? parseConfiguredBoolean(bag.advertised_excludes_doc_fee) : null;
  if ((hasInc && inc == null) || (hasExc && exc == null)) return { basis: "unconfigured", source: "unreadable_setting" };
  if (inc != null && exc != null && inc === exc) return { basis: "conflict", source: "settings_conflict" };
  if (inc != null) return { basis: inc ? "includes_fee" : "before_fee", source: "advertised_includes_doc_fee" };
  if (exc != null) return { basis: exc ? "before_fee" : "includes_fee", source: "advertised_excludes_doc_fee" };
  return { basis: "unconfigured", source: "not_set" };
}

export interface StoredPriceRow {
  price: number | null;
  advertisedBeforeDoc: number | null;
  websiteSalePrice: number | null;
  docFee: number | null;
}

export type FeePlanStatus = "change" | "unchanged" | "no_price" | "split_mismatch" | "invalid" | "blocked_basis";

export interface FeePlan {
  status: FeePlanStatus;
  sellingBefore: number | null;
  sellingAfter: number | null;
  totalBefore: number | null;
  totalAfter: number | null;
  /** The row as the apply would store it. */
  after: StoredPriceRow;
  /** On includes_fee, website_sale_price is not the total. Reported; it blocks a change. */
  salePriceDiffers: boolean;
}

const cents = (n: number): number => Math.round(n * 100);
export const roundFee = (n: number | null | undefined): number => (n == null || !Number.isFinite(n) ? 0 : cents(n) / 100);
const sub = (a: number, b: number): number => (cents(a) - cents(b)) / 100;
const add = (a: number, b: number): number => (cents(a) + cents(b)) / 100;
const differs = (a: number | null, b: number | null): boolean => (a == null || b == null ? a !== b : cents(a) !== cents(b));

export function planFeeChange(basis: FeeBasis, row: StoredPriceRow, fee: number): FeePlan {
  const f = roundFee(fee);
  const plan = (status: FeePlanStatus, rest: Partial<FeePlan> = {}): FeePlan => ({
    status, sellingBefore: null, sellingAfter: null, totalBefore: null, totalAfter: null, after: row, salePriceDiffers: false, ...rest,
  });
  if (!isDecidedBasis(basis)) return plan("blocked_basis");
  if (basis === "includes_fee") {
    if (row.price == null || !Number.isFinite(row.price) || row.price <= 0) return plan("no_price");
    const salePriceDiffers = row.websiteSalePrice != null && differs(row.websiteSalePrice, row.price);
    const totals = { totalBefore: row.price, totalAfter: row.price, salePriceDiffers };
    if (row.advertisedBeforeDoc != null && differs(add(row.advertisedBeforeDoc, row.docFee ?? 0), row.price)) {
      return plan("split_mismatch", { ...totals, sellingBefore: row.advertisedBeforeDoc, sellingAfter: row.advertisedBeforeDoc });
    }
    const sellingBefore = sub(row.price, row.docFee ?? 0);
    const sellingAfter = sub(row.price, f);
    if (sellingAfter <= 0) return plan("invalid", { ...totals, sellingBefore, sellingAfter });
    const changed = differs(row.docFee, f) || differs(row.advertisedBeforeDoc, sellingAfter);
    return plan(changed ? "change" : "unchanged", { ...totals, sellingBefore, sellingAfter, after: { ...row, docFee: f, advertisedBeforeDoc: sellingAfter } });
  }
  if (row.advertisedBeforeDoc == null || !Number.isFinite(row.advertisedBeforeDoc)) return plan("no_price");
  const selling = { sellingBefore: row.advertisedBeforeDoc, sellingAfter: row.advertisedBeforeDoc, totalBefore: row.websiteSalePrice };
  if (row.price != null && differs(row.price, row.advertisedBeforeDoc)) return plan("split_mismatch", { ...selling, totalAfter: row.websiteSalePrice });
  const totalAfter = add(row.advertisedBeforeDoc, f);
  if (row.advertisedBeforeDoc <= 0) return plan("invalid", { ...selling, totalAfter });
  const changed = differs(row.docFee, f) || differs(row.websiteSalePrice, totalAfter);
  return plan(changed ? "change" : "unchanged", { ...selling, totalAfter, after: { ...row, docFee: f, websiteSalePrice: totalAfter } });
}

/** Does the latest website observation contradict the basis? Same rule as doc_fee_evidence_contradicts. */
export function evidenceContradicts(basis: FeeBasis, price: number | null, docFee: number | null, observed: number | null | undefined): boolean {
  if (observed == null || price == null || docFee == null || docFee <= 0) return false;
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  if (basis === "includes_fee") return !near(observed, price) && (near(observed, price + docFee) || near(observed, price - docFee));
  if (basis === "before_fee") return near(observed, price - docFee);
  return false;
}

export interface ReviewRow extends StoredPriceRow {
  archived: boolean;
  /** The latest website observation for the VIN, when one was read. */
  observed?: number | null;
}

export interface FeeChangeReview {
  basis: FeeBasis;
  change: number;
  unchanged: number;
  archivedExcluded: number;
  noPrice: number;
  splitMismatches: number;
  invalid: number;
  salePriceDiffers: number;
  evidenceConflicts: number;
  blocked: boolean;
  blockReasons: string[];
}

/** The dealership-level review: same counts, same reasons and same wording as doc_fee_change_review. */
export function reviewFeeChange(basis: FeeBasis, rows: ReviewRow[], fee: number, includeArchived = false): FeeChangeReview {
  const r: FeeChangeReview = { basis, change: 0, unchanged: 0, archivedExcluded: 0, noPrice: 0, splitMismatches: 0, invalid: 0, salePriceDiffers: 0, evidenceConflicts: 0, blocked: false, blockReasons: [] };
  for (const row of rows) {
    const p = planFeeChange(basis, row, fee);
    const inScope = !row.archived || includeArchived;
    if (!inScope) { if (p.status === "change") r.archivedExcluded += 1; continue; }
    if (p.status === "change") r.change += 1;
    if (p.status === "unchanged") r.unchanged += 1;
    if (p.status === "no_price") r.noPrice += 1;
    if (p.status === "split_mismatch") r.splitMismatches += 1;
    if (p.status === "invalid") r.invalid += 1;
    if (p.salePriceDiffers) r.salePriceDiffers += 1;
    if (evidenceContradicts(basis, row.price, row.docFee, row.observed)) r.evidenceConflicts += 1;
  }
  if (!isDecidedBasis(basis)) r.change = 0;
  if (basis === "unconfigured") r.blockReasons.push("The dealership has not set whether its advertised prices include the document fee.");
  if (basis === "conflict") r.blockReasons.push("The dealership's fee basis settings contradict each other.");
  if (r.splitMismatches > 0) r.blockReasons.push(`${r.splitMismatches} vehicle(s) have a stored vehicle price that does not add up to the advertised total.`);
  if (r.invalid > 0) r.blockReasons.push(`${r.invalid} vehicle(s) would be left with no vehicle price under this fee.`);
  if (basis === "includes_fee" && r.salePriceDiffers > 0) r.blockReasons.push(`${r.salePriceDiffers} vehicle(s) store a sale price (website_sale_price) that differs from the advertised total.`);
  if (r.evidenceConflicts > 0) r.blockReasons.push(`${r.evidenceConflicts} vehicle(s) have a website observation that contradicts the configured fee basis.`);
  if (basis !== "includes_fee") r.salePriceDiffers = 0;
  r.blocked = r.blockReasons.length > 0;
  return r;
}

export const describeFeeBasis = (basis: FeeBasis): string =>
  basis === "includes_fee"
    ? "Advertised prices include the fee: each advertised total is kept and the fee is taken out of the vehicle price."
    : basis === "before_fee"
      ? "Advertised prices exclude the fee: each vehicle price is kept and the fee is added on top."
      : basis === "conflict"
        ? "The dealership's fee basis settings contradict each other."
        : "The dealership has not set whether its advertised prices include the document fee.";
