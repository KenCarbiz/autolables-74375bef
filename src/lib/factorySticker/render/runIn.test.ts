import { describe, expect, it } from "vitest";
import { adaptRenderData, buildRenderLayout, resolveRenderTheme, type FactoryStickerRenderData } from "./contract";
import { EQUIPMENT_MIN_FONT_PT, EQUIPMENT_MIN_LINE_HEIGHT_RATIO, buildStickerLayout, type LayoutModel } from "./layout";
import { checkRenderedCompleteness, expectedStandardEquipment } from "./completeness";
import { qx55ClassFixture, themeFor } from "./__fixtures__/renderData";
import { expectMinFontRespected, expectNoTextOverlap, expectWithinBounds } from "./__fixtures__/layoutAsserts";

const baseExtra = (n: number): FactoryStickerRenderData => {
  const base = qx55ClassFixture();
  const extra = Array.from({ length: n }, (_, i) => `Verified Test Equipment Line ${String(i).padStart(3, "0")}`);
  return { ...base, standardEquipment: { ...base.standardEquipment, technology: [...(base.standardEquipment.technology ?? []), ...extra] } };
};

const withExtra = baseExtra;

const generic = (data: FactoryStickerRenderData): LayoutModel =>
  buildStickerLayout(adaptRenderData(data), resolveRenderTheme(data, themeFor("toyota")));
const routed = (data: FactoryStickerRenderData): LayoutModel => buildRenderLayout(data, themeFor("infiniti"));

const mode = (m: LayoutModel): string | undefined => (m.fit.ok ? m.fit.equipmentMode : undefined);

/** Smallest extra-item count at which the one-per-line list no longer fits but run-in does. */
const findRunIn = (build: (d: FactoryStickerRenderData) => LayoutModel): { n: number; model: LayoutModel } => {
  for (let n = 0; n < 400; n += 2) {
    const model = build(withExtra(n));
    if (model.fit.ok && mode(model) === "run_in") return { n, model };
    if (!model.fit.ok) break;
  }
  throw new Error("no run-in transition found");
};

describe("run-in equipment mode", () => {
  it("keeps one item per line while that fits", () => {
    const m = generic(qx55ClassFixture());
    expect(m.fit.ok && m.fit.equipmentMode).toBe("list");
  });

  describe.each([["generic engine", generic], ["INFINITI letter master", routed]] as const)("%s", (_name, build) => {
    const { n, model } = findRunIn(build);
    const data = withExtra(n);

    it("switches to category paragraphs only after the list cannot fit at the floor", () => {
      expect(model.pages).toHaveLength(1);
      expect(model.fit.ok && model.fit.equipmentFontPt).toBeGreaterThanOrEqual(EQUIPMENT_MIN_FONT_PT);
    });

    it("prints every verified standard item exactly once and passes completeness", () => {
      const expected = expectedStandardEquipment(data);
      expect([...model.printedEquipment].sort()).toEqual([...expected].sort());
      const report = checkRenderedCompleteness(data, model);
      expect(report.missing.filter((m) => m.category === "standard_equipment")).toEqual([]);
      expect(report.miscounted).toEqual([]);
    });

    it("draws bold category labels and joins items with commas", () => {
      const texts = model.pages[0].primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
      expect(texts.filter((t) => t.font === "bold" && /^[A-Z &]+:$/.test(t.str)).length).toBeGreaterThan(1);
      expect(texts.filter((t) => t.str === ",").length).toBeGreaterThan(20);
    });

    it("keeps readable leading, bounds and no overlap", () => {
      const items = new Set(Object.values(data.standardEquipment).flat().map((s) => s.split(" ")[0]));
      const starts = model.pages[0].primitives
        .flatMap((p) => (p.kind === "text" && p.font === "body" && p.str.startsWith("Verified Test") ? [p] : []));
      const originX = Math.min(...starts.map((p) => p.x));
      const tops = starts.filter((p) => Math.abs(p.x - originX) < 0.01).map((p) => p.y);
      const ys = [...new Set(tops)].sort((a, b) => a - b);
      const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((g) => g > 0.5);
      const size = model.fit.ok ? model.fit.equipmentFontPt : 0;
      expect(items.size).toBeGreaterThan(0);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(size * (_name === "generic engine" ? EQUIPMENT_MIN_LINE_HEIGHT_RATIO : 1.06) - 0.05);
      expectMinFontRespected(model);
      expectWithinBounds(model);
      expectNoTextOverlap(model, 0);
    });

    it("leaves priced options and packages as their own rows", () => {
      const strings = model.drawnStrings;
      for (const opt of data.options) expect(strings.some((s) => s.includes(opt.name)), opt.name).toBe(true);
      expect(strings.join(" ")).not.toMatch(new RegExp(`${data.options[0].name},`));
    });
  });
});

describe("equipment-priority composition (generic layout only)", () => {
  const withExtra = (n: number): FactoryStickerRenderData => ({ ...baseExtra(n), warranty: null, partsContent: null, safety: null });
  const find = (): { n: number; model: LayoutModel } => {
    for (let n = 0; n < 600; n += 4) {
      const model = generic(withExtra(n));
      if (model.fit.ok && model.fit.composition === "equipment_priority") return { n, model };
      if (!model.fit.ok) break;
    }
    throw new Error("no equipment-priority transition found");
  };
  const { n, model } = find();
  const data = withExtra(n);

  it("is used only after the standard page cannot fit, and stays on one page at the floor or above", () => {
    expect(model.pages).toHaveLength(1);
    expect(model.fit.ok && model.fit.equipmentFontPt).toBeGreaterThanOrEqual(EQUIPMENT_MIN_FONT_PT);
    expect(generic(qx55ClassFixture()).fit.ok && (generic(qx55ClassFixture()).fit as { composition?: string }).composition).toBe("standard");
  });

  it("prints every verified item once and keeps the banner and disclosure", () => {
    expect([...model.printedEquipment].sort()).toEqual([...expectedStandardEquipment(data)].sort());
    expect(checkRenderedCompleteness(data, model).pass).toBe(true);
    expect(model.drawnStrings.some((s) => s.startsWith("REPRODUCTION WINDOW STICKER"))).toBe(true);
  });

  it("keeps a scannable Passport QR with its caption and the VIN barcode in the right rail", () => {
    const prims = model.pages[0].primitives;
    const qr = prims.find((p) => p.kind === "qr" && p.payload === data.passportUrl);
    expect(qr && qr.kind === "qr" ? qr.size : 0).toBeGreaterThanOrEqual(57.6);
    expect(model.drawnStrings).toContain("Scan for Vehicle Passport");
    const barcode = prims.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" && barcode.x).toBeGreaterThan(500);
    expect(barcode && barcode.kind === "barcode" && barcode.payload).toBe(data.vin);
  });

  it("does not touch the Figma masters: a master that fits keeps its own composition", () => {
    const m = routed(withExtra(0));
    expect(m.drawnStrings.some((s) => s.includes("Fuel Economy and Environment") || s.includes("Fuel Economy & Environment"))).toBe(true);
    expect(m.fit.ok && m.fit.composition).toBe("standard");
    expect(m.fit.ok && m.fit.columns).toBe(2);
  });

  it("still holds content that cannot fit even on this composition", () => {
    const m = generic(withExtra(900));
    expect(m.fit.ok).toBe(false);
    expect(m.mode).toBe("REVIEW_REQUIRED");
  });
});
