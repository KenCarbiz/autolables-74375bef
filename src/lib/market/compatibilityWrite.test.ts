// ── The compatibility columns are the customer's ───────────────────────────
//
// The mandated Gate 14F-A fixture is the vehicle we actually paid to value:
//
//   legacy market_value     $39,158
//   legacy market_position  above_market
//   provider prediction     $40,661   (paid, valid, entitled)
//   V2 marketP50            null      (0 of 7 comparables eligible)
//   V2 position             null
//   V2 status               limited
//   V2 confidence           low
//
// Expected: nothing moves. $39,158 stays, above_market stays, the payload is
// untouched, and `compatibility_updated` is false.
//
// The old code would have written `market_value: null, market_position: null`
// onto a published car the moment `market_value_v2_admin` was flipped — under
// a flag whose name says "admin" and whose columns are read by PublicListing,
// TrustStrip and the Passport.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decideCompatibilityWrite, wouldDestroyLegacyClaim,
  type CompatibilityCandidate, type LegacyMarketColumns,
} from "./compatibilityWrite.ts";

const LEGACY: LegacyMarketColumns = { market_value: 39_158, market_position: "above_market" };

/** The proven Gate 14D result, exactly as `vehicle_market_valuations` holds it. */
const QX50_CANDIDATE: CompatibilityCandidate = {
  marketP50: null,
  status: "limited",
  confidence: "low",
  checkedAt: "2026-09-11T03:06:49.746Z",
  verdict: "Limited Market Evidence",
  effectiveComparableCount: 0,
  providerPrediction: 40_661,
  approvedPositionMapping: null,
};

const decide = (
  over: Partial<CompatibilityCandidate> = {},
  flagEnabled = true,
  legacy: LegacyMarketColumns = LEGACY,
) => decideCompatibilityWrite({
  flagEnabled,
  legacy,
  candidate: { ...QX50_CANDIDATE, ...over },
  payload: { source: "marketcheck", valuation_id: "78961f12-e1fa-4a74-b314-5cce335e7bc2" },
});

describe("the mandated QX50 regression fixture", () => {
  const d = decide();

  it("does not update the compatibility columns", () => {
    expect(d.update).toBe(false);
    expect(d.patch).toBeNull();
  });

  it("leaves $39,158 and above_market exactly where they are", () => {
    expect(wouldDestroyLegacyClaim(LEGACY, d.patch)).toBe(false);
    // Nothing to apply means nothing to overwrite. Stated as the assertion a
    // caller would make, not as a property of a null.
    expect(LEGACY.market_value).toBe(39_158);
    expect(LEGACY.market_position).toBe("above_market");
  });

  it("says the flag alone was not authorization", () => {
    expect(d.reasons).toContain("legacy_position_mapping_not_approved");
    expect(d.reasons).toContain("flag_alone_is_not_authorization_for_a_destructive_write");
  });
});

describe("the non-destruction rules", () => {
  it("a null marketP50 never overwrites a non-null legacy value", () => {
    const d = decide({ approvedPositionMapping: "above_market", status: "available", confidence: "high" });
    expect(d.update).toBe(false);
    expect(d.reasons).toContain("v2_market_value_absent");
    expect(d.reasons).toContain("would_erase_legacy_market_value");
  });

  it("a limited or unavailable status never touches a legacy claim", () => {
    for (const status of ["limited", "unavailable"] as const) {
      const d = decide({
        status, approvedPositionMapping: "above_market",
        marketP50: 40_100, confidence: "high", effectiveComparableCount: 6,
      });
      expect(d.update, status).toBe(false);
      expect(d.reasons).toContain(`v2_status_${status}`);
      expect(d.reasons).toContain("would_erase_legacy_market_value");
      expect(d.reasons).toContain("would_erase_legacy_market_position");
    }
  });

  it("low or unavailable confidence never speaks about a published vehicle", () => {
    for (const confidence of ["low", "unavailable"] as const) {
      const d = decide({
        confidence, status: "available", marketP50: 40_100,
        effectiveComparableCount: 6, approvedPositionMapping: "above_market",
      });
      expect(d.update, confidence).toBe(false);
      expect(d.reasons).toContain(`v2_confidence_${confidence}`);
    }
  });

  it("a provider prediction alone never becomes the compatibility value", () => {
    // Everything else is satisfied; only the market is missing. $40,661 is a
    // real, paid, entitled number and it is still one opinion about one car.
    const d = decide({
      status: "available", confidence: "high", marketP50: 40_661,
      effectiveComparableCount: 0, approvedPositionMapping: "at_market",
    });
    expect(d.update).toBe(false);
    expect(d.reasons).toContain("no_effective_comparables");
    expect(d.reasons).toContain("provider_prediction_is_not_a_market_value");
  });

  it("never writes a new value beside an unapproved or blank position", () => {
    for (const mapping of [null, "", "   "]) {
      const d = decide({
        status: "available", confidence: "high", marketP50: 40_100,
        effectiveComparableCount: 6, approvedPositionMapping: mapping,
      });
      expect(d.update, JSON.stringify(mapping)).toBe(false);
    }
  });

  it("the flag being off is checked before anything else", () => {
    const d = decide({}, false);
    expect(d.update).toBe(false);
    expect(d.reasons).toEqual(["compatibility_flag_off"]);
  });

  it("refuses without a checked-at stamp", () => {
    const d = decide({
      status: "available", confidence: "high", marketP50: 40_100,
      effectiveComparableCount: 6, approvedPositionMapping: "at_market", checkedAt: null,
    });
    expect(d.update).toBe(false);
    expect(d.reasons).toContain("v2_checked_at_absent");
  });
});

