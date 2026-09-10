import { describe, it, expect } from "vitest";
import {
  legacyMarketView, contradictoryVerdicts, renderedClaim, legacyVerdictFor,
  LEGACY_POSITION_TO_VERDICT, LEGACY_POSITIONS, isUsableSubjectPrice,
} from "./surfaceCompat.ts";
import { QX50_LISTING } from "./__fixtures__/qx50.ts";

const QX50_ROW = {
  price: QX50_LISTING.price,
  advertised_price_before_doc: QX50_LISTING.advertisedPriceBeforeDoc,
  website_sale_price: QX50_LISTING.websiteSalePrice,
  doc_fee: QX50_LISTING.docFee,
  advertised_excludes_doc_fee: false,
  market_value: 39158,
  market_position: "above_market",
  market_checked_at: "2026-09-09T08:10:27.352Z",
  market_meta: { similar_count: 8, like_count: 2 },
};

describe("legacyMarketView reproduces today's numbers exactly", () => {
  it("the dealer inventory subtraction is still the fee-inclusive one", () => {
    const v = legacyMarketView(QX50_ROW, "dealer_inventory");
    expect(v.difference).toBe(4718);
    expect(v.displayedTotalPrice).toBe(43876);
    expect(v.vehicleComparisonPrice).toBe(42981);
    expect(v.marketP50).toBe(39158);
  });

  it("a surface that resolved its own price keeps its own answer", () => {
    const v = legacyMarketView(QX50_ROW, "passport", { comparePrice: 42981 });
    expect(v.difference).toBe(3823);
  });

  it("the badge asserts a market standing from an unrecognised position", () => {
    // This is the live defect: any stored string the badge does not know
    // becomes "at market" purely because market_value is non-null.
    const v = legacyMarketView({ ...QX50_ROW, market_position: "something_new" }, "trust_badge");
    expect(v.verdict).toBe("Within Adjusted Market");
    expect(v.confidenceReasons).toContain("badge_asserts_verified_from_non_null_market_value");
  });

  it("uses the real vocabulary when the position is one it knows", () => {
    expect(legacyMarketView(QX50_ROW, "trust_badge").verdict).toBe("High End of Adjusted Market");
    expect(legacyMarketView({ ...QX50_ROW, market_position: "below_market" }, "trust_badge").verdict)
      .toBe("Below Adjusted Market");
  });

  it("the Passport suppresses the claim on a weak basis", () => {
    const v = legacyMarketView({ ...QX50_ROW, market_basis_weak: true }, "passport");
    expect(v.verdict).toBe("Limited Market Evidence");
  });

  it("is unavailable with no stored market value", () => {
    const v = legacyMarketView({ ...QX50_ROW, market_value: null }, "dealer_inventory");
    expect(v.verdict).toBe("Market Estimate Unavailable");
    expect(v.difference).toBeNull();
  });

  it("maps every position production actually holds", () => {
    // Counted read-only on 2026-09-10. below_market and at_market are the two
    // most common values and both were missing from the first draft.
    for (const position of LEGACY_POSITIONS) {
      expect(LEGACY_POSITION_TO_VERDICT[position], position).toBeTruthy();
    }
    expect(LEGACY_POSITION_TO_VERDICT.below_market).toBe("Below Adjusted Market");
    expect(LEGACY_POSITION_TO_VERDICT.at_market).toBe("Within Adjusted Market");
  });

  it("never maps an unknown or unrecognised value to a positive result", () => {
    for (const position of ["unknown", "wat", "", null, undefined, 42]) {
      expect(legacyVerdictFor(position)).toBe("Limited Market Evidence");
    }
  });
});

