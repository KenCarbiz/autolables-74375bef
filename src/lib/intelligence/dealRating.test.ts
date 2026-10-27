import { describe, it, expect } from "vitest";
import type { Freshness, MarketValueV3, ValuationConfidence } from "./contracts";
import { DEAL_RATING_LABELS } from "./contracts";
import {
  buildDealRating, DEAL_RATING_VERSION, DEFAULT_DEAL_RATING_THRESHOLDS, labelForDelta,
  resolveDealRatingThresholds,
} from "./dealRating";

const fresh: Freshness = {
  checkedAt: "2026-10-27T00:00:00Z", observedAt: null, ttlDays: 7, staleAt: "2026-11-03T00:00:00Z", state: "current",
};

const value = (estimatedValue: number | null, confidence: ValuationConfidence = "high", extra: Partial<MarketValueV3> = {}): MarketValueV3 => ({
  algorithmVersion: "market-value-v3-test",
  estimatedValue,
  rangeLow: estimatedValue != null ? estimatedValue - 800 : null,
  rangeHigh: estimatedValue != null ? estimatedValue + 800 : null,
  confidence,
  confidenceReasons: [],
  qualifiedCompCount: 12,
  effectiveSampleSize: 8,
  matchingTier: "A",
  identityLevel: "EXACT_VIN",
  geography: { zip: "00000", radiusMiles: 100, scope: "local" },
  signals: [],
  providerAgreement: "agree",
  disagreementPct: 1.2,
  investigationFlagged: false,
  checkedAt: "2026-10-27T00:00:00Z",
  freshness: fresh,
  publishable: false,
  ...extra,
});

describe("thresholds are configuration", () => {
  it("ships monotonic defaults and accepts an override", () => {
    expect(DEFAULT_DEAL_RATING_THRESHOLDS).toEqual({ greatValueMaxPct: -5, goodValueMaxPct: -1.5, fairPriceMaxPct: 2, aboveMarketMaxPct: 7 });
    const { thresholds, reasons } = resolveDealRatingThresholds({ greatValueMaxPct: -8 });
    expect(thresholds.greatValueMaxPct).toBe(-8);
    expect(reasons).toEqual([]);
  });

  it("falls back to the defaults, and says so, when an override is not monotonic", () => {
    const { thresholds, reasons } = resolveDealRatingThresholds({ greatValueMaxPct: 3 });
    expect(thresholds).toEqual(DEFAULT_DEAL_RATING_THRESHOLDS);
    expect(reasons).toEqual(["thresholds_not_monotonic_defaults_used"]);
  });

  it("maps a signed delta onto every label", () => {
    const t = DEFAULT_DEAL_RATING_THRESHOLDS;
    expect(labelForDelta(-6, t)).toBe("great_value");
    expect(labelForDelta(-5, t)).toBe("great_value");
    expect(labelForDelta(-2, t)).toBe("good_value");
    expect(labelForDelta(0, t)).toBe("fair_price");
    expect(labelForDelta(5, t)).toBe("above_market");
    expect(labelForDelta(7.01, t)).toBe("well_above_market");
  });
});

describe("buildDealRating", () => {
  it("rates a price below value as great value with the delta in dollars and percent", () => {
    const r = buildDealRating({ askingPrice: 40995, basisStatus: "verified", marketValue: value(41900) });
    expect(r.label).toBe("good_value");
    expect(r.deltaDollars).toBe(-905);
    expect(r.deltaPct).toBe(-2.16);
    expect(r.applicable).toBe(true);
    expect(r.version).toBe(DEAL_RATING_VERSION);
    expect(r.reasons).toContain("asking_below_market_value_by_2.16_percent");
    expect(DEAL_RATING_LABELS).toContain(r.label);
  });

  it("a price change moves the rating, and the function has no score input at all", () => {
    const base = { basisStatus: "verified" as const, marketValue: value(50000) };
    expect(buildDealRating({ ...base, askingPrice: 46000 }).label).toBe("great_value");
    expect(buildDealRating({ ...base, askingPrice: 50500 }).label).toBe("fair_price");
    expect(buildDealRating({ ...base, askingPrice: 54500 }).label).toBe("well_above_market");
    expect(Object.keys({ ...base, askingPrice: 1 })).not.toContain("vehicleScore");
  });

  it("is unavailable, with the reason, when the value is missing, untrusted, stale-basis or the price is bad", () => {
    expect(buildDealRating({ askingPrice: 40000, marketValue: value(null) }).reasons).toContain("market_value_unavailable");
    expect(buildDealRating({ askingPrice: 40000, marketValue: value(41000, "low") }).reasons).toContain("valuation_confidence_low_below_minimum_medium");
    expect(buildDealRating({ askingPrice: 40000, marketValue: value(41000, "unavailable") }).label).toBe("unavailable");
    expect(buildDealRating({ askingPrice: null, marketValue: value(41000) }).reasons).toContain("asking_price_missing");
    expect(buildDealRating({ askingPrice: 500, marketValue: value(41000) }).reasons).toContain("asking_price_implausible");
    expect(buildDealRating({ askingPrice: 40000, basisStatus: "invalid", marketValue: value(41000) }).reasons).toContain("price_basis_invalid");
    for (const r of [
      buildDealRating({ askingPrice: 40000, marketValue: value(null) }),
      buildDealRating({ askingPrice: null, marketValue: value(41000) }),
    ]) {
      expect(r.label).toBe("unavailable");
      expect(r.deltaDollars).toBeNull();
      expect(r.deltaPct).toBeNull();
    }
  });

  it("honours a lower minimum confidence and a tighter plausibility band when configured", () => {
    expect(buildDealRating({ askingPrice: 40000, marketValue: value(41000, "low") }, { minimumConfidence: "low" }).label).toBe("good_value");
    expect(buildDealRating({ askingPrice: 40000, marketValue: value(41000) }, { plausibleAskingPrice: { min: 45000, max: 60000 } }).reasons)
      .toContain("asking_price_implausible");
  });

  it("notes an ambiguous basis, a flagged disagreement and a stale value without hiding the rating", () => {
    const r = buildDealRating({
      askingPrice: 40000, basisStatus: "ambiguous",
      marketValue: value(41000, "medium", { investigationFlagged: true, freshness: { ...fresh, state: "stale" } }),
    });
    expect(r.label).toBe("good_value");
    expect(r.reasons).toEqual(expect.arrayContaining([
      "price_basis_ambiguous", "valuation_disagreement_flagged_for_investigation", "market_value_stale",
    ]));
  });

  it("does not rate a new vehicle unless asked to", () => {
    const off = buildDealRating({ askingPrice: 68995, marketValue: value(70965), vehicleType: "new" });
    expect(off.applicable).toBe(false);
    expect(off.label).toBe("unavailable");
    expect(off.reasons).toContain("new_vehicle_rating_not_enabled");
    const on = buildDealRating({ askingPrice: 68995, marketValue: value(70965), vehicleType: "new" }, { rateNewVehicles: true });
    expect(on.applicable).toBe(true);
    expect(on.label).toBe("good_value");
  });
});
