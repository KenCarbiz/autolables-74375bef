import { describe, it, expect } from "vitest";
import { resolvePriceBasis, resolveComparableBasePrice } from "./priceBasis.ts";

// The live Harte QX50 row, copied from production on 2026-09-10.
const QX50 = {
  price: 43876,
  advertisedPriceBeforeDoc: 42981,
  websiteSalePrice: 43876,
  docFee: 895,
  advertisedExcludesDocFee: false,
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
      docFee: 876, advertisedExcludesDocFee: true,
    });
    expect(b.vehicleComparisonPrice).toBe(30000);
    expect(b.displayedTotalPrice).toBe(30876);
    expect(b.basisStatus).toBe("verified");
    expect(b.advertisedIncludesDocFee).toBe(false);
  });
});

describe("resolvePriceBasis — inference and ambiguity", () => {
  it("infers a fee-inclusive price when the stored numbers reconcile", () => {
    const b = resolvePriceBasis({ price: 43876, advertisedPriceBeforeDoc: 42981, docFee: 895 });
    expect(b.advertisedIncludesDocFee).toBe(true);
    expect(b.basisStatus).toBe("verified");
    expect(b.basisReasons).toContain("fee_treatment_inferred_from_stored_prices");
  });

  it("infers a fee-exclusive price when advertised equals the price column", () => {
    const b = resolvePriceBasis({ price: 30000, advertisedPriceBeforeDoc: 30000, docFee: 876 });
    expect(b.advertisedIncludesDocFee).toBe(false);
  });

  it("is ambiguous when the doc fee is unknown", () => {
    const b = resolvePriceBasis({ price: 43876, advertisedPriceBeforeDoc: 42981 });
    expect(b.basisStatus).toBe("ambiguous");
    expect(b.basisReasons).toContain("doc_fee_unknown");
  });

  it("treats a configured zero fee as a verified no-fee price", () => {
    const b = resolvePriceBasis({ price: 25000, docFee: 0 });
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
    expect(b.basisReasons.some((r) => r.startsWith("fee_identity_failed"))).toBe(true);
  });

  it("rejects a missing or implausible price", () => {
    expect(resolvePriceBasis({}).basisStatus).toBe("invalid");
    expect(resolvePriceBasis({ price: 0, docFee: 0 }).basisStatus).toBe("invalid");
    expect(resolvePriceBasis({ price: -5000, docFee: 0 }).basisStatus).toBe("invalid");
  });

  it("tolerates a one-dollar rounding difference and no more", () => {
    const ok = resolvePriceBasis({ price: 43876, advertisedPriceBeforeDoc: 42980, docFee: 895, advertisedExcludesDocFee: false });
    expect(ok.basisStatus).toBe("verified");
    const bad = resolvePriceBasis({ price: 43876, advertisedPriceBeforeDoc: 42978, docFee: 895, advertisedExcludesDocFee: false });
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
    const b = resolvePriceBasis({ ...QX50, mandatoryDealerAddOns: 1495 });
    expect(b.mandatoryDealerAddOns).toBe(1495);
    expect(b.vehicleComparisonPrice).toBe(42981);
    expect(b.basisReasons).toContain("mandatory_add_ons_disclosed_1495");
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
