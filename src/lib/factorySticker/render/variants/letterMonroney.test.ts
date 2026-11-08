import { writeFileSync } from "node:fs";
import * as pdfLibModule from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildRenderLayout, runRenderPipeline, type FactoryStickerRenderData } from "../contract";
import { infinitiBenchmark, nissanBenchmark, qx55ClassFixture, themeFor } from "../__fixtures__/renderData";
import { expectNoTextOverlap, pageStrings } from "../__fixtures__/layoutAsserts";
import { PASSPORT_QR_CAPTION, REPRODUCTION_DISCLOSURE, canonicalPassportUrl } from "../../reproduction";
import { textBBox, type LayoutModel, type QrPrimitive } from "../layout";
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

const passportQr = (model: LayoutModel): QrPrimitive => {
  const qrs = model.pages[0].primitives.filter((p): p is QrPrimitive => p.kind === "qr");
  expect(qrs).toHaveLength(1);
  return qrs[0];
};

// The QR's own four-module quiet zone sits inside its square, so no text or
// barcode may touch that square, and any ink under it must be covered by a
// white panel before the QR is drawn, with no ink drawn over it afterwards.
const expectQrClear = (model: LayoutModel, q: QrPrimitive): void => {
  const hit = (x0: number, y0: number, x1: number, y1: number): boolean =>
    Math.min(x1, q.x + q.size) - Math.max(x0, q.x) > 0.01 && Math.min(y1, q.y + q.size) - Math.max(y0, q.y) > 0.01;
  let inkUnder = false;
  let drawn = false;
  for (const p of model.pages[0].primitives) {
    if (p === q) { expect(inkUnder).toBe(false); drawn = true; continue; }
    if (p.kind === "text") {
      const b = textBBox(p);
      expect(hit(b.x0, b.y0, b.x1, b.y1), p.str).toBe(false);
    } else if (p.kind === "barcode") {
      expect(hit(p.x, p.y, p.x + p.w, p.y + p.h)).toBe(false);
    } else if (p.kind === "rect" && p.fill === "#ffffff") {
      if (!drawn && p.x <= q.x && p.y <= q.y && p.x + p.w >= q.x + q.size && p.y + p.h >= q.y + q.size) inkUnder = false;
    } else if (p.kind === "rect" && hit(p.x, p.y, p.x + p.w, p.y + p.h)) {
      expect(drawn).toBe(false);
      inkUnder = true;
    }
  }
};

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

      it("prints one black 0.90in Passport QR, quiet zone included, in the pricing column with nothing drawn over it", () => {
        const q = passportQr(model);
        expect(q.size).toBeCloseTo(0.9 * 72, 6);
        expect(q.color).toBe("#000000");
        expect(q.payload).toBe(data.passportUrl);
        expect(q.x).toBeGreaterThanOrEqual(287);
        expect(q.x + q.size).toBeLessThanOrEqual(436);
        expectQrClear(model, q);
      });

      it("shrinks the QR only to the room a long price list leaves, never over it, and stays on one page", () => {
        const sizes: number[] = [];
        for (const n of [0, 10, 20, 26, 30, 34, 38]) {
          const options = Array.from({ length: n }, (_, i) => ({ name: `Factory Option Number ${i + 1}`, code: `X${i}`, msrp: 100 + i }));
          const m = buildRenderLayout({ ...data, options }, themeFor(theme));
          if (!isVariant(pageStrings(m, 0))) continue;
          expect(m.pages).toHaveLength(1);
          const q = passportQr(m);
          expect(q.size).toBeLessThanOrEqual(0.9 * 72 + 1e-9);
          expect(q.size).toBeGreaterThanOrEqual(32);
          expectQrClear(m, q);
          sizes.push(q.size);
        }
        expect(sizes[0]).toBeCloseTo(0.9 * 72, 6);
        expect(sizes.some((s) => s < 0.9 * 72)).toBe(true);
      });

      it("never claims to be the federal label or reuses source artwork text", () => {
        const all = model.drawnStrings.join(" ");
        expect(all).not.toMatch(/applied pursuant to Federal law/i);
        expect(all).not.toMatch(/Do not remove prior to delivery/i);
      });

      it("keeps text from overlapping on page 1", () => {
        expectNoTextOverlap(model, 0);
      });

      it("never adds a second page for long equipment", () => {
        const extra = Array.from({ length: 260 }, (_, i) => `Variant Extended Line ${String(i).padStart(3, "0")}`);
        const long = buildRenderLayout(
          { ...data, standardEquipment: { ...data.standardEquipment, technology: extra } },
          themeFor(theme),
          "full_only",
        );
        expect(long.pages.length).toBe(1);
        expect(long.fit.ok).toBe(false);
        expect(long.mode).toBe("REVIEW_REQUIRED");
        const selected = buildRenderLayout(
          { ...data, standardEquipment: { ...data.standardEquipment, technology: extra } },
          themeFor(theme),
        );
        expect(selected.pages.length).toBe(1);
        expect(selected.fit.ok && selected.fit.equipmentScope).toBe("selected");
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

  it("routes INFINITI make-wide but keeps other near-miss makes and fuel classes on the generic layout", () => {
    const qx60 = qx60SportFixture();
    for (const changed of [
      { ...qx60, identity: { ...qx60.identity, trim: "AUTOGRAPH" } },
      { ...qx60, identity: { ...qx60.identity, year: "2025" } },
      { ...qx60, mechanical: { ...qx60.mechanical!, drivetrain: "FWD" } },
    ]) {
      expect(isVariant(buildRenderLayout(changed, themeFor("infiniti")).drawnStrings)).toBe(true);
    }
    const ev = { ...qx60, epa: { ...qx60.epa!, fuelType: "Electricity" } };
    expect(isVariant(buildRenderLayout(ev, themeFor("infiniti")).drawnStrings)).toBe(false);
  });

  it("a QX55-class build (about 60 items, 3 options) fits the routed INFINITI master on one page at the floor or above", () => {
    const data = qx55ClassFixture();
    const m = buildRenderLayout(data, themeFor("infiniti"));
    expect(isVariant(m.drawnStrings)).toBe(true);
    expect(m.pages).toHaveLength(1);
    expect(m.fit.ok).toBe(true);
    expect(m.fit.ok && m.fit.equipmentFontPt).toBeGreaterThanOrEqual(5.5);
    expect(m.width).toBe(792);
    expect(m.height).toBe(612);
    expect([...m.printedEquipment].sort()).toEqual(Object.values(data.standardEquipment).flat().sort());
  });

  it("routes a non-reference Nissan model make-wide and a second Pathfinder trim on the Nissan master", () => {
    for (const trim of ["SV", "SL"]) {
      const data = { ...pathfinderPlatinumFixture(), identity: { year: "2026", make: "Nissan", model: "Pathfinder", trim } };
      const m = buildRenderLayout(data, themeFor("nissan"));
      expect(isVariant(m.drawnStrings)).toBe(true);
      expect(m.pages).toHaveLength(1);
      expect(m.fit.ok).toBe(true);
    }
    const rogue = { ...pathfinderPlatinumFixture(), identity: { year: "2026", make: "Nissan", model: "Rogue", trim: "SV" } };
    const m = buildRenderLayout(rogue, themeFor("nissan"));
    expect(isVariant(m.drawnStrings)).toBe(true);
    expect(m.pages).toHaveLength(1);
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

describe("canonical Passport QR payload", () => {
  it("is the public autolabels.io host plus the listing slug, never a generating origin", () => {
    expect(canonicalPassportUrl("2027-infiniti-qx80-452464")).toBe("https://autolabels.io/v/2027-infiniti-qx80-452464");
    expect(canonicalPassportUrl(" JN8AZ3CC5T9624253 ")).toBe("https://autolabels.io/v/JN8AZ3CC5T9624253");
    expect(canonicalPassportUrl("")).toBe("");
  });
});
