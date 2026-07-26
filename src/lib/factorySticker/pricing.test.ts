import { describe, expect, it } from "vitest";
import {
  derivePriceStatus,
  MATCHED_MAX_DIFF,
  MINOR_VARIATION_MAX_DIFF,
  PricingInputError,
  reconcileMsrp,
  type MsrpReconciliationInput,
} from "./pricing";

const base = (over: Partial<MsrpReconciliationInput> = {}): MsrpReconciliationInput => ({
  baseMsrp: 89450,
  destinationCharge: 1995,
  sourceReportedTotalMsrp: 95695,
  packages: [],
  options: [
    { name: "Illuminated Kick Plates", price: 500, priceStatus: "PRICED" },
    { name: "Welcome Lighting", price: 425, priceStatus: "PRICED" },
    { name: "Roof Rail Crossbars", price: 375, priceStatus: "PRICED" },
    { name: "Cargo Package", price: 450, priceStatus: "PRICED" },
    { name: "22-Inch Dark Forged Wheels", price: 2500, priceStatus: "PRICED" },
  ],
  ...over,
});

describe("reconcileMsrp benchmark", () => {
  it("matches the INFINITI benchmark: 89450 + 4250 + 1995 = 95695", () => {
    const r = reconcileMsrp(base());
    expect(r.baseMsrp).toBe(89450);
    expect(r.optionsTotal).toBe(4250);
    expect(r.factoryInstalledTotal).toBe(4250);
    expect(r.destinationCharge).toBe(1995);
    expect(r.calculatedTotalMsrp).toBe(95695);
    expect(r.sourceReportedTotalMsrp).toBe(95695);
    expect(r.reconciliationDifference).toBe(0);
    expect(r.reconciliationStatus).toBe("MATCHED");
    expect(r.currency).toBe("USD");
  });
});

describe("reconciliation thresholds", () => {
  const withDiff = (diff: number) => reconcileMsrp(base({ sourceReportedTotalMsrp: 95695 - diff }));

  it("|diff| 0 is MATCHED", () => expect(withDiff(0).reconciliationStatus).toBe("MATCHED"));
  it("|diff| 5 is MATCHED", () => expect(withDiff(5).reconciliationStatus).toBe("MATCHED"));
  it("|diff| -5 is MATCHED", () => expect(withDiff(-5).reconciliationStatus).toBe("MATCHED"));
  it("|diff| 6 is MINOR_VARIATION", () => expect(withDiff(6).reconciliationStatus).toBe("MINOR_VARIATION"));
  it("|diff| 100 is MINOR_VARIATION", () => expect(withDiff(100).reconciliationStatus).toBe("MINOR_VARIATION"));
  it("|diff| -100 is MINOR_VARIATION", () => expect(withDiff(-100).reconciliationStatus).toBe("MINOR_VARIATION"));
  it("|diff| 101 is REVIEW_REQUIRED", () => expect(withDiff(101).reconciliationStatus).toBe("REVIEW_REQUIRED"));
  it("|diff| 1050 is REVIEW_REQUIRED", () => expect(withDiff(1050).reconciliationStatus).toBe("REVIEW_REQUIRED"));

  it("records the signed difference", () => {
    expect(withDiff(55).reconciliationDifference).toBe(55);
    expect(withDiff(-55).reconciliationDifference).toBe(-55);
  });

  it("exports the documented threshold constants", () => {
    expect(MATCHED_MAX_DIFF).toBe(5);
    expect(MINOR_VARIATION_MAX_DIFF).toBe(100);
  });
});

describe("PRICED-only totals", () => {
  it("sums only PRICED packages into packagesTotal", () => {
    const r = reconcileMsrp(
      base({
        packages: [
          { name: "Tow Package", price: 2200, priceStatus: "PRICED" },
          { name: "Equipment Group", priceStatus: "INCLUDED" },
          { name: "Floor Liners", price: 0, priceStatus: "NO_CHARGE" },
          { name: "Mystery Package", priceStatus: "UNAVAILABLE" },
        ],
        sourceReportedTotalMsrp: 97895,
      }),
    );
    expect(r.packagesTotal).toBe(2200);
    expect(r.calculatedTotalMsrp).toBe(97895);
    expect(r.reconciliationStatus).toBe("MATCHED");
  });

  it("leaves packagesTotal undefined when no package is PRICED", () => {
    const r = reconcileMsrp(base({ packages: [{ name: "Equipment Group", priceStatus: "INCLUDED" }] }));
    expect(r.packagesTotal).toBeUndefined();
  });

  it("leaves optionsTotal undefined when no option is PRICED (never 0)", () => {
    const r = reconcileMsrp(base({ options: [{ name: "Unpriced Option", priceStatus: "UNAVAILABLE" }] }));
    expect(r.optionsTotal).toBeUndefined();
    expect(r.factoryInstalledTotal).toBeUndefined();
  });

  it("excludes UNAVAILABLE options from the total but keeps PRICED ones", () => {
    const r = reconcileMsrp(
      base({
        options: [
          { name: "Roof Crossbars", price: 800, priceStatus: "PRICED" },
          { name: "All-Season Floor Mats", priceStatus: "UNAVAILABLE" },
        ],
        baseMsrp: 41000,
        destinationCharge: 1395,
        sourceReportedTotalMsrp: 43250,
      }),
    );
    expect(r.optionsTotal).toBe(800);
    expect(r.calculatedTotalMsrp).toBe(43195);
    expect(r.reconciliationDifference).toBe(-55);
    expect(r.reconciliationStatus).toBe("MINOR_VARIATION");
  });
});

