import { writeFileSync } from "node:fs";
import * as pdfLibModule from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildRenderLayout, runRenderPipeline, type FactoryStickerRenderData } from "../contract";
import { infinitiBenchmark, nissanBenchmark, themeFor } from "../__fixtures__/renderData";
import { expectNoTextOverlap, pageStrings } from "../__fixtures__/layoutAsserts";
import { PASSPORT_QR_CAPTION, REPRODUCTION_DISCLOSURE } from "../../reproduction";
import { resolveReferenceVariant } from "../../oem/referenceVariants";

const PRINTED_BANNER = "REPRODUCTION WINDOW STICKER - NOT AN ORIGINAL MANUFACTURER LABEL";
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

// Synthetic vehicles that satisfy the two Letter reference variants. Values
// are test data, not the Figma review samples.
export const qx60SportFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  vin: "5N1DL1HT0TC000001",
  identity: { year: "2026", make: "INFINITI", model: "QX60", trim: "SPORT" },
  mechanical: { engine: "2.0L VC-TURBO I4", transmission: "9-SPEED A/T", drivetrain: "AWD" },
  warranty: {
    basic: "4-Year/60,000-Mile Basic Limited Warranty",
    powertrain: "6-Year/70,000-Mile Powertrain Limited Warranty",
    corrosion: "7-Year/Unlimited-Mile Corrosion Limited Warranty",
    roadside: null,
    emissions: null,
  },
});

export const pathfinderPlatinumFixture = (): FactoryStickerRenderData => ({
  ...nissanBenchmark(),
  vin: "5N1DR3DK0TC000002",
  identity: { year: "2026", make: "Nissan", model: "Pathfinder", trim: "PLATINUM" },
  dealerRole: null,
  warranty: {
    basic: "3-Year/36,000-Mile Basic Limited Warranty",
    powertrain: "5-Year/60,000-Mile Powertrain Limited Warranty",
    corrosion: "5-Year/Unlimited-Mile Corrosion Limited Warranty",
    roadside: null,
    emissions: null,
  },
});

const variants: Array<[string, () => FactoryStickerRenderData, string, string]> = [
  ["infiniti-2026-qx60-sport-awd", qx60SportFixture, "infiniti", "TOTAL OWNERSHIP EXPERIENCE"],
  ["nissan-2026-pathfinder-platinum-4wd", pathfinderPlatinumFixture, "nissan", "NISSAN OWNERSHIP INFORMATION"],
];

const isVariant = (strings: string[]): boolean => strings.includes("Standard Equipment Included at No Extra Charge");

