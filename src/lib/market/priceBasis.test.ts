import { describe, it, expect } from "vitest";
import { resolvePriceBasis, resolveComparableBasePrice } from "./priceBasis.ts";

// The live Harte QX50 row, copied from production on 2026-09-10.
const QX50 = {
  price: 43876,
  advertisedPriceBeforeDoc: 42981,
  websiteSalePrice: 43876,
  docFee: 895,
  advertisedExcludesDocFee: false,
  mandatoryDealerAddOns: 0,
};

describe("resolvePriceBasis — fee-inclusive tenant (every Harte store)", () => {
  it("separates the customer total from the vehicle price", () => {
    const b = resolvePriceBasis(QX50);
    expect(b.displayedTotalPrice).toBe(43876);
    expect(b.vehicleComparisonPrice).toBe(42981);
    expect(b.docFee).toBe(895);
    expect(b.basisStatus).toBe("verified");
    expect(b.advertisedIncludesDocFee).toBe(true);
    expect(b.governmentFeesIncluded).toBe(false);
  });

  it("never adds the fee twice", () => {
    const b = resolvePriceBasis(QX50);
    expect(b.vehicleComparisonPrice! + b.docFee!).toBe(b.displayedTotalPrice);
    expect(b.displayedTotalPrice).not.toBe(43876 + 895);
  });
});

describe("resolvePriceBasis — fee-exclusive tenant", () => {
  it("builds the customer total additively", () => {
    const b = resolvePriceBasis({
      price: 30000, advertisedPriceBeforeDoc: 30000, websiteSalePrice: 30876,
      docFee: 876, advertisedExcludesDocFee: true, mandatoryDealerAddOns: 0,
    });
    expect(b.vehicleComparisonPrice).toBe(30000);
    expect(b.displayedTotalPrice).toBe(30876);
    expect(b.basisStatus).toBe("verified");
    expect(b.advertisedIncludesDocFee).toBe(false);
  });
});

describe("resolvePriceBasis — inference and ambiguity", () => {
  it("infers a fee-inclusive price when the stored numbers reconcile", () => {
    const b = resolvePriceBasis({ price: 43876, advertisedPriceBeforeDoc: 42981, docFee: 895, mandatoryDealerAddOns: 0 });
    expect(b.advertisedIncludesDocFee).toBe(true);
    expect(b.basisStatus).toBe("verified");
    expect(b.basisReasons).toContain("fee_treatment_inferred_from_stored_prices");
  });

  it("infers a fee-exclusive price when advertised equals the price column", () => {
    const b = resolvePriceBasis({ price: 30000, advertisedPriceBeforeDoc: 30000, docFee: 876, mandatoryDealerAddOns: 0 });
    expect(b.advertisedIncludesDocFee).toBe(false);
  });

  it("is ambiguous when the doc fee is unknown", () => {
    const b = resolvePriceBasis({ price: 43876, advertisedPriceBeforeDoc: 42981 });
    expect(b.basisStatus).toBe("ambiguous");
    expect(b.basisReasons).toContain("doc_fee_unknown");
  });

  it("treats a configured zero fee as a verified no-fee price", () => {
    const b = resolvePriceBasis({ price: 25000, docFee: 0, mandatoryDealerAddOns: 0 });
    expect(b.basisStatus).toBe("verified");
    expect(b.vehicleComparisonPrice).toBe(25000);
    expect(b.displayedTotalPrice).toBe(25000);
  });
});

