import { describe, it, expect } from "vitest";
import {
  resolveFactoryWarranty,
  matchCpoPrograms,
  factoryWarrantyToInfo,
  warrantyHeadline,
  type OemFactoryWarranty,
  type CpoProgram,
} from "./oemWarranty";

const infiniti: OemFactoryWarranty = {
  brand: "INFINITI", basic_months: 48, basic_miles: 60000,
  powertrain_months: 72, powertrain_miles: 70000, verified: true,
};
const benz: OemFactoryWarranty = {
  brand: "Mercedes-Benz", basic_months: 48, basic_miles: 50000,
  powertrain_months: 48, powertrain_miles: 50000, verified: false,
};

describe("resolveFactoryWarranty", () => {
  it("matches a brand contained in the year-make-model line", () => {
    expect(resolveFactoryWarranty([infiniti], "2027 INFINITI QX60")?.brand).toBe("INFINITI");
  });

  it("matches multi-word makes via contains, not whitespace split", () => {
    expect(resolveFactoryWarranty([benz], "2025 Mercedes-Benz GLE 350", false)?.brand).toBe("Mercedes-Benz");
  });

  it("returns null for an unverified brand when onlyVerified", () => {
    expect(resolveFactoryWarranty([benz], "2025 Mercedes-Benz GLE 350")).toBeNull();
  });

  it("prefers the verified entry over an unverified duplicate", () => {
    const dup = { ...infiniti, verified: false, basic_miles: 1 };
    expect(resolveFactoryWarranty([dup, infiniti], "INFINITI Q50")?.basic_miles).toBe(60000);
  });

  it("returns null when nothing matches", () => {
    expect(resolveFactoryWarranty([infiniti], "2025 Toyota Camry")).toBeNull();
  });

  it("is safe on empty inputs", () => {
    expect(resolveFactoryWarranty([], "INFINITI")).toBeNull();
    expect(resolveFactoryWarranty(undefined, "INFINITI")).toBeNull();
    expect(resolveFactoryWarranty([infiniti], "")).toBeNull();
  });
});

describe("factoryWarrantyToInfo", () => {
  it("maps to the passport warranty_info shape and carries the in-service date", () => {
    const info = factoryWarrantyToInfo(infiniti, "2026-06-29");
    expect(info.factory_months).toBe(48);
    expect(info.factory_miles).toBe(60000);
    expect(info.powertrain_months).toBe(72);
    expect(info.in_service_date).toBe("2026-06-29");
  });
});

describe("matchCpoPrograms", () => {
  const oemCpo: CpoProgram = { id: "a", name: "INFINITI CPO", kind: "oem", brand: "INFINITI", enabled: true, coverage_from: "in_service", show_on_passport: true };
  const dealerCpo: CpoProgram = { id: "b", name: "Dealer Certified", kind: "dealer", enabled: true, coverage_from: "purchase", show_on_passport: true };
  const disabled: CpoProgram = { id: "c", name: "Off", kind: "dealer", enabled: false, coverage_from: "purchase", show_on_passport: true };

  it("returns OEM programs whose brand matches plus all enabled dealer programs", () => {
    const out = matchCpoPrograms([oemCpo, dealerCpo, disabled], "2024 INFINITI QX80");
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("excludes OEM programs of other brands", () => {
    const out = matchCpoPrograms([oemCpo, dealerCpo], "2024 Toyota Camry");
    expect(out.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("warrantyHeadline", () => {
  it("renders years and thousands of miles", () => {
    expect(warrantyHeadline(infiniti)).toBe("4 yr / 60K mi");
  });
});
