// ── What a customer may be told, and what stays inside ─────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decidePublicMarketClaim, decidePublicMarketClaimForTenant, publicMarketClaimForListing,
  positionValueInconsistent, claimAgeDays, isInternalOnlyCopy,
  PUBLIC_MARKET_FRESHNESS_DAYS, MARKET_CLAIM_UNAVAILABLE_MESSAGE,
} from "./publicClaim.ts";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

/** A vehicle with nothing wrong with it. */
const HEALTHY = {
  marketValue: 39_158,
  marketPosition: "above_market",
  marketCheckedAt: daysAgo(1),
  comparePrice: 43_876,
};

const on = (input: Record<string, unknown> = {}) =>
  decidePublicMarketClaim({ ...HEALTHY, ...input }, { suppressionEnabled: true, now: NOW });

describe("the flag off path is today's UI, unchanged", () => {
  it("shows every claim, including the broken ones", () => {
    for (const input of [
      HEALTHY,
      { marketValue: null, marketPosition: null, marketCheckedAt: null },
      { marketValue: -5, marketCheckedAt: daysAgo(400) },
      { marketValue: 39_158, marketPosition: "below_market", comparePrice: 43_876, marketCheckedAt: daysAgo(90) },
      { certificationConflict: true, explicitlyInvalid: true, v2Status: "limited" },
    ]) {
      const d = decidePublicMarketClaim(input, { suppressionEnabled: false, now: NOW });
      expect(d.show, JSON.stringify(input)).toBe(true);
      expect(d.suppressed).toBe(false);
      expect(d.customerMessage).toBeNull();
      expect(d.reasons).toEqual(["suppression_disabled"]);
    }
  });

  it("is decided before any other condition is even evaluated", () => {
    const src = readFileSync("src/lib/market/publicClaim.ts", "utf8");
    const flagAt = src.indexOf("if (!options.suppressionEnabled)");
    const firstCheck = src.indexOf("const age = claimAgeDays(");
    expect(flagAt).toBeGreaterThan(-1);
    expect(firstCheck).toBeGreaterThan(flagAt);
  });

  it("reads only a literal true from tenant settings", () => {
    for (const flags of [
      {}, { market_invalid_claim_suppression: false },
      { market_invalid_claim_suppression: "true" }, { market_invalid_claim_suppression: 1 },
    ]) {
      const d = decidePublicMarketClaimForTenant({ market_flags: flags }, { marketValue: null }, NOW);
      expect(d.show, JSON.stringify(flags)).toBe(true);
    }
    const on = decidePublicMarketClaimForTenant(
      { market_flags: { market_invalid_claim_suppression: true } }, { marketValue: null }, NOW,
    );
    expect(on.show).toBe(false);
  });
});

describe("with suppression on", () => {
  it("publishes a healthy, fresh, consistent claim", () => {
    const d = on();
    expect(d.show).toBe(true);
    expect(d.reasons).toEqual(["claim_publishable"]);
  });

  it("suppresses a missing timestamp", () => {
    for (const t of [null, undefined, "", "   ", "not-a-date", 42]) {
      const d = on({ marketCheckedAt: t });
      expect(d.show, JSON.stringify(t)).toBe(false);
      expect(d.reasons).toContain("missing_market_timestamp");
    }
  });

  it("holds the seven-day boundary exactly", () => {
    expect(PUBLIC_MARKET_FRESHNESS_DAYS).toBe(7);
    expect(on({ marketCheckedAt: daysAgo(6.99) }).show).toBe(true);
    expect(on({ marketCheckedAt: daysAgo(7) }).show).toBe(true);
    const stale = on({ marketCheckedAt: daysAgo(7.01) });
    expect(stale.show).toBe(false);
    expect(stale.reasons).toContain("market_evidence_stale");
  });

  it("suppresses an invalid value", () => {
    for (const v of [null, undefined, 0, -1, NaN, Infinity, "39158", {}]) {
      const d = on({ marketValue: v });
      expect(d.show, JSON.stringify(v)).toBe(false);
      expect(d.reasons).toContain("market_value_invalid");
    }
  });

  it("suppresses a known certification conflict", () => {
    const d = on({ certificationConflict: true });
    expect(d.show).toBe(false);
    expect(d.reasons).toContain("certification_conflict");
  });

  it("suppresses an unverified price basis", () => {
    for (const basis of ["ambiguous", "invalid", "unknown"]) {
      const d = on({ priceBasisStatus: basis });
      expect(d.show, basis).toBe(false);
      expect(d.reasons).toContain(`price_basis_${basis}`);
    }
    expect(on({ priceBasisStatus: "verified" }).show).toBe(true);
  });

  it("suppresses an incomplete compatibility write and an explicit invalidation", () => {
    expect(on({ compatibilityIncomplete: true }).reasons).toContain("compatibility_write_incomplete");
    expect(on({ explicitlyInvalid: true }).reasons).toContain("claim_explicitly_invalid");
  });

  it("suppresses every non-publishable V2 status", () => {
    for (const status of ["limited", "unavailable", "abstained", "invalid", "conflicting"]) {
      const d = on({ v2Status: status });
      expect(d.show, status).toBe(false);
      expect(d.reasons).toContain(`v2_status_${status}`);
    }
    expect(on({ v2Status: "available" }).show).toBe(true);
  });

  it("suppresses a value and a position that contradict each other", () => {
    // Written by two different jobs, months apart. Half of a contradiction is
    // not a claim.
    const d = on({ marketValue: 45_000, marketPosition: "above_market", comparePrice: 43_876 });
    expect(d.show).toBe(false);
    expect(d.reasons).toContain("position_and_value_inconsistent");

    expect(positionValueInconsistent({ marketValue: 39_158, marketPosition: "below_market", comparePrice: 43_876 })).toBe(true);
    expect(positionValueInconsistent({ marketValue: 39_158, marketPosition: "above_market", comparePrice: 43_876 })).toBe(false);
    // Neutral vocabulary and missing numbers cannot contradict anything.
    expect(positionValueInconsistent({ marketValue: 39_158, marketPosition: "at_market", comparePrice: 43_876 })).toBe(false);
    expect(positionValueInconsistent({ marketValue: null, marketPosition: "above_market", comparePrice: 1 })).toBe(false);
  });
});