describe("resolvePriceBasis — invalid", () => {
  it("rejects a basis whose fee identity does not close", () => {
    const b = resolvePriceBasis({
      price: 43876, advertisedPriceBeforeDoc: 41000, docFee: 895, advertisedExcludesDocFee: false,
    });
    expect(b.basisStatus).toBe("invalid");
    expect(b.vehicleComparisonPrice).toBeNull();
    expect(b.basisReasons.some((r) => r.startsWith("price_identity_failed"))).toBe(true);
  });

  it("rejects a missing or implausible price", () => {
    expect(resolvePriceBasis({}).basisStatus).toBe("invalid");
    expect(resolvePriceBasis({ price: 0, docFee: 0, mandatoryDealerAddOns: 0 }).basisStatus).toBe("invalid");
    expect(resolvePriceBasis({ price: -5000, docFee: 0, mandatoryDealerAddOns: 0 }).basisStatus).toBe("invalid");
  });

  it("tolerates a one-dollar rounding difference and no more", () => {
    const ok = resolvePriceBasis({ price: 43876, advertisedPriceBeforeDoc: 42980, docFee: 895, advertisedExcludesDocFee: false, mandatoryDealerAddOns: 0 });
    expect(ok.basisStatus).toBe("verified");
    const bad = resolvePriceBasis({ price: 43876, advertisedPriceBeforeDoc: 42978, docFee: 895, advertisedExcludesDocFee: false, mandatoryDealerAddOns: 0 });
    expect(bad.basisStatus).toBe("invalid");
  });
});

describe("resolvePriceBasis — conditional money and mandatory add-ons", () => {
  it("adds a conditional rebate back so it cannot lower the comparison price", () => {
    const b = resolvePriceBasis({ ...QX50, conditionalDiscounts: 1000 });
    expect(b.vehicleComparisonPrice).toBe(43981);
    expect(b.conditionalDiscountsExcluded).toBe(1000);
    expect(b.displayedTotalPrice).toBe(43876);
    // The identity still closes on the advertised leg.
    expect(b.advertisedPriceBeforeDoc! + b.docFee!).toBe(b.displayedTotalPrice);
  });

  it("discloses mandatory add-ons without folding them into the vehicle price", () => {
    const b = resolvePriceBasis({ ...QX50, price: 45371, websiteSalePrice: 45371, mandatoryDealerAddOns: 1495 });
    expect(b.mandatoryDealerAddOns).toBe(1495);
    expect(b.vehicleComparisonPrice).toBe(42981);
    expect(b.displayedTotalPrice).toBe(45371);
    expect(b.basisStatus).toBe("verified");
    expect(b.basisReasons).toContain("mandatory_add_ons_disclosed_1495");
    // displayed = comparison − conditional + fee + mandatory
    expect(b.vehicleComparisonPrice! - 0 + b.docFee! + b.mandatoryDealerAddOns!).toBe(b.displayedTotalPrice);
  });
});

describe("resolveComparableBasePrice", () => {
  it("marks an unknown competitor fee treatment as unknown, not as excluded", () => {
    const c = resolveComparableBasePrice({ advertisedPrice: 38431 });
    expect(c.normalizedVehiclePrice).toBe(38431);
    expect(c.priceBasisStatus).toBe("unknown");
    expect(c.reasons).toContain("competitor_doc_fee_treatment_unknown");
  });

  it("removes a known included fee", () => {
    const c = resolveComparableBasePrice({ advertisedPrice: 39326, docFeeIncluded: true, docFee: 895 });
    expect(c.normalizedVehiclePrice).toBe(38431);
    expect(c.priceBasisStatus).toBe("verified");
  });

  it("keeps a known fee-exclusive price unchanged", () => {
    const c = resolveComparableBasePrice({ advertisedPrice: 38431, docFeeIncluded: false });
    expect(c.normalizedVehiclePrice).toBe(38431);
    expect(c.priceBasisStatus).toBe("verified");
  });

  it("adds conditional money back for competitors too", () => {
    const c = resolveComparableBasePrice({ advertisedPrice: 38431, docFeeIncluded: false, conditionalDiscounts: 2000 });
    expect(c.normalizedVehiclePrice).toBe(40431);
  });

  it("rejects an unusable price", () => {
    expect(resolveComparableBasePrice({ advertisedPrice: null }).priceBasisStatus).toBe("invalid");
    expect(resolveComparableBasePrice({ advertisedPrice: 1 }).priceBasisStatus).toBe("invalid");
  });
});

