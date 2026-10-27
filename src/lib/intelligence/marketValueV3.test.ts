import { describe, it, expect } from "vitest";
import type { MarketPriceBasis, WeightedStats } from "../market/types";
import {
  buildMarketValueV3, DEFAULT_DISAGREEMENT_THRESHOLD, MARKET_VALUE_V3_VERSION, SIGNAL_KEYS,
  type ComparableEvidence, type MarketValueV3Input, type ProviderPredictionEvidence,
} from "./marketValueV3";

// Synthetic evidence throughout; no real vehicle, dealer or price.
const NOW = Date.parse("2026-10-28T00:00:00Z");

const stats = (over: Partial<WeightedStats> = {}): WeightedStats => ({
  rawCandidateCount: 12, eligiblePrimaryCount: 8, independentRooftopCount: 4, independentGroupCount: 4,
  effectiveSampleSize: 6, p10: 37000, p25: 38500, p50: 40000, p75: 41500, p90: 43000, mean: 40100,
  stdDev: 1500, mad: 1200, topRooftopShare: 0.2, topGroupShare: 0.2, effectiveRooftopCap: 0.2,
  effectiveGroupCap: 0.2, strictConcentrationSatisfied: true, insufficientMarketDiversity: false,
  marketFloor: 37000, ...over,
});

const basis: MarketPriceBasis = {
  displayedTotalPrice: 41000, vehicleComparisonPrice: 40105, advertisedPriceBeforeDoc: 40105, docFee: 895,
  mandatoryDealerAddOns: 0, mandatoryAddOnsIncludedInDisplayedPrice: true, mandatoryAddOnSource: "tenant_default",
  totalWithMandatoryAddOns: 41000, conditionalDiscountsExcluded: 0, governmentFeesIncluded: false,
  advertisedIncludesDocFee: true, basisStatus: "verified", basisReasons: [], provenance: {},
};

const comps = (over: Partial<ComparableEvidence> = {}): ComparableEvidence => ({
  stats: stats(), winningTier: "B50", relaxationSteps: [], feeNormalized: true, priceBasis: basis,
  groupIdentityKnown: true, tenantIdentityStability: "stable", concentrationUnderAllocated: false,
  materialContradictions: [], ...over,
});

const provider = (predicted = 40500, over: Partial<ProviderPredictionEvidence> = {}): ProviderPredictionEvidence => ({
  valuation: {
    provider: "marketcheck", endpointVersion: "v2", selectedField: "predicted_price", predictedValue: predicted,
    providerRangeLow: predicted - 1500, providerRangeHigh: predicted + 1500, providerRangeMeaning: null,
    providerCertifiedEcho: null, requestFingerprint: "fp", responseHash: "h",
    requestedAt: "2026-10-26T00:00:00Z", receivedAt: "2026-10-26T00:00:01Z", rawResponseSanitized: {},
  },
  validation: { usable: true, rejections: [], cautions: [] },
  ageDays: 2,
  ...over,
});

const base = (over: Partial<MarketValueV3Input> = {}): MarketValueV3Input => ({
  comparables: comps(), provider: provider(), identityLevel: "EXACT_VIN",
  geography: { zip: "00000", radiusMiles: 100 }, checkedAt: "2026-10-27T00:00:00Z", nowMs: NOW, ...over,
});

const signal = (r: ReturnType<typeof buildMarketValueV3>, key: string) => r.signals.find((s) => s.key === key)!;

describe("agreement between the comparable distribution and the prediction", () => {
  it("weights two agreeing signals and reaches high confidence on full evidence", () => {
    const r = buildMarketValueV3(base());
    expect(r.algorithmVersion).toBe(MARKET_VALUE_V3_VERSION);
    expect(r.providerAgreement).toBe("agree");
    expect(r.investigationFlagged).toBe(false);
    expect(r.estimatedValue).toBeGreaterThan(40000);
    expect(r.estimatedValue).toBeLessThan(40500);
    expect(r.confidence).toBe("high");
    expect(r.qualifiedCompCount).toBe(8);
    expect(r.effectiveSampleSize).toBe(6);
    expect(r.matchingTier).toBe("B50");
    expect(r.geography).toEqual({ zip: "00000", radiusMiles: 50, scope: "local" });
    expect(r.publishable).toBe(false);
    expect(signal(r, "comparable_distribution").used).toBe(true);
    expect(signal(r, "marketcheck_prediction").used).toBe(true);
    const weights = r.signals.filter((s) => s.used).map((s) => s.weight ?? 0);
    expect(Math.round(weights.reduce((a, b) => a + b, 0) * 1000) / 1000).toBe(1);
  });

  it("lists every signal key once, in a stable order", () => {
    const r = buildMarketValueV3(base());
    expect(r.signals.map((s) => s.key)).toEqual([...SIGNAL_KEYS]);
  });

  it("agreement raises nothing beyond what the evidence supports", () => {
    const thin = buildMarketValueV3(base({ comparables: comps({ stats: stats({ effectiveSampleSize: 4, eligiblePrimaryCount: 4 }) }) }));
    expect(thin.providerAgreement).toBe("agree");
    expect(thin.confidence).toBe("medium");
    expect(thin.confidenceReasons).toContain("effective_primary_comparables_below_5");
  });
});

