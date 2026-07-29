import { describe, expect, it } from "vitest";
import {
  AUTO_PUBLISH_POLICY_VERSION,
  evaluateAutoPublish,
  fromCents,
  reconcileMsrp,
  selectionAllowsAutoPublish,
  toCents,
  type AutoPublishBlockerCode,
  type AutoPublishInput,
} from "./autoPublish";
import { selectOemTemplate } from "./oem/selection";
import { OEM_REGISTRY, type OemId } from "./oem/identity";

// A vehicle that is fully in order: VIN-specific build sheet, a brand the
// engine renders, MSRP that adds up, clean QA. This is the state the whole
// point of the exercise is to publish without anyone pressing a button.
const clean = (): AutoPublishInput => ({
  hasBuildSheet: true,
  eligibility: { eligible: true, status: "eligible_new", reasons: [] },
  selection: {
    selectionStatus: "selected",
    downgrades: [],
    conflictingFields: [],
    hasTemplateDefinition: true,
  },
  templateOverrideActive: false,
  reconciliation: reconcileMsrp({
    baseMsrp: 53_350,
    optionsTotal: 2_450,
    destinationCharge: 1_195,
    statedTotalMsrp: 56_995,
  }),
  confidence: "HIGH",
  canonicalPassportUrl: "https://app.autolabels.io/v/JN1FV7AR5KM800521",
  qaChecks: {
    vin_drawn: true,
    content_complete: true,
    barcode_is_vin: true,
    qr_is_canonical_passport: true,
    page_count_ok: true,
  },
  completeness: { pass: true, code: "OK", missing: [], miscounted: [] },
  geometry: { pass: true, code: "OK", reasons: [] },
});

const codes = (input: AutoPublishInput): AutoPublishBlockerCode[] =>
  evaluateAutoPublish(input).blockers.map((b) => b.code);

describe("money is integer cents, never float", () => {
  it("converts and restores exactly", () => {
    expect(toCents(53_350.1)).toBe(5_335_010);
    expect(toCents(0)).toBe(0);
    expect(toCents(null)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(fromCents(5_335_010)).toBe(53_350.1);
    expect(fromCents(null)).toBeNull();
  });

  it("adds money the dealer's way, not IEEE-754's", () => {
    // 25333.47 + 538.61 + 131.47 is 26003.550000000003 in binary floating
    // point — a total that is not the total. Cents make the intermediate
    // exact, so the figure the document reconciles against is the figure a
    // person adding the column would get.
    expect(25_333.47 + 538.61 + 131.47).not.toBe(26_003.55);
    const r = reconcileMsrp({
      baseMsrp: 25_333.47,
      optionsTotal: 538.61,
      destinationCharge: 131.47,
      statedTotalMsrp: 26_003.55,
    });
    expect(r.computedCents).toBe(2_600_355);
    expect(r.statedCents).toBe(2_600_355);
    expect(r.differenceCents).toBe(0);
    expect(r.difference).toBe(0);
    expect(r.status).toBe("MATCHED");
  });

  it("reports the difference as an exact two-decimal number", () => {
    const r = reconcileMsrp({
      baseMsrp: 30_000, optionsTotal: null, destinationCharge: 1_395, statedTotalMsrp: 31_398.37,
    });
    expect(r.differenceCents).toBe(337);
    expect(r.difference).toBe(3.37);
  });
});

describe("MSRP reconciliation", () => {
  it("needs both manufacturer anchors to say anything at all", () => {
    expect(reconcileMsrp({
      baseMsrp: 53_350, optionsTotal: null, destinationCharge: 1_195, statedTotalMsrp: null,
    }).status).toBe("INSUFFICIENT_DATA");
    expect(reconcileMsrp({
      baseMsrp: null, optionsTotal: null, destinationCharge: null, statedTotalMsrp: 56_995,
    }).status).toBe("INSUFFICIENT_DATA");
  });

  it("matches within five dollars and flags anything larger", () => {
    const at = (stated: number) => reconcileMsrp({
      baseMsrp: 50_000, optionsTotal: 0, destinationCharge: 1_000, statedTotalMsrp: stated,
    }).status;
    expect(at(51_000)).toBe("MATCHED");
    expect(at(51_005)).toBe("MATCHED");
    expect(at(51_005.01)).toBe("MINOR_VARIANCE");
    expect(at(51_100)).toBe("MINOR_VARIANCE");
    expect(at(51_100.01)).toBe("REVIEW_REQUIRED");
  });

  it("treats a missing destination charge as the discrepancy it is", () => {
    // The computed total is short by exactly the destination charge. Silently
    // accepting that would print a price table that does not add up.
    const r = reconcileMsrp({
      baseMsrp: 50_000, optionsTotal: 0, destinationCharge: null, statedTotalMsrp: 51_395,
    });
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.difference).toBe(1_395);
  });
});

