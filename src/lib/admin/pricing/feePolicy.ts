import { STATE_DOC_FEES, type DocFeeConfig } from "@/data/docFees";
import type { PriceDisplayMode } from "@/lib/priceModel";
import { describeFeeBasis, planFeeChange, type FeeBasis } from "./feeBasis";

// The documentation-fee policy as a reviewable draft, plus the pure dry-run
// that mirrors the server's recalculation predicate. Nothing here writes.

export interface FeeDraft {
  enabled: boolean;
  amount: number;
  stateCode: string;
}

export const feeDraftFromSettings = (s: { doc_fee_enabled?: boolean; doc_fee_amount?: number | string | null; doc_fee_state?: string | null }): FeeDraft => ({
  enabled: !!s.doc_fee_enabled,
  amount: Number(s.doc_fee_amount) || 0,
  stateCode: (s.doc_fee_state ?? "").toUpperCase(),
});

export const feeReference = (stateCode: string | null | undefined): DocFeeConfig | null =>
  STATE_DOC_FEES.find((s) => s.stateCode === (stateCode ?? "").toUpperCase()) ?? null;

export const jurisdictionLabel = (stateCode: string | null | undefined): string =>
  feeReference(stateCode)?.state ?? (stateCode ? stateCode.toUpperCase() : "Not set");

export const describePriceBasis = (mode: PriceDisplayMode | string | null | undefined): string =>
  mode === "website_sale_price" ? "Advertised total includes document fee" : "Advertised price before document fee";

export const priceBasisShort = (mode: PriceDisplayMode | string | null | undefined): string =>
  mode === "website_sale_price" ? "Includes fee" : "Fee disclosed separately";

/** The fee the server applies: zero whenever the fee is disabled. */
export const effectiveFee = (d: FeeDraft): number => (d.enabled ? round2(d.amount) : 0);

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function validateFeeDraft(d: FeeDraft): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(d.amount)) errors.push("Enter a dollar amount.");
  else {
    if (d.amount < 0) errors.push("The fee cannot be negative.");
    if (d.amount > 10_000) errors.push("The fee is above any documented state amount; check the value.");
    if (Math.round(d.amount * 100) !== d.amount * 100) errors.push("Use whole cents.");
  }
  if (d.enabled && !d.stateCode) errors.push("Choose the jurisdiction the fee is charged in.");
  return errors;
}

/** Reference data is not a certified rule; a cap is a warning, never a block. */
export function feeDraftWarnings(d: FeeDraft): string[] {
  const out: string[] = [];
  const ref = feeReference(d.stateCode);
  if (d.enabled && ref?.maxFee != null && d.amount > ref.maxFee) {
    out.push(`${ref.state} reference material lists a maximum of $${ref.maxFee.toLocaleString()}. The reference table is not a reviewed rule; confirm the current statute before relying on it.`);
  }
  if (d.enabled && d.amount === 0) out.push("The fee is enabled with a $0 amount, so no fee will be added.");
  return out;
}

export interface FeeImpactRow {
  vin: string;
  year: string | number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  stock: string | null;
  archived: boolean;
  /** The inventory price: the advertised total on an includes_fee basis. */
  price?: number | null;
  advertised_price_before_doc: number | null;
  doc_fee: number | null;
  website_sale_price: number | null;
  price_parse_status: string | null;
}

export interface FeeImpactSample {
  vinSuffix: string;
  vehicle: string;
  stock: string | null;
  /** The vehicle price after the change (before the fee). */
  sellingPrice: number;
  sellingBefore: number | null;
  feeBefore: number;
  feeAfter: number;
  totalBefore: number | null;
  totalAfter: number;
  basis: FeeBasis;
  /** A stored website price that disagrees with the advertised total; preserved. */
  sourceMismatch: boolean;
}

export interface FeeImpact {
  basis: FeeBasis;
  eligible: number;
  unchanged: number;
  excludedArchived: number;
  includedArchived: number;
  noPrice: number;
  invalid: number;
  /** Fee-inclusive rows whose stored before-fee price does not add up to the total; skipped. */
  splitMismatches: number;
  sourceMismatches: number;
  parserWarnings: number;
  samples: FeeImpactSample[];
  warnings: string[];
  exclusions: string[];
}

const storedOf = (r: Pick<FeeImpactRow, "price" | "advertised_price_before_doc" | "doc_fee" | "website_sale_price">) => ({
  price: r.price == null ? null : Number(r.price),
  advertisedBeforeDoc: r.advertised_price_before_doc == null ? null : Number(r.advertised_price_before_doc),
  websiteSalePrice: r.website_sale_price == null ? null : Number(r.website_sale_price),
  docFee: r.doc_fee == null ? null : Number(r.doc_fee),
});

/**
 * The server predicate, cent for cent (doc_fee_row_plan): a row is touched
 * only when its fee or a derived price would change. Rows with nothing to
 * anchor on are never touched.
 */
export function rowNeedsUpdate(row: Pick<FeeImpactRow, "price" | "advertised_price_before_doc" | "doc_fee" | "website_sale_price">, fee: number, basis: FeeBasis = "before_fee"): boolean {
  return planFeeChange(basis, storedOf(row), fee).status === "change";
}

