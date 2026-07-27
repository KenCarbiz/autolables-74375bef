import { describe, expect, it } from "vitest";
import {
  getTemplateDefinition,
  listCompatibleTemplates,
  listTemplateDefinitions,
  selectOemTemplate,
  validatePageGeometry,
  validateTemplateOverride,
} from "./selection";
import { evaluateStickerEligibility, classifyCondition } from "./eligibility";

describe("OEM template registry", () => {
  it("publishes a geometry and required-field contract for every registered brand", () => {
    const defs = listTemplateDefinitions(2026);
    expect(defs.length).toBeGreaterThan(25);
    for (const d of defs) {
      expect(d.key, d.displayName).toMatch(/^oem-[a-z0-9-]+$/);
      expect(d.pageFormat.orientation, d.displayName).toBe("landscape");
      expect(d.pageFormat.widthInches, d.displayName).toBeCloseTo(11, 5);
      expect(d.pageFormat.heightInches, d.displayName).toBeCloseTo(8.5, 5);
      expect(d.pageFormat.expectedPageCount, d.displayName).toBe(1);
      expect(d.requiredDataFields, d.displayName).toContain("pricing.totalMsrp");
      expect(d.blockingValidations, d.displayName).toContain("msrp_reconciles_exactly");
      expect(d.layoutFamily, d.displayName).toBeTruthy();
    }
    // Template keys are unique — two brands can never share one.
    expect(new Set(defs.map((d) => d.key)).size).toBe(defs.length);
  });

  it("has no definition for the neutral fallback", () => {
    expect(getTemplateDefinition("AUTOLABELS_FALLBACK", 2026)).toBeNull();
  });
});

describe("OEM template selection engine", () => {
  it("selects on a trusted canonical make", () => {
    const r = selectOemTemplate({ canonicalMake: "Buick", modelYear: 2025 });
    expect(r.selectionStatus).toBe("selected");
    expect(r.canonicalMake).toBe("BUICK");
    expect(r.templateKey).toBe("oem-buick");
    expect(r.templateFamily).toBe("refined-factory-technical");
    expect(r.confidence).toBe(1);
  });

  it("accepts a registered manufacturer alias at slightly lower confidence", () => {
    const r = selectOemTemplate({ canonicalMake: "Buick Motor Division", modelYear: 2025 });
    expect(r.canonicalMake).toBe("BUICK");
    expect(r.selectionStatus).toBe("selected");
    expect(r.confidence).toBeLessThan(1);
    expect(r.reasons.join(" ")).toContain("alias");
  });

  it("never lets a corporate parent choose between its brands", () => {
    for (const parent of [
      "General Motors", "Stellantis", "FCA US LLC", "Hyundai Motor Group",
      "Toyota Motor Corporation", "Honda Motor", "Nissan Motor", "Ford Motor",
      "Volkswagen Group",
    ]) {
      const r = selectOemTemplate({ canonicalMake: parent, modelYear: 2026 });
      expect(r.templateKey, parent).toBeNull();
      expect(r.selectionStatus, parent).toBe("unsupported");
    }
  });

  it("treats a bare manufacturer with no make as manual review, not a guess", () => {
    const r = selectOemTemplate({ canonicalManufacturer: "General Motors LLC", modelYear: 2026 });
    expect(r.templateKey).toBeNull();
    expect(r.selectionStatus).toBe("manual_review");
    expect(r.conflictingFields).toContain("make");
    expect(r.reasons.join(" ")).toContain("cannot select a brand on its own");
  });

  it("blocks when two trusted sources name different brands", () => {
    const r = selectOemTemplate({
      canonicalMake: "Chevrolet",
      corroboratingMakes: ["GMC"],
      modelYear: 2026,
    });
    expect(r.selectionStatus).toBe("conflict");
    expect(r.templateKey).toBeNull();
    expect(r.canonicalMake).toBeNull();
    expect(r.conflictingFields).toContain("make");
  });

  it("selects when independent sources agree", () => {
    const r = selectOemTemplate({
      canonicalMake: "Chevrolet",
      corroboratingMakes: ["CHEVROLET", "Chevy"],
      modelYear: 2026,
    });
    expect(r.selectionStatus).toBe("selected");
    expect(r.canonicalMake).toBe("CHEVROLET");
    expect(r.sourceReferences).toContain("corroboratingMake");
  });

  it("keeps corporate sibling brands on their own templates", () => {
    const pairs: Array<[string, string]> = [
      ["Buick", "Cadillac"], ["Chevrolet", "GMC"],
      ["Hyundai", "Genesis"], ["Genesis", "Kia"],
      ["Honda", "Acura"], ["Toyota", "Lexus"],
      ["Nissan", "INFINITI"], ["Ford", "Lincoln"],
      ["Chrysler", "Dodge"], ["Jeep", "Ram"],
      ["Volkswagen", "Audi"], ["Audi", "Porsche"],
    ];
    for (const [a, b] of pairs) {
      const ra = selectOemTemplate({ canonicalMake: a, modelYear: 2026 });
      const rb = selectOemTemplate({ canonicalMake: b, modelYear: 2026 });
      expect(ra.templateKey, `${a}/${b}`).not.toBe(rb.templateKey);
      expect(ra.canonicalMake, `${a}/${b}`).not.toBe(rb.canonicalMake);
    }
  });

  it("refuses dealer names, descriptions and shared technology as selectors", () => {
    for (const noise of [
      "Lakeview Chevrolet dealership", "Chrysler Capital", "GM Financial",
      "Mopar", "OnStar", "Audi-style", "BMW replica", "Toyota-certified dealer",
    ]) {
      const r = selectOemTemplate({ canonicalMake: noise, modelYear: 2026 });
      expect(r.templateKey, noise).toBeNull();
      expect(r.selectionStatus, noise).toBe("unsupported");
    }
  });

  it("reports an unsupported market rather than substituting the US set", () => {
    const r = selectOemTemplate({ canonicalMake: "Buick", market: "CA", modelYear: 2026 });
    expect(r.selectionStatus).toBe("unsupported");
    expect(r.templateKey).toBeNull();
  });

  it("downgrades to manual review when the model year is unknown", () => {
    const r = selectOemTemplate({ canonicalMake: "Buick", modelYear: null });
    expect(r.confidence).toBeLessThanOrEqual(0.7);
    expect(r.selectionStatus).toBe("manual_review");
    expect(r.reasons.join(" ")).toContain("model year missing");
  });
});