describe("template selection policy", () => {
  it("publishes a clean selection", () => {
    expect(selectionAllowsAutoPublish({
      selectionStatus: "selected", downgrades: [], conflictingFields: [], hasTemplateDefinition: true,
    })).toBe(true);
  });

  it("publishes a brand whose model year has no authored profile", () => {
    // The brand's own registered theme still renders the document; only the
    // year-pinned profile is engine-generated, and a profile selects
    // presentation only.
    expect(selectionAllowsAutoPublish({
      selectionStatus: "manual_review",
      downgrades: ["generated_fallback_profile"],
      conflictingFields: [],
      hasTemplateDefinition: true,
    })).toBe(true);
  });

  it("never publishes a make that only matched fuzzily", () => {
    expect(selectionAllowsAutoPublish({
      selectionStatus: "manual_review",
      downgrades: ["make_fuzzy", "generated_fallback_profile"],
      conflictingFields: ["make"],
      hasTemplateDefinition: true,
    })).toBe(false);
  });

  it("never publishes without a model year", () => {
    expect(selectionAllowsAutoPublish({
      selectionStatus: "manual_review",
      downgrades: ["model_year_missing", "generated_fallback_profile"],
      conflictingFields: [],
      hasTemplateDefinition: true,
    })).toBe(false);
  });

  it("never publishes a brand with no renderable template", () => {
    expect(selectionAllowsAutoPublish({
      selectionStatus: "unsupported", downgrades: [], conflictingFields: [], hasTemplateDefinition: false,
    })).toBe(false);
    expect(selectionAllowsAutoPublish({
      selectionStatus: "conflict", downgrades: [], conflictingFields: ["make"], hasTemplateDefinition: false,
    })).toBe(false);
  });

  it("fails closed on a downgrade code it has never been reasoned about", () => {
    expect(selectionAllowsAutoPublish({
      selectionStatus: "manual_review",
      // Cast on purpose: this is the future-proofing assertion. A new
      // downgrade added to the selection engine must block until someone
      // decides otherwise here.
      downgrades: ["some_future_downgrade" as never],
      conflictingFields: [],
      hasTemplateDefinition: true,
    })).toBe(false);
  });
});

