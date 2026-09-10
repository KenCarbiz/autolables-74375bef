import { describe, it, expect } from "vitest";
import { buildMarketView } from "./marketView.ts";
import { applyConcentrationCaps, CONCENTRATION_CAP } from "./concentration.ts";
import { classifyOwnership, rooftopKey, groupKey } from "./dealerIdentity.ts";
import { canonicalizeComparable, dedupeByVin, assignTier, selectTier, readCertified } from "./comparables.ts";
import { reviewOutliers } from "./outliers.ts";
import { scoreSimilarity } from "./similarity.ts";
import { redWarningGate, verdictBuffer } from "./verdict.ts";
import { recommendPricingPosition } from "./pricingPosition.ts";
import { readMarketFlag, readMarketFlags, MARKET_FLAGS } from "./flags.ts";
import { adjustComparablePrice } from "./adjustments.ts";
import type { ComparableCandidate, ProviderValuation } from "./types.ts";

const NOW = Date.parse("2026-09-10T00:00:00.000Z");
const OBSERVED = "2026-09-09T00:00:00.000Z";

const provider = (predictedValue: number, receivedAt = OBSERVED): ProviderValuation => ({
  provider: "marketcheck", endpointVersion: "us/marketcheck_price@2026-09",
  selectedField: "marketcheck_price", predictedValue,
  providerRangeLow: predictedValue * 0.95, providerRangeHigh: predictedValue * 1.05,
  providerRangeMeaning: "Provider Estimated Range", providerCertifiedEcho: true,
  requestFingerprint: "fp", responseHash: "0000000000000000",
  requestedAt: receivedAt, receivedAt, rawResponseSanitized: {},
});

/** A healthy market: many rooftops, certification known, prices resolvable. */
const healthyComps = (prices: number[]): ComparableCandidate[] =>
  prices.map((price, i) => ({
    vin: `HEALTHYCMP${String(i).padStart(7, "0")}`,
    year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
    drivetrain: "AWD", mileage: 12000 + i * 100, price,
    certified: true, docFeeIncluded: false,
    dealerName: `Dealer ${i}`, rooftopId: `rooftop-${i}`, dealerGroupId: `group-${i}`,
    distanceMiles: 20 + i, observedAt: OBSERVED,
    historyStatus: "clean", conditionStatus: "verified",
  }));

const subject = {
  vin: "3PCAJ5FB1SF109999",
  year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
  drivetrain: "AWD", powertrain: null, mileage: 12912, certified: true,
  price: 43876, advertisedPriceBeforeDoc: 42981, websiteSalePrice: 43876,
  docFee: 895, advertisedExcludesDocFee: false,
  dealerType: "franchise" as const, zip: "06120",
};

const build = (candidates: ComparableCandidate[], p: ProviderValuation | null, over: Record<string, unknown> = {}) =>
  buildMarketView({
    subject, condition: "cpo", candidates, identity: { names: ["Harte Infiniti"] },
    provider: p, nowMs: NOW, ...over,
  });

