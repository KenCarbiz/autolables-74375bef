import { describe, it, expect } from "vitest";
import { resolveWarrantyState, type WarrantyStateInput } from "./state";

const base: WarrantyStateInput = {
  isNew: false, hasProgram: false, authority: "unknown",
  hasVerifiedStartDate: false, startDateCertainty: "unknown",
  computedActive: null, computedExpired: false, conflict: false,
};

describe("resolveWarrantyState", () => {
  it("new + undelivered → STARTS_AT_DELIVERY", () => {
    const v = resolveWarrantyState({ ...base, isNew: true, hasProgram: true, authority: "oem_reference" }, "INFINITI");
    expect(v.state).toBe("STARTS_AT_DELIVERY");
    expect(v.showCovered).toBe(false);
    expect(v.showExactDates).toBe(false);
    expect(v.statusCopy).toMatch(/INFINITI/);
    expect(v.statusCopy).toMatch(/when you take delivery/);
  });

  it("new WITH verified in-service + active → VERIFIED_ACTIVE", () => {
    const v = resolveWarrantyState({ ...base, isNew: true, hasProgram: true, authority: "vehicle_specific", hasVerifiedStartDate: true, startDateCertainty: "verified", computedActive: true });
    expect(v.state).toBe("VERIFIED_ACTIVE");
    expect(v.showCovered).toBe(true);
  });

  it("demonstrator (used mode) in-service verified + active → VERIFIED_ACTIVE", () => {
    const v = resolveWarrantyState({ ...base, isNew: false, hasProgram: true, authority: "dealer_verified", hasVerifiedStartDate: true, startDateCertainty: "verified", computedActive: true });
    expect(v.state).toBe("VERIFIED_ACTIVE");
    expect(v.showCovered).toBe(true);
  });

  it("used with verified remaining → VERIFIED_ACTIVE (showRemaining)", () => {
    const v = resolveWarrantyState({ ...base, hasProgram: true, authority: "vehicle_specific", hasVerifiedStartDate: true, startDateCertainty: "verified", computedActive: true });
    expect(v.state).toBe("VERIFIED_ACTIVE");
    expect(v.showRemaining).toBe(true);
  });

  it("oem_reference only → ESTIMATED_COVERAGE (MAY APPLY)", () => {
    const v = resolveWarrantyState({ ...base, hasProgram: true, authority: "oem_reference" });
    expect(v.state).toBe("ESTIMATED_COVERAGE");
    expect(v.statusLabel).toBe("MAY APPLY");
  });

  it("cpo_program without verified start → ESTIMATED_COVERAGE", () => {
    const v = resolveWarrantyState({ ...base, hasProgram: true, authority: "cpo_program", startDateCertainty: "estimated" });
    expect(v.state).toBe("ESTIMATED_COVERAGE");
  });

  it("missing everything → CONFIRMATION_REQUIRED", () => {
    const v = resolveWarrantyState(base);
    expect(v.state).toBe("CONFIRMATION_REQUIRED");
  });

  it("verified start + expired → VERIFIED_EXPIRED", () => {
    const v = resolveWarrantyState({ ...base, hasProgram: true, authority: "vehicle_specific", hasVerifiedStartDate: true, startDateCertainty: "verified", computedExpired: true });
    expect(v.state).toBe("VERIFIED_EXPIRED");
  });

  it("computedExpired but NO verified start → not expired", () => {
    const v = resolveWarrantyState({ ...base, hasProgram: true, authority: "oem_reference", computedExpired: true });
    expect(v.state).not.toBe("VERIFIED_EXPIRED");
  });

  it("conflict → CONFIRMATION_REQUIRED overrides all", () => {
    const v = resolveWarrantyState({ ...base, isNew: true, hasProgram: true, authority: "vehicle_specific", hasVerifiedStartDate: true, computedActive: true, conflict: true });
    expect(v.state).toBe("CONFIRMATION_REQUIRED");
  });

  it("no input without a verified start ever has showCovered/showExactDates", () => {
    const combos: WarrantyStateInput[] = [
      { ...base },
      { ...base, isNew: true, hasProgram: true, authority: "oem_reference" },
      { ...base, hasProgram: true, authority: "cpo_program" },
      { ...base, hasProgram: true, authority: "oem_reference" },
      { ...base, conflict: true },
    ];
    for (const c of combos) {
      const v = resolveWarrantyState(c);
      expect(v.showCovered).toBe(false);
      expect(v.showExactDates).toBe(false);
    }
  });
});
