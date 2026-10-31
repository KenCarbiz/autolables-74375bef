import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAPER_SIZES,
  REFERENCE_FIGMA_FILE_KEY,
  REFERENCE_VARIANTS,
  getReferenceVariant,
  normalizeDrivetrain,
  normalizePowertrain,
  resolveReferenceVariant,
  type ReferenceVariantInput,
} from "./referenceVariants";

const SEVEN: Array<[string, ReferenceVariantInput, string, string]> = [
  ["infiniti-2026-qx60-sport-awd",
    { make: "INFINITI", modelYear: 2026, model: "QX60", trim: "SPORT", drivetrain: "AWD", fuelType: "Gasoline" },
    "LETTER_LANDSCAPE", "EPA_GASOLINE_MPG"],
  ["nissan-2026-pathfinder-platinum-4wd",
    { make: "Nissan", modelYear: 2026, model: "Pathfinder", trim: "Platinum", drivetrain: "4WD", fuelType: "Regular Unleaded" },
    "LETTER_LANDSCAPE", "EPA_GASOLINE_MPG"],
  ["hyundai-2026-santa-fe-hybrid-se-awd",
    { make: "Hyundai", modelYear: 2026, model: "Santa Fe Hybrid", trim: "SE", drivetrain: "All-Wheel Drive", fuelType: "Hybrid" },
    "TABLOID_LANDSCAPE", "EPA_HYBRID_MPG"],
  ["mitsubishi-2025-outlander-se-s-awc",
    { make: "Mitsubishi", modelYear: 2025, model: "Outlander", trim: "SE", drivetrain: "S-AWC", fuelType: "Gasoline" },
    "TABLOID_LANDSCAPE", "EPA_GASOLINE_MPG"],
  ["jeep-2024-grand-cherokee-4xe-phev",
    { make: "Jeep", modelYear: 2024, model: "Grand Cherokee 4xe", trim: null, drivetrain: "4X4", fuelType: "Plug-In Hybrid" },
    "TABLOID_LANDSCAPE", "EPA_PHEV_DUAL_MODE"],
  ["chrysler-2024-pacifica-select-phev",
    { make: "Chrysler", modelYear: 2024, model: "Pacifica Plug-In Hybrid", trim: "Select", drivetrain: "FWD", fuelType: "PHEV" },
    "TABLOID_LANDSCAPE", "EPA_PHEV_DUAL_MODE"],
  ["ford-2025-transit-250-cargo-rwd-e85-carb",
    { make: "Ford", modelYear: 2025, model: "Transit-250 Cargo Van", trim: "Base", drivetrain: "RWD", fuelType: "Flex Fuel (E85)" },
    "TABLOID_LANDSCAPE", "CARB_ENVIRONMENTAL"],
];

describe("reference variant registry", () => {
  it("registers exactly the seven handoff variants, each with unique keys and Figma nodes", () => {
    expect(REFERENCE_VARIANTS).toHaveLength(7);
    expect(new Set(REFERENCE_VARIANTS.map((v) => v.key)).size).toBe(7);
    expect(new Set(REFERENCE_VARIANTS.map((v) => v.figma.master)).size).toBe(7);
  });

  for (const [key, input, paper, panel] of SEVEN) {
    it(`selects ${key} with its paper size and powertrain treatment`, () => {
      const r = resolveReferenceVariant(input);
      expect(r.status, r.reasons.join("; ")).toBe("matched");
      expect(r.variant?.key).toBe(key);
      expect(r.variant?.paperSize).toBe(paper);
      expect(r.variant?.environmentPanel).toBe(panel);
      // No variant layout is implemented yet; the generic reproduction
      // layout renders and says so.
      expect(r.rendering).toBe("generic_reproduction_layout");
    });
  }

  it("uses the right physical page sizes", () => {
    expect(PAPER_SIZES.LETTER_LANDSCAPE).toMatchObject({ widthPt: 792, heightPt: 612 });
    expect(PAPER_SIZES.TABLOID_LANDSCAPE).toMatchObject({ widthPt: 1224, heightPt: 792 });
  });

  it("never routes a different trim, year, powertrain or model line into a reference layout", () => {
    const qx60 = SEVEN[0][1];
    expect(resolveReferenceVariant({ ...qx60, trim: "AUTOGRAPH" }).status).toBe("review_required");
    expect(resolveReferenceVariant({ ...qx60, modelYear: 2025 }).status).toBe("unsupported");
    expect(resolveReferenceVariant({ ...qx60, model: "QX80" }).status).toBe("unsupported");
    expect(resolveReferenceVariant({ ...qx60, drivetrain: "FWD" }).status).toBe("review_required");
    expect(resolveReferenceVariant({ ...qx60, drivetrain: null }).status).toBe("review_required");

    const santaFe = SEVEN[2][1];
    expect(resolveReferenceVariant({ ...santaFe, model: "Santa Fe", fuelType: "Gasoline" }).status).toBe("review_required");
    expect(resolveReferenceVariant({ ...santaFe, model: "Santa Fe Plug-in Hybrid" }).status).toBe("unsupported");
    expect(resolveReferenceVariant({ ...santaFe, trim: "SEL" }).status).toBe("review_required");

    const outlander = SEVEN[3][1];
    expect(resolveReferenceVariant({ ...outlander, model: "Outlander PHEV", fuelType: "Plug-in Hybrid" }).status).toBe("unsupported");
    expect(resolveReferenceVariant({ ...outlander, model: "Outlander Sport" }).status).toBe("unsupported");

    const jeep = SEVEN[4][1];
    expect(resolveReferenceVariant({ ...jeep, trim: "Trailhawk 4xe" }).status).toBe("review_required");
    expect(resolveReferenceVariant({ ...jeep, model: "Grand Cherokee", trim: "Limited", fuelType: "Gasoline" }).status)
      .toBe("review_required");

    const transit = SEVEN[6][1];
    expect(resolveReferenceVariant({ ...transit, model: "Transit-350 Cargo Van" }).status).toBe("review_required");
    expect(resolveReferenceVariant({ ...transit, fuelType: "Gasoline" }).status).toBe("review_required");
    expect(resolveReferenceVariant({ ...transit, model: "Transit Connect" }).status).toBe("unsupported");

    expect(resolveReferenceVariant({ make: "Toyota", modelYear: 2026, model: "RAV4", trim: "XLE", drivetrain: "AWD", fuelType: "Hybrid" }).status)
      .toBe("unsupported");
    expect(resolveReferenceVariant({ make: null, modelYear: 2026, model: "QX60", trim: "SPORT", drivetrain: "AWD", fuelType: "Gasoline" }).status)
      .toBe("unsupported");
  });

  it("keeps CARB and AALA applicability distinct for the Transit", () => {
    const transit = getReferenceVariant("ford-2025-transit-250-cargo-rwd-e85-carb");
    expect(transit?.environmentPanel).toBe("CARB_ENVIRONMENTAL");
    expect(transit?.partsContentPanel).toBe(false);
    expect(transit?.requiredEvidence).toContain("carb_configuration_matched_source");
  });

  it("requires validated PHEV label-mode evidence for the Jeep and Chrysler", () => {
    for (const key of ["jeep-2024-grand-cherokee-4xe-phev", "chrysler-2024-pacifica-select-phev"]) {
      expect(getReferenceVariant(key)?.requiredEvidence).toContain("epa_phev_label_mode_fields_validated");
    }
  });

  it("normalizes drivetrain and powertrain spellings conservatively", () => {
    expect(normalizeDrivetrain("S-AWC")).toBe("AWD");
    expect(normalizeDrivetrain("4x4")).toBe("4WD");
    expect(normalizeDrivetrain("Rear-Wheel Drive")).toBe("RWD");
    expect(normalizeDrivetrain("something")).toBeNull();
    expect(normalizePowertrain("Plug-In Hybrid")).toBe("PLUG_IN_HYBRID");
    expect(normalizePowertrain("Hybrid")).toBe("HYBRID");
    expect(normalizePowertrain("Flex Fuel (E85)")).toBe("FLEX_FUEL_E85");
    expect(normalizePowertrain("Electric")).toBeNull();
  });
});

