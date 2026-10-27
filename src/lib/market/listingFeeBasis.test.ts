import { describe, it, expect } from "vitest";
import { corroborateTenantFeeSetting, parseFees, resolveListingFeeBasis } from "./listingFeeBasis.ts";

describe("unknown stays unknown", () => {
  it("has no comparison price and no range when the feed says nothing about fees", () => {
    const b = resolveListingFeeBasis({ price: 30_000 });
    expect(b.normalizedComparisonPrice).toBeNull();
    expect(b.range).toBeNull();
    expect(b.identifiedFees).toBeNull();
    expect(b.basisStatus).toBe("unknown");
    expect(b.reasons).toContain("no_fee_evidence");
  });

  it("never substitutes zero for an excluded-but-unstated fee", () => {
    const b = resolveListingFeeBasis({ price: 30_000, price_includes_fees: false });
    expect(b.priceIncludesFees).toBe("excluded");
    expect(b.identifiedFees).toBeNull();
    expect(b.normalizedComparisonPrice).toBeNull();
    expect(b.basisStatus).toBe("ambiguous");
    expect(b.reasons).toContain("fees_excluded_amount_unknown");
  });

  it("gives a range, not a number, when the amount is known but inclusion is not", () => {
    const b = resolveListingFeeBasis({ price: 30_000, fees: 895 });
    expect(b.normalizedComparisonPrice).toBeNull();
    expect(b.range).toEqual({ low: 30_000, high: 30_895 });
    expect(b.basisStatus).toBe("ambiguous");
  });

  it("has nothing to say without an advertised price", () => {
    const b = resolveListingFeeBasis({ fees: 895, price_includes_fees: false });
    expect(b.advertisedPrice).toBeNull();
    expect(b.basisStatus).toBe("unknown");
    expect(b.reasons).toContain("advertised_price_missing");
  });
});

describe("verified bases", () => {
  it("uses the advertised price as-is when fees are included", () => {
    const b = resolveListingFeeBasis({ price: 30_000, fees: 895, price_includes_fees: true });
    expect(b.normalizedComparisonPrice).toBe(30_000);
    expect(b.basisStatus).toBe("verified");
  });

  it("adds identified fees when the price excludes them (the handoff's worked example)", () => {
    const b = resolveListingFeeBasis({ price: 39_995, fees: 2_995, price_includes_fees: false });
    expect(b.normalizedComparisonPrice).toBe(42_990);
    expect(b.basisStatus).toBe("verified");
    expect(b.reasons).toContain("fees_excluded_and_identified");
  });

  it("accepts the feed's boolean spellings", () => {
    expect(resolveListingFeeBasis({ price: 1_000, price_includes_fees: "true" }).priceIncludesFees).toBe("included");
    expect(resolveListingFeeBasis({ price: 1_000, price_includes_fees: 0 }).priceIncludesFees).toBe("excluded");
    expect(resolveListingFeeBasis({ price: 1_000, price_includes_fees: "maybe" }).priceIncludesFees).toBe("unknown");
  });
});

describe("fee shapes", () => {
  it("reads a number, a money string, an item list and a map, and records which", () => {
    expect(parseFees(895)).toMatchObject({ total: 895, shape: "number" });
    expect(parseFees("$1,295")).toMatchObject({ total: 1_295, shape: "string" });
    expect(parseFees([{ name: "Doc", amount: 499 }, { type: "Dealer prep", value: "$1,500" }]))
      .toMatchObject({ total: 1_999, shape: "items" });
    expect(parseFees({ doc_fee: 499, reconditioning: 995 })).toMatchObject({ total: 1_494, shape: "map" });
  });

  it("does not invent an amount from an unrecognised shape", () => {
    const parsed = parseFees("call for details");
    expect(parsed.total).toBeNull();
    expect(parsed.shape).toBe("unrecognised");
    const b = resolveListingFeeBasis({ price: 20_000, fees: "call for details", price_includes_fees: false });
    expect(b.normalizedComparisonPrice).toBeNull();
    expect(b.reasons).toContain("fees_shape_unrecognised");
  });

  it("treats an empty list as no evidence, not as zero fees", () => {
    expect(parseFees([])).toMatchObject({ total: null });
    expect(resolveListingFeeBasis({ price: 20_000, fees: [] }).basisStatus).toBe("unknown");
  });

  it("rejects a negative fee", () => {
    expect(parseFees(-5).total).toBeNull();
  });
});

describe("corroborating the tenant setting", () => {
  it("agrees, conflicts, or has nothing to say", () => {
    const included = resolveListingFeeBasis({ price: 1, price_includes_fees: true });
    const excluded = resolveListingFeeBasis({ price: 1, price_includes_fees: false });
    const silent = resolveListingFeeBasis({ price: 1 });
    expect(corroborateTenantFeeSetting(included, true)).toBe("agrees");
    expect(corroborateTenantFeeSetting(included, false)).toBe("conflicts");
    expect(corroborateTenantFeeSetting(excluded, false)).toBe("agrees");
    expect(corroborateTenantFeeSetting(silent, true)).toBe("no_listing_evidence");
    expect(corroborateTenantFeeSetting(included, null)).toBe("no_listing_evidence");
  });
});
