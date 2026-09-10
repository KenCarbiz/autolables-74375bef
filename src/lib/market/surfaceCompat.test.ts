import { describe, it, expect } from "vitest";
import { legacyMarketView, contradictoryVerdicts, LEGACY_POSITION_TO_VERDICT } from "./surfaceCompat.ts";
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

  it("the badge asserts within-market from the mere presence of a market value", () => {
    const v = legacyMarketView(QX50_ROW, "trust_badge");
    expect(v.verdict).toBe("Within Adjusted Market");
    expect(v.confidenceReasons).toContain("badge_asserts_verified_from_non_null_market_value");
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

  it("maps every stored position to the unified vocabulary", () => {
    for (const position of ["great_deal", "good_deal", "fair_deal", "above_market", "unknown"]) {
      expect(LEGACY_POSITION_TO_VERDICT[position]).toBeTruthy();
    }
  });
});

describe("contradictoryVerdicts", () => {
  it("catches the QX50 saying three things at once", () => {
    const d = contradictoryVerdicts(QX50_ROW);
    expect(d.contradictory).toBe(true);
    expect(d.surfaces.dealer_inventory).toBe("High End of Adjusted Market");
    expect(d.surfaces.trust_badge).toBe("Within Adjusted Market");
  });

  it("is not contradictory when there is nothing to disagree about", () => {
    expect(contradictoryVerdicts({ ...QX50_ROW, market_value: null }).contradictory).toBe(false);
  });
});
