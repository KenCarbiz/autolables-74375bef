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
});
