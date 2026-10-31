import { describe, it, expect } from "vitest";
import { normalizeStateCode, resolveOperatingState } from "./dealerState";

describe("normalizeStateCode", () => {
  it("accepts codes and the full names older records hold", () => {
    expect(normalizeStateCode("CT")).toBe("CT");
    expect(normalizeStateCode(" ct ")).toBe("CT");
    expect(normalizeStateCode("Connecticut")).toBe("CT");
    expect(normalizeStateCode("new  york")).toBe("NY");
    expect(normalizeStateCode("District of Columbia")).toBe("DC");
  });

  it("returns empty for anything that is not a US state", () => {
    expect(normalizeStateCode("")).toBe("");
    expect(normalizeStateCode(null)).toBe("");
    expect(normalizeStateCode("Ontario")).toBe("");
    expect(normalizeStateCode("XX")).toBe("");
  });

  it("resolves the governing state from a legacy full name", () => {
    expect(resolveOperatingState({ dealer_state: "Connecticut" })).toBe("CT");
    expect(resolveOperatingState({ dealer_state: "Ontario" })).toBe("ONTARIO");
  });
});