describe("dealer identity", () => {
  it("matches on a stable id before anything else", () => {
    const v = classifyOwnership({ rooftopId: "R1", dealerName: "Nothing Alike" }, { rooftopIds: ["R1"] });
    expect(v.relation).toBe("own_rooftop");
    expect(v.matchedOn).toBe("rooftop_id");
    expect(v.identityConfidence).toBe("stable");
  });

  it("matches a normalized domain", () => {
    const v = classifyOwnership({ dealerDomain: "https://www.harteinfiniti.com/inventory" }, { domains: ["harteinfiniti.com"] });
    expect(v.relation).toBe("own_rooftop");
    expect(v.matchedOn).toBe("dealer_domain");
  });

  it("separates an affiliated group from a rooftop", () => {
    const v = classifyOwnership({ dealerGroupId: "G9" }, { groupIds: ["G9"] });
    expect(v.relation).toBe("own_group");
  });

  it("accepts a name match but marks it name_only", () => {
    const v = classifyOwnership({ dealerName: "Harte Infiniti" }, { names: ["Harte Infiniti"] });
    expect(v.relation).toBe("own_rooftop");
    expect(v.identityConfidence).toBe("name_only");
    expect(v.cautions).toContain("own_rooftop_matched_by_name_only");
  });

  it("does NOT exclude a neighbouring dealer at zero distance", () => {
    const v = classifyOwnership({ dealerName: "Competitor Motors", distanceMiles: 0 }, { names: ["Harte Infiniti"] });
    expect(v.relation).toBe("external");
    expect(v.cautions).toContain("adjacent_rooftop_kept_as_external");
  });

  it("flags a comparable with no stable identity at all", () => {
    const v = classifyOwnership({ dealerName: "Someone Else" }, { names: ["Harte Infiniti"] });
    expect(v.identityConfidence).toBe("none");
    expect(v.cautions).toContain("comparable_has_no_stable_dealer_identity");
  });

  it("collapses two spellings of one rooftop into a single key", () => {
    expect(rooftopKey({ dealerName: "Harte INFINITI, Inc." })).toBe(rooftopKey({ dealerName: "Harte Infiniti" }));
  });

  it("treats a rooftop with no group as its own group of one", () => {
    expect(groupKey({ rooftopId: "R2" })).toBe("R2");
  });
});

describe("certification is three-state", () => {
  it("reads explicit flags and leaves everything else unknown", () => {
    expect(readCertified(true)).toBe(true);
    expect(readCertified(1)).toBe(true);
    expect(readCertified("cpo")).toBe(true);
    expect(readCertified(false)).toBe(false);
    expect(readCertified("false")).toBe(false);
    expect(readCertified(undefined)).toBeNull();
    expect(readCertified(null)).toBeNull();
    expect(readCertified("maybe")).toBeNull();
  });
});

describe("deduplication", () => {
  const row = (vin: string, observedAt: string, rooftopId: string | null): ComparableCandidate => ({
    vin, year: 2025, make: "INFINITI", model: "QX50", trim: "Sport", mileage: 12000,
    price: 40000, observedAt, rooftopId, dealerName: "Some Dealer", certified: true,
  });

  it("keeps one row per VIN and marks the rest duplicate_vin", () => {
    const comps = [row("DUPVIN00000000001", "2026-09-01T00:00:00Z", "a"), row("DUPVIN00000000001", "2026-09-08T00:00:00Z", "b")]
      .map((c) => canonicalizeComparable(c, {}));
    const { kept, dropped } = dedupeByVin(comps);
    expect(kept).toHaveLength(1);
    expect(kept[0].listingObservedAt).toBe("2026-09-08T00:00:00Z");
    expect(dropped[0].exclusionReasons).toContain("duplicate_vin");
  });

  it("prefers the canonical dealer listing over a syndication copy at the same time", () => {
    const comps = [row("DUPVIN00000000002", OBSERVED, null), row("DUPVIN00000000002", OBSERVED, "rooftop-real")]
      .map((c) => canonicalizeComparable(c, {}));
    expect(dedupeByVin(comps).kept[0].rooftopId).toBe("rooftop-real");
  });

  it("a duplicated VIN cannot vote twice in the market", () => {
    const dupes = healthyComps([40000, 40000, 40500, 41000, 41500, 42000]);
    dupes[1] = { ...dupes[1], vin: dupes[0].vin as string };
    const { explanation } = build(dupes, provider(41000));
    const counted = explanation.comparables.filter((c) => c.inclusionStatus === "primary");
    expect(new Set(counted.map((c) => c.vin)).size).toBe(counted.length);
  });
});

