import { describe, it, expect } from "vitest";
import { lookupOemReference, hasOemReference, OEM_WARRANTY_REFERENCE } from "./oemWarrantyReference";
import { factoryWarrantyToInfo, UNLIMITED_MILES, type OemFactoryWarranty } from "@/lib/oemWarranty";

describe("lookupOemReference", () => {
  it("finds a brand by exact name (case-insensitive)", () => {
    expect(lookupOemReference("infiniti")?.basic_miles).toBe(60000);
  });

  it("resolves common aliases", () => {
    expect(lookupOemReference("Chevy")).toBe(OEM_WARRANTY_REFERENCE.CHEVROLET);
    expect(lookupOemReference("VW")).toBe(OEM_WARRANTY_REFERENCE.VOLKSWAGEN);
    expect(lookupOemReference("Mercedes")).toBe(OEM_WARRANTY_REFERENCE["MERCEDES-BENZ"]);
  });

  it("matches a brand contained in a year-make-model line", () => {
    expect(lookupOemReference("2027 INFINITI QX60")?.powertrain_months).toBe(72);
  });

  it("returns null for an unknown make", () => {
    expect(lookupOemReference("DeLorean")).toBeNull();
    expect(hasOemReference("DeLorean")).toBe(false);
  });

  it("carries the second-owner powertrain drop for HMG brands", () => {
    expect(OEM_WARRANTY_REFERENCE.HYUNDAI.powertrain_months).toBe(120);
    expect(OEM_WARRANTY_REFERENCE.HYUNDAI.powertrain_transfer_months).toBe(60);
    expect(OEM_WARRANTY_REFERENCE.KIA.powertrain_transfer_miles).toBe(60000);
  });

  it("uses the unlimited sentinel for unlimited corrosion terms", () => {
    expect(OEM_WARRANTY_REFERENCE.FORD.corrosion_miles).toBe(UNLIMITED_MILES);
  });
});

describe("factoryWarrantyToInfo owner-awareness", () => {
  const kia: OemFactoryWarranty = {
    brand: "KIA", basic_months: 60, basic_miles: 60000,
    powertrain_months: 120, powertrain_miles: 100000,
    powertrain_transfer_months: 60, powertrain_transfer_miles: 60000,
    verified: true,
  };

  it("gives the original owner the full powertrain term", () => {
    const info = factoryWarrantyToInfo(kia, "2026-01-01", false);
    expect(info.powertrain_months).toBe(120);
    expect(info.powertrain_miles).toBe(100000);
  });

  it("drops a subsequent owner to the transferred powertrain term", () => {
    const info = factoryWarrantyToInfo(kia, "2026-01-01", true);
    expect(info.powertrain_months).toBe(60);
    expect(info.powertrain_miles).toBe(60000);
  });
});
