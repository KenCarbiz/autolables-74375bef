import { describe, it, expect } from "vitest";

import { suggestAccessible as suggest, contrastRatio as ratio } from "./color";
describe("suggestAccessible", () => {
  it("returns null for a passing colour and an AA alternative for a failing one", () => {
    expect(suggest("#142338", "#FFFFFF")).toBeNull();
    const darker = suggest("#9FB6E6", "#FFFFFF");
    expect(darker).toMatch(/^#[0-9A-F]{6}$/);
    expect(ratio(darker as string, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    const lighter = suggest("#2457D6", "#162638");
    expect(ratio(lighter as string, "#162638")).toBeGreaterThanOrEqual(4.5);
  });

  it("tries both directions for a mid-grey and keeps the closest passing colour", () => {
    for (const bg of ["#808080", "#7A7A7A"]) {
      const c = suggest("#8A8A8A", bg, 3) as string;
      expect(c).toMatch(/^#[0-9A-F]{6}$/);
      expect(ratio(c, bg)).toBeGreaterThanOrEqual(3);
    }
    const c = suggest("#777777", "#808080", 3) as string;
    expect(ratio(c, "#808080")).toBeGreaterThanOrEqual(3);
    expect(suggest("#808080", "#808080")).not.toBeNull();
  });
});