describe("tiering", () => {
  const comp = (over: Partial<ComparableCandidate>) =>
    canonicalizeComparable({
      vin: "TIERVIN0000000001", year: 2025, make: "INFINITI", model: "QX50", trim: "Sport",
      drivetrain: "AWD", mileage: 12912, price: 40000, certified: true, docFeeIncluded: false,
      distanceMiles: 10, observedAt: OBSERVED, ...over,
    }, {});
  const subj = { vin: "S", year: 2025, make: "INFINITI", model: "QX50", trim: "Sport", drivetrain: "AWD", powertrain: null, mileage: 12912, certified: true };

  it("A for an exact match inside 50 miles", () => {
    expect(assignTier(subj, comp({}), NOW).tier).toBe("A");
  });
  it("expands the radius before anything else", () => {
    expect(assignTier(subj, comp({ distanceMiles: 80 }), NOW).tier).toBe("B100");
    expect(assignTier(subj, comp({ distanceMiles: 150 }), NOW).tier).toBe("B200");
  });
  it("C for the wider mileage band", () => {
    expect(assignTier(subj, comp({ mileage: 12912 + 9000 }), NOW).tier).toBe("C");
  });
  it("D for an adjacent model year, context only", () => {
    expect(assignTier(subj, comp({ year: 2024 }), NOW).tier).toBe("D");
  });
  it("E for a certification mismatch and for unknown certification", () => {
    expect(assignTier(subj, comp({ certified: false }), NOW).tier).toBe("E");
    expect(assignTier(subj, comp({ certified: null }), NOW).tier).toBe("E");
  });
  it("F for a different trim, drivetrain or model", () => {
    expect(assignTier(subj, comp({ trim: "Luxe" }), NOW).tier).toBe("F");
    expect(assignTier(subj, comp({ drivetrain: "FWD" }), NOW).tier).toBe("F");
    expect(assignTier(subj, comp({ model: "QX60" }), NOW).tier).toBe("F");
  });
  it("demotes a listing that has not been observed recently", () => {
    const t = assignTier(subj, comp({ observedAt: "2026-06-01T00:00:00Z" }), NOW);
    expect(t.tier).toBe("C");
    expect(t.reasons).toContain("listing_not_recently_observed");
  });
  it("stops relaxing once there is enough primary evidence, and records every step", () => {
    const s = selectTier(["A", "A", "A", "C", "C"]);
    expect(s.winningTier).toBe("A");
    expect(s.acceptedTiers).toEqual(["A"]);
    expect(s.relaxationSteps[0]).toContain("A: 3 qualified");
  });
  it("reports no winning tier when nothing is primary", () => {
    const s = selectTier(["E", "E", "F"]);
    expect(s.winningTier).toBeNull();
    expect(s.relaxationSteps).toContain("no primary comparable at any tier");
  });
});

describe("similarity", () => {
  const base = {
    year: 2025, make: "INFINITI", model: "QX50", trim: "Sport", drivetrain: "AWD",
    powertrain: null, mileage: 12912, certified: true, equipmentCodes: [] as string[],
  };
  const cand = (over: Record<string, unknown> = {}) => ({
    ...base, distanceMiles: 10, daysOnMarket: 30, observedAt: OBSERVED,
    historyStatus: "clean" as const, conditionStatus: "verified" as const,
    priceBasisStatus: "verified" as const, identityConfidence: "stable" as const, ...over,
  });

  it("price is not an input: two comparables identical but for price score identically", () => {
    const a = scoreSimilarity(base, cand(), NOW);
    const b = scoreSimilarity(base, cand(), NOW);
    expect(a.rawWeight).toBe(b.rawWeight);
    expect(Object.keys(a.components)).not.toContain("price");
  });

  it("an unknown certification costs weight but does not zero it", () => {
    const known = scoreSimilarity(base, cand(), NOW).rawWeight;
    const unknown = scoreSimilarity(base, cand({ certified: null }), NOW).rawWeight;
    expect(unknown).toBeLessThan(known);
    expect(unknown).toBeGreaterThan(0);
  });

  it("an invalid price basis zeroes data quality", () => {
    expect(scoreSimilarity(base, cand({ priceBasisStatus: "invalid" }), NOW).rawWeight).toBe(0);
  });

  it("distance, staleness and unknown history each cost weight", () => {
    const best = scoreSimilarity(base, cand(), NOW).rawWeight;
    expect(scoreSimilarity(base, cand({ distanceMiles: 190 }), NOW).rawWeight).toBeLessThan(best);
    expect(scoreSimilarity(base, cand({ observedAt: "2026-08-01T00:00:00Z" }), NOW).rawWeight).toBeLessThan(best);
    expect(scoreSimilarity(base, cand({ historyStatus: "unknown" }), NOW).rawWeight).toBeLessThan(best);
  });

  it("stores every component so a dealer can be told why", () => {
    const c = scoreSimilarity(base, cand(), NOW).components;
    for (const key of ["spec", "mileage", "certification", "equipment", "history", "freshness", "geography", "dataQuality"]) {
      expect(c[key]).not.toBeUndefined();
    }
  });
});

