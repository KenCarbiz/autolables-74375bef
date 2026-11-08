import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_SCOPE_POLICY, adaptRenderData, buildRenderLayout, equipmentBase,
  type EquipmentScopePolicy, type FactoryStickerRenderData,
} from "./contract";
import { checkRenderedCompleteness, expectedStandardEquipment } from "./completeness";
import { qx55ClassFixture, themeFor } from "./__fixtures__/renderData";
import { SELECTED_EQUIPMENT_NOTE } from "../equipmentSelection";
import type { LayoutModel } from "./layout";

const build = (extra: number): FactoryStickerRenderData => {
  const base = qx55ClassFixture();
  const more = Array.from({ length: extra }, (_, i) => `Verified Standard Item ${String(i).padStart(3, "0")} with a descriptive name`);
  return {
    ...base,
    standardEquipment: { ...base.standardEquipment, technology: [...(base.standardEquipment.technology ?? []), ...more, "Full Size SUV"] },
    keyFeatures: { adas: ["Verified Key Feature Alpha", "Verified Key Feature Beta"] },
  };
};

const infiniti = (d: FactoryStickerRenderData, policy?: EquipmentScopePolicy): LayoutModel =>
  buildRenderLayout(d, themeFor("infiniti"), policy);
const scopeOf = (m: LayoutModel): string | undefined => (m.fit.ok ? m.fit.equipmentScope : undefined);
const counts = (m: LayoutModel) => (m.fit.ok ? m.fit.equipmentCounts : undefined);

describe("equipment scope policy", () => {
  it("defaults to full, then selected", () => {
    expect(EQUIPMENT_SCOPE_POLICY).toBe("full_then_selected");
  });

  it("prints every verified item on the master while it fits, with no pointer line", () => {
    const d = build(0);
    const m = infiniti(d);
    expect(m.fit.ok).toBe(true);
    expect(scopeOf(m)).toBe("full");
    expect(m.drawnStrings.join(" ")).not.toContain("Selected standard equipment shown");
    expect([...m.printedEquipment].sort()).toEqual([...expectedStandardEquipment(d)].sort());
    expect(counts(m)).toMatchObject({ printed: equipmentBase(d).total, total: equipmentBase(d).total });
  });

  it("prints ranked, normalized lines with the pointer when the full list cannot fit the master", () => {
    const d = build(900);
    const m = infiniti(d);
    expect(m.fit.ok).toBe(true);
    expect(scopeOf(m)).toBe("selected");
    expect(m.drawnStrings.join(" ")).toContain("Selected standard equipment shown.");
    const c = counts(m)!;
    expect(c.printed).toBeLessThan(c.total);
    expect(c.total).toBe(equipmentBase(d).total);
    expect([...m.printedEquipment].sort()).toEqual([...expectedStandardEquipment(d, "selected", c.lines)].sort());
    expect(checkRenderedCompleteness(d, m).pass).toBe(true);
    expect(m.fit.ok && m.fit.equipmentFontPt).toBeGreaterThanOrEqual(5.5);
    expect(m.pages).toHaveLength(1);
  });

  it("never prints a body-class label on a selected sticker", () => {
    const m = infiniti(build(900));
    expect(m.printedEquipment).not.toContain("Full Size SUV");
  });

  it("holds for review, never generic, when mandatory content cannot fit", () => {
    const d = build(0);
    const options = Array.from({ length: 400 }, (_, i) => ({ ...d.options[0], name: `Verified Priced Option ${i} with a long descriptive name`, code: `X${i}` }));
    const m = infiniti({ ...d, options });
    expect(m.fit.ok).toBe(false);
    expect(m.mode).toBe("REVIEW_REQUIRED");
    expect(m.printedEquipment).toEqual([]);
  });

  it("honours the registry setting", () => {
    expect(infiniti(build(900), "full_only").fit.ok).toBe(false);
    expect(scopeOf(infiniti(build(0), "full_only"))).toBe("full");
  });

  it("applies to the generic layout too", () => {
    const d = build(900);
    const m = buildRenderLayout({ ...d, identity: { ...d.identity, make: "Toyota" } }, themeFor("toyota"));
    expect(m.fit.ok).toBe(true);
    expect(scopeOf(m)).toBe("selected");
    expect(m.drawnStrings).toContain(SELECTED_EQUIPMENT_NOTE);
    expect(checkRenderedCompleteness({ ...d, identity: { ...d.identity, make: "Toyota" } }, m).pass).toBe(true);
    expect(adaptRenderData(d).data.equipment.standard.length).toBeGreaterThan(0);
  });
});
