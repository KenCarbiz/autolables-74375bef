import { describe, expect, it } from "vitest";
import {
  BUYERS_GUIDE_POINTER,
  MAX_EQUIPMENT_LINES,
  buildUsedVehicleWindowSticker,
  evaluateUsedStickerAutoPublish,
  extractUsedStickerEquipment,
  isCompleteVin,
  type UsedStickerInput,
} from "./usedVehicleWindowSticker";

const VIN = "JN1FV7AR5KM800521";

const base = (over: Partial<UsedStickerInput> = {}): UsedStickerInput => {
  const { vehicle, dealer, ...rest } = over;
  return {
    vehicle: {
      vin: VIN,
      condition: "used",
      year: "2019",
      make: "INFINITI",
      model: "Q50",
      trim: "3.0t LUXE",
      stockNumber: "P4821",
      mileage: 41250,
      price: 27887,
      equipment: ["Heated Front Seats", "Moonroof"],
      ...(vehicle || {}),
    },
    dealer: { name: "Harte INFINITI", city: "Wallingford", state: "CT", ...(dealer || {}) },
    passportUrl: "https://app.autolabels.io/v/2019-infiniti-q50-800521",
    ...rest,
  };
};

describe("used-vehicle window sticker content", () => {
  it("carries identity, odometer and the advertised price", () => {
    const c = buildUsedVehicleWindowSticker(base());
    expect(c.title).toBe("2019 INFINITI Q50");
    expect(c.subtitle).toBe("3.0t LUXE");
    expect(c.vin).toBe(VIN);
    expect(c.mileageText).toBe("41,250 miles");
    expect(c.priceText).toBe("$27,887");
    expect(c.barcodePayload).toBe(VIN);
  });

  it("points at the FTC Buyers Guide instead of restating it", () => {
    const c = buildUsedVehicleWindowSticker(base());
    expect(c.disclosures).toContain(BUYERS_GUIDE_POINTER);
    // The family prohibits looking like the Guide. It must never assert the
    // warranty box itself.
    const all = c.disclosures.join(" ").toLowerCase();
    expect(all).not.toContain("as is - no dealer warranty");
    expect(all).not.toContain("implied warranties only");
  });

  it("never prints an equipment price", () => {
    const c = buildUsedVehicleWindowSticker(base({
      vehicle: {
        vin: VIN, condition: "used", year: "2019", make: "INFINITI", model: "Q50",
        mileage: 10, price: 100,
        equipment: ["Premium Package", "Moonroof"],
      },
    }));
    for (const line of c.equipment) expect(line).not.toMatch(/\$/);
  });

  it("caps and reports truncated equipment", () => {
    const many = Array.from({ length: MAX_EQUIPMENT_LINES + 7 }, (_, i) => `Feature ${i}`);
    const c = buildUsedVehicleWindowSticker(base({
      vehicle: {
        vin: VIN, condition: "used", year: "2019", make: "INFINITI", model: "Q50",
        mileage: 10, price: 100, equipment: many,
      },
    }));
    expect(c.equipment).toHaveLength(MAX_EQUIPMENT_LINES);
    expect(c.equipmentTruncated).toBe(7);
  });

  it("discloses a configured doc fee without folding it into the price", () => {
    const c = buildUsedVehicleWindowSticker(base({
      dealer: { name: "Harte INFINITI", docFeeEnabled: true, docFeeAmount: 895 },
    }));
    expect(c.priceText).toBe("$27,887");
    expect(c.docFeeNote).toContain("$895");
  });

  it("omits a price line rather than printing a zero", () => {
    const c = buildUsedVehicleWindowSticker(base({
      vehicle: { vin: VIN, condition: "used", year: "2019", make: "INFINITI", model: "Q50", mileage: 1, price: 0 },
    }));
    expect(c.priceText).toBeNull();
  });
});

