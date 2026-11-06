import { describe, it, expect } from "vitest";
import { computeCheckDigit, validateVin } from "./vin.ts";

describe("vin", () => {
  it("normalizes case and whitespace without padding or guessing", () => {
    expect(validateVin("  1hgcm82633a004352 ")).toEqual({ ok: true, vin: "1HGCM82633A004352", reason: null });
    expect(validateVin("1HGCM82633A00435").reason).toBe("bad_format");
  });

  it("VIN-03 flags a check digit mismatch as its own reason", () => {
    const r = validateVin("1HGCM82634A004352");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("check_digit_mismatch");
  });

  it("VIN-03 rejects forbidden letters, empties and non-strings", () => {
    expect(validateVin("1HGCM82633A00435I").reason).toBe("bad_format");
    expect(validateVin("").reason).toBe("empty");
    expect(validateVin(null).reason).toBe("empty");
  });

  it("computes X as a check digit when the remainder is 10", () => {
    expect(computeCheckDigit("1M8GDM9AXKP042788")).toBe("X");
    expect(validateVin("1M8GDM9AXKP042788").ok).toBe(true);
  });
});