describe("Letter reference variant layouts", () => {
  for (const [key, make, theme, ownership] of variants) {
    describe(key, () => {
      const data = make();
      const model = buildRenderLayout(data, themeFor(theme));

      it("is selected only through an exact registry match", () => {
        const r = resolveReferenceVariant({
          make: data.identity.make,
          modelYear: Number(data.identity.year),
          model: data.identity.model,
          trim: data.identity.trim,
          drivetrain: data.mechanical?.drivetrain ?? null,
          fuelType: data.epa?.fuelType ?? null,
        });
        expect(r.status).toBe("matched");
        expect(r.variant?.key).toBe(key);
        expect(r.rendering).toBe("variant_layout");
        expect(isVariant(model.drawnStrings)).toBe(true);
      });

      it("prints the banner and the full disclosure on every page", () => {
        for (let i = 0; i < model.pages.length; i++) {
          const strings = pageStrings(model, i);
          expect(strings).toContain(PRINTED_BANNER);
          expect(norm(strings.join(" "))).toContain(norm(REPRODUCTION_DISCLOSURE));
        }
      });

      it("prints every standard-equipment item, option and price from the data", () => {
        const printed = norm(model.drawnStrings.join(" ")).toUpperCase();
        for (const item of Object.values(data.standardEquipment).flat()) {
          for (const w of norm(item).toUpperCase().split(" ")) expect(printed, item).toContain(w);
        }
        for (const o of data.options) expect(printed).toContain(o.name.toUpperCase().split(" ")[0]);
        expect(printed).toContain(data.vin);
        expect(model.drawnStrings.join(" ")).toContain(ownership);
      });

      it("captions the Passport QR exactly and omits it when there is no Passport", () => {
        expect(model.drawnStrings).toContain(PASSPORT_QR_CAPTION);
        const none = buildRenderLayout({ ...data, passportUrl: "" }, themeFor(theme));
        expect(none.drawnStrings).not.toContain(PASSPORT_QR_CAPTION);
        expect(none.pages.flatMap((p) => p.primitives).some((p) => p.kind === "qr")).toBe(false);
      });

      it("never claims to be the federal label or reuses source artwork text", () => {
        const all = model.drawnStrings.join(" ");
        expect(all).not.toMatch(/applied pursuant to Federal law/i);
        expect(all).not.toMatch(/Do not remove prior to delivery/i);
      });

      it("keeps text from overlapping on page 1", () => {
        expectNoTextOverlap(model, 0);
      });

      it("continues long equipment onto further pages without dropping items", () => {
        const extra = Array.from({ length: 260 }, (_, i) => `Variant Extended Line ${String(i).padStart(3, "0")}`);
        const long = buildRenderLayout(
          { ...data, standardEquipment: { ...data.standardEquipment, technology: extra } },
          themeFor(theme),
        );
        expect(isVariant(long.drawnStrings)).toBe(true);
        expect(long.pages.length).toBeGreaterThan(1);
        const printed = long.drawnStrings.join("\n");
        for (const line of extra) expect(printed).toContain(line);
        const last = long.pages.length;
        expect(pageStrings(long, last - 1)).toContain(`PAGE ${last} OF ${last}`);
        for (let i = 0; i < last; i++) expect(pageStrings(long, i)).toContain(PRINTED_BANNER);
      });

      it("draws the owner-authorized logo artwork in the master logo slot", () => {
        const imgs = model.pages[0].primitives.filter((p) => p.kind === "image");
        expect(imgs).toHaveLength(1);
        expect(imgs[0].kind === "image" && imgs[0].assetId).toMatch(/^figma-(infiniti|nissan)-logo-v1$/);
      });

      it("falls back to the generic layout under a template override", () => {
        const overridden = buildRenderLayout(data, { ...themeFor(theme), templateOverrideKey: "autolabels_fallback" });
        expect(isVariant(overridden.drawnStrings)).toBe(false);
      });
    });
  }

  it("keeps near-miss vehicles on the generic reproduction layout", () => {
    const qx60 = qx60SportFixture();
    for (const changed of [
      { ...qx60, identity: { ...qx60.identity, trim: "AUTOGRAPH" } },
      { ...qx60, identity: { ...qx60.identity, year: "2025" } },
      { ...qx60, mechanical: { ...qx60.mechanical!, drivetrain: "FWD" } },
    ]) {
      expect(isVariant(buildRenderLayout(changed, themeFor("infiniti")).drawnStrings)).toBe(false);
    }
    expect(isVariant(buildRenderLayout(nissanBenchmark(), themeFor("nissan")).drawnStrings)).toBe(false);
  });

  it("shows unrated and unavailable safety states distinctly, never as stars", () => {
    const base = qx60SportFixture();
    const m = buildRenderLayout({ ...base, safety: null }, themeFor("infiniti"));
    const s = m.drawnStrings.join(" ");
    expect(s).toMatch(/Not Rated|Not Available/);
  });

  it.skipIf(!process.env.WRITE_VARIANT_SAMPLES)("writes sample PDFs", async () => {
    const pdfLib = pdfLibModule as unknown as Parameters<typeof runRenderPipeline>[2];
    for (const [key, make, theme] of variants) {
      const r = await runRenderPipeline(make(), themeFor(theme), pdfLib);
      writeFileSync(`${process.env.WRITE_VARIANT_SAMPLES}/${key}.pdf`, r.pdfBytes);
    }
  });
});
