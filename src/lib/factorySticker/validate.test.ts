import { describe, expect, it } from "vitest";
import { isPlaceholderText, validateStickerData, vinNormalize, VinValidationError } from "./validate";
import { normalizeNeovin } from "./normalizeNeovin";
import { infinitiLuxurySuv } from "./__fixtures__";
import type { FactoryStickerData } from "./types";

const valid = (): FactoryStickerData => normalizeNeovin(infinitiLuxurySuv());

describe("vinNormalize", () => {
  it("uppercases and trims", () => {
    expect(vinNormalize("  jn8az2ne8p9123456 ")).toBe("JN8AZ2NE8P9123456");
  });

  it("accepts a valid 17-character VIN unchanged", () => {
    expect(vinNormalize("JN8AZ2NE8P9123456")).toBe("JN8AZ2NE8P9123456");
  });

  it("rejects VINs shorter than 17 characters", () => {
    expect(() => vinNormalize("JN8AZ2NE8P912345")).toThrow(VinValidationError);
    expect(() => vinNormalize("JN8AZ2NE8P912345")).toThrow(/17 characters/);
  });

  it("rejects VINs longer than 17 characters", () => {
    expect(() => vinNormalize("JN8AZ2NE8P91234567")).toThrow(VinValidationError);
  });

  it.each(["I", "O", "Q"])("rejects the letter %s", (ch) => {
    expect(() => vinNormalize(`JN8AZ2NE8P912345${ch}`)).toThrow(/I, O, or Q/);
  });

  it("rejects lowercase i/o/q after normalization", () => {
    expect(() => vinNormalize("jn8az2ne8p912345o")).toThrow(VinValidationError);
  });

  it("rejects characters outside the VIN alphabet", () => {
    expect(() => vinNormalize("JN8AZ2NE8P912345*")).toThrow(VinValidationError);
  });

  it("rejects the empty string", () => {
    expect(() => vinNormalize("")).toThrow(VinValidationError);
  });
});

describe("isPlaceholderText", () => {
  it.each(["null", "NULL", " undefined ", "NaN", "TBD", "tbd", "n/a", "lorem ipsum dolor"])(
    "flags %j",
    (s) => expect(isPlaceholderText(s)).toBe(true),
  );

  it.each(["Moonbow Blue", "Nullarbor Edition", "Standard"])("allows %j", (s) =>
    expect(isPlaceholderText(s)).toBe(false),
  );
});

describe("validateStickerData", () => {
  it("accepts a fully normalized fixture", () => {
    const res = validateStickerData(valid());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validateStickerData(null).ok).toBe(false);
    expect(validateStickerData("sticker").ok).toBe(false);
  });

  it("rejects a non-normalized VIN", () => {
    const d = valid();
    d.vehicle.vin = "jn8az2ne8p9123456";
    const res = validateStickerData(d);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/vehicle\.vin/);
  });

  it("rejects a VIN containing I/O/Q", () => {
    const d = valid();
    d.vehicle.vin = "JN8AZ2NE8P912345O";
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects a currency other than USD", () => {
    const d = valid() as unknown as { pricing: { currency: string } };
    d.pricing.currency = "EUR";
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects negative prices", () => {
    const d = valid();
    d.pricing.baseMsrp = -1;
    const res = validateStickerData(d);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/negative/);
  });

  it("rejects implausibly large prices", () => {
    const d = valid();
    d.pricing.sourceReportedTotalMsrp = 25_000_000;
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("allows a negative reconciliationDifference", () => {
    const d = valid();
    d.pricing.reconciliationDifference = -55;
    expect(validateStickerData(d).ok).toBe(true);
  });

  it.each(["null", "undefined", "NaN", "TBD"])("rejects placeholder color %j", (bad) => {
    const d = valid();
    d.vehicle.exteriorColor = bad;
    const res = validateStickerData(d);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/placeholder/);
  });

  it("rejects lorem-ipsum text in equipment items", () => {
    const d = valid();
    d.equipment.standard[0].items[0] = "Lorem ipsum dolor sit amet";
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects an out-of-range model year", () => {
    const d = valid();
    d.vehicle.year = 1899;
    expect(validateStickerData(d).ok).toBe(false);
    d.vehicle.year = new Date().getFullYear() + 5;
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects an invalid condition enum value", () => {
    const d = valid() as unknown as { vehicle: { condition: string } };
    d.vehicle.condition = "PRE_OWNED";
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects a PRICED option without a price", () => {
    const d = valid();
    d.equipment.options[0] = { name: "Mystery Option", priceStatus: "PRICED" };
    const res = validateStickerData(d);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/PRICED but has no price/);
  });

  it("rejects an UNAVAILABLE option that carries a price", () => {
    const d = valid();
    d.equipment.options[0] = { name: "Mystery Option", priceStatus: "UNAVAILABLE", price: 100 };
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects a NO_CHARGE item with a non-zero price", () => {
    const d = valid();
    d.equipment.packages[0].priceStatus = "NO_CHARGE";
    d.equipment.packages[0].price = 750;
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects a malformed generatedAt timestamp", () => {
    const d = valid();
    d.document.generatedAt = "yesterday";
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects a non-URL passportUrl", () => {
    const d = valid();
    d.document.passportUrl = "not-a-url";
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("rejects unknown extra keys", () => {
    const d = valid() as unknown as Record<string, unknown>;
    d.surprise = true;
    expect(validateStickerData(d).ok).toBe(false);
  });

  it("reports every error with a path", () => {
    const d = valid();
    d.vehicle.exteriorColor = "TBD";
    d.pricing.baseMsrp = -5;
    const res = validateStickerData(d);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
    for (const e of res.errors) expect(e).toMatch(/^[a-z]+[a-zA-Z.0-9]*: /);
  });
});
