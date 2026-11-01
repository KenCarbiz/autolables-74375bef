// Customer-facing availability of a Passport listing.
//
// "Archived" only means the listing left advertised inventory. It is never
// read as a sale on its own: a sale needs a recorded custody milestone or a
// dealer deal record. Pure module, imported by public-listing-view (Deno) and
// by the Passport (browser).

export type ListingDisposition =
  | "available"
  | "sale_pending"
  | "sold"
  | "transferred"
  | "withdrawn"
  | "missing_from_feed"
  | "unknown";

export type DispositionBasis = "custody_milestone" | "deal_record" | "listing_status" | "feed_absence" | "none";

export interface DispositionListingInput {
  status?: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
  published_at?: string | null;
}

export interface CustodyEvidence {
  custody_state?: string | null;
  changed_at?: string | null;
}

export interface DealEvidence {
  deal_status?: string | null;
  updated_at?: string | null;
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

const isArchived = (l: DispositionListingInput) => l.status === "archived" || !!l.archived_at;

const result = (disposition: ListingDisposition, basis: DispositionBasis, as_of: string | null): PassportAvailability => ({
  disposition,
  basis,
  purchasable: disposition === "available",
  price_status: disposition === "available" ? "current_offer" : "last_advertised",
  as_of,
});

export function deriveListingDisposition(
  listing: DispositionListingInput,
  custody: CustodyEvidence | null = null,
  deal: DealEvidence | null = null,
): PassportAvailability {
  const state = custody?.custody_state ?? null;
  if (state === "delivered") return result("sold", "custody_milestone", custody?.changed_at ?? null);
  if (state === "sold" || state === "awaiting_delivery") return result("sale_pending", "custody_milestone", custody?.changed_at ?? null);
  if (state === "transferred_out") return result("transferred", "custody_milestone", custody?.changed_at ?? null);

  // vehicle_files is one row per tenant+VIN forever and its updated_at moves on
  // any edit, so it cannot date a deal: a delivery from an earlier stay of the
  // same car would mark a relisted car sold. The deal record therefore only
  // explains a listing that has already left advertised inventory.
  const dealStatus = deal?.deal_status ?? null;
  const dealCounts = state !== "in_stock" && isArchived(listing);
  if (dealCounts && dealStatus === "delivered") return result("sold", "deal_record", deal?.updated_at ?? null);
  if (dealCounts && dealStatus === "signed") return result("sale_pending", "deal_record", deal?.updated_at ?? null);

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
