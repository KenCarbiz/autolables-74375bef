import { describe, it, expect } from "vitest";
import { canonicalCondition, needsUsedCarWarranty } from "./vehicleCondition";

describe("canonicalCondition", () => {
  it("maps new / demo / loaner to 'new'", () => {
    expect(canonicalCondition("New")).toBe("new");
    expect(canonicalCondition("Demo")).toBe("new");
    expect(canonicalCondition("Demonstrator")).toBe("new");
    expect(canonicalCondition("Loaner")).toBe("new");
  });

  it("maps any CPO / certified label to 'cpo'", () => {
    expect(canonicalCondition("CPO")).toBe("cpo");
    expect(canonicalCondition("Factory CPO")).toBe("cpo");
    expect(canonicalCondition("OEM CPO")).toBe("cpo");
    expect(canonicalCondition("Certified")).toBe("cpo");
  });

  it("maps used / pre-owned variants to 'used'", () => {
    expect(canonicalCondition("Used")).toBe("used");
    expect(canonicalCondition("Pre-Owned")).toBe("used");
    expect(canonicalCondition("pre owned")).toBe("used");
    expect(canonicalCondition("preowned")).toBe("used");
  });

  it("treats 'Certified Pre-Owned' as cpo (cpo takes precedence)", () => {
    expect(canonicalCondition("Certified Pre-Owned")).toBe("cpo");
  });

  it("returns undefined for empty or unrecognized labels", () => {
    expect(canonicalCondition("")).toBeUndefined();
    expect(canonicalCondition(null)).toBeUndefined();
    expect(canonicalCondition(undefined)).toBeUndefined();
    expect(canonicalCondition("Salvage")).toBeUndefined();
  });
});

describe("needsUsedCarWarranty", () => {
  it("requires the FTC warranty disclosure for used and cpo", () => {
    expect(needsUsedCarWarranty("Used")).toBe(true);
    expect(needsUsedCarWarranty("Certified Pre-Owned")).toBe(true);
  });

  it("does not require it for new / demo or unknown", () => {
    expect(needsUsedCarWarranty("New")).toBe(false);
    expect(needsUsedCarWarranty("Demo")).toBe(false);
    expect(needsUsedCarWarranty("")).toBe(false);
    expect(needsUsedCarWarranty(null)).toBe(false);
  });
});
