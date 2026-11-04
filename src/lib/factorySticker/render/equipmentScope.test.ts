import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_SCOPE_POLICY, adaptRenderData, buildRenderLayout, equipmentNoteFor, type EquipmentScopePolicy,
  type FactoryStickerRenderData,
} from "./contract";
import { checkRenderedCompleteness, expectedStandardEquipment } from "./completeness";
import { qx55ClassFixture, themeFor } from "./__fixtures__/renderData";
import type { LayoutModel } from "./layout";

const KEY = Array.from({ length: 24 }, (_, i) => `Verified Key Feature ${String(i).padStart(2, "0")}`);

const build = (extra: number, keyFeatures: string[] = KEY): FactoryStickerRenderData => {
  const base = qx55ClassFixture();
  const more = Array.from({ length: extra }, (_, i) => `Verified Standard Item ${String(i).padStart(3, "0")} with a descriptive name`);
  return {
    ...base,
    standardEquipment: { ...base.standardEquipment, technology: [...(base.standardEquipment.technology ?? []), ...more] },
    keyFeatures: keyFeatures.length ? { STANDARD: keyFeatures } : {},
  };
};

const infiniti = (d: FactoryStickerRenderData, policy?: EquipmentScopePolicy): LayoutModel =>
  buildRenderLayout(d, themeFor("infiniti"), policy);
const scopeOf = (m: LayoutModel): string | undefined => (m.fit.ok ? m.fit.equipmentScope : undefined);
const total = (d: FactoryStickerRenderData): number => adaptRenderData(d).data.equipment.standard.reduce((n, g) => n + g.items.length, 0);

describe("equipment scope policy on an approved make-wide master", () => {
  it("defaults to the full list, then the key-feature layer", () => {
    expect(EQUIPMENT_SCOPE_POLICY).toBe("full_then_key_features");
  });

  it("prints the full verified list while it fits", () => {
    const d = build(0);
    const m = infiniti(d);
    expect(m.fit.ok).toBe(true);
    expect(scopeOf(m)).toBe("full");
    expect(m.drawnStrings.some((s) => s.startsWith("Complete factory equipment list"))).toBe(false);
    expect([...m.printedEquipment].sort()).toEqual([...expectedStandardEquipment(d)].sort());
  });

  it("switches to the key features with one fixed Passport line when the full list cannot fit", () => {
    const d = build(900);
    const m = infiniti(d);
    expect(m.fit.ok).toBe(true);
    expect(scopeOf(m)).toBe("key_features");
    expect(m.drawnStrings.join(" ")).toContain(equipmentNoteFor(total(d)).split(" ").slice(0, 3).join(" "));
    expect([...m.printedEquipment].sort()).toEqual([...expectedStandardEquipment(d, "key_features")].sort());
    expect(checkRenderedCompleteness(d, m).pass).toBe(true);
    expect(m.fit.ok && m.fit.equipmentFontPt).toBeGreaterThanOrEqual(5.5);
    expect(m.pages).toHaveLength(1);
  });

  it("counts the real number of verified standard items in the line", () => {
    const d = build(900);
    expect(equipmentNoteFor(total(d))).toBe(`Complete factory equipment list (${total(d)} items): scan the Vehicle Passport QR`);
    expect(total(d)).toBeGreaterThan(900);
  });

  it("is review-required, never generic, when even the key features cannot fit", () => {
    const m = infiniti(build(900, Array.from({ length: 900 }, (_, i) => `Key feature number ${i} with a long descriptive name`)));
    expect(m.fit.ok).toBe(false);
    expect(m.mode).toBe("REVIEW_REQUIRED");
    expect(m.printedEquipment).toEqual([]);
  });

  it("is review-required when there is no key-feature layer to fall back to", () => {
    const m = infiniti(build(900, []));
    expect(m.fit.ok).toBe(false);
  });

  it("honours the registry setting", () => {
    expect(scopeOf(infiniti(build(0), "key_features"))).toBe("key_features");
    expect(infiniti(build(900), "full_only").fit.ok).toBe(false);
    expect(scopeOf(infiniti(build(0), "full_only"))).toBe("full");
  });

  it("leaves makes without an approved master on the generic layout", () => {
    const d = build(0);
    const m = buildRenderLayout({ ...d, identity: { ...d.identity, make: "Toyota" } }, themeFor("toyota"));
    expect(m.fit.ok && m.fit.equipmentScope).toBeFalsy();
  });
});
