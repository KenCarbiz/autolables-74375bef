import { describe, it, expect } from "vitest";
import { isSafePassportReturnPath, buildPassportActionPath, resolvePassportBack, passportForwardPath } from "./passportReturn";

describe("isSafePassportReturnPath", () => {
  it("accepts internal passport paths", () => {
    expect(isSafePassportReturnPath("/v3/2023-infiniti-qx50-113139")).toBe(true);
    expect(isSafePassportReturnPath("/v/2023-infiniti-qx50-113139")).toBe(true);
    expect(isSafePassportReturnPath("/v/3PCAJ5BB1PF113139")).toBe(true);
  });
  it("rejects external and unsafe targets (no open redirect)", () => {
    expect(isSafePassportReturnPath("https://evil.com")).toBe(false);
    expect(isSafePassportReturnPath("//evil.com")).toBe(false);
    expect(isSafePassportReturnPath("http://x/v/abc")).toBe(false);
    expect(isSafePassportReturnPath("/admin")).toBe(false);
    expect(isSafePassportReturnPath("/v/../admin")).toBe(false);
    expect(isSafePassportReturnPath("/dashboard")).toBe(false);
    expect(isSafePassportReturnPath(null)).toBe(false);
    expect(isSafePassportReturnPath("")).toBe(false);
  });
});

describe("buildPassportActionPath", () => {
  it("carries the originating V3 path as returnTo", () => {
    expect(buildPassportActionPath("qx50", "todays-price", "/v3/qx50")).toBe(
      "/v/qx50/todays-price?returnTo=%2Fv3%2Fqx50",
    );
  });
  it("carries the governed /v/ path as returnTo when that is the origin", () => {
    expect(buildPassportActionPath("qx50", "reserve", "/v/qx50")).toBe(
      "/v/qx50/reserve?returnTo=%2Fv%2Fqx50",
    );
  });
  it("omits an unsafe origin", () => {
    expect(buildPassportActionPath("qx50", "contact", "https://evil.com")).toBe("/v/qx50/contact");
    expect(buildPassportActionPath("qx50", "contact", null)).toBe("/v/qx50/contact");
  });
  it("preserves preview mode", () => {
    expect(buildPassportActionPath("qx50", "test-drive", "/v3/qx50", true)).toBe(
      "/v/qx50/test-drive?returnTo=%2Fv3%2Fqx50&preview=1",
    );
  });
});

describe("passportForwardPath", () => {
  it("preserves the originating returnTo across a forward hop", () => {
    // On /v/qx50/reserve?returnTo=/v3/qx50, going forward to Trade keeps /v3.
    expect(passportForwardPath("qx50", "trade", "?returnTo=%2Fv3%2Fqx50", false)).toBe(
      "/v/qx50/trade?returnTo=%2Fv3%2Fqx50",
    );
  });
  it("omits returnTo when none is present or it is unsafe", () => {
    expect(passportForwardPath("qx50", "trade", "", false)).toBe("/v/qx50/trade");
    expect(passportForwardPath("qx50", "trade", "?returnTo=https%3A%2F%2Fevil.com", false)).toBe("/v/qx50/trade");
  });
  it("preserves preview", () => {
    expect(passportForwardPath("qx50", "reserve", "?returnTo=%2Fv3%2Fqx50", true)).toBe(
      "/v/qx50/reserve?returnTo=%2Fv3%2Fqx50&preview=1",
    );
  });
});

describe("resolvePassportBack", () => {
  it("returns to the validated V3 origin", () => {
    expect(resolvePassportBack("?returnTo=%2Fv3%2Fqx50", "qx50", false)).toBe("/v3/qx50");
  });
  it("falls back to /v/:slug when no returnTo", () => {
    expect(resolvePassportBack("", "qx50", false)).toBe("/v/qx50");
  });
  it("rejects an unsafe returnTo and falls back", () => {
    expect(resolvePassportBack("?returnTo=https%3A%2F%2Fevil.com", "qx50", false)).toBe("/v/qx50");
    expect(resolvePassportBack("?returnTo=%2Fadmin", "qx50", false)).toBe("/v/qx50");
  });
  it("preserves preview in both the returnTo and the fallback", () => {
    expect(resolvePassportBack("?returnTo=%2Fv3%2Fqx50", "qx50", true)).toBe("/v3/qx50?preview=1");
    expect(resolvePassportBack("", "qx50", true)).toBe("/v/qx50?preview=1");
  });
});
