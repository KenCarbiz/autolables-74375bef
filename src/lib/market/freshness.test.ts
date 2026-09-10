import { describe, it, expect } from "vitest";
import {
  resolveProviderFreshness, isTransientFailure, TRANSIENT_OUTCOMES,
  PROVIDER_FRESH_DAYS, PROVIDER_HARD_EXPIRY_DAYS, type ProviderAttemptOutcome,
} from "./freshness.ts";

const base = {
  lastGoodAgeDays: 2,
  attemptOutcome: "succeeded" as ProviderAttemptOutcome,
  certificationMismatch: false,
  subjectMismatch: false,
  priceBasisInvalid: false,
};

describe("age bands", () => {
  it("is fresh through seven days and red is reachable", () => {
    for (const age of [0, 1, PROVIDER_FRESH_DAYS]) {
      const r = resolveProviderFreshness({ ...base, lastGoodAgeDays: age });
      expect(r.tier).toBe("fresh");
      expect(r.useLastGood).toBe(true);
      expect(r.allowRed).toBe(true);
      expect(r.showStaleWarning).toBe(false);
    }
  });

  it("is stale from eight to fourteen days: usable, warned, never red", () => {
    for (const age of [PROVIDER_FRESH_DAYS + 1, 10, PROVIDER_HARD_EXPIRY_DAYS]) {
      const r = resolveProviderFreshness({ ...base, lastGoodAgeDays: age });
      expect(r.tier).toBe("stale");
      expect(r.useLastGood).toBe(true);
      expect(r.allowRed).toBe(false);
      expect(r.showStaleWarning).toBe(true);
      expect(r.refreshRecommended).toBe(true);
    }
  });

  it("is expired past fourteen days and claims nothing", () => {
    const r = resolveProviderFreshness({ ...base, lastGoodAgeDays: PROVIDER_HARD_EXPIRY_DAYS + 0.1 });
    expect(r.tier).toBe("expired");
    expect(r.useLastGood).toBe(false);
    expect(r.allowRed).toBe(false);
  });

  it("claims nothing with no stored answer", () => {
    const r = resolveProviderFreshness({ ...base, lastGoodAgeDays: null });
    expect(r.tier).toBe("none");
    expect(r.reasons).toContain("no_stored_provider_answer");
  });
});

describe("a transient failure preserves the last-good value", () => {
  it("keeps a fresh answer usable after every transient outcome", () => {
    for (const outcome of TRANSIENT_OUTCOMES) {
      const r = resolveProviderFreshness({ ...base, attemptOutcome: outcome });
      expect(r.useLastGood, outcome).toBe(true);
      expect(r.tier, outcome).toBe("fresh");
      expect(r.reasons, outcome).toContain(`provider_attempt_${outcome}`);
      expect(r.reasons, outcome).toContain("failed_attempt_did_not_replace_last_good");
    }
  });

  it("still expires an old answer even when the refresh failed transiently", () => {
    const r = resolveProviderFreshness({ ...base, lastGoodAgeDays: 30, attemptOutcome: "timeout" });
    expect(r.useLastGood).toBe(false);
    expect(r.tier).toBe("expired");
  });

  it("never represents a failed attempt as a successful current valuation", () => {
    const r = resolveProviderFreshness({ ...base, attemptOutcome: "rate_limited" });
    expect(r.reasons.some((x) => x.startsWith("provider_attempt_"))).toBe(true);
  });

  it("classifies outcomes", () => {
    expect(isTransientFailure("timeout")).toBe(true);
    expect(isTransientFailure("succeeded")).toBe(false);
    expect(isTransientFailure("not_attempted")).toBe(false);
  });
});

describe("hard overrides void the last-good answer immediately", () => {
  it("a certification mismatch voids it whatever the age", () => {
    const r = resolveProviderFreshness({ ...base, lastGoodAgeDays: 0, certificationMismatch: true });
    expect(r.useLastGood).toBe(false);
    expect(r.tier).toBe("none");
    expect(r.reasons).toContain("certification_mismatch_voids_last_good");
  });

  it("a subject mismatch voids it", () => {
    expect(resolveProviderFreshness({ ...base, subjectMismatch: true }).useLastGood).toBe(false);
  });

  it("an invalid price basis voids it", () => {
    expect(resolveProviderFreshness({ ...base, priceBasisInvalid: true }).useLastGood).toBe(false);
  });

  it("outranks a perfectly fresh successful answer", () => {
    const fresh = resolveProviderFreshness({ ...base, lastGoodAgeDays: 0 });
    expect(fresh.allowRed).toBe(true);
    const voided = resolveProviderFreshness({ ...base, lastGoodAgeDays: 0, certificationMismatch: true });
    expect(voided.allowRed).toBe(false);
  });
});