describe("equipment extraction", () => {
  it("prefers the structured build sheet and drops duplicates", () => {
    const names = extractUsedStickerEquipment({
      build_sheet: {
        key_features: { Comfort: ["Heated Seats", { name: "Moonroof" }] },
        options: [{ name: "Moonroof", msrp: 1200 }],
      },
      features: ["Bluetooth"],
    });
    expect(names).toEqual(["Heated Seats", "Moonroof", "Bluetooth"]);
  });

  it("falls back to the flat feed lists, then to listing features", () => {
    expect(extractUsedStickerEquipment({ features: ["A"], options: ["B"] })).toEqual(["A", "B"]);
    expect(extractUsedStickerEquipment({}, ["Only Here"])).toEqual(["Only Here"]);
  });
});

describe("auto-publish policy", () => {
  it("publishes a complete used sheet with no human step", () => {
    const d = evaluateUsedStickerAutoPublish(buildUsedVehicleWindowSticker(base()));
    expect(d.publish).toBe(true);
    expect(d.holds).toEqual([]);
  });

  it("holds when the sheet would assert something the record cannot support", () => {
    const noPrice = evaluateUsedStickerAutoPublish(buildUsedVehicleWindowSticker(base({
      vehicle: { vin: VIN, condition: "used", year: "2019", make: "INFINITI", model: "Q50", mileage: 10, price: null },
    })));
    expect(noPrice.publish).toBe(false);
    expect(noPrice.holds).toContain("NO_ADVERTISED_PRICE");

    const noOdo = evaluateUsedStickerAutoPublish(buildUsedVehicleWindowSticker(base({
      vehicle: { vin: VIN, condition: "used", year: "2019", make: "INFINITI", model: "Q50", mileage: null, price: 100 },
    })));
    expect(noOdo.holds).toContain("NO_ODOMETER");

    const badVin = evaluateUsedStickerAutoPublish(buildUsedVehicleWindowSticker(base({
      vehicle: { vin: "SHORT", condition: "used", year: "2019", make: "INFINITI", model: "Q50", mileage: 10, price: 100 },
    })));
    expect(badVin.holds).toContain("INCOMPLETE_VIN");
  });

  it("refuses a new vehicle — the Monroney is a different family", () => {
    const d = evaluateUsedStickerAutoPublish(buildUsedVehicleWindowSticker(base({
      vehicle: { vin: VIN, condition: "new", year: "2026", make: "INFINITI", model: "QX60", mileage: 12, price: 61000 },
    })));
    expect(d.publish).toBe(false);
    expect(d.holds).toContain("NOT_A_USED_VEHICLE");
  });

  it("never overrides a manager rejection", () => {
    const d = evaluateUsedStickerAutoPublish(buildUsedVehicleWindowSticker(base()), { humanRejected: true });
    expect(d.publish).toBe(false);
    expect(d.holds).toContain("HUMAN_REJECTED");
  });

  it("publishes a sparse but truthful sheet", () => {
    const c = buildUsedVehicleWindowSticker(base({
      vehicle: {
        vin: VIN, condition: "cpo", year: "2019", make: "INFINITI", model: "Q50",
        mileage: 41250, price: 27887, equipment: [],
      },
      passportUrl: null,
    }));
    expect(c.equipment).toEqual([]);
    expect(c.qrPayload).toBeNull();
    expect(evaluateUsedStickerAutoPublish(c).publish).toBe(true);
  });

  it("every hold carries a dealer-actionable reason", () => {
    const d = evaluateUsedStickerAutoPublish(buildUsedVehicleWindowSticker(base({
      vehicle: { vin: "", condition: "new", year: null, make: null, model: null, mileage: null, price: null },
      dealer: {},
    })));
    expect(d.holds.length).toBeGreaterThan(0);
    expect(d.reasons).toHaveLength(d.holds.length);
    for (const r of d.reasons) expect(r.length).toBeGreaterThan(20);
  });
});

describe("vin completeness", () => {
  it("rejects the I/O/Q characters a VIN cannot contain", () => {
    expect(isCompleteVin(VIN)).toBe(true);
    expect(isCompleteVin("JN1FV7ARIKM800521")).toBe(false);
    expect(isCompleteVin("JN1FV7AR5KM80052")).toBe(false);
  });
});
