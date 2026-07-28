import { describe, expect, it } from "vitest";
import { hasStickerSourceData, MAX_SPEC_ATTEMPTS, shouldDecodeVin } from "./sourceData";

const sheet = { packages: [], options: [], standard: {}, source: "neovin" };

describe("provider decode decisions", () => {
  it("decodes a VIN that has never been decoded", () => {
    expect(shouldDecodeVin({})).toEqual({ decode: true, reason: "no_build_sheet", attempts: 0 });
    expect(shouldDecodeVin(null).decode).toBe(true);
    expect(shouldDecodeVin(undefined).decode).toBe(true);
  });

  it("never re-decodes a VIN that already has its build sheet", () => {
    // The whole point: a vehicle that stays in inventory is decoded once,
    // and every later scrape costs nothing.
    const decoded = { build_sheet: sheet, specs_attempts: 1 };
    for (let scrape = 0; scrape < 30; scrape++) {
      expect(shouldDecodeVin(decoded).decode, `scrape ${scrape}`).toBe(false);
    }
    expect(shouldDecodeVin(decoded).reason).toBe("already_decoded");
  });

  it("still decodes a VIN that has equipment lists but no build sheet", () => {
    // The regression this fixes: those vehicles counted as decoded, so
    // their window sticker could never be built.
    const listsOnly = { options: [{ name: "Moonroof" }], features: ["Heated Seats"] };
    expect(shouldDecodeVin(listsOnly).decode).toBe(true);
    expect(shouldDecodeVin(listsOnly).reason).toBe("no_build_sheet");
  });

  it("stops paying after the attempt cap on a VIN the provider cannot decode", () => {
    // Without the cap this VIN was re-pulled on every sweep, forever, for a
    // result that never changes.
    let attempts = 0;
    let charges = 0;
    for (let sweep = 0; sweep < 50; sweep++) {
      const decision = shouldDecodeVin({ specs_attempts: attempts });
      if (decision.decode) { charges++; attempts++; }
    }
    expect(charges).toBe(MAX_SPEC_ATTEMPTS);
    expect(shouldDecodeVin({ specs_attempts: attempts }).reason).toBe("attempt_cap_reached");
  });

  it("honours a caller-supplied cap", () => {
    expect(shouldDecodeVin({ specs_attempts: 1 }, 1).decode).toBe(false);
    expect(shouldDecodeVin({ specs_attempts: 0 }, 1).decode).toBe(true);
  });

  it("treats a build sheet as decisive even at the attempt cap", () => {
    expect(shouldDecodeVin({ build_sheet: sheet, specs_attempts: 99 }).decode).toBe(false);
  });

  it("reports whether the sticker pipeline has what it needs", () => {
    expect(hasStickerSourceData({ build_sheet: sheet })).toBe(true);
    expect(hasStickerSourceData({ options: [{ name: "x" }] })).toBe(false);
    expect(hasStickerSourceData({})).toBe(false);
    expect(hasStickerSourceData(null)).toBe(false);
  });

  it("ignores a malformed attempt counter rather than decoding forever", () => {
    expect(shouldDecodeVin({ specs_attempts: "many" }).attempts).toBe(0);
    expect(shouldDecodeVin({ specs_attempts: -5 }).decode).toBe(true);
  });
});

describe("re-asking for a generic sheet, exactly once", () => {
  const generic = (over: Record<string, unknown> = {}) => ({
    build_sheet: { source: "neovin", generic: true }, ...over,
  });

  it("re-decodes a generic sheet that was never asked for strictly", () => {
    // Every sheet in production is generic because the old request always
    // sent include_generic=true. Those VINs have never been asked for their
    // own build, so "already decoded" was never true of them.
    const d = shouldDecodeVin(generic());
    expect(d.decode).toBe(true);
    expect(d.reason).toBe("generic_sheet_never_asked_strictly");
  });

  it("stops once the strict question has actually been asked", () => {
    // A generic answer to a strict question is the best this VIN has.
    // Paying to hear it again is the recurring charge this module exists
    // to prevent.
    const d = shouldDecodeVin(generic({ specs_strict_attempted: true }));
    expect(d.decode).toBe(false);
    expect(d.reason).toBe("already_decoded");
  });

  it("never re-decodes a real VIN-specific sheet", () => {
    expect(shouldDecodeVin({ build_sheet: { source: "neovin", generic: false } }).decode).toBe(false);
    expect(shouldDecodeVin({ build_sheet: { source: "neovin" } }).decode).toBe(false);
  });

  it("still honours the attempt cap on a generic sheet", () => {
    const d = shouldDecodeVin(generic({ specs_attempts: 3 }));
    expect(d.decode).toBe(false);
    expect(d.reason).toBe("already_decoded");
  });

  it("treats a malformed sheet as decoded rather than re-paying", () => {
    expect(shouldDecodeVin({ build_sheet: "not-an-object" }).decode).toBe(false);
    expect(shouldDecodeVin({ build_sheet: { generic: "true" } }).decode).toBe(false);
  });
});
