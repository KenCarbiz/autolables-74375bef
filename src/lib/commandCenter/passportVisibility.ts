import type { Tone } from "@/components/command/CommandPrimitives";

// ──────────────────────────────────────────────────────────────────────
// The single source of truth for "is a real shopper on a real URL served this
// exact artifact". Every count, pill, preview row and href on the Documents &
// Print Center is derived from it, so they cannot answer a compliance question
// two different ways inside one card.
//
// The customer's URL comes first. Both anon entry points —
// get_vehicle_listing_by_slug (20260625210623:6-8) and the public-listing-view
// function that wraps it — require `vehicle_listings.status = 'published'`, and
// without a slug there is no address at all. A used car still in get-ready has
// no shopper, whatever its documents say.
//
// The document comes second. The passport reads generated_documents through
// get_published_documents_public (20260620232625:53-63) and its only document
// predicate is `gd.document_status = 'published'`. `approved` and `printed` are
// internal lifecycle states no shopper ever sees.
//
// Both halves matter, and BOTH used to be answered wrongly:
// 20260724010000_autopublish_k208_on_signoff flips the K-208 to `published` the
// instant service signs, with no listing condition — so asking only about the
// document reported "Customer Visible" for a car whose /v/:slug 404s.
//
// packet_modules is deliberately NOT part of this answer. That curation layer is
// enforced by public-listing-view (:686-711) over `vehicle_listings.documents` —
// the dealer-uploaded JSONB — and get_published_documents_public applies no
// module filter to generated_documents at all. Claiming "Hidden" for a published
// generated document was the mirror image of the same mistake: the dealer was
// told the shopper could not see a document the RPC serves.
// ──────────────────────────────────────────────────────────────────────

export type PassportVisibilityState =
  | "customer_visible"
  | "vehicle_unpublished"
  | "internal_only"
  | "not_in_passport";

export interface PassportDocument {
  document_status?: string | null;
  document_type?: string | null;
}

export interface PassportVehicle {
  slug?: string | null;
  status?: string | null;
}

/** Is there a customer URL for this vehicle at all? */
export const passportServesVehicle = (v: PassportVehicle | null | undefined): boolean =>
  !!v && !!v.slug && String(v.status || "") === "published";

/** The one document predicate. `published` is the only status the RPC returns. */
export const passportServesDocument = (d: PassportDocument): boolean =>
  String(d.document_status || "") === "published";

/** The public address of the passport, or null when it has none. */
export const passportHrefFor = (v: PassportVehicle | null | undefined): string | null =>
  passportServesVehicle(v) ? `/v/${v?.slug}` : null;

export function passportVisibilityState(
  d: PassportDocument,
  vehicle: PassportVehicle | null | undefined,
): PassportVisibilityState {
  if (!passportServesDocument(d)) return "internal_only";
  return passportServesVehicle(vehicle) ? "customer_visible" : "vehicle_unpublished";
}

export const isCustomerVisible = (s: PassportVisibilityState): boolean =>
  s === "customer_visible";

/**
 * A row the passport has no way to serve — a QR cling is media pointing AT the
 * packet, not a document served IN it, and get_published_documents_public reads
 * generated_documents only. Counting one as "Customer Visible" put a document
 * that does not exist into the compliance count and into Passport Preview.
 */
export const NOT_IN_PASSPORT: PassportVisibilityState = "not_in_passport";

export const PASSPORT_VISIBILITY_PILL: Record<PassportVisibilityState, { label: string; tone: Tone }> = {
  customer_visible: { label: "Customer Visible", tone: "blue" },
  vehicle_unpublished: { label: "Vehicle Not Published", tone: "amber" },
  internal_only: { label: "Internal Only", tone: "violet" },
  not_in_passport: { label: "Not in Passport", tone: "slate" },
};
