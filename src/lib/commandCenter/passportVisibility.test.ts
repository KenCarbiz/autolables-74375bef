import { describe, it, expect } from "vitest";
import {
  isCustomerVisible,
  passportHrefFor,
  passportServesDocument,
  passportServesVehicle,
  passportVisibilityState,
  PASSPORT_VISIBILITY_PILL,
} from "./passportVisibility";

const publishedVehicle = { slug: "2025-infiniti-qx80-300001", status: "published" };
const draftVehicle = { slug: "2025-infiniti-qx80-300001", status: "draft" };
const noSlug = { slug: null, status: "published" };

describe("passportServesDocument", () => {
  // The passport RPC's only document predicate is
  // `gd.document_status = 'published'` (20260620232625:53-63); approved and
  // printed are internal lifecycle states no shopper ever sees.
  it("serves published documents only", () => {
    expect(passportServesDocument({ document_status: "published" })).toBe(true);
  });

  it("does not serve approved, printed, draft, rejected or retired paper", () => {
    for (const s of ["draft", "in_review", "pending_approval", "approved", "printed", "rejected", "superseded", "archived", ""]) {
      expect(passportServesDocument({ document_status: s })).toBe(false);
    }
    expect(passportServesDocument({})).toBe(false);
  });
});

describe("passportServesVehicle", () => {
  // Both anon entry points require status='published'
  // (get_vehicle_listing_by_slug, 20260625210623:6-8), and without a slug there
  // is no address at all.
  it("needs a published listing AND a slug", () => {
    expect(passportServesVehicle(publishedVehicle)).toBe(true);
    expect(passportServesVehicle(draftVehicle)).toBe(false);
    expect(passportServesVehicle(noSlug)).toBe(false);
    expect(passportServesVehicle(null)).toBe(false);
  });

  it("is the same fact the Open Passport link is built from", () => {
    expect(passportHrefFor(publishedVehicle)).toBe("/v/2025-infiniti-qx80-300001");
    expect(passportHrefFor(draftVehicle)).toBeNull();
    expect(passportHrefFor(noSlug)).toBeNull();
  });
});

describe("passportVisibilityState", () => {
  const publishedDoc = { document_status: "published", document_type: "k208" };

  it("is Customer Visible only when a shopper can open both the vehicle and the document", () => {
    expect(passportVisibilityState(publishedDoc, publishedVehicle)).toBe("customer_visible");
    expect(isCustomerVisible(passportVisibilityState(publishedDoc, publishedVehicle))).toBe(true);
  });

  // THE common case: 20260724010000_autopublish_k208_on_signoff flips the K-208
  // to published the instant service signs, with no listing condition. Answering
  // from the document alone said "Customer Visible" for a used car still in
  // get-ready, whose /v/:slug 404s and whose own card footer read "This vehicle
  // has no published Passport yet".
  it("does not call a published document visible on a vehicle with no public URL", () => {
    expect(passportVisibilityState(publishedDoc, draftVehicle)).toBe("vehicle_unpublished");
    expect(passportVisibilityState(publishedDoc, noSlug)).toBe("vehicle_unpublished");
    expect(isCustomerVisible(passportVisibilityState(publishedDoc, draftVehicle))).toBe(false);
  });

  it("agrees with the passport href on the same vehicle, in both directions", () => {
    for (const vehicle of [publishedVehicle, draftVehicle, noSlug]) {
      const visible = isCustomerVisible(passportVisibilityState(publishedDoc, vehicle));
      expect(visible).toBe(passportHrefFor(vehicle) !== null);
    }
  });

  it("an unpublished document is Internal Only whatever the vehicle is doing", () => {
    expect(passportVisibilityState({ document_status: "approved" }, publishedVehicle)).toBe("internal_only");
    expect(passportVisibilityState({ document_status: "approved" }, draftVehicle)).toBe("internal_only");
  });

  // P3: packet_modules curates vehicle_listings.documents (public-listing-view
  // :686-711), NOT generated_documents — get_published_documents_public applies
  // no module filter at all, and neither does any consumer of it. Claiming
  // "Hidden" told the dealer a shopper could not see a document the RPC serves.
  it("does not depend on packet curation, which no generated-document path applies", () => {
    expect(Object.keys(PASSPORT_VISIBILITY_PILL)).not.toContain("hidden");
  });
});

describe("PASSPORT_VISIBILITY_PILL", () => {
  it("labels every state, and only one of them reads Customer Visible", () => {
    expect(PASSPORT_VISIBILITY_PILL.customer_visible.label).toBe("Customer Visible");
    expect(PASSPORT_VISIBILITY_PILL.vehicle_unpublished.label).toBe("Vehicle Not Published");
    expect(PASSPORT_VISIBILITY_PILL.internal_only.label).toBe("Internal Only");
    // A QR cling is media pointing AT the packet; the passport RPC reads
    // generated_documents only, so no QR row is ever served in a Passport.
    expect(PASSPORT_VISIBILITY_PILL.not_in_passport.label).toBe("Not in Passport");
  });
});
