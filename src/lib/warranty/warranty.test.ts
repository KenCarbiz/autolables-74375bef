import { describe, it, expect } from "vitest";
import { getWarrantyDisplayMode, matchOemWarrantyProgram } from "./match";
import { calculateUsedWarrantyRemaining } from "./calculate";
import { buildWarrantyDisplayModel } from "./displayModel";
import { buildWarrantyCoverageReport } from "./coverageReport";
import type { WarrantyVehicleInput } from "./types";

const QX60 = (over: Partial<WarrantyVehicleInput> = {}): WarrantyVehicleInput => ({
  vin: "5N1DL1FS0RC000000", year: 2026, make: "INFINITI", model: "QX60", trim: "LUXE",
  fuelType: "gasoline", powertrainType: "gas", country: "US", condition: "new", mileage: 12, ...over,
});

describe("getWarrantyDisplayMode", () => {
  it("returns new / used / cpo from the right signals", () => {
    expect(getWarrantyDisplayMode(QX60({ condition: "new" }))).toBe("new");
    expect(getWarrantyDisplayMode(QX60({ condition: "used" }))).toBe("used");
    expect(getWarrantyDisplayMode(QX60({ condition: "used", certified: true }))).toBe("cpo");
    expect(getWarrantyDisplayMode(QX60({ condition: "certified pre-owned" }))).toBe("cpo");
    expect(getWarrantyDisplayMode(QX60({ condition: null, isNew: true }))).toBe("new");
  });
});

describe("matchOemWarrantyProgram", () => {
  it("selects the model-specific INFINITI QX60 program", () => {
    const r = matchOemWarrantyProgram(QX60());
    expect(r.program?.id).toBe("infiniti-2026-qx60-us");
    // QX60 program carries a powertrain but no trim → matches at the
    // model+year+powertrain tier.
    expect(r.matchedBy).toBe("model_year_powertrain");
  });

  it("falls back to the make-level default for a different INFINITI model/year", () => {
    const r = matchOemWarrantyProgram(QX60({ model: "QX50", year: 2022, trim: null }));
    expect(r.program?.id).toBe("infiniti-us-default");
    // The make-level program is model-agnostic (model=null) → make+year-range tier.
    expect(r.matchedBy).toBe("make_year_range");
  });

  it("returns a no-guess fallback when no program matches", () => {
    const r = matchOemWarrantyProgram(QX60({ make: "Ferrari", model: "Roma", year: 2024 }));
    expect(r.program).toBeNull();
    expect(r.matchedBy).toBe("none");
    expect(r.needsDealerConfirmation).toBe(true);
  });
});

describe("buildWarrantyDisplayModel — NEW vehicle", () => {
  const m = buildWarrantyDisplayModel(QX60({ condition: "new" }));
  it("shows delivery-based start and term-only coverage", () => {
    expect(m.mode).toBe("new");
    expect(m.status).toBe("ACTIVE");
    expect(m.warrantyStartValue).toBe("At Delivery Date");
    expect(m.showWarrantyEnd).toBe(false);
    expect(m.showProgress).toBe(false);
    expect(m.showRemaining).toBe(false);
    expect(m.showCpoBanner).toBe(false);
    const btb = m.coverageAtGlance.find((c) => c.coverageType === "bumper_to_bumper");
    const pt = m.coverageAtGlance.find((c) => c.coverageType === "powertrain");
    expect(btb?.termYears).toBe("4 Years");
    expect(btb?.termMiles).toBe("50,000 Miles");
    expect(pt?.termYears).toBe("6 Years");
    expect(pt?.termMiles).toBe("70,000 Miles");
    expect(btb?.pctRemaining ?? null).toBeNull();
    expect(m.notice).toMatch(/take delivery/i);
  });
});

describe("buildWarrantyDisplayModel — USED vehicle", () => {
  const inServiceDate = "2024-01-01";
  const m = buildWarrantyDisplayModel(QX60({ condition: "used", trim: null, inServiceDate, mileage: 20000 }));
  it("shows in-service start, calculated end, and remaining figures", () => {
    expect(m.mode).toBe("used");
    expect(m.warrantyStartSubcopy).toBe("(In-Service Date)");
    expect(m.showWarrantyEnd).toBe(true);
    expect(m.showProgress).toBe(true);
    const btb = m.coverageAtGlance.find((c) => c.coverageType === "bumper_to_bumper");
    expect(btb?.pctRemaining).not.toBeNull();
    expect(btb?.milesRemainingLabel).toMatch(/Miles Remaining/);
    expect(btb?.expiresDate).toBeTruthy();
  });
});

describe("buildWarrantyDisplayModel — missing data fallback", () => {
  const m = buildWarrantyDisplayModel(QX60({ condition: "used", trim: null, inServiceDate: null, mileage: null }));
  it("does not fabricate and asks for dealer confirmation without 'Pending'", () => {
    expect(m.needsDealerConfirmation).toBe(true);
    expect(m.warrantyStartValue).toBe("See dealer");
    const serialized = JSON.stringify(m);
    expect(serialized.toLowerCase()).not.toContain("pending");
    const btb = m.coverageAtGlance.find((c) => c.coverageType === "bumper_to_bumper");
    expect(btb?.expiresDate ?? null).toBeNull();
    expect(m.confirmationDisclosure).toBeTruthy();
  });
});

describe("calculateUsedWarrantyRemaining", () => {
  it("returns partial + needs confirmation when in-service date missing", () => {
    const r = calculateUsedWarrantyRemaining({
      coverage: { coverageType: "powertrain", displayName: "Powertrain", termMonths: 72, mileageLimit: 70000, startsAt: "in_service_date", sortOrder: 1 },
      inServiceDate: null, currentMileage: 20000,
    });
    expect(r.expirationDate).toBeNull();
    expect(r.milesRemaining).toBe(50000);
    expect(r.partial).toBe(true);
    expect(r.needsDealerConfirmation).toBe(true);
  });
});

describe("Hyundai second-owner powertrain reduction", () => {
  it("uses the reduced transfer term for a used Hyundai", () => {
    const used = buildWarrantyDisplayModel({
      make: "HYUNDAI", model: "Tucson", year: 2022, country: "US", condition: "used",
      inServiceDate: "2022-01-01", mileage: 10000,
    });
    const pt = used.coverageAtGlance.find((c) => c.coverageType === "powertrain");
    // Original 10 yr / 100k drops to 5 yr / 60k after transfer → 60k - 10k = 50k left.
    expect(pt?.milesRemainingLabel).toBe("50,000 Miles Remaining");
  });
});

describe("coverage tracker", () => {
  const report = buildWarrantyCoverageReport();
  it("lists the four loaded makes and flags them needs_review", () => {
    const makes = report.loaded.map((m) => m.make).sort();
    expect(makes).toEqual(["HYUNDAI", "INFINITI", "NISSAN", "VOLKSWAGEN"]);
    expect(report.needsVerification.sort()).toEqual(["HYUNDAI", "INFINITI", "NISSAN", "VOLKSWAGEN"]);
    expect(report.totals.verifiedMakes).toBe(0);
  });
  it("reports remaining curated makes as pending", () => {
    expect(report.pending).not.toContain("INFINITI");
    expect(report.pending.length).toBeGreaterThan(0);
    expect(report.pending).toContain("TOYOTA");
  });
});
