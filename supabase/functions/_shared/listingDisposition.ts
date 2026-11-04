// Customer-facing availability of a Passport listing.
//
// "Archived" only means the listing left advertised inventory. It is never read
// as a sale on its own. "Sold" needs a custody milestone that provably belongs to
// the stay this listing advertises. The dealer deal record (vehicle_files) is one
// row per tenant+VIN forever and the listing row is reused when a car comes back,
// so neither can tell this stay from an earlier one: a deal record therefore never
// labels a car sold. Any sale evidence that cannot be tied to this stay is
// ambiguous, which reads "No longer listed" with purchase actions off. Pure
// module, imported by public-listing-view (Deno) and by the Passport (browser).

export type ListingDisposition =
  | "available"
  | "sale_pending"
  | "sold"
  | "transferred"
  | "withdrawn"
  | "missing_from_feed"
  | "unknown";

export type DispositionBasis =
  | "custody_milestone"
  | "ambiguous_sale_evidence"
  | "listing_status"
  | "feed_absence"
  | "none";

export interface DispositionListingInput {
  id?: string | null;
  status?: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
  published_at?: string | null;
}

// The newest custody episode for the listing's tenant+VIN, with the time of the
// milestone that put it in its current state.
export interface CustodyEvidence {
  custody_state?: string | null;
  listing_id?: string | null;
  occurred_at?: string | null;
}

export interface PassportAvailability {
  disposition: ListingDisposition;
  basis: DispositionBasis;
  purchasable: boolean;
  price_status: "current_offer" | "last_advertised";
  as_of: string | null;
}

const FEED_ABSENCE = new Set(["left_feed", "removed_from_feed"]);
const WITHDRAWN = new Set(["duplicate_reconciled", "withdrawn", "dealer_withdrawn", "unpublished"]);
const SALE_STATES: Record<string, ListingDisposition> = {
  delivered: "sold",
  sold: "sale_pending",
  awaiting_delivery: "sale_pending",
  transferred_out: "transferred",
};

const isArchived = (l: DispositionListingInput) => l.status === "archived" || !!l.archived_at;
const ms = (t: string | null | undefined) => (t ? Date.parse(t) : NaN);

const result = (disposition: ListingDisposition, basis: DispositionBasis, as_of: string | null): PassportAvailability => ({
  disposition,
  basis,
  purchasable: disposition === "available",
  price_status: disposition === "available" ? "current_offer" : "last_advertised",
  as_of,
});

// A milestone belongs to this stay only when its episode is bound to this listing
// and it happened at or after the listing's current publish. Missing data on
// either side is not proof.
function belongsToThisStay(listing: DispositionListingInput, custody: CustodyEvidence): boolean {
  if (!listing.id || !custody.listing_id || custody.listing_id !== listing.id) return false;
  const at = ms(custody.occurred_at);
  const published = ms(listing.published_at);
  return Number.isFinite(at) && Number.isFinite(published) && at >= published;
}

export function deriveListingDisposition(
  listing: DispositionListingInput,
  custody: CustodyEvidence | null = null,
): PassportAvailability {
  const sale = custody?.custody_state ? SALE_STATES[custody.custody_state] : undefined;
  if (sale && custody) {
    return belongsToThisStay(listing, custody)
      ? result(sale, "custody_milestone", custody.occurred_at ?? null)
      : result("unknown", "ambiguous_sale_evidence", listing.archived_at ?? null);
  }

  if (!isArchived(listing)) {
    return listing.status === "published"
      ? result("available", "listing_status", null)
      : result("unknown", "none", null);
  }
  const reason = (listing.archive_reason ?? "").trim();
  if (FEED_ABSENCE.has(reason)) return result("missing_from_feed", "feed_absence", listing.archived_at ?? null);
  if (WITHDRAWN.has(reason)) return result("withdrawn", "listing_status", listing.archived_at ?? null);
  return result("unknown", "listing_status", listing.archived_at ?? null);
}

// Browser entry: trust the server's projection when present; otherwise derive
// from the listing columns the current public-listing-view already returns.
export function readPassportAvailability(row: unknown): PassportAvailability {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const a = r.availability as Partial<PassportAvailability> | undefined;
  const known: ListingDisposition[] = ["available", "sale_pending", "sold", "transferred", "withdrawn", "missing_from_feed", "unknown"];
  if (a && typeof a === "object" && known.includes(a.disposition as ListingDisposition)) {
    return result(a.disposition as ListingDisposition, (a.basis as DispositionBasis) ?? "none", typeof a.as_of === "string" ? a.as_of : null);
  }
  return deriveListingDisposition({
    id: typeof r.id === "string" ? r.id : null,
    status: typeof r.status === "string" ? r.status : null,
    archived_at: typeof r.archived_at === "string" ? r.archived_at : null,
    archive_reason: typeof r.archive_reason === "string" ? r.archive_reason : null,
    published_at: typeof r.published_at === "string" ? r.published_at : null,
  });
}

export interface AvailabilityCopy {
  label: string;
  message: string;
  priceLabel: string;
}

export function availabilityCopy(a: PassportAvailability, dealerName?: string | null): AvailabilityCopy | null {
  const dealer = dealerName?.trim() || "the dealership";
  switch (a.disposition) {
    case "available":
      return null;
    case "sold":
      return { label: "Sold", message: "This vehicle has been sold and is not available for purchase. Its passport stays available as a record.", priceLabel: "Last advertised price" };
    case "sale_pending":
      return { label: "Sale pending", message: "This vehicle has a pending sale and cannot be reserved.", priceLabel: "Last advertised price" };
    case "transferred":
      return { label: "No longer at this dealership", message: `This vehicle is no longer in ${dealer}'s inventory.`, priceLabel: "Last advertised price" };
    default:
      return { label: "No longer listed", message: `This vehicle is no longer in ${dealer}'s advertised inventory. Contact the dealership to ask about it or similar vehicles.`, priceLabel: "Last advertised price" };
  }
}

// Sticky/bottom-bar keys that offer to buy, hold, price or test-drive the car.
export const PURCHASE_ACTION_KEYS = new Set([
  "test_drive", "todays_price", "reserve", "pre_qualified", "apply_financing",
  "check_availability", "payment_options", "calculate_payment",
]);

export const PURCHASE_SECTIONS = new Set(["reserve", "test-drive", "todays-price", "check-availability"]);