export const vehicleLabel = (r: Pick<FeeImpactRow, "year" | "make" | "model" | "trim">): string =>
  [r.year, r.make, r.model].filter((x) => x != null && `${x}`.trim() !== "").join(" ") + (r.trim ? ` ${r.trim}` : "");

export function buildFeeImpact(rows: FeeImpactRow[], draft: FeeDraft, opts: { includeArchived?: boolean; sampleSize?: number; basis?: FeeBasis } = {}): FeeImpact {
  const fee = effectiveFee(draft);
  const basis = opts.basis ?? "before_fee";
  const sampleSize = opts.sampleSize ?? 3;
  let eligible = 0;
  let unchanged = 0;
  let excludedArchived = 0;
  let includedArchived = 0;
  let noPrice = 0;
  let invalid = 0;
  let splitMismatches = 0;
  let sourceMismatches = 0;
  let parserWarnings = 0;
  const samples: FeeImpactSample[] = [];
  for (const r of rows) {
    const plan = planFeeChange(basis, storedOf(r), fee);
    if (plan.status === "no_basis") { if (!r.archived) noPrice += 1; continue; }
    if (r.archived && !opts.includeArchived) { if (plan.status === "change") excludedArchived += 1; continue; }
    if (plan.sourceMismatch) sourceMismatches += 1;
    if (plan.status === "invalid") { invalid += 1; continue; }
    if (plan.status === "split_mismatch") { splitMismatches += 1; continue; }
    if (plan.status !== "change") { unchanged += 1; continue; }
    if (r.archived) includedArchived += 1;
    eligible += 1;
    if (r.price_parse_status === "warning") parserWarnings += 1;
    if (samples.length < sampleSize) {
      samples.push({
        vinSuffix: r.vin.slice(-6),
        vehicle: vehicleLabel(r),
        stock: r.stock,
        sellingPrice: plan.sellingAfter as number,
        sellingBefore: plan.sellingBefore,
        feeBefore: Number(r.doc_fee ?? 0),
        feeAfter: fee,
        totalBefore: plan.totalBefore,
        totalAfter: plan.totalAfter as number,
        basis,
        sourceMismatch: plan.sourceMismatch,
      });
    }
  }
  const warnings: string[] = [describeFeeBasis(basis)];
  if (invalid > 0) warnings.push(`${invalid} ${invalid === 1 ? "vehicle" : "vehicles"} would be left with no vehicle price under this fee and ${invalid === 1 ? "is" : "are"} skipped.`);
  if (splitMismatches > 0) warnings.push(`${splitMismatches} ${splitMismatches === 1 ? "vehicle has" : "vehicles have"} a stored before-fee price that does not add up to the advertised total; ${splitMismatches === 1 ? "it is" : "they are"} skipped and left as stored for review.`);
  if (sourceMismatches > 0) warnings.push(`${sourceMismatches} ${sourceMismatches === 1 ? "vehicle carries" : "vehicles carry"} a website price that differs from the advertised total; it is preserved for review and not used to reprice.`);
  if (parserWarnings > 0) warnings.push(`${parserWarnings} eligible ${parserWarnings === 1 ? "vehicle carries" : "vehicles carry"} a price parser warning; the warning and its source observation date are preserved.`);
  const exclusions: string[] = [];
  if (!opts.includeArchived) exclusions.push("Archived records are excluded and require a separate authorized action.");
  if (noPrice > 0) exclusions.push(`${noPrice} ${noPrice === 1 ? "vehicle has" : "vehicles have"} no advertised price and cannot be recalculated.`);
  if (basis === "conflict") return { basis, eligible: 0, unchanged, excludedArchived: 0, includedArchived: 0, noPrice, invalid: 0, splitMismatches: 0, sourceMismatches: 0, parserWarnings: 0, samples: [], warnings, exclusions };
  return { basis, eligible, unchanged, excludedArchived, includedArchived, noPrice, invalid, splitMismatches, sourceMismatches, parserWarnings, samples, warnings, exclusions };
}

export interface FeeDiffRow {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

export const fmtMoney = (n: number | null | undefined): string => (n == null || !Number.isFinite(Number(n)) ? "—" : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

export function feeChangeDiff(before: FeeDraft, after: FeeDraft, mode: PriceDisplayMode | string, version: string | number | null): FeeDiffRow[] {
  const feeBefore = before.enabled ? fmtMoney(before.amount) : "Disabled";
  const feeAfter = after.enabled ? fmtMoney(after.amount) : "Disabled";
  const jBefore = jurisdictionLabel(before.stateCode);
  const jAfter = jurisdictionLabel(after.stateCode);
  const basis = priceBasisShort(mode);
  const v = version == null ? "Unknown" : String(version);
  const vNext = typeof version === "number" ? String(version + 1) : version == null ? "Unknown" : "Next";
  return [
    { field: "Document fee", before: feeBefore, after: feeAfter, changed: feeBefore !== feeAfter },
    { field: "Jurisdiction", before: jBefore, after: jAfter, changed: jBefore !== jAfter },
    { field: "Price basis", before: basis, after: basis, changed: false },
    { field: "Policy version", before: v, after: vNext, changed: true },
  ];
}

export const isFeeDraftEqual = (a: FeeDraft, b: FeeDraft): boolean =>
  a.enabled === b.enabled && round2(a.amount) === round2(b.amount) && a.stateCode === b.stateCode;
