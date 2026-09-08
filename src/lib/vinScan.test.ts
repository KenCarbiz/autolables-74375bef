import { describe, it, expect } from "vitest";
import { normalizeScannedVin } from "./vinScan";

const VIN = "1HGCM82633A004352";

describe("normalizeScannedVin", () => {
  it("passes a clean 17-character read straight through", () => {
    const out = normalizeScannedVin(VIN, "barcode");
    expect(out).toMatchObject({ ok: true, vin: VIN, trimmed: false, corrected: false });
  });

  it("uppercases and drops the punctuation a reader adds", () => {
    expect(normalizeScannedVin(` *${VIN.toLowerCase()}* `, "barcode")).toMatchObject({
      ok: true,
      vin: VIN,
    });
    expect(normalizeScannedVin("1HG-CM826 33A0 04352", "typed")).toMatchObject({ ok: true, vin: VIN });
  });

  it("finds the VIN inside a door-jamb payload that carries a leading delimiter", () => {
    expect(normalizeScannedVin(`I${VIN}`, "barcode")).toMatchObject({
      ok: true,
      vin: VIN,
      trimmed: true,
      corrected: false,
    });
  });

  it("finds the VIN inside a payload that carries a trailing check character", () => {
    expect(normalizeScannedVin(`${VIN}7`, "barcode")).toMatchObject({ ok: true, vin: VIN, trimmed: true });
  });

  it("reads I, O and Q back as 1, 0 and 0 when a person typed the dashboard plate", () => {
    const misread = "1HGCM82633AOO4352".replace("1HG", "IHG");
    expect(normalizeScannedVin(misread, "typed")).toMatchObject({
      ok: true,
      vin: VIN,
      corrected: true,
    });
  });

  it("never second-guesses a barcode — an I, O or Q in it is a bad read, not a typo", () => {
    const out = normalizeScannedVin("1HGCM82633AOO4352", "barcode");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("characters");
    expect(out.message).toMatch(/I, O or Q/);
  });

  it("prefers an exact window over a corrected one", () => {
    // Offset 0 would only validate after I→1; offset 1 is the real VIN.
    expect(normalizeScannedVin(`I${VIN}`, "typed")).toMatchObject({ ok: true, vin: VIN, corrected: false });
  });

  it("says how much it actually read when the scan is short", () => {
    const out = normalizeScannedVin("1HGCM826", "barcode");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("too_short");
    expect(out.message).toContain("8 of the 17");
  });

  it("says nothing was read rather than failing silently", () => {
    const out = normalizeScannedVin("   ", "barcode");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("empty");
    expect(out.message).toMatch(/door jamb/);
  });

  it("rejects a payload that swallowed more than one barcode", () => {
    const out = normalizeScannedVin(`${VIN}${VIN}${VIN}`, "barcode");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("too_long");
  });
});