describe("missing baseMsrp", () => {
  it("is INSUFFICIENT_DATA with no calculated total", () => {
    const r = reconcileMsrp(base({ baseMsrp: undefined }));
    expect(r.reconciliationStatus).toBe("INSUFFICIENT_DATA");
    expect(r.calculatedTotalMsrp).toBeUndefined();
    expect(r.reconciliationDifference).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/baseMsrp unavailable/);
  });

  it("still reports the component totals it can compute", () => {
    const r = reconcileMsrp(base({ baseMsrp: undefined }));
    expect(r.optionsTotal).toBe(4250);
  });
});

describe("missing destinationCharge", () => {
  it("keeps destinationCharge undefined, never 0", () => {
    const r = reconcileMsrp(base({ destinationCharge: undefined, sourceReportedTotalMsrp: 93700 }));
    expect(r.destinationCharge).toBeUndefined();
    expect(r.calculatedTotalMsrp).toBe(93700);
    expect(r.reconciliationStatus).toBe("MATCHED");
  });

  it("goes REVIEW_REQUIRED when the reported total cannot be explained without it", () => {
    const r = reconcileMsrp(base({ destinationCharge: undefined }));
    expect(r.calculatedTotalMsrp).toBe(93700);
    expect(r.reconciliationDifference).toBe(-1995);
    expect(r.reconciliationStatus).toBe("REVIEW_REQUIRED");
    expect(r.notes.join(" ")).toMatch(/destination/);
  });
});

describe("missing sourceReportedTotalMsrp", () => {
  it("calculates from components and reports MATCHED with a confidence note", () => {
    const r = reconcileMsrp(base({ sourceReportedTotalMsrp: undefined }));
    expect(r.calculatedTotalMsrp).toBe(95695);
    expect(r.sourceReportedTotalMsrp).toBeUndefined();
    expect(r.reconciliationDifference).toBeUndefined();
    expect(r.reconciliationStatus).toBe("MATCHED");
    expect(r.notes.join(" ")).toMatch(/sourceReportedTotalMsrp unavailable/);
  });

  it("goes REVIEW_REQUIRED when both reported total and destination are missing", () => {
    const r = reconcileMsrp(base({ sourceReportedTotalMsrp: undefined, destinationCharge: undefined }));
    expect(r.reconciliationStatus).toBe("REVIEW_REQUIRED");
  });
});

describe("negative and impossible prices", () => {
  it("throws on a negative component price without oemCredit", () => {
    expect(() =>
      reconcileMsrp(base({ options: [{ name: "Discount Line", price: -500, priceStatus: "PRICED" }] })),
    ).toThrow(PricingInputError);
  });

  it("accepts a negative price flagged oemCredit and nets it into the total", () => {
    const r = reconcileMsrp(
      base({
        options: [
          { name: "Roof Crossbars", price: 800, priceStatus: "PRICED" },
          { name: "Package Credit", price: -300, priceStatus: "PRICED", oemCredit: true },
        ],
        sourceReportedTotalMsrp: 91945,
      }),
    );
    expect(r.optionsTotal).toBe(500);
    expect(r.calculatedTotalMsrp).toBe(91945);
    expect(r.reconciliationStatus).toBe("MATCHED");
  });

  it("throws on non-finite component prices", () => {
    expect(() =>
      reconcileMsrp(base({ options: [{ name: "Bad", price: Number.NaN, priceStatus: "PRICED" }] })),
    ).toThrow(PricingInputError);
  });

  it("throws on a negative baseMsrp or destinationCharge", () => {
    expect(() => reconcileMsrp(base({ baseMsrp: -1 }))).toThrow(PricingInputError);
    expect(() => reconcileMsrp(base({ destinationCharge: -1 }))).toThrow(PricingInputError);
  });

  it("rounds currency math to cents deterministically", () => {
    const r = reconcileMsrp(
      base({
        options: [
          { name: "A", price: 0.1, priceStatus: "PRICED" },
          { name: "B", price: 0.2, priceStatus: "PRICED" },
        ],
        sourceReportedTotalMsrp: 91445.3,
      }),
    );
    expect(r.optionsTotal).toBe(0.3);
    expect(r.reconciliationDifference).toBe(0);
    expect(r.reconciliationStatus).toBe("MATCHED");
  });
});

describe("determinism", () => {
  it("returns identical results for identical input", () => {
    expect(reconcileMsrp(base())).toEqual(reconcileMsrp(base()));
  });
});

describe("derivePriceStatus", () => {
  it("maps a positive price to PRICED", () => {
    expect(derivePriceStatus({ price: 500 })).toEqual({ price: 500, priceStatus: "PRICED" });
  });

  it("maps an explicit zero to NO_CHARGE", () => {
    expect(derivePriceStatus({ price: 0 })).toEqual({ price: 0, priceStatus: "NO_CHARGE" });
  });

  it("maps an explicit included flag to INCLUDED, never inventing a price", () => {
    expect(derivePriceStatus({ explicitIncluded: true })).toEqual({ priceStatus: "INCLUDED" });
  });

  it("maps an explicit no-charge flag without a price to NO_CHARGE without inventing 0", () => {
    expect(derivePriceStatus({ explicitNoCharge: true })).toEqual({ priceStatus: "NO_CHARGE" });
  });

  it("maps a missing price to UNAVAILABLE, never 0", () => {
    expect(derivePriceStatus({})).toEqual({ priceStatus: "UNAVAILABLE" });
  });

  it("treats an unflagged negative price as UNAVAILABLE", () => {
    expect(derivePriceStatus({ price: -100 })).toEqual({ priceStatus: "UNAVAILABLE" });
  });

  it("passes through an oemCredit negative price as PRICED", () => {
    expect(derivePriceStatus({ price: -100, oemCredit: true })).toEqual({ price: -100, priceStatus: "PRICED" });
  });
});
