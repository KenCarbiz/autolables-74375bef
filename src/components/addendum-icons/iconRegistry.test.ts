import { describe, it, expect } from "vitest";
import { ADDENDUM_ICON_DEFS, ADDENDUM_ICON_METADATA } from "./iconMetadata";
import { getAddendumIconDef, getAddendumIconComponent, searchAddendumIcons } from "./iconRegistry";
import { CATEGORY_PREFIX, CATEGORY_PREFIX_200 } from "./iconTypes";
import { ADDENDUM_ICON_COLORS } from "./colorTokens";

const RANGE_MAX: Record<string, number> = { S: 25, P: 25, V: 50, A: 75, C: 50, M: 50, D: 50, U: 50, W: 25 };

describe("addendum icon manifest", () => {
  it("has at least 150 entries", () => {
    expect(ADDENDUM_ICON_DEFS.length).toBeGreaterThanOrEqual(150);
  });

  it("has unique icon ids", () => {
    const ids = ADDENDUM_ICON_DEFS.map((d) => d.iconId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every id matches its category prefix and stays inside the reserved range", () => {
    for (const def of ADDENDUM_ICON_DEFS) {
      const m = /^([A-Z]{1,2})(\d{3})$/.exec(def.iconId);
      expect(m, def.iconId).toBeTruthy();
      const [, prefix, num] = m!;
      if (prefix.length === 2) {
        // 200-series: two-letter prefix, numbered 201+ so it can never
        // collide with the core single-letter ranges.
        expect(CATEGORY_PREFIX_200[prefix], def.iconId).toBe(def.category);
        expect(Number(num), def.iconId).toBeGreaterThanOrEqual(201);
        expect(Number(num), def.iconId).toBeLessThanOrEqual(299);
      } else {
        expect(prefix, def.iconId).toBe(CATEGORY_PREFIX[def.category]);
        expect(Number(num), def.iconId).toBeGreaterThanOrEqual(1);
        expect(Number(num), def.iconId).toBeLessThanOrEqual(RANGE_MAX[prefix]);
      }
    }
  });

  it("includes the full 200-series from the reference sheet", () => {
    const counts: Record<string, number> = { PR: 8, ST: 9, WC: 10, SR: 10, DC: 8, CA: 8, AX: 14, EV: 7, WA: 7 };
    for (const [prefix, expected] of Object.entries(counts)) {
      const got = ADDENDUM_ICON_DEFS.filter((x) => new RegExp(`^${prefix}2\\d{2}$`).test(x.iconId)).length;
      expect(got, prefix).toBe(expected);
    }
  });

  it("every entry carries complete metadata and approved colors", () => {
    const colorKeys = Object.keys(ADDENDUM_ICON_COLORS);
    for (const def of ADDENDUM_ICON_DEFS) {
      expect(def.name.length, def.iconId).toBeGreaterThan(0);
      expect(def.description.length, def.iconId).toBeGreaterThan(0);
      expect(def.recommendedUse.length, def.iconId).toBeGreaterThan(0);
      expect(def.tags.length, def.iconId).toBeGreaterThan(0);
      expect(colorKeys, def.iconId).toContain(def.defaultColor);
      for (const c of def.allowedColors) expect(colorKeys, def.iconId).toContain(c);
      expect(def.allowedColors, def.iconId).toContain(def.defaultColor);
    }
  });

  it("custom-source icons are flagged so final artwork is tracked", () => {
    for (const def of ADDENDUM_ICON_DEFS) {
      if (def.source === "custom") expect(["custom_required", "placeholder", "ready"], def.iconId).toContain(def.status);
      if (def.status === "custom_required") expect(def.source, def.iconId).toBe("custom");
    }
  });

  it("includes the twelve required passport custom icons", () => {
    for (let i = 1; i <= 12; i++) {
      const id = `P${String(i).padStart(3, "0")}`;
      const def = getAddendumIconDef(id);
      expect(def, id).toBeTruthy();
      expect(def!.source, id).toBe("custom");
    }
  });

  it("metadata export mirrors the defs without component references", () => {
    expect(ADDENDUM_ICON_METADATA.length).toBe(ADDENDUM_ICON_DEFS.length);
    expect("icon" in ADDENDUM_ICON_METADATA[0]).toBe(false);
  });
});

describe("addendum icon registry", () => {
  // Lucide exports are forwardRef components (typeof "object"); customs are
  // plain functions. Both are renderable — assert on that, not typeof.
  const renderable = (c: unknown) => c != null && (typeof c === "function" || typeof c === "object");

  it("resolves every manifest id to a component", () => {
    for (const def of ADDENDUM_ICON_DEFS) {
      expect(renderable(getAddendumIconComponent(def.iconId)), def.iconId).toBe(true);
    }
  });

  it("is case-insensitive and falls back safely on unknown ids", () => {
    expect(getAddendumIconDef("a001")?.iconId).toBe("A001");
    expect(getAddendumIconDef("Z999")).toBeNull();
    expect(renderable(getAddendumIconComponent("Z999"))).toBe(true);
  });

  it("search matches id, name, and tags", () => {
    expect(searchAddendumIcons("A001")[0]?.iconId).toBe("A001");
    expect(searchAddendumIcons("tint").some((d) => d.iconId === "A001")).toBe(true);
    expect(searchAddendumIcons("passport").length).toBeGreaterThanOrEqual(12);
  });
});
