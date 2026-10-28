import { resolveDisplayPrice, type PriceDisplayMode } from "@/lib/priceModel";
import { feeExclusiveEquivalent, reconcileGap } from "@/components/compliance/complianceData";

// Price consistency across the customer touchpoints: what the dealer's own
// website showed, what the label carries and what the Passport displays. Each
// row separates numerical agreement, parser state and evidence freshness, so a
// failed read is Unknown and a vehicle with no website observation is Not
// checked, never "reconciled".

export interface ConsistencyListing {
  id: string;
  vin: string;
  year: string | number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  stock: string | null;
  condition: string | null;
  heroImageUrl: string | null;
  price: number | null;
  advertisedBeforeDoc: number | null;
  docFee: number | null;
  websiteSalePrice: number | null;
  parseStatus: string | null;
  verifiedAt: string | null;
  vehicleFileId: string | null;
}

export interface WebsiteObservation {
  price: number;
  capturedAt: string;
  sourceUrl: string | null;
  channel: string;
}

export type EvidenceState = "same_version" | "older_version" | "awaiting";
export type ConsistencyStatus = "consistent" | "mismatch" | "not_checked";

export interface ConsistencyAssessment {
  listing: ConsistencyListing;
  vehicle: string;
  sellingPrice: number | null;
  docFee: number;
  website: number | null;
  label: number | null;
  passport: number | null;
  evidence: EvidenceState;
  status: ConsistencyStatus;
  detail: string;
  delta: number | null;
  reviewHref: string | null;
  sourceUrl: string | null;
}

export const EVIDENCE_LABEL: Record<EvidenceState, string> = {
  same_version: "Same version",
  older_version: "Older version",
  awaiting: "Awaiting evidence",
};

export const STATUS_LABEL: Record<ConsistencyStatus, string> = {
  consistent: "Consistent",
  mismatch: "Mismatch",
  not_checked: "Not checked",
};

const TOLERANCE = 1;

export const conditionOfListing = (condition: string | null | undefined): "new" | "used" | "cpo" => {
  const c = (condition ?? "").toLowerCase();
  if (c === "new") return "new";
  if (/cpo|certified/.test(c)) return "cpo";
  return "used";
};

export const vehicleTitle =(l: Pick<ConsistencyListing, "year" | "make" | "model">): string =>
  [l.year, l.make, l.model].filter((x) => x != null && `${x}`.trim() !== "").join(" ");

export function assessConsistency(
  listing: ConsistencyListing,
  observation: WebsiteObservation | null,
  configuredFee: number,
  mode: PriceDisplayMode,
): ConsistencyAssessment {
  const docFee = listing.docFee ?? configuredFee;
  const label = listing.price;
  const passport = resolveDisplayPrice(
    { advertised_price_before_doc: listing.advertisedBeforeDoc, doc_fee: docFee, website_sale_price: listing.websiteSalePrice, price: listing.price },
    mode,
  );
  const website = observation && observation.price > 0 ? observation.price : null;
  const reviewHref = listing.vehicleFileId ? `/vehicle-file/${listing.vehicleFileId}` : `/inventory?q=${encodeURIComponent(listing.vin)}`;

  let evidence: EvidenceState = "awaiting";
  if (website != null && observation) {
    const captured = new Date(observation.capturedAt).getTime();
    const verified = listing.verifiedAt ? new Date(listing.verifiedAt).getTime() : null;
    evidence = verified == null || captured >= verified ? "same_version" : "older_version";
  }

  if (website == null || label == null) {
    return {
      listing, vehicle: vehicleTitle(listing), sellingPrice: listing.advertisedBeforeDoc, docFee, website, label, passport,
      evidence: "awaiting", status: "not_checked", detail: website == null ? "No website observation for this vehicle yet." : "No stored label price to compare.",
      delta: null, reviewHref, sourceUrl: observation?.sourceUrl ?? null,
    };
  }

  const { difference } = reconcileGap(
    website,
    label,
    docFee,
    feeExclusiveEquivalent(website, { website_sale_price: listing.websiteSalePrice, advertised_price_before_doc: listing.advertisedBeforeDoc }),
  );
  const parserWarning = listing.parseStatus === "warning";
  const numericallyConsistent = Math.abs(difference) < TOLERANCE;
  const status: ConsistencyStatus = numericallyConsistent && !parserWarning ? "consistent" : "mismatch";
  const detail = parserWarning
    ? "The price parser flagged this vehicle; the flag is preserved until the source is reviewed."
    : numericallyConsistent
      ? "Website, label and Passport agree on the advertised total."
      : `Website differs from the label by ${difference > 0 ? "+" : "-"}$${Math.abs(Math.round(difference)).toLocaleString()}.`;

  return {
    listing, vehicle: vehicleTitle(listing), sellingPrice: listing.advertisedBeforeDoc, docFee, website, label, passport,
    evidence, status, detail, delta: numericallyConsistent ? 0 : difference, reviewHref,
    sourceUrl: observation?.sourceUrl ?? null,
  };
}

export interface ConsistencySummary {
  consistent: number;
  mismatch: number;
  notChecked: number;
  shown: number;
}

export const summarizeConsistency = (rows: ConsistencyAssessment[]): ConsistencySummary => ({
  consistent: rows.filter((r) => r.status === "consistent").length,
  mismatch: rows.filter((r) => r.status === "mismatch").length,
  notChecked: rows.filter((r) => r.status === "not_checked").length,
  shown: rows.length,
});

/** Header chip wording. A failed read is Unknown; an unchecked set is not reconciled. */
export function consistencyHeadline(summary: ConsistencySummary | null, loadFailed: boolean): { label: string; tone: "neutral" | "success" | "warning" | "danger" } {
  if (loadFailed || !summary) return { label: "Unknown", tone: "neutral" };
  if (summary.shown === 0) return { label: "No priced vehicles", tone: "neutral" };
  if (summary.mismatch > 0) return { label: `${summary.mismatch} ${summary.mismatch === 1 ? "mismatch" : "mismatches"}`, tone: "warning" };
  if (summary.consistent === 0) return { label: "Not checked", tone: "neutral" };
  if (summary.notChecked > 0) return { label: `${summary.consistent} consistent, ${summary.notChecked} not checked`, tone: "neutral" };
  return { label: `${summary.consistent} consistent`, tone: "success" };
}
