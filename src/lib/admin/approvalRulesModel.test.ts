import { describe, it, expect } from "vitest";
import { RULE_FAMILY_ICON, SIGNED_VERSIONS_INVARIANT, changeConsequences } from "./approvalRulesModel";

describe("approval rules model", () => {
  it("gives the four families distinct icons", () => {
    expect(new Set(Object.values(RULE_FAMILY_ICON)).size).toBe(Object.values(RULE_FAMILY_ICON).length);
  });
  it("states that signed versions are always kept", () => {
    expect(SIGNED_VERSIONS_INVARIANT.length).toBeGreaterThan(0);
  });
  it("exports consequence builder", () => {
    expect(typeof changeConsequences).toBe("function");
  });
});
