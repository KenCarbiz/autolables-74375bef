import { describe, expect, it } from "vitest";
import { decodeCode128, encodeCode128 } from "./code128";

const VIN = "JN8AZ2NE8P9123456";

describe("code128", () => {
  it("encodes a 17-character VIN and decodes it back", () => {
    const enc = encodeCode128(VIN);
    expect(decodeCode128(enc.widths)).toBe(VIN);
  });

  it("produces a valid checksum", () => {
    const enc = encodeCode128(VIN);
    expect(enc.checksum).toBeGreaterThanOrEqual(0);
    expect(enc.checksum).toBeLessThan(103);
    let sum = enc.codes[0];
    for (let j = 1; j < enc.codes.length; j++) sum += enc.codes[j] * j;
    expect(sum % 103).toBe(enc.checksum);
  });

  it("is deterministic", () => {
    expect(encodeCode128(VIN)).toEqual(encodeCode128(VIN));
  });

  it("starts in subset B for the VIN and switches to subset C for the digit tail", () => {
    const enc = encodeCode128(VIN);
    expect(enc.codes[0]).toBe(104);
    expect(enc.codes).toContain(99);
  });

  it("starts in subset C for all-digit payloads", () => {
    const enc = encodeCode128("1234567890");
    expect(enc.codes[0]).toBe(105);
    expect(decodeCode128(enc.widths)).toBe("1234567890");
  });

  it("round-trips mixed content", () => {
    for (const payload of ["AUTOLABELS", "A1B2C3", "WBA53AY08PFR12345", "5FNRL6H87PB012345", "X99999"]) {
      expect(decodeCode128(encodeCode128(payload).widths)).toBe(payload);
    }
  });

  it("emits only module widths 1-4 and a stop pattern", () => {
    const enc = encodeCode128(VIN);
    expect(enc.widths.every((w) => w >= 1 && w <= 4)).toBe(true);
    expect(enc.widths.slice(-7).join("")).toBe("2331112");
    expect(enc.totalModules).toBe(enc.widths.reduce((a, b) => a + b, 0));
  });

  it("rejects empty and non-ASCII payloads", () => {
    expect(() => encodeCode128("")).toThrow();
    expect(() => encodeCode128("VINÿ")).toThrow();
  });

  it("decode rejects a corrupted symbol stream", () => {
    const enc = encodeCode128(VIN);
    const widths = [...enc.widths];
    // Swapping two distinct data symbols breaks the position-weighted checksum.
    const first = widths.slice(6, 12);
    const second = widths.slice(12, 18);
    widths.splice(6, 6, ...second);
    widths.splice(12, 6, ...first);
    expect(() => decodeCode128(widths)).toThrow(/checksum/);
  });
});
