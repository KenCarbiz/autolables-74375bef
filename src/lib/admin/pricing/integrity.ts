import type { ConsistencyAssessment } from "./priceConsistency";
import type { StoredListingPrice } from "./previewPricing";

// Pricing integrity: stored arithmetic, source evidence and customer output
// are three separate checks over the same consistency read. A vehicle counts
// as source verified only when a same-version website observation agrees with
// the label and the Passport; a matching sum alone never verifies a price.

export type IntegrityTone = "green" | "amber" | "red" | "blue" | "neutral";
export interface IntegrityChip { label: string; tone: IntegrityTone }

export interface IntegritySummary {
  checked: number;
  verified: number;
  needsEvidence: number;
  observed: number;
  breakdownConflicts: number;
}

export const isSourceVerified = (r: ConsistencyAssessment): boolean => r.status === "consistent" && r.evidence === "same_version";

const nonZero = (n: number | null): boolean => n != null && Math.abs(n) >= 1;

export function summarizeIntegrity(rows: ConsistencyAssessment[]): IntegritySummary {
  const verified = rows.filter(isSourceVerified).length;
  return {
    checked: rows.length,
    verified,
    needsEvidence: rows.length - verified,
    observed: rows.filter((r) => r.evidence !== "awaiting").length,
    breakdownConflicts: rows.filter((r) => nonZero(r.breakdownDelta)).length,
  };
}

export interface IntegrityQueueRow {
  id: string;
  vehicle: string;
  arithmetic: IntegrityChip;
  identity: IntegrityChip;
  fee: IntegrityChip;
  action: { label: string; href: string | null };
}

export function integrityQueueRow(r: ConsistencyAssessment): IntegrityQueueRow {
  const conflict = nonZero(r.breakdownDelta) || nonZero(r.delta) || nonZero(r.passportDelta);
  const verified = isSourceVerified(r);
  const identity: IntegrityChip = r.evidence === "same_version"
    ? { label: "Confirmed", tone: "green" }
    : r.evidence === "older_version" ? { label: "Older version", tone: "amber" } : { label: "Missing", tone: "amber" };
  return {
    id: r.listing.id,
    vehicle: r.listing.stock || r.listing.vin,
    arithmetic: conflict ? { label: "Conflict", tone: "red" } : { label: "Match", tone: "green" },
    identity,
    fee: verified ? { label: "Confirmed", tone: "green" } : { label: "Unknown", tone: "amber" },
    action: { label: verified ? "View evidence" : r.status === "mismatch" ? "Hold for review" : "Review source", href: r.reviewHref },
  };
}

/** The first vehicle with a stored price, read the way the Passport reads it. */
export function previewListing(rows: ConsistencyAssessment[]): { row: ConsistencyAssessment; stored: StoredListingPrice } | null {
  const row = rows.find((r) => (r.listing.price ?? r.listing.advertisedBeforeDoc ?? 0) > 0) ?? null;
  if (!row) return null;
  const l = row.listing;
  return { row, stored: { price: l.price, advertisedBeforeDoc: l.advertisedBeforeDoc, websiteSalePrice: l.websiteSalePrice, docFee: l.docFee } };
}

/** A read that names a column the table does not have is a schema contract failure, not missing data. */
export const isSchemaMismatch = (message: string | null | undefined): boolean =>
  !!message && /column .* does not exist|could not find the .* column|schema cache|42703|PGRST204/i.test(message);
