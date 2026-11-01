import { writeFileSync } from "node:fs";
import * as pdfLibModule from "pdf-lib";
import { describe, expect, it } from "vitest";
import { adaptRenderData, type FactoryStickerRenderData } from "../contract";
import { realizePdf } from "../toPdf";
import { infinitiBenchmark } from "../__fixtures__/renderData";
import { expectNoTextOverlap, pageStrings } from "../__fixtures__/layoutAsserts";
import { PASSPORT_QR_CAPTION, REPRODUCTION_BANNER, REPRODUCTION_DISCLOSURE } from "../../reproduction";
import type { VariantLayoutBuilder } from "./shared";
import { buildHyundaiSantaFeHybridLayout } from "./hyundaiSantaFeHybrid";
import { buildMitsubishiOutlanderLayout } from "./mitsubishiOutlander";
import { buildFordTransitCarbLayout } from "./fordTransitCarb";

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const PRINTED_BANNER = norm(REPRODUCTION_BANNER.replace(/[–—]/g, "-"));

// Synthetic vehicles; values are test data, not the Figma review samples.
const hyundaiFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  vin: "KM8TESTHYB0000001",
  identity: { year: "2026", make: "Hyundai", model: "Santa Fe Hybrid", trim: "SE" },
  mechanical: { engine: "Test 1.6L Hybrid", transmission: "Test 6-Speed", drivetrain: "AWD" },
  epa: {
    city: 36, highway: 31, combined: 33, annualFuelCost: 1300, ghgScore: 7, smogScore: 6,
    rangeMiles: null, fuelType: "Gasoline Hybrid", gallonsPer100Miles: 3.0, fiveYearCostDifference: 900,
  },
  warranty: {
    basic: "Test 5-year basic term", powertrain: "Test 10-year powertrain term",
    corrosion: null, roadside: null, emissions: null,
  },
});

const outlanderFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  vin: "JA4TESTOUT0000002",
  identity: { year: "2025", make: "Mitsubishi", model: "Outlander", trim: "SE" },
  mechanical: { engine: "Test 2.5L Engine", transmission: "Test CVT", drivetrain: "S-AWC" },
  epa: {
    city: 25, highway: 31, combined: 27, annualFuelCost: 1900, ghgScore: 4, smogScore: 5,
    rangeMiles: null, fuelType: "Gasoline Vehicle", gallonsPer100Miles: 3.7, fiveYearCostDifference: -400,
    classNote: "Test class range note.",
  },
});

const transitFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  vin: "1FTTESTTRN0000003",
  identity: { year: "2025", make: "Ford", model: "Transit-250 Cargo Van", trim: "Base" },
  mechanical: { engine: "Test 3.5L V6", transmission: "Test 10-Speed", drivetrain: "RWD" },
  epa: {
    city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null,
    rangeMiles: null, fuelType: "Flex Fuel (E85)",
  },
  safety: null,
  nhtsaNotRated: true,
});

const cases: Array<[string, () => FactoryStickerRenderData, VariantLayoutBuilder, string]> = [
  ["hyundai-2026-santa-fe-hybrid-se-awd", hyundaiFixture, buildHyundaiSantaFeHybridLayout, "Hyundai"],
  ["mitsubishi-2025-outlander-se-s-awc", outlanderFixture, buildMitsubishiOutlanderLayout, "Mitsubishi"],
  ["ford-2025-transit-250-cargo-rwd-e85-carb", transitFixture, buildFordTransitCarbLayout, "Ford"],
];

const run = (
  build: VariantLayoutBuilder, fixture: FactoryStickerRenderData, displayMake: string,
) => build({
  layout: adaptRenderData(fixture),
  equipmentGroups: Object.entries(fixture.standardEquipment).map(([hint, items]) => ({ hint, items })),
  displayMake,
});