// The policy above is only correct if it matches what the real selection
// engine emits. This walks the whole registry rather than trusting a
// hand-written fixture to stay in step with it.
describe("policy against the real selection engine", () => {
  const brands = (Object.keys(OEM_REGISTRY) as OemId[])
    .filter((id) => id !== "AUTOLABELS_FALLBACK");

  it("publishes every registered brand across a modern and a legacy model year", () => {
    for (const id of brands) {
      const make = OEM_REGISTRY[id].displayName;
      for (const year of [2016, 2019, 2021, 2024, 2026, 2030]) {
        const selection = selectOemTemplate({ canonicalMake: make, modelYear: year });
        expect(selection.definition, `${make} ${year}`).not.toBeNull();
        expect(selectionAllowsAutoPublish({
          selectionStatus: selection.selectionStatus,
          downgrades: selection.downgrades,
          conflictingFields: selection.conflictingFields,
          hasTemplateDefinition: !!selection.definition,
        }), `${make} ${year}`).toBe(true);
      }
    }
  });

  it("is what changed: pre-2020 inventory used to be permanently unpublishable", () => {
    const selection = selectOemTemplate({ canonicalMake: "Toyota", modelYear: 2016 });
    expect(selection.selectionStatus).toBe("manual_review");
    expect(selection.downgrades).toEqual(["generated_fallback_profile"]);
    expect(selectionAllowsAutoPublish({
      selectionStatus: selection.selectionStatus,
      downgrades: selection.downgrades,
      conflictingFields: selection.conflictingFields,
      hasTemplateDefinition: !!selection.definition,
    })).toBe(true);
  });

  it("still refuses a cross-source make conflict", () => {
    const selection = selectOemTemplate({
      canonicalMake: "Buick", modelYear: 2024, corroboratingMakes: ["Chevrolet"],
    });
    expect(selection.selectionStatus).toBe("conflict");
    expect(selectionAllowsAutoPublish({
      selectionStatus: selection.selectionStatus,
      downgrades: selection.downgrades,
      conflictingFields: selection.conflictingFields,
      hasTemplateDefinition: !!selection.definition,
    })).toBe(false);
  });

  it("still refuses a make with no registered template", () => {
    const selection = selectOemTemplate({ canonicalMake: "Mitsubishi", modelYear: 2024 });
    expect(selection.selectionStatus).toBe("unsupported");
    expect(selectionAllowsAutoPublish({
      selectionStatus: selection.selectionStatus,
      downgrades: selection.downgrades,
      conflictingFields: selection.conflictingFields,
      hasTemplateDefinition: !!selection.definition,
    })).toBe(false);
  });

  it("still refuses a corporate parent standing in for a brand", () => {
    const selection = selectOemTemplate({
      canonicalMake: null, canonicalManufacturer: "Stellantis", modelYear: 2024,
    });
    expect(selectionAllowsAutoPublish({
      selectionStatus: selection.selectionStatus,
      downgrades: selection.downgrades,
      conflictingFields: selection.conflictingFields,
      hasTemplateDefinition: !!selection.definition,
    })).toBe(false);
  });

  it("still refuses a missing model year on an otherwise perfect record", () => {
    const selection = selectOemTemplate({ canonicalMake: "Toyota", modelYear: null });
    expect(selection.downgrades).toContain("model_year_missing");
    expect(selectionAllowsAutoPublish({
      selectionStatus: selection.selectionStatus,
      downgrades: selection.downgrades,
      conflictingFields: selection.conflictingFields,
      hasTemplateDefinition: !!selection.definition,
    })).toBe(false);
  });
});

