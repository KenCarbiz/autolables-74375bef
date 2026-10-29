import { describe, it, expect } from "vitest";
import {
  draftFromRule,
  draftToRulePatch,
  evidenceChecklist,
  priceTreatmentOf,
  sampleResult,
  validateApplicabilityDraft,
  vehicleEligible,
  type ApplicabilityDraft,
} from "./productApplicability";

const draft = (over: Partial<ApplicabilityDraft> = {}): ApplicabilityDraft => ({
  conditions: { new: true, used: true, cpo: true },
  mileageMax: null,
  yearMin: "",
  yearMax: "",
  ...over,
});

const vehicle = { vin: "EXAMPLEVIN0000001", year: 2024, make: "Example", model: "Crossover", trim: "Base", condition: "new", mileage: 12 };

describe("applicability draft and the stored rule", () => {
  it("round-trips the stored condition, with CPO following Used", () => {
    expect(draftFromRule({ condition: "used", mileage_max: 60000, year_min: "2020", year_max: "" })).toEqual({ conditions: { new: false, used: true, cpo: true }, mileageMax: 60000, yearMin: "2020", yearMax: "" });
    expect(draftFromRule({ condition: "new", mileage_max: 0, year_min: "", year_max: "" }).conditions).toEqual({ new: true, used: false, cpo: false });
    expect(draftFromRule(null)).toEqual({ conditions: { new: true, used: true, cpo: true }, mileageMax: null, yearMin: "", yearMax: "" });
    expect(draftToRulePatch(draft({ conditions: { new: false, used: true, cpo: true }, mileageMax: 60000 }))).toEqual({ condition: "used", mileage_max: 60000, year_min: "", year_max: "" });
    expect(draftToRulePatch(draft()).condition).toBe("all");
  });

  it("validates conditions, mileage and the year range", () => {
    expect(validateApplicabilityDraft(draft({ conditions: { new: false, used: false, cpo: false } }))).toEqual(["Choose at least one condition."]);
    expect(validateApplicabilityDraft(draft({ mileageMax: -5 }))).toEqual(["Mileage limit must be zero or more."]);
    expect(validateApplicabilityDraft(draft({ yearMin: "2025", yearMax: "2020" }))).toEqual(["Model year range is reversed."]);
    expect(validateApplicabilityDraft(draft())).toEqual([]);
  });
});

describe("eligibility", () => {
  it("uses the condition, mileage and year rules", () => {
    expect(vehicleEligible(draft(), vehicle)).toBe(true);
    expect(vehicleEligible(draft({ conditions: { new: false, used: true, cpo: true } }), vehicle)).toBe(false);
    expect(vehicleEligible(draft({ mileageMax: 10 }), { ...vehicle, condition: "used", mileage: 28_115 })).toBe(false);
    expect(vehicleEligible(draft({ yearMin: "2025" }), vehicle)).toBe(false);
    expect(vehicleEligible(draft({ conditions: { new: false, used: true, cpo: true } }), { ...vehicle, condition: "cpo" })).toBe(true);
  });
});

describe("price treatment and evidence", () => {
  it("reads installed versus optional from the product", () => {
    expect(priceTreatmentOf({ badge_type: "installed", price_in_advertised: true }).treatment).toBe("installed");
    expect(priceTreatmentOf({ badge_type: "optional", price_in_advertised: true }).treatment).toBe("optional");
    expect(priceTreatmentOf({ badge_type: "installed", price_in_advertised: true, available_preinstalled: false }).treatment).toBe("optional");
    expect(priceTreatmentOf({ badge_type: "installed", price_in_advertised: false }).includedInAdvertised).toBe(false);
  });

  it("requires proof for an installed product and approval only when the policy says so", () => {
    const items = evidenceChecklist({ badge_type: "installed", price_in_advertised: true, disclosure: "x", benefit_justification: "y", contract_url: null }, { requireManagerApproval: true, requireInstallVerification: true }, true);
    expect(items.map((i) => [i.key, i.state])).toEqual([["applicable", "pending"], ["installation_proof", "required"], ["disclosure", "complete"], ["approval", "manager_required"]]);
    const optional = evidenceChecklist({ badge_type: "optional", price_in_advertised: true, disclosure: "", benefit_justification: "", contract_url: null }, { requireManagerApproval: false, requireInstallVerification: false }, false);
    expect(optional.find((i) => i.key === "installation_proof")?.state).toBe("not_required");
    expect(optional.find((i) => i.key === "disclosure")?.state).toBe("required");
  });
});