describe("the complete price identity", () => {
  // displayed = comparison − conditional + fee + mandatory
  const identityHolds = (b: ReturnType<typeof resolvePriceBasis>, conditional: number) =>
    b.vehicleComparisonPrice! - conditional + (b.docFee ?? 0) + (b.mandatoryDealerAddOns ?? 0);

  it("holds for the QX50 with both extra terms at zero", () => {
    const b = resolvePriceBasis(QX50);
    expect(b.displayedTotalPrice).toBe(43876);
    expect(b.vehicleComparisonPrice).toBe(42981);
    expect(b.conditionalDiscountsExcluded).toBeNull();
    expect(b.docFee).toBe(895);
    expect(b.mandatoryDealerAddOns).toBe(0);
    expect(b.basisStatus).toBe("verified");
    expect(identityHolds(b, 0)).toBe(43876);
  });

  it("holds with a conditional finance discount", () => {
    const b = resolvePriceBasis({ ...QX50, conditionalDiscounts: 1500 });
    expect(b.vehicleComparisonPrice).toBe(44481);
    expect(b.displayedTotalPrice).toBe(43876);
    expect(identityHolds(b, 1500)).toBe(43876);
  });

  it("holds with a loyalty discount", () => {
    const b = resolvePriceBasis({ ...QX50, conditionalDiscounts: 750 });
    expect(b.vehicleComparisonPrice).toBe(43731);
    expect(identityHolds(b, 750)).toBe(43876);
  });

  it("holds with trade assistance", () => {
    const b = resolvePriceBasis({ ...QX50, conditionalDiscounts: 2000 });
    expect(b.vehicleComparisonPrice).toBe(44981);
    expect(identityHolds(b, 2000)).toBe(43876);
  });

  it("never lets conditional money lower the comparison price", () => {
    const plain = resolvePriceBasis(QX50).vehicleComparisonPrice!;
    for (const amount of [1, 500, 1500, 5000]) {
      const withDiscount = resolvePriceBasis({ ...QX50, conditionalDiscounts: amount });
      expect(withDiscount.vehicleComparisonPrice!).toBeGreaterThan(plain);
    }
  });

  it("holds with a mandatory add-on inside the customer total", () => {
    const b = resolvePriceBasis({
      ...QX50, price: 45371, websiteSalePrice: 45371, mandatoryDealerAddOns: 1495,
    });
    expect(b.displayedTotalPrice).toBe(45371);
    expect(b.vehicleComparisonPrice).toBe(42981);
    expect(b.mandatoryDealerAddOns).toBe(1495);
    expect(b.basisStatus).toBe("verified");
    expect(identityHolds(b, 0)).toBe(45371);
  });

  it("holds with a conditional discount and a mandatory add-on together", () => {
    const b = resolvePriceBasis({
      ...QX50, price: 45371, websiteSalePrice: 45371,
      mandatoryDealerAddOns: 1495, conditionalDiscounts: 1000,
    });
    expect(b.vehicleComparisonPrice).toBe(43981);
    expect(identityHolds(b, 1000)).toBe(45371);
  });

  it("never hides a mandatory add-on", () => {
    const b = resolvePriceBasis({ ...QX50, price: 45371, websiteSalePrice: 45371, mandatoryDealerAddOns: 1495 });
    expect(b.mandatoryDealerAddOns).toBe(1495);
    expect(b.basisReasons).toContain("mandatory_add_ons_disclosed_1495");
  });

  it("treats an unanswered add-on question as ambiguous, not as zero", () => {
    const { mandatoryDealerAddOns: _omitted, ...withoutAnswer } = QX50;
    const b = resolvePriceBasis(withoutAnswer);
    expect(b.basisStatus).toBe("ambiguous");
    expect(b.basisReasons).toContain("mandatory_add_on_treatment_unknown");
    expect(b.mandatoryDealerAddOns).toBeNull();
    // Still produces a comparison price — it is unusable for red, not unusable.
    expect(b.vehicleComparisonPrice).toBe(42981);
  });

  it("rejects an identity that does not close once the add-on is counted", () => {
    const b = resolvePriceBasis({ ...QX50, mandatoryDealerAddOns: 1495 });
    expect(b.basisStatus).toBe("invalid");
    expect(b.basisReasons.some((r) => r.startsWith("price_identity_failed"))).toBe(true);
  });
});