describe("the one shape that IS allowed to write", () => {
  const d = decide({
    status: "available", confidence: "high", marketP50: 40_100,
    effectiveComparableCount: 6, approvedPositionMapping: "at_market",
  });

  it("moves value and position together, never one without the other", () => {
    expect(d.update).toBe(true);
    expect(d.patch).not.toBeNull();
    expect(d.patch?.market_value).toBe(40_100);
    expect(d.patch?.market_position).toBe("at_market");
    expect(d.patch?.market_checked_at).toBe(QX50_CANDIDATE.checkedAt);
  });

  it("produces a patch that destroys nothing", () => {
    expect(wouldDestroyLegacyClaim(LEGACY, d.patch)).toBe(false);
  });

  it("carries no null into either customer-facing column", () => {
    for (const key of ["market_value", "market_position"] as const) {
      expect(d.patch?.[key]).not.toBeNull();
      expect(d.patch?.[key]).not.toBeUndefined();
    }
  });
});

describe("wouldDestroyLegacyClaim", () => {
  it("catches a blanking patch in either column", () => {
    expect(wouldDestroyLegacyClaim(LEGACY, { market_value: null, market_position: null })).toBe(true);
    expect(wouldDestroyLegacyClaim(LEGACY, { market_value: 40_100, market_position: null })).toBe(true);
    expect(wouldDestroyLegacyClaim(LEGACY, { market_value: null })).toBe(true);
    expect(wouldDestroyLegacyClaim(LEGACY, { market_value: 40_100, market_position: "at_market" })).toBe(false);
  });

  it("is not tripped when there was no legacy claim to destroy", () => {
    const blank: LegacyMarketColumns = { market_value: null, market_position: null };
    expect(wouldDestroyLegacyClaim(blank, { market_value: null, market_position: null })).toBe(false);
  });
});

describe("the writer wires the decision rather than repeating it", () => {
  const WRITER = "supabase/functions/market-valuation-write/index.ts";
  const src = readFileSync(WRITER, "utf8");

  it("calls the module instead of writing the columns inline", () => {
    expect(src).toContain("decideCompatibilityWrite({");
    expect(src).toContain("if (compatibility.update && compatibility.patch)");
  });

  it("no longer writes a literal null position", () => {
    // The exact removed line. If it returns, this fails before a deploy can
    // blank a published vehicle.
    expect(src).not.toMatch(/market_position:\s*null/);
    expect(src).not.toMatch(/market_value:\s*view\.marketP50/);
  });

  it("passes an unapproved position mapping, so today's answer is no write", () => {
    expect(src).toMatch(/approvedPositionMapping:\s*null/);
  });

  it("keeps compatibility_updated in the audit row and the response", () => {
    expect(src).toContain("compatibility_updated: compatibilityUpdated");
    expect(src).toContain("compatibility_reasons: compatibility.reasons");
  });

  it("still never updates or deletes the append-only evidence tables", () => {
    for (const table of ["vehicle_market_valuations", "vehicle_market_comparables"]) {
      expect(src).not.toMatch(new RegExp(`from\\("${table}"\\)\\s*\\.\\s*(update|delete)`));
    }
    expect(src).not.toMatch(/\.delete\(\)/);
  });
});