describe("what suppression does and does not remove", () => {
  it("says one neutral sentence and nothing else", () => {
    const d = on({ marketValue: null });
    expect(d.customerMessage).toBe(MARKET_CLAIM_UNAVAILABLE_MESSAGE);
    expect(d.customerMessage).toBe("Market comparison currently unavailable.");
    // Not an error, not an outage, not an apology.
    expect(d.customerMessage).not.toMatch(/error|fail|sorry|unavailable due|problem/i);
  });

  it("never puts a diagnostic in the customer message", () => {
    const d = on({ marketValue: null, v2Status: "limited", certificationConflict: true });
    for (const reason of d.reasons) expect(d.customerMessage).not.toContain(reason);
    expect(isInternalOnlyCopy(d.customerMessage)).toBe(false);
  });

  it("never exposes Limited Market Evidence to a customer", () => {
    const d = on({ v2Status: "limited" });
    expect(d.customerMessage).not.toContain("Limited Market Evidence");
    expect(isInternalOnlyCopy("Limited Market Evidence")).toBe(true);
    expect(isInternalOnlyCopy("Market Estimate Unavailable")).toBe(true);
  });

  it("carries no price of any kind", () => {
    // Not the advertised price, not $42,981, and not $40,661.
    const d = on({ marketValue: null });
    for (const n of ["43,876", "42,981", "40,661", "39,158", "895"]) {
      expect(d.customerMessage ?? "").not.toContain(n);
    }
  });

  it("removes the claim, never the vehicle's price", () => {
    // The decision has no opinion about the price at all — it returns show and
    // reasons, and the price is the surface's own field.
    const d = on({ marketValue: null });
    expect(Object.keys(d)).toEqual(["show", "suppressed", "customerMessage", "reasons"]);
    expect(Object.keys(d)).not.toContain("price");
  });
});

describe("claimAgeDays", () => {
  it("reads a stored ISO timestamp and refuses anything else", () => {
    expect(claimAgeDays(daysAgo(3), NOW)).toBeCloseTo(3, 5);
    for (const v of [null, undefined, "", "   ", "tomorrow", 1_757_000_000, {}, []]) {
      expect(claimAgeDays(v, NOW), JSON.stringify(v)).toBeNull();
    }
  });
});

describe("publicMarketClaimForListing", () => {
  const listing = (over: Record<string, unknown> = {}) => ({
    market_value: 39_158, market_position: "above_market",
    market_checked_at: daysAgo(1), price: 43_876,
    dealer_snapshot: { market_flags: { market_invalid_claim_suppression: true } },
    ...over,
  });

  it("reads the flag out of the listing's own dealer snapshot", () => {
    expect(publicMarketClaimForListing(listing(), NOW).show).toBe(true);
    expect(publicMarketClaimForListing(listing({ market_value: null }), NOW).show).toBe(false);
  });

  it("shows everything when the snapshot carries no flags — today's state", () => {
    // This is the documented prerequisite: until market_flags reaches the
    // public payload, suppression cannot be activated, and the correct
    // behaviour meanwhile is to change nothing.
    for (const snapshot of [undefined, null, {}, { name: "Harte Infiniti" }, "x", []]) {
      const d = publicMarketClaimForListing(
        listing({ dealer_snapshot: snapshot, market_value: null, market_checked_at: null }), NOW,
      );
      expect(d.show, JSON.stringify(snapshot)).toBe(true);
    }
  });

  it("reads a certification conflict off the stored record", () => {
    const d = publicMarketClaimForListing(
      listing({ certification: { certified: true, provider_conflict: true } }), NOW,
    );
    expect(d.show).toBe(false);
    expect(d.reasons).toContain("certification_conflict");
  });

  it("coerces a numeric string market value rather than calling it invalid", () => {
    expect(publicMarketClaimForListing(listing({ market_value: "39158" }), NOW).show).toBe(true);
  });
});