describe("page geometry validation", () => {
  const format = {
    widthInches: 11, heightInches: 8.5, orientation: "landscape" as const,
    expectedPageCount: 1, continuationAllowed: true,
  };

  it("passes the engine's native landscape page", () => {
    const r = validatePageGeometry(format, { widthPt: 792, heightPt: 612, pageCount: 1 });
    expect(r).toEqual({ pass: true, code: "OK", reasons: [] });
  });

  it("fails a portrait page as a PDF validation failure", () => {
    const r = validatePageGeometry(format, { widthPt: 612, heightPt: 792, pageCount: 1 });
    expect(r.pass).toBe(false);
    expect(r.code).toBe("PDF_VALIDATION_FAILED");
    expect(r.reasons.join(" ")).toContain("orientation");
  });

  it("reports too many pages as layout overflow, not a size failure", () => {
    const r = validatePageGeometry(format, { widthPt: 792, heightPt: 612, pageCount: 3 });
    expect(r.code).toBe("LAYOUT_OVERFLOW");
  });

  it("rejects a continuation page when the template forbids one", () => {
    const strict = { ...format, continuationAllowed: false };
    expect(validatePageGeometry(strict, { widthPt: 792, heightPt: 612, pageCount: 2 }).code)
      .toBe("LAYOUT_OVERFLOW");
    expect(validatePageGeometry(format, { widthPt: 792, heightPt: 612, pageCount: 2 }).pass)
      .toBe(true);
  });
});