describe("what lowers confidence", () => {
  it("a thin sample", () => {
    const r = buildMarketValueV3(base({ comparables: comps({ stats: stats({ effectiveSampleSize: 2, eligiblePrimaryCount: 2, independentRooftopCount: 1 }) }) }));
    expect(r.confidence).toBe("low");
    expect(r.confidenceReasons).toContain("effective_primary_comparables_below_3");
  });

  it("a relaxed comparable tier", () => {
    const r = buildMarketValueV3(base({ comparables: comps({ relaxationSteps: ["trim_year_band", "year_band"] }) }));
    expect(r.confidence).toBe("medium");
    expect(r.confidenceReasons).toContain("comparable_tier_relaxed:trim_year_band>year_band");
  });

  it("material provider disagreement, which is set aside rather than averaged, and flagged", () => {
    const r = buildMarketValueV3(base({ provider: provider(36000) }));
    expect(r.providerAgreement).toBe("disagree");
    expect(r.investigationFlagged).toBe(true);
    expect(r.disagreementPct).toBeGreaterThan(DEFAULT_DISAGREEMENT_THRESHOLD);
    expect(r.estimatedValue).toBe(40000);
    expect(signal(r, "marketcheck_prediction").used).toBe(false);
    expect(signal(r, "marketcheck_prediction").reason).toBe("excluded_material_disagreement");
    expect(r.confidence).toBe("low");
    expect(r.rangeLow).toBeLessThanOrEqual(36000);
    expect(r.rangeHigh).toBeGreaterThanOrEqual(44000);
  });

  it("a single signal is never better than medium", () => {
    const r = buildMarketValueV3(base({ provider: null }));
    expect(r.providerAgreement).toBe("single_signal");
    expect(r.confidence).toBe("medium");
    expect(r.confidenceReasons).toContain("single_signal");
    expect(r.estimatedValue).toBe(40000);
  });

  it("generic, YMM and unknown identity cap confidence and say so", () => {
    expect(buildMarketValueV3(base({ identityLevel: "GENERIC_CANDIDATE" })).confidence).toBe("medium");
    expect(buildMarketValueV3(base({ identityLevel: "GENERIC_CANDIDATE" })).confidenceReasons).toContain("identity_generic_candidate_caps_confidence");
    expect(buildMarketValueV3(base({ identityLevel: "YMM" })).confidence).toBe("medium");
    expect(buildMarketValueV3(base({ identityLevel: "UNKNOWN" })).confidence).toBe("low");
    expect(buildMarketValueV3(base({ identityLevel: "EXACT_BUILD" })).confidence).toBe("high");
  });
});

describe("no usable signal", () => {
  it("is unavailable with a null value, never a zero", () => {
    const r = buildMarketValueV3(base({ comparables: null, provider: null }));
    expect(r.estimatedValue).toBeNull();
    expect(r.rangeLow).toBeNull();
    expect(r.rangeHigh).toBeNull();
    expect(r.confidence).toBe("unavailable");
    expect(r.providerAgreement).toBe("none");
    expect(r.confidenceReasons).toContain("no_usable_signal");
    expect(r.signals.every((s) => !s.used)).toBe(true);
  });

  it("an expired or unusable prediction contributes nothing", () => {
    const expired = buildMarketValueV3(base({ comparables: null, provider: provider(40500, { ageDays: 30 }) }));
    expect(expired.estimatedValue).toBeNull();
    expect(signal(expired, "marketcheck_prediction").reason).toBe("provider_answer_expired");
    const rejected = buildMarketValueV3(base({ comparables: null, provider: provider(40500, { validation: { usable: false, rejections: ["implausible_mileage"], cautions: [] } }) }));
    expect(rejected.estimatedValue).toBeNull();
    expect(signal(rejected, "marketcheck_prediction").reason).toMatch(/provider_answer_not_usable:implausible_mileage/);
  });
});

describe("the value is price-blind", () => {
  it("the dealer's asking price changes nothing", () => {
    const without = buildMarketValueV3(base());
    const low = buildMarketValueV3(base({ subjectAskingPrice: 30000 }));
    const high = buildMarketValueV3(base({ subjectAskingPrice: 50000 }));
    expect(low).toEqual(without);
    expect(high).toEqual(without);
  });
});

