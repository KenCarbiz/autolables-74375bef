import { describe, expect, it } from "vitest";
import {
  generationFingerprint,
  generationFingerprintAsync,
  sha256HexAsync,
  sha256HexSync,
  stableStringify,
} from "./fingerprint";
import { normalizeNeovin } from "./normalizeNeovin";
import { infinitiLuxurySuv } from "./__fixtures__";
import type { FactoryStickerData } from "./types";

const data = (): FactoryStickerData => normalizeNeovin(infinitiLuxurySuv());
const fp = (d: FactoryStickerData, over: Partial<Record<"template" | "renderer" | "theme" | "logo" | "url", string>> = {}) =>
  generationFingerprint(d, over.template ?? "1.0.0", over.renderer ?? "1.0.0", over.theme ?? "1.0.0", over.logo, over.url ?? "https://autolabels.io/v/demo-qx80");

describe("stableStringify", () => {
  it("sorts object keys so key order never changes the output", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys recursively", () => {
    expect(stableStringify({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it("preserves array order", () => {
    expect(stableStringify([2, 1])).toBe("[2,1]");
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
  });

  it("omits undefined object values like JSON does", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("serializes undefined array slots and non-finite numbers as null", () => {
    expect(stableStringify([undefined, Number.NaN, Infinity])).toBe("[null,null,null]");
  });

  it("handles primitives and null", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("a\"b")).toBe(JSON.stringify('a"b'));
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(1.5)).toBe("1.5");
  });
});

describe("sha256", () => {
  it("produces the known SHA-256 of the empty string", () => {
    expect(sha256HexSync("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("async WebCrypto variant matches the sync node variant", async () => {
    const input = stableStringify(data());
    expect(await sha256HexAsync(input)).toBe(sha256HexSync(input));
  });
});

describe("generationFingerprint", () => {
  it("is a 64-character lowercase hex string", () => {
    expect(fp(data())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: same input, same hash", () => {
    expect(fp(data())).toBe(fp(data()));
  });

  it("changes when the sticker data changes", () => {
    const d = data();
    const before = fp(d);
    d.pricing.baseMsrp = 89451;
    expect(fp(d)).not.toBe(before);
  });

  it("changes when templateVersion changes", () => {
    expect(fp(data(), { template: "1.0.1" })).not.toBe(fp(data()));
  });

  it("changes when rendererVersion changes", () => {
    expect(fp(data(), { renderer: "1.0.1" })).not.toBe(fp(data()));
  });

  it("changes when themeVersion changes", () => {
    expect(fp(data(), { theme: "1.0.1" })).not.toBe(fp(data()));
  });

  it("changes when logoAssetVersion changes, including undefined vs set", () => {
    expect(fp(data(), { logo: "logo-v1" })).not.toBe(fp(data()));
    expect(fp(data(), { logo: "logo-v2" })).not.toBe(fp(data(), { logo: "logo-v1" }));
  });

  it("changes when passportUrl changes", () => {
    expect(fp(data(), { url: "https://autolabels.io/v/other" })).not.toBe(fp(data()));
  });

  it("async variant produces the identical fingerprint", async () => {
    const d = data();
    const sync = generationFingerprint(d, "1.0.0", "1.0.0", "1.0.0", undefined, "https://autolabels.io/v/demo-qx80");
    const async_ = await generationFingerprintAsync(d, "1.0.0", "1.0.0", "1.0.0", undefined, "https://autolabels.io/v/demo-qx80");
    expect(async_).toBe(sync);
  });
});