interface CrosswalkSlot {
  nodeId: string;
  name: string;
  propertyKey: string;
  resolution: string;
  canonicalField?: string;
  [k: string]: unknown;
}
interface Crosswalk {
  figmaFileKey: string;
  templates: Array<{ key: string; figma: { master: string; review: string }; slotCount: number; slots: CrosswalkSlot[] }>;
}

describe("binding crosswalk", () => {
  const path = join(process.cwd(), "data/window-sticker-reference/binding-crosswalk.json");
  const crosswalk = JSON.parse(readFileSync(path, "utf8")) as Crosswalk;
  const RESOLUTIONS = new Set([
    "semantic", "semantic_positional", "semantic_positional_alias", "template_literal",
    "category_mapped_pending_review", "pending_semantic_review",
  ]);

  it("inventories all 1,037 handoff slots across the seven registered variants", () => {
    expect(crosswalk.figmaFileKey).toBe(REFERENCE_FIGMA_FILE_KEY);
    expect(crosswalk.templates.map((t) => t.key).sort()).toEqual(REFERENCE_VARIANTS.map((v) => v.key).sort());
    const total = crosswalk.templates.reduce((n, t) => n + t.slots.length, 0);
    expect(total).toBe(1037);
    for (const t of crosswalk.templates) {
      expect(t.slots.length).toBe(t.slotCount);
      expect(getReferenceVariant(t.key)?.figma.master).toBe(t.figma.master);
    }
  });

  it("has no orphan or duplicate bindings and resolves every slot to a known state", () => {
    for (const t of crosswalk.templates) {
      expect(new Set(t.slots.map((s) => s.nodeId)).size).toBe(t.slots.length);
      for (const s of t.slots) {
        expect(RESOLUTIONS.has(s.resolution), `${t.key} ${s.nodeId}`).toBe(true);
        const mapped = s.resolution !== "pending_semantic_review";
        expect(Boolean(s.canonicalField), `${t.key} ${s.nodeId}`).toBe(mapped);
      }
    }
  });

  it("carries no reference sample values", () => {
    for (const t of crosswalk.templates) {
      for (const s of t.slots) {
        expect(Object.keys(s)).not.toContain("sample");
      }
    }
    const raw = readFileSync(path, "utf8");
    // Reference VINs from the review instances must not appear anywhere.
    expect(raw).not.toMatch(/5N1AL1FW4TC351652|5NMP1DG13TH098463/);
  });

  it("maps Nissan's inherited equipment properties to their actual sections", () => {
    const nissan = crosswalk.templates.find((t) => t.key === "nissan-2026-pathfinder-platinum-4wd")!;
    const field = (name: string) => nissan.slots.find((s) => s.name === name)?.canonicalField;
    expect(field("equipment.comfort")).toBe("equipment.standard.safetySecurity");
    expect(field("equipment.driver")).toBe("equipment.standard.comfortConvenience");
    expect(field("equipment.safety")).toBe("equipment.standard.exterior");
  });

  it("treats option slot names as positional rows, never OEM option codes", () => {
    for (const t of crosswalk.templates) {
      for (const s of t.slots.filter((x) => x.name.startsWith("option."))) {
        expect(s.resolution).toBe("semantic_positional");
        expect(s.canonicalField).toBe("options.installed[]");
      }
    }
  });
});
