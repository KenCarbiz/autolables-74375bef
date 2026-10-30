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
/**
 * What the Label and Passport figures mean under the display basis. In
 * website_sale_price mode the stored `price` IS the fee-inclusive advertised
 * total (resolveDisplayPrice anchors on it), so it is compared as a total; in
 * advertised_before_doc mode it is the price before the document fee.
 */
export type PriceBasis = "includes_fee" | "before_fee";
/** How the observed website figure relates to the basis it was compared on. */
export type WebsiteBasis = "as_shown" | "fee_removed" | "fee_added";
export type ConsistencyStatus = "consistent" | "mismatch" | "not_checked";

export interface ConsistencyAssessment {
  listing: ConsistencyListing;
  vehicle: string;
  sellingPrice: number | null;
  docFee: number;
  website: number | null;
  label: number | null;
  passport: number | null;
  basis: PriceBasis;
  websiteBasis: WebsiteBasis;
  evidence: EvidenceState;
  status: ConsistencyStatus;
  detail: string;
  /** Website minus label on the compared basis. */
  delta: number | null;
  /** Passport minus label; both are on the display basis. */
  passportDelta: number | null;
  /**
   * On the fee-inclusive basis: stored before-fee price plus the fee, minus the
   * advertised total. Non-zero means the stored breakdown and the total disagree.
   */
  breakdownDelta: number | null;
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

export const priceBasisOf = (mode: PriceDisplayMode): PriceBasis => (mode === "website_sale_price" ? "includes_fee" : "before_fee");

const signedMoney = (n: number): string => `${n > 0 ? "+" : "-"}$${Math.abs(Math.round(n)).toLocaleString()}`;
const money = (n: number): string => `$${Math.round(n).toLocaleString()}`;

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
  const basis = priceBasisOf(mode);
  const label = listing.price;
  const passport = resolveDisplayPrice(
    { advertised_price_before_doc: listing.advertisedBeforeDoc, doc_fee: docFee, website_sale_price: listing.websiteSalePrice, price: listing.price },
    mode,
  );
  const website = observation && observation.price > 0 ? observation.price : null;
  const derivedSelling = label != null ? (basis === "includes_fee" ? label - docFee : label) : null;
  const sellingPrice = listing.advertisedBeforeDoc ?? (derivedSelling != null && derivedSelling > 0 ? derivedSelling : null);
  const reviewHref = listing.vehicleFileId ? `/vehicle-file/${listing.vehicleFileId}` : `/inventory?q=${encodeURIComponent(listing.vin)}`;

  let evidence: EvidenceState = "awaiting";
  if (website != null && observation) {
    const captured = new Date(observation.capturedAt).getTime();
    const verified = listing.verifiedAt ? new Date(listing.verifiedAt).getTime() : null;
    evidence = verified == null || captured >= verified ? "same_version" : "older_version";
  }

  const breakdownDifference = basis === "includes_fee" && label != null && listing.advertisedBeforeDoc != null
    ? listing.advertisedBeforeDoc + docFee - label
    : 0;
  const breakdownAgrees = Math.abs(breakdownDifference) < TOLERANCE;
  // On the fee-inclusive basis website_sale_price should equal the total.
  // Earlier fee recalculations wrote it as well as the crawl, so its column
  // name is not evidence of a website observation: a difference is reported
  // for review and never reconciled here.
  const storedWebsiteDifference = basis === "includes_fee" && label != null && listing.websiteSalePrice != null
    ? listing.websiteSalePrice - label
    : 0;
  const breakdownText = [
    breakdownAgrees || listing.advertisedBeforeDoc == null
      ? null
      : `Stored breakdown (${money(listing.advertisedBeforeDoc)} before fee + ${money(docFee)} fee = ${money(listing.advertisedBeforeDoc + docFee)}) differs from the advertised total by ${signedMoney(breakdownDifference)}.`,
    Math.abs(storedWebsiteDifference) < TOLERANCE
      ? null
      : `Stored sale price ${money(listing.websiteSalePrice as number)} differs from the advertised total by ${signedMoney(storedWebsiteDifference)}; its source is not verified and it is kept for review.`,
  ].filter(Boolean).join(" ") || null;

  if (website == null || label == null) {
    const base = website == null ? "No website observation for this vehicle yet." : "No stored label price to compare.";
    return {
      listing, vehicle: vehicleTitle(listing), sellingPrice, docFee, website, label, passport, basis, websiteBasis: "as_shown",
      evidence: "awaiting", status: breakdownText ? "mismatch" : "not_checked", detail: breakdownText ? `${base} ${breakdownText}` : base,
      delta: null, passportDelta: null, breakdownDelta: breakdownAgrees ? 0 : breakdownDifference, reviewHref, sourceUrl: observation?.sourceUrl ?? null,
    };
  }

  // The website figure is brought onto the label's basis. On a before-fee
  // basis a page total that the stored breakdown shows as price + fee is read
  // as its pre-fee price. On a fee-inclusive basis the label is already the
  // total, so a page total is compared as shown; only a page that shows the
  // pre-fee price (website + fee = label) is lifted by the fee.
  const feeExclusiveWebsite = basis === "before_fee"
    ? feeExclusiveEquivalent(website, { website_sale_price: listing.websiteSalePrice, advertised_price_before_doc: listing.advertisedBeforeDoc })
    : null;
  const { difference, matchedWithDocFee } = reconcileGap(website, label, docFee, feeExclusiveWebsite);
  const websiteBasis: WebsiteBasis = !matchedWithDocFee ? "as_shown" : basis === "before_fee" ? "fee_removed" : "fee_added";
  const passportDifference = passport == null ? 0 : passport - label;
  const websiteAgrees = Math.abs(difference) < TOLERANCE;
  const passportAgrees = Math.abs(passportDifference) < TOLERANCE;
  const parserWarning = listing.parseStatus === "warning";
  const status: ConsistencyStatus = websiteAgrees && passportAgrees && !breakdownText && !parserWarning ? "consistent" : "mismatch";
  const basisText = basis === "includes_fee" ? "advertised total including the document fee" : "price before the document fee";
  const disagreements = [
    websiteAgrees ? null : `Website differs from the label by ${signedMoney(difference)} on the ${basisText}.`,
    passportAgrees ? null : `Passport differs from the label by ${signedMoney(passportDifference)}.`,
    breakdownText,
  ].filter((x): x is string => !!x);
  const detail = parserWarning
    ? "The price parser flagged this vehicle; the flag is preserved until the source is reviewed."
    : disagreements.length
      ? disagreements.join(" ")
      : `Website, label and Passport agree on the ${basisText}.`;

  return {
    listing, vehicle: vehicleTitle(listing), sellingPrice, docFee, website, label, passport, basis, websiteBasis,
    evidence, status, detail, delta: websiteAgrees ? 0 : difference, passportDelta: passportAgrees ? 0 : passportDifference, breakdownDelta: breakdownAgrees ? 0 : breakdownDifference, reviewHref,
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