// ── Mandatory dealer add-ons: two questions, both of which can be unanswered ─
//
// Harte is the live case. Six vehicles carry priced installed items on a DRAFT
// addendum, and on every one of them `price − advertised − doc_fee` is exactly
// 0.00 — the money is not inside the displayed price. A tenant-wide zero would
// be factually wrong; folding the amount into the advertised price would
// restate a published number. Both are refused here.
describe("mandatory add-ons — scope resolution", () => {
  const noAnswer = (() => { const { mandatoryDealerAddOns: _o, ...rest } = QX50; return rest; })();

  it("takes a verified per-vehicle zero as a real answer", () => {
    const b = resolvePriceBasis({
      ...noAnswer,
      vehicleMandatoryAddOns: { amountUsd: 0, verified: true },
    });
    expect(b.mandatoryDealerAddOns).toBe(0);
    expect(b.mandatoryAddOnSource).toBe("vehicle");
    expect(b.basisStatus).toBe("verified");
    expect(b.totalWithMandatoryAddOns).toBe(43876);
  });

  it("takes a verified per-vehicle non-zero answer", () => {
    const b = resolvePriceBasis({
      ...noAnswer, price: 45371, websiteSalePrice: 45371,
      vehicleMandatoryAddOns: { amountUsd: 1495, verified: true, includedInDisplayedPrice: true },
    });
    expect(b.mandatoryDealerAddOns).toBe(1495);
    expect(b.mandatoryAddOnSource).toBe("vehicle");
    expect(b.basisStatus).toBe("verified");
    expect(b.vehicleComparisonPrice).toBe(42981);
  });

  it("uses a verified tenant default when the vehicle has no answer", () => {
    const b = resolvePriceBasis({
      ...noAnswer,
      tenantMandatoryAddOns: { amountUsd: 0, verified: true },
    });
    expect(b.mandatoryDealerAddOns).toBe(0);
    expect(b.mandatoryAddOnSource).toBe("tenant_default");
    expect(b.basisReasons).toContain("mandatory_add_ons_from_verified_tenant_default");
    expect(b.basisStatus).toBe("verified");
  });

  it("refuses an unverified tenant default rather than assuming it", () => {
    const b = resolvePriceBasis({
      ...noAnswer,
      tenantMandatoryAddOns: { amountUsd: 0 },
    });
    expect(b.mandatoryDealerAddOns).toBeNull();
    expect(b.mandatoryAddOnSource).toBe("unknown");
    expect(b.basisReasons).toContain("tenant_mandatory_add_on_default_not_verified");
    expect(b.basisStatus).toBe("ambiguous");
  });

  it("lets the vehicle override the tenant default", () => {
    const b = resolvePriceBasis({
      ...noAnswer, price: 45371, websiteSalePrice: 45371,
      vehicleMandatoryAddOns: { amountUsd: 1495, verified: true, includedInDisplayedPrice: true },
      tenantMandatoryAddOns: { amountUsd: 0, verified: true },
    });
    expect(b.mandatoryDealerAddOns).toBe(1495);
    expect(b.mandatoryAddOnSource).toBe("vehicle");
  });

  it("treats a draft addendum's priced items as unanswered, not as verified", () => {
    // The six Harte vehicles: real installed items, real dollars, but the
    // addendum is a DRAFT. A draft is not a disclosure the dealer has made, so
    // it cannot become a mandatory charge we assert on their behalf.
    const b = resolvePriceBasis({
      ...noAnswer,
      vehicleMandatoryAddOns: { amountUsd: 2343.99, verified: false },
    });
    expect(b.mandatoryDealerAddOns).toBeNull();
    expect(b.mandatoryAddOnSource).toBe("unknown");
    expect(b.basisStatus).toBe("ambiguous");
    expect(b.basisReasons).toContain("mandatory_add_on_treatment_unknown");
    // Never assumed to be zero, and never quietly folded into the total.
    expect(b.displayedTotalPrice).toBe(43876);
    expect(b.totalWithMandatoryAddOns).toBeNull();
  });

  it("stays ambiguous when nobody has answered at any scope", () => {
    const b = resolvePriceBasis(noAnswer);
    expect(b.mandatoryDealerAddOns).toBeNull();
    expect(b.mandatoryAddOnsIncludedInDisplayedPrice).toBeNull();
    expect(b.mandatoryAddOnSource).toBe("unknown");
    expect(b.basisStatus).toBe("ambiguous");
    expect(b.totalWithMandatoryAddOns).toBeNull();
  });
});

