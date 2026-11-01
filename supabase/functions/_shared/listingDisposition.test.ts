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

  it("custody milestones decide sold, pending and transferred, even over a stale live listing", () => {
    expect(deriveListingDisposition(live, { custody_state: "delivered" })).toMatchObject({ disposition: "sold", basis: "custody_milestone", purchasable: false });
    expect(deriveListingDisposition(live, { custody_state: "sold" }).disposition).toBe("sale_pending");
    expect(deriveListingDisposition(live, { custody_state: "awaiting_delivery" }).disposition).toBe("sale_pending");
    expect(deriveListingDisposition(leftFeed, { custody_state: "transferred_out" }).disposition).toBe("transferred");
  });

  it("a deal record explains an archived listing only", () => {
    expect(deriveListingDisposition(leftFeed, null, { deal_status: "delivered" })).toMatchObject({ disposition: "sold", basis: "deal_record" });
    expect(deriveListingDisposition(leftFeed, null, { deal_status: "signed" }).disposition).toBe("sale_pending");
    expect(deriveListingDisposition(live, null, { deal_status: "delivered", updated_at: "2026-10-30T00:00:00Z" }).disposition).toBe("available");
    expect(deriveListingDisposition(leftFeed, null, { deal_status: "unwound" }).disposition).toBe("missing_from_feed");
  });

  it("a reacquired car in stock is not sold by an old deal record", () => {
    expect(deriveListingDisposition(leftFeed, { custody_state: "in_stock" }, { deal_status: "delivered" }).disposition).toBe("missing_from_feed");
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
