import { describe, it, expect } from "vitest";
import { normalizeTier, FEATURE_TIER, rankOf } from "./features";

describe("entitlement tier normalization (no-lockout safety)", () => {
  it("treats the bundled essential plan as Pro-level", () => {
    expect(normalizeTier("essential", true)).toBe("pro");
  });
  it("defaults an active dealer with an unknown tier to Pro", () => {
    expect(normalizeTier("something-weird", true)).toBe("pro");
    expect(normalizeTier(null, true)).toBe("pro");
  });
  it("maps compliance/enterprise tiers to compliance", () => {
    expect(normalizeTier("compliance", true)).toBe("compliance");
    expect(normalizeTier("enterprise", true)).toBe("compliance");
  });
  it("keeps explicit starter/free at starter", () => {
    expect(normalizeTier("free", true)).toBe("starter");
  });
  it("returns none without app access", () => {
    expect(normalizeTier("pro", false)).toBe("none");
  });
});

describe("feature tier map", () => {
  it("keeps existing live flows at or below Pro so dealers aren't locked out", () => {
    for (const k of ["addendum_signing", "sticker_studio", "manager_approval_rules", "qr_tracking", "sticker_packet_match_review"] as const) {
      expect(rankOf(FEATURE_TIER[k])).toBeLessThanOrEqual(rankOf("pro"));
    }
  });
  it("gates not-yet-built compliance surfaces at the compliance tier", () => {
    expect(FEATURE_TIER.evidence_packet_export).toBe("compliance");
    expect(FEATURE_TIER.compliance_evidence_timeline).toBe("compliance");
  });
});
