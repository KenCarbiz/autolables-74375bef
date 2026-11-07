import { describe, expect, it } from "vitest";
import { availabilityCopy, deriveListingDisposition, readPassportAvailability } from "./listingDisposition";

const live = { status: "published", archived_at: null, archive_reason: null, published_at: "2026-10-01T00:00:00Z" };
const leftFeed = { status: "archived", archived_at: "2026-10-20T00:00:00Z", archive_reason: "left_feed", published_at: "2026-09-01T00:00:00Z" };

describe("deriveListingDisposition", () => {
  it("a live listing with no other evidence is available", () => {
    expect(deriveListingDisposition(live)).toMatchObject({ disposition: "available", purchasable: true, price_status: "current_offer" });
  });

  it("archived alone is never sold: left_feed reads missing_from_feed", () => {
    const a = deriveListingDisposition(leftFeed);
    expect(a).toMatchObject({ disposition: "missing_from_feed", basis: "feed_absence", purchasable: false, price_status: "last_advertised" });
  });

  it("distinguishes withdrawn and unknown archive reasons", () => {
    expect(deriveListingDisposition({ ...leftFeed, archive_reason: "duplicate_reconciled" }).disposition).toBe("withdrawn");
    expect(deriveListingDisposition({ ...leftFeed, archive_reason: null }).disposition).toBe("unknown");
    expect(deriveListingDisposition({ ...leftFeed, archive_reason: "something_new" }).disposition).toBe("unknown");
  });

  const L = "11111111-1111-4111-8111-111111111111";
  const liveL = { ...live, id: L };
  const leftFeedL = { ...leftFeed, id: L };
  const thisStay = (state: string) => ({ custody_state: state, listing_id: L, occurred_at: "2026-10-19T00:00:00Z" });

  it("custody milestones bound to this stay decide sold, pending and transferred, even over a stale live listing", () => {
    expect(deriveListingDisposition(leftFeedL, thisStay("delivered"))).toMatchObject({ disposition: "sold", basis: "custody_milestone", purchasable: false });
    expect(deriveListingDisposition(liveL, { ...thisStay("delivered"), occurred_at: "2026-10-30T00:00:00Z" }).disposition).toBe("sold");
    expect(deriveListingDisposition(leftFeedL, thisStay("sold")).disposition).toBe("sale_pending");
    expect(deriveListingDisposition(leftFeedL, thisStay("awaiting_delivery")).disposition).toBe("sale_pending");
    expect(deriveListingDisposition(leftFeedL, thisStay("transferred_out")).disposition).toBe("transferred");
  });

  it("a delivery from an earlier stay of the same listing row is ambiguous, not sold", () => {
    const earlier = { custody_state: "delivered", listing_id: L, occurred_at: "2026-08-01T00:00:00Z" };
    expect(deriveListingDisposition(leftFeedL, earlier)).toMatchObject({ disposition: "unknown", basis: "ambiguous_sale_evidence", purchasable: false });
    expect(deriveListingDisposition(liveL, earlier)).toMatchObject({ disposition: "unknown", purchasable: false });
    expect(availabilityCopy(deriveListingDisposition(leftFeedL, earlier))?.label).toBe("No longer listed");
  });

  it("sale evidence that cannot be tied to this listing is ambiguous", () => {
    expect(deriveListingDisposition(leftFeedL, { ...thisStay("delivered"), listing_id: null }).basis).toBe("ambiguous_sale_evidence");
    expect(deriveListingDisposition(leftFeedL, { ...thisStay("delivered"), listing_id: "22222222-2222-4222-8222-222222222222" }).disposition).toBe("unknown");
    expect(deriveListingDisposition(leftFeedL, { ...thisStay("delivered"), occurred_at: null }).disposition).toBe("unknown");
    expect(deriveListingDisposition({ ...leftFeedL, published_at: null }, thisStay("delivered")).disposition).toBe("unknown");
    expect(deriveListingDisposition(leftFeed, thisStay("delivered")).disposition).toBe("unknown");
  });

  it("a reacquired car in stock reads from the listing columns", () => {
    expect(deriveListingDisposition(leftFeedL, { custody_state: "in_stock", listing_id: L }).disposition).toBe("missing_from_feed");
    expect(deriveListingDisposition(liveL, { custody_state: "in_stock", listing_id: L }).disposition).toBe("available");
  });

  it("drafts are not available", () => {
    expect(deriveListingDisposition({ status: "draft" }).purchasable).toBe(false);
  });
});

describe("readPassportAvailability", () => {
  it("uses the server projection when present", () => {
    expect(readPassportAvailability({ ...live, availability: { disposition: "sold", basis: "custody_milestone", as_of: "2026-10-30" } }))
      .toMatchObject({ disposition: "sold", purchasable: false });
  });
  it("falls back to the listing columns the current server already returns", () => {
    expect(readPassportAvailability(leftFeed).disposition).toBe("missing_from_feed");
    expect(readPassportAvailability(live).purchasable).toBe(true);
  });
  it("ignores an unrecognised projection", () => {
    expect(readPassportAvailability({ ...leftFeed, availability: { disposition: "maybe" } }).disposition).toBe("missing_from_feed");
  });
});

describe("availabilityCopy", () => {
  it("never claims a sale without sale evidence", () => {
    const copy = availabilityCopy(deriveListingDisposition(leftFeed), "Synthetic Demo Motors");
    expect(copy?.label).toBe("No longer listed");
    expect(copy?.message).not.toMatch(/sold/i);
  });
  it("is null for an available car", () => {
    expect(availabilityCopy(deriveListingDisposition(live))).toBeNull();
  });
});
