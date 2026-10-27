import { describe, it, expect } from "vitest";
import {
  EXACT_ONLY_CLAIMS, IDENTITY_MATCH_LEVELS, identityConfidenceCeiling, isExactIdentity, mayClaim,
  mergeByIdentity, readIdentityResolution,
} from "./identityMatch.ts";

describe("generic fallback is never exact verification", () => {
  it.each(EXACT_ONLY_CLAIMS)("%s cannot be claimed from a generic candidate, YMMT or YMM match", (claim) => {
    expect(mayClaim(claim, "GENERIC_CANDIDATE")).toBe(false);
    expect(mayClaim(claim, "YMMT")).toBe(false);
    expect(mayClaim(claim, "YMM")).toBe(false);
    expect(mayClaim(claim, "UNKNOWN")).toBe(false);
  });

  it.each(EXACT_ONLY_CLAIMS)("%s may be claimed only from an exact VIN or exact build identity", (claim) => {
    expect(mayClaim(claim, "EXACT_VIN")).toBe(true);
    expect(mayClaim(claim, "EXACT_BUILD")).toBe(true);
  });

  it("still allows market context and a price estimate from a generic match, never from unknown", () => {
    expect(mayClaim("price_estimate", "GENERIC_CANDIDATE")).toBe(true);
    expect(mayClaim("market_context", "YMM")).toBe(true);
    expect(mayClaim("price_estimate", "UNKNOWN")).toBe(false);
  });
});

describe("generic fallback lowers identity confidence", () => {
  it("caps Data Confidence by identity level", () => {
    expect(identityConfidenceCeiling("EXACT_VIN")).toBe("high");
    expect(identityConfidenceCeiling("EXACT_BUILD")).toBe("high");
    expect(identityConfidenceCeiling("YMMT")).toBe("moderate");
    expect(identityConfidenceCeiling("YMM")).toBe("limited");
    expect(identityConfidenceCeiling("GENERIC_CANDIDATE")).toBe("limited");
    expect(identityConfidenceCeiling("UNKNOWN")).toBe("none");
  });

  it("keeps the levels distinct and ordered", () => {
    expect(IDENTITY_MATCH_LEVELS).toEqual(["EXACT_VIN", "EXACT_BUILD", "YMMT", "YMM", "GENERIC_CANDIDATE", "UNKNOWN"]);
    expect(isExactIdentity("GENERIC_CANDIDATE")).toBe(false);
  });
});

describe("reading the provider's answer", () => {
  it("is exact only when no fallback was asked for and nothing in the body says generic", () => {
    const r = readIdentityResolution({ body: { marketcheck_price: 1 }, fallbackRequested: false });
    expect(r.level).toBe("EXACT_VIN");
    expect(r.fallbackUsed).toBe(false);
  });

  it("is a generic candidate whenever the provider marks it or returns candidates, and keeps them", () => {
    const r = readIdentityResolution({
      body: { marketcheck_price: 1, is_generic: true, candidates: [{ trim: "Base" }, { trim: "Premium" }], match_tier: "ymm" },
      fallbackRequested: true,
    });
    expect(r.level).toBe("GENERIC_CANDIDATE");
    expect(r.fallbackUsed).toBe(true);
    expect(r.candidates).toHaveLength(2);
    expect(r.providerTier).toBe("ymm");
    expect(r.diagnostics).toContain("provider_marked_generic");
  });

  it("flags a generic answer that arrived without being asked for", () => {
    const r = readIdentityResolution({ body: { generic_candidates: [{}] }, fallbackRequested: false });
    expect(r.level).toBe("GENERIC_CANDIDATE");
    expect(r.diagnostics).toContain("generic_answer_without_fallback_request");
  });

  it("is UNKNOWN, not exact, when a fallback was requested and the body is silent", () => {
    const r = readIdentityResolution({ body: { marketcheck_price: 1 }, fallbackRequested: true });
    expect(r.level).toBe("UNKNOWN");
    expect(r.diagnostics).toContain("fallback_requested_no_marker_in_body");
  });

  it("is exact when a fallback was requested and the provider explicitly says it was not used", () => {
    const r = readIdentityResolution({ body: { marketcheck_price: 1, is_generic: false }, fallbackRequested: true });
    expect(r.level).toBe("EXACT_VIN");
  });

  it("handles a non-object body as UNKNOWN after a fallback request", () => {
    expect(readIdentityResolution({ body: null, fallbackRequested: true }).level).toBe("UNKNOWN");
  });
});

describe("generic data never silently overwrites exact facts", () => {
  it("keeps the held exact value when the incoming one is less exact", () => {
    const m = mergeByIdentity({ value: "LUXE", level: "EXACT_VIN" }, { value: "SENSORY", level: "GENERIC_CANDIDATE" });
    expect(m?.value).toBe("LUXE");
    expect(m?.reason).toBe("incoming_less_exact_than_held");
  });

  it("lets a more exact value replace a generic one and lets a gap be filled", () => {
    expect(mergeByIdentity({ value: "x", level: "YMM" }, { value: "y", level: "EXACT_VIN" })?.value).toBe("y");
    expect(mergeByIdentity(null, { value: "y", level: "GENERIC_CANDIDATE" })?.reason).toBe("incoming_fills_gap");
  });

  it("lets a refresh at the same level win", () => {
    expect(mergeByIdentity({ value: 1, level: "EXACT_VIN" }, { value: 2, level: "EXACT_VIN" })?.value).toBe(2);
  });
});