describe("secondary signals", () => {
  it("ignores Black Book until the integration is operational, and uses it when it is", () => {
    const off = buildMarketValueV3(base({ blackBook: { retail: 39500, operational: false, checkedAt: null } }));
    expect(signal(off, "black_book").used).toBe(false);
    expect(signal(off, "black_book").reason).toBe("black_book_not_operational");
    const on = buildMarketValueV3(base({ blackBook: { retail: 39500, operational: true, checkedAt: "2026-10-27T00:00:00Z" } }));
    expect(signal(on, "black_book").used).toBe(true);
    expect(on.providerAgreement).toBe("agree");
  });

  it("uses inferred-sold context only with a real sample, as last advertised price before sale", () => {
    const thin = buildMarketValueV3(base({ soldContext: { medianLastAdvertisedBeforeSale: 39800, count: 3, scope: "state", windowDays: 90, checkedAt: null } }));
    expect(signal(thin, "sold_context").used).toBe(false);
    expect(signal(thin, "sold_context").reason).toBe("inferred_sold_sample_below_5");
    const enough = buildMarketValueV3(base({ soldContext: { medianLastAdvertisedBeforeSale: 39800, count: 12, scope: "state", windowDays: 90, checkedAt: null } }));
    expect(signal(enough, "sold_context").used).toBe(true);
    expect(signal(enough, "sold_context").weight).toBeLessThan(signal(enough, "comparable_distribution").weight ?? 0);
  });

  it("uses Premium comparables only when fee-normalized and sampled", () => {
    const mixed = buildMarketValueV3(base({ premium: { p25: 39000, p50: 40200, p75: 41800, count: 10, feeNormalized: false, checkedAt: null } }));
    expect(signal(mixed, "premium_comparables").reason).toBe("premium_fee_basis_not_normalized");
    const ok = buildMarketValueV3(base({ premium: { p25: 39000, p50: 40200, p75: 41800, count: 10, feeNormalized: true, checkedAt: null } }));
    expect(signal(ok, "premium_comparables").used).toBe(true);
  });

  it("applies an exact-configuration adjustment only for an exact identity", () => {
    const exact = buildMarketValueV3(base({ provider: null, exactConfiguration: { supported: true, adjustmentDollars: 500, reason: "cohort_measured" } }));
    expect(exact.estimatedValue).toBe(40500);
    const ymm = buildMarketValueV3(base({ provider: null, identityLevel: "YMM", exactConfiguration: { supported: true, adjustmentDollars: 500, reason: "cohort_measured" } }));
    expect(ymm.estimatedValue).toBe(40000);
    const unsupported = buildMarketValueV3(base({ provider: null, exactConfiguration: { supported: false, adjustmentDollars: 500, reason: "no_cohort_evidence" } }));
    expect(unsupported.estimatedValue).toBe(40000);
    expect(unsupported.confidenceReasons).toContain("exact_configuration_adjustment_not_supported:no_cohort_evidence");
  });
});

describe("fee basis", () => {
  it("does not let a mixed-basis distribution into the number without the normalization flag", () => {
    const r = buildMarketValueV3(base({ comparables: comps({ feeNormalized: false }) }));
    expect(signal(r, "comparable_distribution").used).toBe(false);
    expect(signal(r, "comparable_distribution").reason).toBe("comparables_fee_basis_not_normalized");
    expect(r.estimatedValue).toBe(40500);
    expect(r.providerAgreement).toBe("single_signal");
    expect(r.confidence).toBe("medium");
    expect(r.confidenceReasons).toContain("comparables_fee_basis_not_normalized");
    expect(r.rangeLow).toBe(39000);
    expect(r.rangeHigh).toBe(42000);
  });
});

describe("range, geography and freshness", () => {
  it("the range is never narrower than the comparable P25 to P75", () => {
    const r = buildMarketValueV3(base());
    expect(r.rangeLow).toBe(38500);
    expect(r.rangeHigh).toBe(41500);
  });

  it("names the geography by tier, and national for a context tier", () => {
    expect(buildMarketValueV3(base({ comparables: comps({ winningTier: "B200" }) })).geography.scope).toBe("regional");
    expect(buildMarketValueV3(base({ comparables: comps({ winningTier: "D" }) })).geography.scope).toBe("national");
    expect(buildMarketValueV3(base({ comparables: null, geography: { zip: null, radiusMiles: 200 } })).geography.scope).toBe("regional");
    expect(buildMarketValueV3(base({ comparables: null, geography: { zip: null, radiusMiles: null } })).geography.scope).toBe("unknown");
  });

  it("goes stale on the policy TTL and borrows the newest evidence stamp when none is given", () => {
    const stale = buildMarketValueV3(base({ checkedAt: "2026-10-10T00:00:00Z" }));
    expect(stale.freshness.state).toBe("stale");
    const borrowed = buildMarketValueV3(base({ checkedAt: null }));
    expect(borrowed.checkedAt).toBe("2026-10-26T00:00:01.000Z");
    expect(borrowed.freshness.state).toBe("current");
  });
});
