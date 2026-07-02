import { describe, it, expect } from "vitest";
import { resolveProductIcon, PRODUCT_ICONS, PRODUCT_ICON_KEYS } from "./productIcons";
import { PlaceholderGlyph, WindowTint, PaintProtectionFilm } from "../addendum-icons/customIcons";
import { getAddendumIconComponent } from "../addendum-icons/iconRegistry";

describe("resolveProductIcon", () => {
  it("routes mapped types through the icon library", () => {
    expect(resolveProductIcon("window_tint")).toBe(WindowTint);
    expect(resolveProductIcon("clear_bra")).toBe(PaintProtectionFilm);
    expect(resolveProductIcon("maintenance_plan")).toBe(getAddendumIconComponent("M003"));
  });

  it("never returns the dashed placeholder on a customer document", () => {
    for (const key of [...PRODUCT_ICON_KEYS, "default"]) {
      expect(resolveProductIcon(key), key).not.toBe(PlaceholderGlyph);
    }
    // roof_rack's library entry is still placeholder art — legacy mark holds.
    expect(resolveProductIcon("roof_rack")).not.toBe(PlaceholderGlyph);
  });

  it("falls back to the default tag for unknown or missing types", () => {
    expect(resolveProductIcon("not_a_type")).toBe(PRODUCT_ICONS.default);
    expect(resolveProductIcon(undefined)).toBe(PRODUCT_ICONS.default);
  });
});
