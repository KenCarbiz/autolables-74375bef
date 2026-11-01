import { writeFileSync } from "node:fs";
import * as pdfLibModule from "pdf-lib";
import { describe, expect, it } from "vitest";
import { adaptRenderData, type FactoryStickerRenderData } from "../contract";
import { jeep4xeFixture } from "../__fixtures__/renderData";
import { expectNoTextOverlap, pageStrings } from "../__fixtures__/layoutAsserts";
import { PASSPORT_QR_CAPTION, REPRODUCTION_BANNER, reproductionDisclosureLines } from "../../reproduction";
import { realizePdf } from "../toPdf";
import { buildJeepGrandCherokee4xeLayout } from "./jeepGrandCherokee4xe";
import { buildChryslerPacificaPhevLayout } from "./chryslerPacificaPhev";
import type { VariantLayoutBuilder } from "./shared";

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

const jeepFixture = (): FactoryStickerRenderData => ({
  ...jeep4xeFixture(),
  vin: "1C4RJYB60RC000001",
  identity: { year: "2024", make: "Jeep", model: "Grand Cherokee 4xe", trim: null },
  mechanical: { engine: "2.0L Test PHEV Engine", transmission: "8-Speed Test Transmission", drivetrain: "4X4" },
  colors: { exterior: { name: "Test Blue Pearl", code: "PBJ" }, interior: { name: "Test Black", code: "X7" } },
  pricing: { baseMsrp: 61230, destinationCharge: 1795, optionsTotal: 595, totalMsrp: 63620 },
  epa: {
    city: 52, highway: 57, combined: 54, annualFuelCost: 1810, ghgScore: 6, rangeMiles: 24,
    fuelType: "Plug-In Hybrid", smogScore: 5, gallonsPer100Miles: null, fiveYearCostDifference: 1420,
    classNote: "Standard SUV range test note for synthetic data.", gasCombinedMpg: 21,
  },
  warranty: {
    basic: "3-year or 36,000-mile Test Basic Limited Warranty.",
    powertrain: "5-year or 60,000-mile Test Powertrain Limited Warranty.",
    corrosion: null,
    roadside: null,
    emissions: "8-year or 100,000-mile Test High Voltage Battery Warranty.",
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "41%" },
    { label: "Major foreign parts content", value: "Testland 17%" },
    { label: "Final assembly point", value: "Testville, Michigan, U.S.A." },
    { label: "Engine", value: "Testland" },
    { label: "Transmission", value: "Otherland" },
  ],
  passportUrl: "https://example.test/v/synthetic-jeep",
  dealerRole: "original_delivery",
  dealer: { name: "Synthetic Motors", address: "1 Test Way", city: "Testville", state: "MI", zip: "48000", phone: "555-0100" },
});

const pacificaFixture = (): FactoryStickerRenderData => ({
  ...jeepFixture(),
  vin: "2C4RC1S70RR000002",
  identity: { year: "2024", make: "Chrysler", model: "Pacifica Plug-In Hybrid", trim: "Select" },
  mechanical: { engine: "3.6L Test V6 Hybrid", transmission: "Test eFlite Transmission", drivetrain: "FWD" },
  epa: {
    city: 80, highway: 78, combined: 79, annualFuelCost: 1290, ghgScore: 8, rangeMiles: 31,
    fuelType: "PHEV", smogScore: 7, gallonsPer100Miles: null, fiveYearCostDifference: -400,
    classNote: null, gasCombinedMpg: 29,
  },
  passportUrl: "https://example.test/v/synthetic-pacifica",
});

interface Case {
  key: string;
  build: VariantLayoutBuilder;
  fixture: () => FactoryStickerRenderData;
  make: string;
}

const cases: Case[] = [
  { key: "jeep-2024-grand-cherokee-4xe-phev", build: buildJeepGrandCherokee4xeLayout, fixture: jeepFixture, make: "Jeep" },
  { key: "chrysler-2024-pacifica-select-phev", build: buildChryslerPacificaPhevLayout, fixture: pacificaFixture, make: "Chrysler" },
];

const run = (c: Case, f: FactoryStickerRenderData) => {
  const model = c.build({
    layout: adaptRenderData(f),
    equipmentGroups: Object.entries(f.standardEquipment).map(([hint, items]) => ({ hint, items })),
    displayMake: c.make,
  });
  if (!model) throw new Error("builder returned null");
  return model;
};

