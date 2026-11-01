import { describe, it, expect } from "vitest";
import { sha256Hex, sign, signingMessage, timingSafeEqualHex, verify, withinSkew } from "./signing.ts";

describe("signing", () => {
  it("builds the domain-separated message", () => {
    expect(signingMessage("1700000000", "key_1", "abc")).toBe("rooftopos.v1\n1700000000\nkey_1\nabc");
  });

  it("matches an independently computed HMAC-SHA256", async () => {
    const body = '{"a":1}';
    const expected = await (async () => {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s3cret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const msg = signingMessage("1700000000", "key_1", await sha256Hex(body));
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
      return "v1=" + Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
    })();
    expect(await sign("s3cret", "1700000000", "key_1", body)).toBe(expected);
  });

  it("SEC-02 rejects a changed body, key id, timestamp or secret", async () => {
    const sig = await sign("s3cret", "1700000000", "key_1", "body");
    expect(await verify("s3cret", "1700000000", "key_1", "body", sig)).toBe(true);
    expect(await verify("s3cret", "1700000000", "key_1", "body!", sig)).toBe(false);
    expect(await verify("s3cret", "1700000000", "key_2", "body", sig)).toBe(false);
    expect(await verify("s3cret", "1700000001", "key_1", "body", sig)).toBe(false);
    expect(await verify("other", "1700000000", "key_1", "body", sig)).toBe(false);
    expect(await verify("s3cret", "1700000000", "key_1", "body", "")).toBe(false);
  });

  it("compares signatures without length shortcuts", () => {
    expect(timingSafeEqualHex("abc", "abc")).toBe(true);
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
    expect(timingSafeEqualHex("abc", "abd")).toBe(false);
  });

  it("SEC-03 enforces a 300 second skew in both directions", () => {
    expect(withinSkew(1000, 1300, 300)).toBe(true);
    expect(withinSkew(1000, 1301, 300)).toBe(false);
    expect(withinSkew(1301, 1000, 300)).toBe(false);
    expect(withinSkew(Number.NaN, 1000)).toBe(false);
  });
});