describe("sample results keep eligible, installed and published apart", () => {
  it("never reads eligibility as installed", () => {
    const r = sampleResult(draft(), "installed", { requireManagerApproval: true }, vehicle, 0);
    expect(r.eligible).toBe(true);
    expect(r.proof).toBe("missing");
    expect(r.publication).toBe("blocked");
  });

  it("reads attached proof as ready for review under a manager gate, publishable without one", () => {
    expect(sampleResult(draft(), "installed", { requireManagerApproval: true }, vehicle, 1).publication).toBe("ready_for_review");
    expect(sampleResult(draft(), "installed", { requireManagerApproval: false }, vehicle, 1).publication).toBe("publishable");
  });

  it("excludes an ineligible vehicle and marks a failed proof read unknown", () => {
    expect(sampleResult(draft({ conditions: { new: false, used: true, cpo: true } }), "installed", { requireManagerApproval: true }, vehicle, 1)).toMatchObject({ eligible: false, proof: "excluded", publication: "not_published" });
    expect(sampleResult(draft(), "installed", { requireManagerApproval: true }, vehicle, null)).toMatchObject({ proof: "unknown", publication: "unknown" });
  });

  it("does not require proof for an optional accessory", () => {
    expect(sampleResult(draft(), "optional", { requireManagerApproval: false }, vehicle, null)).toMatchObject({ proof: "not_required", publication: "publishable" });
  });
});

describe("screen 07 samples and the addendum builder agree", () => {
  it("gives the same status for every saved rule shape and vehicle", async () => {
    const { productEligibility } = await import("@/hooks/useProductRules");
    const { draftFromRule, vehicleEligibility } = await import("./productApplicability");
    const conditions = ["new", "used", "all"] as const;
    const limits = [0, 28_115, 30_000];
    const vehicles = [
      { condition: "new", mileage: 12 },
      { condition: "used", mileage: 28_115 },
      { condition: "used", mileage: 28_116 },
      { condition: "cpo", mileage: 96_480 },
      { condition: "Certified Pre-Owned", mileage: 5_000 },
      { condition: null, mileage: 10_000 },
      { condition: "Fleet return", mileage: 10_000 },
      { condition: "used", mileage: null },
    ];
    let compared = 0;
    for (const condition of conditions) {
      for (const mileage_max of limits) {
        const saved = { id: "r", product_id: "p", year_min: "2020", year_max: "", makes: [], models: [], trims: [], body_styles: [], condition, mileage_max };
        for (const v of vehicles) {
          const sample = vehicleEligibility(draftFromRule(saved), { vin: "V", year: 2023, make: "Example", model: "S30", trim: null, condition: v.condition, mileage: v.mileage });
          const addendum = productEligibility([saved], { year: "2023", make: "Example", model: "S30", trim: "", bodyStyle: "", condition: v.condition, mileage: v.mileage }, [{ id: "p" } as never]);
          const addendumStatus = addendum.eligible.length ? "eligible" : addendum.excluded.length ? "excluded" : "undetermined";
          expect(sample.status, `${condition} ${mileage_max} ${JSON.stringify(v)}`).toBe(addendumStatus);
          compared++;
        }
      }
    }
    expect(compared).toBe(72);
  });
});