describe("mandatory add-ons — inside the displayed price or on top of it", () => {
  const noAnswer = (() => { const { mandatoryDealerAddOns: _o, ...rest } = QX50; return rest; })();

  it("subtracts an add-on that is inside the displayed price", () => {
    const b = resolvePriceBasis({
      ...noAnswer, price: 45371, websiteSalePrice: 45371,
      vehicleMandatoryAddOns: { amountUsd: 1495, verified: true, includedInDisplayedPrice: true },
    });
    expect(b.mandatoryAddOnsIncludedInDisplayedPrice).toBe(true);
    expect(b.displayedTotalPrice).toBe(45371);
    expect(b.totalWithMandatoryAddOns).toBe(45371);
    expect(b.vehicleComparisonPrice).toBe(42981);
    expect(b.basisReasons).toContain("mandatory_add_ons_inside_displayed_price");
    expect(b.basisStatus).toBe("verified");
  });

  it("leaves the advertised price alone when the add-on is charged on top", () => {
    // This is the Harte shape: price − advertised − doc_fee = 0, and the
    // product is charged at the desk. Subtracting it would restate a published
    // advertised price by $2,343.99.
    const b = resolvePriceBasis({
      ...noAnswer,
      vehicleMandatoryAddOns: { amountUsd: 2343.99, verified: true, includedInDisplayedPrice: false },
    });
    expect(b.mandatoryAddOnsIncludedInDisplayedPrice).toBe(false);
    expect(b.displayedTotalPrice).toBe(43876);
    expect(b.vehicleComparisonPrice).toBe(42981);
    expect(b.totalWithMandatoryAddOns).toBeCloseTo(46219.99, 2);
    expect(b.basisReasons).toContain("mandatory_add_ons_outside_displayed_price");
    expect(b.basisStatus).toBe("verified");
  });

  it("is ambiguous when the amount is known but its placement is not", () => {
    const b = resolvePriceBasis({
      ...noAnswer,
      vehicleMandatoryAddOns: { amountUsd: 2343.99, verified: true },
    });
    expect(b.mandatoryDealerAddOns).toBeCloseTo(2343.99, 2);
    expect(b.mandatoryAddOnsIncludedInDisplayedPrice).toBeNull();
    expect(b.basisStatus).toBe("ambiguous");
    expect(b.basisReasons).toContain("mandatory_add_on_placement_unknown");
    // No total can be stated without knowing which side of the price it sits on.
    expect(b.totalWithMandatoryAddOns).toBeNull();
    expect(b.displayedTotalPrice).toBe(43876);
  });
});