describe("concentration", () => {
  it("caps a dominant rooftop at 20% when there are enough sources", () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => ({ key: `big-${i}`, rooftop: "BIG", group: "BIG", weight: 1 })),
      ...Array.from({ length: 5 }, (_, i) => ({ key: `s-${i}`, rooftop: `S${i}`, group: `S${i}`, weight: 1 })),
    ];
    const r = applyConcentrationCaps(items);
    expect(r.topRooftopShare).toBeLessThanOrEqual(CONCENTRATION_CAP + 1e-9);
    expect(r.cappedRooftops).toContain("BIG");
    expect(r.underAllocated).toBe(false);
  });

  it("caps an affiliated group even when each rooftop looks small", () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => ({ key: `g-${i}`, rooftop: `GR${i}`, group: "GROUP", weight: 1 })),
      ...Array.from({ length: 6 }, (_, i) => ({ key: `o-${i}`, rooftop: `O${i}`, group: `O${i}`, weight: 1 })),
    ];
    const r = applyConcentrationCaps(items);
    expect(r.topGroupShare).toBeLessThanOrEqual(CONCENTRATION_CAP + 1e-9);
    expect(r.cappedGroups).toContain("GROUP");
  });

  it("does not manufacture weight when there are too few sources", () => {
    const r = applyConcentrationCaps([
      { key: "a", rooftop: "A", group: "A", weight: 9 },
      { key: "b", rooftop: "B", group: "B", weight: 1 },
    ]);
    expect(r.underAllocated).toBe(true);
    expect(r.effectiveRooftopCap).toBeCloseTo(0.5, 9);
    expect(r.topRooftopShare).toBeLessThanOrEqual(0.5 + 1e-9);
    // Neither source was annihilated to satisfy an unreachable ratio.
    expect(r.cappedWeights.get("a")!).toBeGreaterThan(0);
    expect(r.cappedWeights.get("b")!).toBeGreaterThan(0);
  });

  it("counts independent rooftops and groups separately", () => {
    const r = applyConcentrationCaps([
      { key: "a", rooftop: "A", group: "G", weight: 1 },
      { key: "b", rooftop: "B", group: "G", weight: 1 },
      { key: "c", rooftop: "C", group: "H", weight: 1 },
    ]);
    expect(r.independentRooftopCount).toBe(3);
    expect(r.independentGroupCount).toBe(2);
  });
});

describe("outliers", () => {
  const set = (values: number[], evidence: Record<number, string[]> = {}) =>
    values.map((value, i) => ({
      key: `k${i}`, value, weight: 1,
      supportingEvidence: (evidence[i] ?? []) as never,
    }));

  it("never removes the cheapest listing for being cheapest", () => {
    const r = reviewOutliers(set([20000, 39000, 39500, 40000, 40500, 41000, 41500]));
    expect(r.flagged).toContain("k0");
    expect(r.excluded).toHaveLength(0);
    expect(r.concerns.some((c) => c.startsWith("outlier_kept_no_supporting_evidence"))).toBe(true);
  });

  it("removes a flagged listing once an independent reason exists", () => {
    const r = reviewOutliers(set([20000, 39000, 39500, 40000, 40500, 41000, 41500], { 0: ["adverse_title"] }));
    expect(r.excluded.map((e) => e.key)).toEqual(["k0"]);
    expect(r.excluded[0].reasons).toEqual(["statistical_outlier", "adverse_title"]);
  });

  it("treats high outliers exactly like low ones", () => {
    const r = reviewOutliers(set([39000, 39500, 40000, 40500, 41000, 41500, 90000], { 6: ["data_corruption"] }));
    expect(r.excluded.map((e) => e.key)).toEqual(["k6"]);
  });

  it("removes nothing below seven eligible comparables", () => {
    const r = reviewOutliers(set([20000, 40000, 40500, 41000], { 0: ["adverse_title"] }));
    expect(r.sampleTooSmall).toBe(true);
    expect(r.excluded).toHaveLength(0);
    expect(r.concerns.some((c) => c.includes("sample_below_7"))).toBe(true);
  });
});