describe("sticker eligibility", () => {
  const complete = { hasVinSpecificBuildData: true, hasManufacturerPricing: true };

  it("classifies condition from the structured value only", () => {
    expect(classifyCondition("New")).toBe("new");
    expect(classifyCondition("certified pre-owned")).toBe("cpo");
    expect(classifyCondition("pre-owned")).toBe("used");
    expect(classifyCondition("")).toBe("unknown");
    expect(classifyCondition("clean, one owner")).toBe("unknown");
  });

  it("lets a complete new vehicle through", () => {
    const r = evaluateStickerEligibility({ condition: "new", ...complete });
    expect(r.eligible).toBe(true);
    expect(r.status).toBe("eligible_new");
    expect(r.requiresReproductionDisclosure).toBe(true);
  });

  it("keeps used inventory in the Used Car Sticker workflow by default", () => {
    const r = evaluateStickerEligibility({ condition: "used", ...complete });
    expect(r.eligible).toBe(false);
    expect(r.status).toBe("ineligible_used");
    const cpo = evaluateStickerEligibility({ condition: "cpo", ...complete });
    expect(cpo.eligible).toBe(false);
  });

  it("permits a used reproduction only on an explicit tenant opt-in", () => {
    const r = evaluateStickerEligibility({
      condition: "used", settings: { used_reproduction: true }, ...complete,
    });
    expect(r.eligible).toBe(true);
    expect(r.status).toBe("eligible_used_reproduction");
    expect(r.requiresReproductionDisclosure).toBe(true);
  });

  it("blocks when trusted sources disagree on condition", () => {
    const r = evaluateStickerEligibility({
      condition: "new", corroboratingConditions: ["used"], ...complete,
    });
    expect(r.eligible).toBe(false);
    expect(r.blockerCode).toBe("VEHICLE_CONDITION_CONFLICT");
  });

  it("blocks on missing manufacturer data instead of filling gaps", () => {
    const r = evaluateStickerEligibility({
      condition: "new", hasVinSpecificBuildData: false, hasManufacturerPricing: false,
    });
    expect(r.eligible).toBe(false);
    expect(r.blockerCode).toBe("MISSING_VERIFIED_DATA");
    expect(r.reasons.length).toBe(2);
  });

  it("honours the dealership disabling factory stickers entirely", () => {
    const r = evaluateStickerEligibility({
      condition: "new", settings: { enabled: false }, ...complete,
    });
    expect(r.eligible).toBe(false);
    expect(r.status).toBe("ineligible_disabled");
  });
});

describe("manual template override", () => {
  it("offers only the vehicle's own brand and the neutral template", () => {
    const options = listCompatibleTemplates("BUICK", 2025);
    expect(options.map((o) => o.templateKey).sort())
      .toEqual(["oem-autolabels-fallback", "oem-buick"]);
    expect(options.find((o) => o.templateKey === "oem-buick")?.isAutomatic).toBe(true);
    expect(options.find((o) => o.neutral)?.templateKey).toBe("oem-autolabels-fallback");
  });

  it("allows switching to the neutral template", () => {
    const v = validateTemplateOverride("BUICK", "oem-autolabels-fallback", 2025);
    expect(v.allowed).toBe(true);
    expect(v.option?.neutral).toBe(true);
  });

  it("allows re-applying the brand's own template", () => {
    expect(validateTemplateOverride("BUICK", "oem-buick", 2025).allowed).toBe(true);
  });

  it("refuses another manufacturer's template even when a user asks for it", () => {
    for (const [make, requested] of [
      ["BUICK", "oem-chevrolet"], ["CHEVROLET", "oem-buick"],
      ["HONDA", "oem-acura"], ["TOYOTA", "oem-lexus"],
      ["JEEP", "oem-ram"], ["AUDI", "oem-porsche"],
    ] as const) {
      const v = validateTemplateOverride(make, requested, 2026);
      expect(v.allowed, `${make} -> ${requested}`).toBe(false);
      expect(v.reason, `${make} -> ${requested}`).toContain("different manufacturer");
    }
  });

  it("refuses an unregistered template key", () => {
    const v = validateTemplateOverride("BUICK", "oem-delorean", 2025);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("not a registered template");
  });

  it("offers only the neutral template when the make never resolved", () => {
    const options = listCompatibleTemplates(null, 2026);
    expect(options.map((o) => o.templateKey)).toEqual(["oem-autolabels-fallback"]);
    expect(validateTemplateOverride(null, "oem-buick", 2026).allowed).toBe(false);
  });

  it("rejects an empty request", () => {
    expect(validateTemplateOverride("BUICK", "", 2025).allowed).toBe(false);
  });
});
