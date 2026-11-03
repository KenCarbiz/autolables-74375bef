import { describe, expect, it } from "vitest";
import { adaptRenderData, buildRenderLayout, resolveRenderTheme, type FactoryStickerRenderData } from "./contract";
import { EQUIPMENT_MIN_FONT_PT, EQUIPMENT_MIN_LINE_HEIGHT_RATIO, buildStickerLayout, type LayoutModel } from "./layout";
import { checkRenderedCompleteness, expectedStandardEquipment } from "./completeness";
import { qx55ClassFixture, themeFor } from "./__fixtures__/renderData";
import { expectMinFontRespected, expectNoTextOverlap, expectWithinBounds } from "./__fixtures__/layoutAsserts";

const withExtra = (n: number): FactoryStickerRenderData => {
  const base = qx55ClassFixture();
  const extra = Array.from({ length: n }, (_, i) => `Verified Test Equipment Line ${String(i).padStart(3, "0")}`);
  return { ...base, standardEquipment: { ...base.standardEquipment, technology: [...(base.standardEquipment.technology ?? []), ...extra] } };
};

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
      const tops = model.pages[0].primitives
        .flatMap((p) => (p.kind === "text" && p.font === "body" && p.str.startsWith("Verified Test") ? [p] : []))
        .map((p) => p.y);
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