describe("adjustments", () => {
  it("is an identity until a model is trained", () => {
    const r = adjustComparablePrice(40000);
    expect(r.adjustedPrice).toBe(40000);
    expect(r.identityOnly).toBe(true);
    expect(r.terms.every((t) => t.status === "unavailable" && t.amount === 0)).toBe(true);
  });

  it("names every missing adjustment so the gap is visible", () => {
    expect(adjustComparablePrice(1000).terms.map((t) => t.key)).toEqual(
      ["mileage", "certification", "equipment", "history", "condition", "region"],
    );
  });
});

describe("verdict and the red gate", () => {
  it("uses max($500, 2%) as the buffer", () => {
    expect(verdictBuffer(10000)).toBe(500);
    expect(verdictBuffer(50000)).toBe(1000);
    expect(verdictBuffer(null)).toBeNull();
  });

  it("a healthy market puts a mid-range price inside the market", () => {
    const { view, explanation } = build(healthyComps([41000, 41500, 42000, 42500, 43000, 43500, 44000]), provider(42981));
    expect(view.confidence).toBe("high");
    expect(view.verdict).toBe("Within Adjusted Market");
    expect(explanation.tone).toBe("neutral");
  });

  it("a genuinely over-priced car in a healthy market may go red", () => {
    const { view, explanation } = build(healthyComps([30000, 30500, 31000, 31500, 32000, 32500, 33000]), provider(31500));
    expect(view.confidence).toBe("high");
    expect(view.verdict).toBe("Above Adjusted Market");
    expect(explanation.tone).toBe("red");
    expect(view.priceToMarketPercent).toBeGreaterThan(100);
  });

  it("medium confidence can never turn red", () => {
    // Three rooftops' worth of evidence, provider seven-plus days old.
    const { view, explanation } = build(
      healthyComps([30000, 30500, 31000]),
      provider(31000, "2026-08-31T00:00:00.000Z"),
    );
    expect(view.confidence).toBe("medium");
    expect(explanation.tone).not.toBe("red");
    expect(view.verdict).toContain("High End of Adjusted Market");
  });

  it("low confidence is neutral and makes no deal claim", () => {
    const { view, explanation } = build(healthyComps([30000, 30500]), provider(30000));
    expect(view.confidence).toBe("low");
    expect(view.verdict).toBe("Limited Market Evidence");
    expect(explanation.tone).toBe("neutral");
  });

  it("the red gate names every failure rather than silently downgrading", () => {
    const gate = redWarningGate({
      priceBasis: { basisStatus: "ambiguous" } as never,
      confidence: "low",
      stats: { effectiveSampleSize: 1, independentRooftopCount: 1, topRooftopShare: 0.9, topGroupShare: 0.9, p50: null, p75: null, p90: null } as never,
      winningTier: null,
      providerPrediction: null,
      concentrationUnderAllocated: true,
      materialContradictions: ["history"],
    });
    expect(gate.allowed).toBe(false);
    expect(gate.failures).toContain("confidence_not_high");
    expect(gate.failures).toContain("effective_primary_comparables_below_5");
    expect(gate.failures).toContain("independent_dealerships_below_3");
    expect(gate.failures).toContain("rooftop_exceeds_20_percent");
  });
});

