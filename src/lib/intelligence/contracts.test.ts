import { describe, it, expect } from "vitest";
import {
  AUTHORITY_CLASSES, containsForbiddenKey, DEAL_RATING_LABELS, HARD_GATES, isNewPassport, makeFact,
  PUBLIC_STATES, RECOMMENDATION_STATES, resolveFreshness, SCORE_DOMAINS, SCORE_NEVER_INFLUENCED_BY, SCORE_WEIGHTS,
  TITLE_ODOMETER_STATES, unknownFact, VIN_RECALL_CONTRACT_STATES,
} from "./contracts";

const NOW = Date.parse("2026-10-28T00:00:00Z");

describe("the shared vocabulary", () => {
  it("states the six public states, the four title states and the seven recall contract states", () => {
    expect(PUBLIC_STATES).toEqual(["verified", "warning", "adverse", "unknown", "stale", "unavailable"]);
    expect(TITLE_ODOMETER_STATES).toEqual(["VERIFIED_NO_ADVERSE_REPORTED", "ADVERSE", "REVIEW_REQUIRED", "NOT_VERIFIED"]);
    expect(VIN_RECALL_CONTRACT_STATES).toHaveLength(7);
    expect(RECOMMENDATION_STATES).toContain("NOT_ENOUGH_VERIFIED_INFORMATION");
    expect(DEAL_RATING_LABELS).toContain("unavailable");
    expect(AUTHORITY_CLASSES).toContain("government_record");
  });

  it("keeps the score weights at 35/30/20/15 and names what may never raise the score", () => {
    expect(SCORE_DOMAINS).toEqual(["integrity", "condition", "provenance", "documentation_safety"]);
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(SCORE_WEIGHTS).toEqual({ integrity: 35, condition: 30, provenance: 20, documentation_safety: 15 });
    for (const banned of ["market_demand", "dealer_price", "marketmatch", "cheapness", "deal_rating"]) {
      expect(SCORE_NEVER_INFLUENCED_BY).toContain(banned);
    }
    expect(HARD_GATES).toContain("unresolved_title_brand");
    expect(HARD_GATES).toContain("open_safety_recall");
  });
});

describe("freshness", () => {
  it("is unknown without a check date, current inside the TTL, stale past it", () => {
    expect(resolveFreshness({ checkedAt: null, ttlDays: 7, nowMs: NOW }).state).toBe("unknown");
    const fresh = resolveFreshness({ checkedAt: "2026-10-25T00:00:00Z", ttlDays: 7, nowMs: NOW });
    expect(fresh.state).toBe("current");
    expect(fresh.staleAt).toBe("2026-11-01T00:00:00.000Z");
    expect(resolveFreshness({ checkedAt: "2026-10-01T00:00:00Z", ttlDays: 7, nowMs: NOW }).state).toBe("stale");
    expect(resolveFreshness({ checkedAt: "2026-10-01T00:00:00Z", ttlDays: null, nowMs: NOW }).state).toBe("current");
    expect(resolveFreshness({ checkedAt: "not a date", ttlDays: 7, nowMs: NOW }).state).toBe("unknown");
  });
});

describe("facts", () => {
  it("an unknown is a state with a reason, never a value", () => {
    const f = unknownFact<number>("no_report");
    expect(f.value).toBeNull();
    expect(f.state).toBe("unknown");
    expect(f.confidence).toBe("UNVERIFIED");
    expect(f.reasons).toEqual(["no_report"]);
  });

  it("a verified fact past its TTL presents as stale, and an adverse one stays adverse", () => {
    const stale = makeFact(true, { state: "verified", authority: "government_record", confidence: "VERIFIED", checkedAt: "2026-09-01T00:00:00Z", ttlDays: 30, nowMs: NOW });
    expect(stale.state).toBe("stale");
    expect(stale.freshness.state).toBe("stale");
    const adverse = makeFact("SALVAGE", { state: "adverse", authority: "government_record", confidence: "VERIFIED", checkedAt: "2026-09-01T00:00:00Z", ttlDays: 30, nowMs: NOW });
    expect(adverse.state).toBe("adverse");
  });
});

describe("read-model hygiene", () => {
  it("finds a forbidden key anywhere in a nested read model", () => {
    expect(containsForbiddenKey({ vehicle: { vin: "X" }, marketValue: { signals: [{ raw_payload: {} }] } })).toBe("raw_payload");
    expect(containsForbiddenKey({ vehicle: { vin: "X" }, media: { photos: [] } })).toBeNull();
    expect(containsForbiddenKey(null)).toBeNull();
  });

  it("tells a new passport from a used one by its declared type", () => {
    expect(isNewPassport({ vehicleType: "new" } as never)).toBe(true);
    expect(isNewPassport({ vehicleType: "used" } as never)).toBe(false);
  });
});
