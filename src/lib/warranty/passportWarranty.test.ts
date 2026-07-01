import { describe, it, expect } from "vitest";
import { resolveEffectiveWarranty } from "./passportWarranty";

describe("resolveEffectiveWarranty", () => {
  it("new car: fills full factory terms from the library", () => {
    const r = resolveEffectiveWarranty({ condition: "new", ymm: "2026 Nissan Altima" });
    expect(r.mode).toBe("new");
    expect(r.info.factory_months).toBe(36);
    expect(r.info.factory_miles).toBe(36000);
    expect(r.info.powertrain_months).toBe(60);
    expect(r.secondOwnerReduced).toBe(false);
    expect(r.usedLibrary).toBe(true);
  });

  it("factory CPO at a matching franchise: CPO powertrain overlays (Nissan store, CPO Altima)", () => {
    const r = resolveEffectiveWarranty({
      condition: "cpo", ymm: "2023 Nissan Altima",
      warrantyInfo: { in_service_date: "2023-03-01" }, hasDealerOem: true,
    });
    expect(r.mode).toBe("cpo_factory");
    expect(r.info.powertrain_months).toBe(84);   // 7 yr / 100k CPO powertrain
    expect(r.info.powertrain_miles).toBe(100000);
    expect(r.info.factory_months).toBe(36);      // remainder of factory basic
    expect(r.cpoWrap).toBeNull();                // Nissan Certified has no purchase wrap
    expect(r.franchiseMatch).toBe(true);
  });

  it("cross-brand used (Chevy store selling a Toyota): factory balance only, no CPO", () => {
    const r = resolveEffectiveWarranty({
      condition: "used", ymm: "2023 Toyota RAV4",
      warrantyInfo: { in_service_date: "2023-05-01" }, hasDealerOem: false,
    });
    expect(r.mode).toBe("used");
    expect(r.info.factory_months).toBe(36);
    expect(r.info.powertrain_months).toBe(60);   // Toyota has no transfer reduction
    expect(r.secondOwnerReduced).toBe(false);
    expect(r.franchiseMatch).toBe(false);
    expect(r.cpoWrap).toBeNull();
  });

  it("used Hyundai second owner without factory CPO: powertrain drops to 5yr/60k", () => {
    const r = resolveEffectiveWarranty({
      condition: "used", ymm: "2023 Hyundai Tucson",
      warrantyInfo: { in_service_date: "2023-01-15" }, hasDealerOem: false,
    });
    expect(r.info.powertrain_months).toBe(60);
    expect(r.info.powertrain_miles).toBe(60000);
    expect(r.secondOwnerReduced).toBe(true);
  });

  it("CPO-marked car at a NON-matching franchise is treated as used (reduced)", () => {
    const r = resolveEffectiveWarranty({
      condition: "cpo", ymm: "2023 Hyundai Tucson",
      warrantyInfo: { in_service_date: "2023-01-15" }, hasDealerOem: false, cpoPrograms: null,
    });
    expect(r.mode).toBe("used");
    expect(r.info.powertrain_months).toBe(60);
    expect(r.secondOwnerReduced).toBe(true);
  });

  it("factory CPO Hyundai reinstates the 10yr/100k powertrain", () => {
    const r = resolveEffectiveWarranty({
      condition: "cpo", ymm: "2023 Hyundai Tucson",
      warrantyInfo: { in_service_date: "2023-01-15" }, hasDealerOem: true,
    });
    expect(r.mode).toBe("cpo_factory");
    expect(r.info.powertrain_months).toBe(120);
    expect(r.info.powertrain_miles).toBe(100000);
    expect(r.secondOwnerReduced).toBe(false);
  });

  it("factory CPO Kia adds the 1yr/12k Platinum wrap as a purchase-based card", () => {
    const r = resolveEffectiveWarranty({
      condition: "cpo", ymm: "2023 Kia Telluride",
      warrantyInfo: { in_service_date: "2023-02-01" }, hasDealerOem: true,
    });
    expect(r.mode).toBe("cpo_factory");
    expect(r.cpoWrap?.months).toBe(12);
    expect(r.cpoWrap?.miles).toBe(12000);
    expect(r.info.powertrain_months).toBe(120);
  });

  it("factory CPO INFINITI replaces basic with the 6yr/75k in-service comprehensive", () => {
    const r = resolveEffectiveWarranty({
      condition: "cpo", ymm: "2023 INFINITI QX60",
      warrantyInfo: { in_service_date: "2023-04-01" }, hasDealerOem: true,
    });
    expect(r.mode).toBe("cpo_factory");
    expect(r.info.factory_months).toBe(72);
    expect(r.info.factory_miles).toBe(75000);
    expect(r.cpoWrap).toBeNull();
  });

  it("dealer-entered warranty_info always wins over the library", () => {
    const r = resolveEffectiveWarranty({
      condition: "used", ymm: "2023 Toyota RAV4",
      warrantyInfo: { factory_months: 40, factory_miles: 40000, powertrain_months: 70, powertrain_miles: 70000, in_service_date: "2023-05-01" },
      hasDealerOem: true,
    });
    expect(r.info.factory_months).toBe(40);
    expect(r.info.powertrain_months).toBe(70);
    expect(r.usedLibrary).toBe(false);
  });

  it("used car with NO in-service date gets no fabricated library countdown", () => {
    const r = resolveEffectiveWarranty({ condition: "used", ymm: "2023 Toyota RAV4", warrantyInfo: {}, hasDealerOem: false });
    expect(r.info.factory_months).toBeUndefined();
    expect(r.usedLibrary).toBe(false);
  });

  it("an OEM cpo program attached by the edge function counts as a franchise match", () => {
    const r = resolveEffectiveWarranty({
      condition: "cpo", ymm: "2023 Nissan Rogue",
      warrantyInfo: { in_service_date: "2023-06-01" }, hasDealerOem: false,
      cpoPrograms: [{ kind: "oem", name: "Nissan Certified Pre-Owned", powertrain_months: 84, powertrain_miles: 100000 }],
    });
    expect(r.mode).toBe("cpo_factory");
    expect(r.franchiseMatch).toBe(true);
    expect(r.cpoProgramName).toBe("Nissan Certified Pre-Owned");
    expect(r.info.powertrain_months).toBe(84);
  });
});