describe("evaluateAutoPublish", () => {
  it("publishes a clean run with no reason attached", () => {
    const d = evaluateAutoPublish(clean());
    expect(d.autoPublish).toBe(true);
    expect(d.blockers).toEqual([]);
    expect(d.reviewReason).toBeNull();
  });

  it("publishes a 2016 used reproduction off a fallback theme profile", () => {
    const d = evaluateAutoPublish({
      ...clean(),
      eligibility: { eligible: true, status: "eligible_used_reproduction", reasons: [] },
      selection: {
        selectionStatus: "manual_review",
        downgrades: ["generated_fallback_profile"],
        conflictingFields: [],
        hasTemplateDefinition: true,
      },
    });
    expect(d.autoPublish).toBe(true);
  });

  // ── The five states that must never publish themselves ──────────────

  it("blocks when the build sheet is absent", () => {
    expect(codes({ ...clean(), hasBuildSheet: false })).toContain("build_sheet_absent");
  });

  it("blocks when a conflict blocker fired", () => {
    expect(codes({
      ...clean(),
      eligibility: {
        eligible: false,
        status: "ineligible_condition_conflict",
        reasons: ["trusted sources disagree on condition: new vs used"],
      },
    })).toContain("not_eligible");
  });

  it("blocks when the MSRP arithmetic does not reconcile", () => {
    const d = evaluateAutoPublish({
      ...clean(),
      reconciliation: reconcileMsrp({
        baseMsrp: 50_000, optionsTotal: 0, destinationCharge: 1_395, statedTotalMsrp: 58_000,
      }),
    });
    expect(d.autoPublish).toBe(false);
    expect(d.blockers.map((b) => b.code)).toContain("msrp_does_not_reconcile");
    // The dealer is told the actual numbers, not a status enum.
    expect(d.reviewReason).toContain("$51,395.00");
    expect(d.reviewReason).toContain("$58,000.00");
    expect(d.reviewReason).toContain("$6,605.00");
  });

  it("blocks a minor variance too — near enough is not reconciled", () => {
    expect(codes({
      ...clean(),
      reconciliation: reconcileMsrp({
        baseMsrp: 50_000, optionsTotal: 0, destinationCharge: 1_000, statedTotalMsrp: 51_050,
      }),
    })).toContain("msrp_does_not_reconcile");
  });

  it("blocks when one of the two MSRP anchors is missing", () => {
    expect(codes({
      ...clean(),
      reconciliation: reconcileMsrp({
        baseMsrp: 50_000, optionsTotal: null, destinationCharge: null, statedTotalMsrp: null,
      }),
    })).toContain("msrp_incomplete");
  });

  it("blocks when the brand has no template the engine can render", () => {
    expect(codes({
      ...clean(),
      selection: {
        selectionStatus: "unsupported", downgrades: [], conflictingFields: [],
        hasTemplateDefinition: false,
      },
    })).toContain("template_unresolved");
  });

  it("blocks when the vehicle is not eligible for a reproduction", () => {
    const d = evaluateAutoPublish({
      ...clean(),
      eligibility: {
        eligible: false,
        status: "ineligible_used",
        reasons: ["this dealership has turned off manufacturer-style reproductions for used and CPO inventory"],
      },
    });
    expect(d.autoPublish).toBe(false);
    expect(d.reviewReason).toContain("turned off manufacturer-style reproductions");
  });

  // ── Rendering and identity ──────────────────────────────────────────

  it("blocks when the render dropped required content", () => {
    const d = evaluateAutoPublish({
      ...clean(),
      qaChecks: { ...clean().qaChecks, content_complete: false },
      completeness: {
        pass: false, code: "LAYOUT_OVERFLOW",
        missing: [{ label: "Premium Package — Heated steering wheel" }],
        miscounted: [],
      },
    });
    expect(d.autoPublish).toBe(false);
    expect(d.blockers.map((b) => b.code)).toEqual(["layout_incomplete"]);
    expect(d.reviewReason).toContain("Heated steering wheel");
  });

  it("blocks when a priced package printed twice", () => {
    const d = evaluateAutoPublish({
      ...clean(),
      qaChecks: { ...clean().qaChecks, content_complete: false },
      completeness: {
        pass: false, code: "PDF_VALIDATION_FAILED", missing: [],
        miscounted: [{ label: "Package Technology Package listed once", actualCount: 2 }],
      },
    });
    expect(d.autoPublish).toBe(false);
    expect(d.reviewReason).toContain("appeared 2x");
  });

  it("blocks on a page geometry failure", () => {
    expect(codes({
      ...clean(),
      qaChecks: { ...clean().qaChecks, page_count_ok: false },
      geometry: { pass: false, code: "LAYOUT_OVERFLOW", reasons: ["rendered 3 pages; the template allows at most 2"] },
    })).toContain("page_geometry_failed");
  });

  it("blocks when the barcode or QR is not this vehicle's", () => {
    const d = evaluateAutoPublish({
      ...clean(),
      qaChecks: { ...clean().qaChecks, barcode_is_vin: false, vin_drawn: false },
    });
    expect(d.autoPublish).toBe(false);
    expect(d.reviewReason).toContain("barcode_is_vin");
    expect(d.reviewReason).toContain("vin_drawn");
  });

  it("blocks when there is no passport address for the QR to resolve to", () => {
    const d = evaluateAutoPublish({
      ...clean(),
      canonicalPassportUrl: null,
      qaChecks: { ...clean().qaChecks, qr_is_canonical_passport: false },
    });
    expect(d.autoPublish).toBe(false);
    expect(d.blockers.map((b) => b.code)).toContain("passport_url_missing");
  });

  it("blocks a generic typical-for-trim decode", () => {
    expect(codes({ ...clean(), confidence: "LOW" })).toContain("low_confidence");
  });

  it("leaves a hand-pinned template for the manager who pinned it", () => {
    const d = evaluateAutoPublish({ ...clean(), templateOverrideActive: true });
    expect(d.autoPublish).toBe(false);
    expect(d.blockers.map((b) => b.code)).toEqual(["template_override_active"]);
  });

  it("reports every blocker at once rather than only the first", () => {
    const d = evaluateAutoPublish({
      ...clean(),
      hasBuildSheet: false,
      confidence: "LOW",
      canonicalPassportUrl: null,
      reconciliation: reconcileMsrp({
        baseMsrp: null, optionsTotal: null, destinationCharge: null, statedTotalMsrp: null,
      }),
    });
    expect(d.blockers.map((b) => b.code).sort()).toEqual([
      "build_sheet_absent", "low_confidence", "msrp_incomplete", "passport_url_missing",
    ]);
    // Every blocker names itself in the stored reason, so the card never
    // shows one problem while a second is what actually needs fixing.
    for (const b of d.blockers) expect(d.reviewReason).toContain(b.code);
  });

  it("carries a policy version so a policy change re-decides the fleet", () => {
    expect(AUTO_PUBLISH_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