describe("Tabloid reproduction layouts (Hyundai, Mitsubishi, Ford)", () => {
  for (const [key, make, build, displayMake] of cases) {
    describe(key, () => {
      const fixture = make();
      const model = run(build, fixture, displayMake);

      it("builds a 17x11 model", () => {
        expect(model).not.toBeNull();
        expect(model!.width).toBe(1224);
        expect(model!.height).toBe(792);
      });

      it("prints the banner and the full disclosure on every page", () => {
        for (let i = 0; i < model!.pages.length; i++) {
          const strings = pageStrings(model!, i);
          expect(strings).toContain(PRINTED_BANNER);
          expect(norm(strings.join(" "))).toContain(norm(REPRODUCTION_DISCLOSURE));
        }
      });

      it("prints every equipment item and the VIN", () => {
        const printed = norm(model!.drawnStrings.join(" ")).toUpperCase();
        for (const item of Object.values(fixture.standardEquipment).flat()) {
          for (const w of norm(item).toUpperCase().split(" ")) expect(printed, item).toContain(w);
        }
        expect(printed).toContain(fixture.vin);
      });

      it("captions the Passport QR exactly and omits it when there is no Passport", () => {
        expect(model!.drawnStrings).toContain(PASSPORT_QR_CAPTION);
        expect(model!.pages.flatMap((p) => p.primitives).some((p) => p.kind === "qr")).toBe(true);
        const none = run(build, { ...fixture, passportUrl: "" }, displayMake)!;
        expect(none.drawnStrings).not.toContain(PASSPORT_QR_CAPTION);
        expect(none.pages.flatMap((p) => p.primitives).some((p) => p.kind === "qr")).toBe(false);
      });

      it("omits the dealer block unless the dealer is proven", () => {
        expect(model!.drawnStrings.join(" ")).not.toContain(fixture.dealer.name ?? "unreachable");
        const proven = run(build, { ...fixture, dealerRole: "original_delivery" }, displayMake)!;
        expect(proven.drawnStrings.join(" ")).toContain((fixture.dealer.name ?? "").toUpperCase());
      });

      it("keeps text from overlapping on page 1", () => {
        expectNoTextOverlap(model!, 0);
        const proven = run(build, { ...fixture, dealerRole: "original_delivery" }, displayMake)!;
        expectNoTextOverlap(proven, 0);
      });

      it("continues long equipment onto further pages without dropping items", () => {
        const extra = Array.from({ length: 300 }, (_, i) => `Variant Extended Line ${String(i).padStart(3, "0")}`);
        const long = run(
          build, { ...fixture, standardEquipment: { ...fixture.standardEquipment, technology: extra } }, displayMake,
        )!;
        expect(long.pages.length).toBeGreaterThan(1);
        const printed = long.drawnStrings.join("\n").toUpperCase();
        for (const line of extra) expect(printed).toContain(line.toUpperCase());
        const last = long.pages.length;
        expect(pageStrings(long, last - 1)).toContain(`PAGE ${last} OF ${last}`);
        for (let i = 0; i < last; i++) {
          expect(pageStrings(long, i)).toContain(PRINTED_BANNER);
          expect(norm(pageStrings(long, i).join(" "))).toContain(norm(REPRODUCTION_DISCLOSURE));
        }
        expectNoTextOverlap(long, 1);
      });

      it("never prints a zero for unknown values", () => {
        const sparse = run(
          build,
          {
            ...fixture,
            pricing: { baseMsrp: null, destinationCharge: null, optionsTotal: null, totalMsrp: null },
            epa: null,
            safety: null,
          },
          displayMake,
        )!;
        expect(sparse).not.toBeNull();
        expect(sparse.drawnStrings.join(" ")).not.toMatch(/(^|[^\d.,])\$?0\.00\b/);
      });
    });
  }

  it("prints the fuel type from data and no letter grades where CARB data is absent", () => {
    const hyundai = run(buildHyundaiSantaFeHybridLayout, hyundaiFixture(), "Hyundai")!;
    expect(hyundai.drawnStrings).toContain("Gasoline Hybrid");
    const ford = run(buildFordTransitCarbLayout, transitFixture(), "Ford")!;
    expect(ford.drawnStrings).toContain("Flex Fuel (E85)");
    expect(ford.drawnStrings.filter((s) => s === "Not Available").length).toBe(2);
    expect(ford.drawnStrings.join(" ")).not.toMatch(/PARTS CONTENT/i);
  });

  it("returns null when the price list cannot fit", () => {
    const f = outlanderFixture();
    const many = Array.from({ length: 90 }, (_, i) => ({ name: `Test Option ${i}`, code: null, msrp: 10 + i }));
    expect(run(buildMitsubishiOutlanderLayout, { ...f, options: many }, "Mitsubishi")).toBeNull();
  });

  it.skipIf(!process.env.WRITE_VARIANT_SAMPLES)("writes sample PDFs", async () => {
    for (const [key, make, build, displayMake] of cases) {
      const m = run(build, { ...make(), dealerRole: "original_delivery" }, displayMake)!;
      const bytes = await realizePdf(m, pdfLibModule as never);
      writeFileSync(`${process.env.WRITE_VARIANT_SAMPLES}/${key}.pdf`, bytes);
    }
  });
});