describe("Stellantis tabloid PHEV layouts", () => {
  for (const c of cases) {
    describe(c.key, () => {
      const f = c.fixture();
      const model = run(c, f);
      const layout = adaptRenderData(f);

      it("is 17 x 11 landscape", () => {
        expect(model.width).toBe(1224);
        expect(model.height).toBe(792);
      });

      it("prints the banner and the full disclosure on every page", () => {
        const disclosure = norm([...reproductionDisclosureLines(layout.factoryBuild), ...layout.disclaimers].join(" "));
        for (let i = 0; i < model.pages.length; i++) {
          const strings = pageStrings(model, i);
          expect(strings).toContain(REPRODUCTION_BANNER.replace("—", "-"));
          expect(norm(strings.join(" "))).toContain(disclosure);
        }
      });

      it("prints every standard-equipment item, option and the VIN", () => {
        const printed = norm(model.drawnStrings.join(" ")).toUpperCase();
        for (const item of Object.values(f.standardEquipment).flat()) {
          for (const w of norm(item).toUpperCase().split(" ")) expect(printed, item).toContain(w);
        }
        for (const o of f.options) expect(printed).toContain(o.name.toUpperCase().split(" ")[0]);
        expect(printed).toContain(f.vin);
      });

      it("captions the Passport QR exactly and omits it without a URL", () => {
        expect(model.drawnStrings).toContain(PASSPORT_QR_CAPTION);
        const qrs = model.pages.flatMap((p) => p.primitives).filter((p) => p.kind === "qr");
        expect(qrs).toHaveLength(1);
        const none = run(c, { ...f, passportUrl: "" });
        expect(none.drawnStrings).not.toContain(PASSPORT_QR_CAPTION);
        expect(none.pages.flatMap((p) => p.primitives).some((p) => p.kind === "qr")).toBe(false);
      });

      it("prints the dealer block only when a dealer name exists", () => {
        expect(model.drawnStrings.join(" ")).toContain("SYNTHETIC MOTORS");
        const none = run(c, { ...f, dealerRole: null });
        expect(none.drawnStrings.join(" ")).not.toContain("SYNTHETIC MOTORS");
      });

      it("does not print the Figma sample values or OEM logo text", () => {
        const all = model.drawnStrings.join(" ");
        for (const sample of ["1C4RJYB6XRC129489", "FCA US LLC", "IAM-JEEP", "MOPAR", "$60,490", "$50,765"]) {
          expect(all).not.toContain(sample);
        }
      });

      it("keeps text from overlapping on page 1", () => {
        expectNoTextOverlap(model, 0);
      });

      it("does not print an electric range number when the data has none", () => {
        const none = run(c, { ...f, epa: { ...f.epa!, rangeMiles: null } });
        const s = none.drawnStrings.join(" ");
        expect(s).not.toContain("All electric range");
        expect(s).toContain("Electric range not available");
        expect(none.drawnStrings.some((t) => t === "miles")).toBe(false);
      });

      it("shows absent gasoline and EPA values as not available, never zero", () => {
        const none = run(c, { ...f, epa: { ...f.epa!, gasCombinedMpg: null, annualFuelCost: null, ghgScore: null, smogScore: null } });
        const s = none.drawnStrings;
        expect(s).toContain("Not Available");
        expect(s).toContain("Not Rated");
        expect(s.filter((x) => /^\$0(\.00)?$/.test(x))).toEqual([]);
      });

      it("continues long equipment onto further pages without dropping items", () => {
        const extra = Array.from({ length: 300 }, (_, i) => `Variant Extended Line ${String(i).padStart(3, "0")}`);
        const long = run(c, { ...f, standardEquipment: { ...f.standardEquipment, technology: extra } });
        expect(long.pages.length).toBeGreaterThan(1);
        const printed = long.drawnStrings.join("\n");
        for (const line of extra) expect(printed).toContain(line);
        const last = long.pages.length;
        expect(pageStrings(long, last - 1)).toContain(`PAGE ${last} OF ${last}`);
        for (let i = 0; i < last; i++) expect(pageStrings(long, i)).toContain(REPRODUCTION_BANNER.replace("—", "-"));
      });

      it("returns null when the pricing stack cannot fit", () => {
        const many = Array.from({ length: 80 }, (_, i) => ({ name: `Synthetic Option ${i}`, code: null, msrp: 100 }));
        const m = c.build({
          layout: adaptRenderData({ ...f, options: many }),
          equipmentGroups: Object.entries(f.standardEquipment).map(([hint, items]) => ({ hint, items })),
          displayMake: c.make,
        });
        expect(m).toBeNull();
      });
    });
  }

  it.skipIf(!process.env.WRITE_VARIANT_SAMPLES)("writes sample PDFs", async () => {
    for (const c of cases) {
      const bytes = await realizePdf(run(c, c.fixture()), pdfLibModule as never);
      writeFileSync(`${process.env.WRITE_VARIANT_SAMPLES}/${c.key}.pdf`, bytes);
    }
  });
});