describe("contradictoryVerdicts measures what surfaces render", () => {
  it("catches the QX50 pointing two ways at once", () => {
    const d = contradictoryVerdicts(QX50_ROW);
    expect(d.surfaces.dealer_inventory.direction).toBe("above");
    expect(d.surfaces.dealer_inventory.amount).toBe(4718);
    // The command centre honours the stored "above_market" string too.
    expect(d.surfaces.command_center.direction).toBe("above");
    // The Passport shows the same car as above value — but by a DIFFERENT
    // amount, because it resolves its own fee-excluded price.
    expect(d.surfaces.passport.direction).toBe("above");
    expect(d.surfaces.passport.amount).toBe(3823);
    expect(d.numericContradiction).toBe(true);
    // TrustStrip renders nothing for above_market, which is silence, not a
    // contradiction.
    expect(d.surfaces.trust_badge.direction).toBe("none");
    expect(d.directionalContradiction).toBe(false);
  });

  it("catches a genuine directional contradiction", () => {
    // Stored position says below market; the arithmetic says the car is priced
    // above it. Two surfaces then point opposite ways about one vehicle.
    const conflicted = { ...QX50_ROW, market_position: "below_market" };
    const d = contradictoryVerdicts(conflicted);
    expect(d.surfaces.dealer_inventory.direction).toBe("below");
    expect(d.surfaces.passport.direction).toBe("above");
    expect(d.directionalContradiction).toBe(true);
    expect(d.contradictory).toBe(true);
  });

  it("does not count silence as disagreement", () => {
    // Stored position and arithmetic agree: the car IS priced below the value.
    // Same resolved price on every surface, and a stored position that agrees
    // with the arithmetic.
    const agreed = {
      ...QX50_ROW, market_value: 50000, market_position: "below_market",
      advertised_price_before_doc: 43876,
    };
    const d = contradictoryVerdicts(agreed);
    expect(d.distinctDirections).toEqual(["below"]);
    expect(d.numericContradiction).toBe(false);
    expect(d.directionalContradiction).toBe(false);
    // TrustStrip and insights say nothing about some cars; that is not a
    // contradiction, and counting it as one is what inflated the first metric.
    expect(Object.values(d.surfaces).some((c) => c.direction === "none")).toBe(false);
  });

  it("catches a stored position that disagrees with its own arithmetic", () => {
    // market_value 50,000 against a 43,876 price is a car priced BELOW the
    // market, still carrying a stored `above_market` string.
    const d = contradictoryVerdicts({ ...QX50_ROW, market_value: 50000 });
    expect(d.surfaces.dealer_inventory.direction).toBe("above");
    expect(d.surfaces.passport.direction).toBe("below");
    expect(d.directionalContradiction).toBe(true);
  });

  it("is not contradictory when there is nothing to disagree about", () => {
    expect(contradictoryVerdicts({ ...QX50_ROW, market_value: null }).contradictory).toBe(false);
  });

  it("catches two surfaces showing different dollar figures", () => {
    const d = contradictoryVerdicts({ ...QX50_ROW, market_position: "below_market" });
    expect(d.numericContradiction).toBe(true);
  });
});

describe("P10 — invalid subject price makes no market claim", () => {
  // The three published rows Gate 13 found.
  const NULL_PRICE = { ...QX50_ROW, price: null, market_value: 104109 };
  const ABSURD_PRICE = { ...QX50_ROW, price: 171, advertised_price_before_doc: 171, website_sale_price: 1066, market_value: 98725 };

  it("the flag is OFF by default and legacy behaviour is preserved exactly", () => {
    const absurd = legacyMarketView(ABSURD_PRICE, "dealer_inventory");
    expect(absurd.difference).toBe(171 - 98725);
    const nullPriced = legacyMarketView(NULL_PRICE, "passport", { comparePrice: 0 });
    expect(nullPriced.difference).toBe(-104109);
  });

  it("a null price produces no dollar claim when suppression is enabled", () => {
    const v = legacyMarketView(NULL_PRICE, "passport", { comparePrice: 0, suppressInvalidClaims: true });
    expect(v.difference).toBeNull();
    expect(v.verdict).toBe("Market Estimate Unavailable");
    expect(v.confidenceReasons).toContain("invalid_subject_price");
  });

  it("a $171 price against a $98,725 market value produces no claim when enabled", () => {
    const v = legacyMarketView(ABSURD_PRICE, "dealer_inventory", { suppressInvalidClaims: true });
    expect(v.difference).toBeNull();
    expect(v.priceToMarketPercent).toBeNull();
    expect(v.confidenceReasons).toContain("invalid_subject_price");
  });

  it("leaves every valid listing untouched when enabled", () => {
    const on = legacyMarketView(QX50_ROW, "dealer_inventory", { suppressInvalidClaims: true });
    const off = legacyMarketView(QX50_ROW, "dealer_inventory");
    expect(on).toEqual(off);
  });

  it("names the floor a subject price must clear", () => {
    expect(isUsableSubjectPrice(null)).toBe(false);
    expect(isUsableSubjectPrice(0)).toBe(false);
    expect(isUsableSubjectPrice(-100)).toBe(false);
    expect(isUsableSubjectPrice(171)).toBe(false);
    expect(isUsableSubjectPrice(500)).toBe(true);
    expect(isUsableSubjectPrice(43876)).toBe(true);
  });

  it("suppresses on every surface, not just one", () => {
    for (const surface of ["dealer_inventory", "command_center", "trust_badge", "passport", "insights"] as const) {
      const claim = renderedClaim(ABSURD_PRICE, surface, { suppressInvalidClaims: true });
      expect(claim.direction, surface).toBe("none");
    }
  });
});