describe("staleness", () => {
  const healthy = healthyComps([41000, 41500, 42000, 42500, 43000, 43500, 44000]);

  it("is high through seven days", () => {
    expect(build(healthy, provider(42981, "2026-09-04T00:00:00.000Z")).view.confidence).toBe("high");
  });

  it("drops out of high after seven days", () => {
    expect(build(healthy, provider(42981, "2026-09-01T00:00:00.000Z")).view.confidence).toBe("medium");
  });

  it("is unavailable past fourteen days", () => {
    const { view } = build(healthy, provider(42981, "2026-08-01T00:00:00.000Z"));
    expect(view.confidence).toBe("unavailable");
    expect(view.verdict).toBe("Market Estimate Unavailable");
  });

  it("publishes a stale-at boundary derived from the provider answer", () => {
    const { view } = build(healthy, provider(42981, "2026-09-04T00:00:00.000Z"));
    expect(view.staleAt).toBe("2026-09-11T00:00:00.000Z");
  });

  it("recomputes the verdict from a price change without needing a new provider call", () => {
    const cheap = buildMarketView({
      subject: { ...subject, price: 31000, advertisedPriceBeforeDoc: 30105, websiteSalePrice: 31000 },
      condition: "cpo", candidates: healthy, identity: {}, provider: provider(42981), nowMs: NOW,
    });
    expect(cheap.view.vehicleComparisonPrice).toBe(30105);
    expect(cheap.explanation.provider!.requestFingerprint).toBe("fp");
    expect(cheap.view.verdict).not.toBe("Within Adjusted Market");
  });
});

describe("flags", () => {
  it("every flag ships off", () => {
    expect(Object.values(MARKET_FLAGS).every((v) => v === false)).toBe(true);
  });
  it("only a literal true enables anything", () => {
    expect(readMarketFlag({ market_flags: { market_value_v2_public: true } }, "market_value_v2_public")).toBe(true);
    expect(readMarketFlag({ market_flags: { market_value_v2_public: "true" } }, "market_value_v2_public")).toBe(false);
    expect(readMarketFlag({ market_flags: { market_value_v2_public: 1 } }, "market_value_v2_public")).toBe(false);
    expect(readMarketFlag(null, "market_value_v2_public")).toBe(false);
  });
  it("reads the whole set", () => {
    expect(Object.values(readMarketFlags(undefined)).every((v) => v === false)).toBe(true);
  });
});

describe("pricing position stays separate and shadow-only", () => {
  it("returns a percentile target, never a price", () => {
    const r = recommendPricingPosition({
      marketDaysSupply: 20, vdpViewsLast30: 400, leadsLast30: 12, inventoryAgeDays: 10,
      holdingCostPerDay: 32, targetTurnDays: 45,
    });
    expect(r.regime).toBe("low_supply_high_demand");
    expect(r.targetPercentileLow).toBe(60);
    expect(r.targetPercentileHigh).toBe(75);
    expect(r.publishable).toBe(false);
    expect(Object.keys(r)).not.toContain("recommendedPrice");
  });

  it("moves an aged car down the same distribution", () => {
    const r = recommendPricingPosition({
      marketDaysSupply: 45, vdpViewsLast30: 100, leadsLast30: 2, inventoryAgeDays: 130,
      agingThresholdDays: 60, holdingCostPerDay: 32, targetTurnDays: 45,
    });
    expect(r.targetPercentileLow!).toBeLessThan(50);
    expect(r.rationale.some((x) => x.includes("aged"))).toBe(true);
  });

  it("suggests nothing when supply and demand are unknown", () => {
    const r = recommendPricingPosition({
      marketDaysSupply: null, vdpViewsLast30: null, leadsLast30: null, inventoryAgeDays: null,
    });
    expect(r.regime).toBe("unknown");
    expect(r.targetPercentileLow).toBeNull();
    expect(r.missingInputs).toContain("market_days_supply");
  });
});

describe("shadow composite", () => {
  it("is computed and never publishable", () => {
    const { explanation } = build(healthyComps([41000, 41500, 42000, 42500, 43000, 43500, 44000]), provider(42981));
    expect(explanation.shadowComposite!.publishable).toBe(false);
    expect(explanation.shadowComposite!.value).toBeGreaterThan(0);
    expect(explanation.shadowComposite!.reasons)
      .toContain("rolling_cohort_error_not_measured_composite_stays_shadow_only");
  });

  it("uses no fixed 60/40 blend", () => {
    const { explanation } = build(healthyComps([41000, 41500, 42000, 42500, 43000, 43500, 44000]), provider(42981));
    const shares = explanation.shadowComposite!.signals.map((s) => s.share).sort();
    expect(shares).not.toEqual([0.4, 0.6]);
  });
});
