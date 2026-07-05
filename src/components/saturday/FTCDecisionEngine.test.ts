import { describe, it, expect } from "vitest";
import { decideFTCBuyersGuide } from "./FTCDecisionEngine";

// The auto-attach decision must route Maine and Wisconsin to their own state
// forms (they are exempt from the FTC rule), and everyone else to the FTC form.
const dealer = { name: "Test Motors", address: "1 Main St", city: "Town", state: "XX", zip: "00000" };
const vehicle = (saleState: string) => ({
  year: 2022, make: "INFINITI", model: "QX60", vin: "SAMPLEVIN0001", mileage: 30000, saleState,
});

describe("decideFTCBuyersGuide — per-state form routing", () => {
  it("routes Wisconsin to its own state form with the official PDF asset", () => {
    const d = decideFTCBuyersGuide({ vehicle: vehicle("WI"), dealer });
    expect(d.usesStateForm).toBe(true);
    expect(d.buyersGuideForm.formId).toBe("wi-mv2872");
    expect(d.buyersGuideForm.assetUrl).toBe("/buyers-guides/wi-mv2872.pdf");
    expect(d.requiredForms).toEqual([d.buyersGuideForm.formName]);
    expect(d.reasons.join(" ")).toMatch(/exempt from the FTC rule/i);
  });

  it("routes Maine to its own state form with the official PDF asset", () => {
    const d = decideFTCBuyersGuide({ vehicle: vehicle("ME"), dealer });
    expect(d.usesStateForm).toBe(true);
    expect(d.buyersGuideForm.formId).toBe("me-250c104");
    expect(d.buyersGuideForm.assetUrl).toBe("/buyers-guides/me-250c104.pdf");
    expect(d.requiredForms).toEqual([d.buyersGuideForm.formName]);
  });

  it("uses the federal FTC form for all other states (no state PDF)", () => {
    for (const st of ["CT", "CA", "TX", "NY"]) {
      const d = decideFTCBuyersGuide({ vehicle: vehicle(st), dealer });
      expect(d.usesStateForm, st).toBe(false);
      expect(d.buyersGuideForm.formId, st).toBe("ftc");
      expect(d.buyersGuideForm.assetUrl, st).toBeNull();
    }
  });

  it("still marks a Buyers Guide as required regardless of which form applies", () => {
    expect(decideFTCBuyersGuide({ vehicle: vehicle("WI"), dealer }).required).toBe(true);
    expect(decideFTCBuyersGuide({ vehicle: vehicle("CT"), dealer }).required).toBe(true);
  });
});
