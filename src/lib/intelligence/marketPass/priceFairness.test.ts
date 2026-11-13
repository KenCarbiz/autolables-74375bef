import { describe, it, expect } from "vitest";
import { buildMarketPassAssessment } from "./assessment";
import { NOW, comparableRows, iso, legacyUsedRow, newRow, providerValuation, settings, usedRow } from "./__fixtures__/rows";
import type { MarketPassRow } from "./rowEvidence";

// Synthetic rows. Five comparables at 30,000 / 30,500 / 31,000 / 31,500 / 32,000,
// equal mileage and distance, so equal weights: the weighted median is 31,000.
const pf = (row: MarketPassRow, s: unknown = settings()) => buildMarketPassAssessment({ row, settings: s, nowMs: NOW }).priceFairness;
const priced = (p: number) => usedRow({ price: p, advertised_price_before_doc: p });

describe("used Price Fairness, assessed path", () => {
  it("rates a price against the comparable estimate and states the denominator", () => {
    const r = pf(usedRow());
    // 29,900 - 31,000 = -1,100; -1,100 / 31,000 x 100 = -3.548 -> -3.55; -5 < -3.55 <= -1.5 -> good_value -> segment 3.
    expect(r.state).toBe("assessed");
    expect(r.comparisonPrice).toBe(29900);
    expect(r.benchmarkValue).toBe(31000);
    expect(r.benchmarkIsEstimate).toBe(true);
    expect(r.deltaDollars).toBe(-1100);
    expect(r.deltaPct).toBe(-3.55);
    expect(r.deltaDenominator).toBe("market_value_estimate");
    expect(r.segmentIndex).toBe(3);
    expect(r.label).toBe("Good price");
    expect(r.explanation).toMatch(/estimate/);
    expect(r.explanation).toMatch(/not a transaction price/);
  });

  it.each([
    // [price, expected deltaPct, segment]
    [29450, -5, 4],      // 31,000 x 0.95 = 29,450 -> exactly -5.00 -> great (<= -5)
    [29451, -5, 4],      // -1,549 / 31,000 = -4.9968% -> rounds to -5.00 -> great
    [29452, -4.99, 3],   // -1,548 / 31,000 = -4.9935% -> -4.99 -> good
    [30535, -1.5, 3],    // 31,000 x 0.985 = 30,535 -> exactly -1.50 -> good (<= -1.5)
    [30536, -1.5, 3],    // -464 / 31,000 = -1.4968% -> rounds to -1.50 -> good
    [30537, -1.49, 2],   // -463 / 31,000 = -1.4935% -> -1.49 -> fair
    [31620, 2, 2],       // 620 / 31,000 = 2.00% -> fair (<= 2)
    [31622, 2.01, 1],    // 622 / 31,000 = 2.0065% -> 2.01 -> above
    [33171, 7, 1],       // 2,171 / 31,000 = 7.0032% -> 7.00 -> above (<= 7)
    [33172, 7.01, 0],    // 2,172 / 31,000 = 7.0065% -> 7.01 -> well above
  ])("price %i -> %d%% -> segment %i (two-decimal rounding before banding)", (price, pctExpected, segment) => {
    const r = pf(priced(price));
    expect(r.deltaPct).toBe(pctExpected);
    expect(r.segmentIndex).toBe(segment);
  });
});

describe("comparable selection is independent of the asking price", () => {
  it("analyzes qualifying listings both above and below the asking price", () => {
    const r = pf(priced(31000));
    // 30,000 and 30,500 sit below 31,000; 31,500 and 32,000 above; all five are analyzed.
    expect(r.comparables?.analyzedCount).toBe(5);
    expect(comparableRows().filter((c) => c.price < 31000)).toHaveLength(2);
    expect(comparableRows().filter((c) => c.price > 31000)).toHaveLength(2);
    expect(r.deltaPct).toBe(0);
    expect(r.label).toBe("Fair price");
  });

  it("the benchmark does not move when only the asking price moves", () => {
    expect(pf(priced(25000)).benchmarkValue).toBe(31000);
    expect(pf(priced(36000)).benchmarkValue).toBe(31000);
  });

  it("separates total search matches from the listings actually analyzed", () => {
    const r = pf(usedRow());
    expect(r.comparables?.totalSearchMatches).toBe(212);
    expect(r.comparables?.analyzedCount).toBe(5);
    expect(r.comparables?.description).toMatch(/^5 of 5 stored listings analyzed/);
    expect(r.comparables?.description).toMatch(/212 total matches/);
  });

  it("refuses comparables whose selection was not recorded as price-independent", () => {
    const legacy = pf(legacyUsedRow());
    expect(legacy.state).toBe("unavailable");
    expect(legacy.segmentIndex).toBeNull();
    expect(legacy.reasons).toContain("comparable_selection_not_recorded");
    expect(legacy.comparables?.selection).toBe("not_recorded");
    const banded = pf(usedRow({ market_meta: { ...(usedRow().market_meta as object), comp_selection: { price_independent: false, total_matches: 40 } } }));
    expect(banded.reasons).toContain("comparable_selection_conditioned_on_subject_price");
    expect(banded.state).toBe("unavailable");
  });
});

describe("missing, stale, conflicting and invalid evidence never reads as a rating", () => {
  it("a single provider estimate is qualified, with no segment and no public delta", () => {
    const r = pf(usedRow({ comparables: [], market_payload: { provider_valuation: providerValuation(31000) } }));
    expect(r.state).toBe("qualified");
    expect(r.segmentIndex).toBeNull();
    expect(r.deltaDollars).toBeNull();
    expect(r.label).toBe("Limited market evidence");
    expect(r.reasons).toContain("benchmark_is_a_single_provider_estimate");
  });

  it("stale comparable evidence is unavailable", () => {
    const meta = { ...(usedRow().market_meta as Record<string, unknown>), comp_selection: { price_independent: true, total_matches: 212, radius_miles: 50, checked_at: iso(10) } };
    const r = pf(usedRow({ market_meta: meta }));
    // Retrieved 10 days ago against a 7-day TTL.
    expect(r.state).toBe("unavailable");
    expect(r.reasons).toContain("market_evidence_stale");
  });

  it("comparables with an unknown fee basis stay out, and nothing else is there to rate with", () => {
    const comps = comparableRows().map(({ doc_fee_included: _drop, ...rest }) => rest);
    const r = pf(usedRow({ comparables: comps }));
    expect(r.state).toBe("unavailable");
    expect(r.reasons).toContain("comparables_fee_basis_not_normalized");
  });

  it("an unanswered add-on question makes the price basis ambiguous, which is qualified", () => {
    const s = { ...settings(), mandatory_add_ons_verified: false };
    const r = pf(usedRow(), s);
    expect(r.state).toBe("qualified");
    expect(r.reasons).toContain("price_basis_not_verified");
  });

  it("a missing price is unavailable, never a default", () => {
    const r = pf(usedRow({ price: null, advertised_price_before_doc: null }));
    expect(r.state).toBe("unavailable");
    expect(r.segmentIndex).toBeNull();
  });

  it("sources that disagree by more than 7% are unavailable, never averaged into a rating", () => {
    // Prediction 35,000 against comparables 31,000: (35,000 - 31,000) / 31,000 = 12.9% > 7%,
    // so Market Value V3 caps confidence at low and the Deal Rating needs medium.
    const r = pf(usedRow({ market_payload: { provider_valuation: providerValuation(35000) } }));
    expect(r.state).toBe("unavailable");
    expect(r.reasons).toContain("sources_materially_disagree");
    expect(r.segmentIndex).toBeNull();
  });

  it("a used prediction above the original factory MSRP is rejected as implausible", () => {
    // Configured MSRP 47,000; prediction 52,000 for the used vehicle.
    const r = pf(usedRow({ comparables: [], market_payload: { provider_valuation: providerValuation(52000) } }));
    expect(r.reasons).toContain("provider_prediction_exceeds_original_factory_msrp");
    expect(r.state).toBe("unavailable");
  });
});

describe("new vehicles are compared with the verified factory MSRP, not the market", () => {
  it("rates against the configured MSRP and says what it compares", () => {
    const r = pf(newRow());
    // 46,000 - 47,000 = -1,000; -1,000 / 47,000 x 100 = -2.1277 -> -2.13 <= -1 -> Below MSRP, segment 2.
    expect(r.vehicleType).toBe("new");
    expect(r.basis).toBe("factory_msrp");
    expect(r.deltaDollars).toBe(-1000);
    expect(r.deltaPct).toBe(-2.13);
    expect(r.segmentIndex).toBe(2);
    expect(r.label).toBe("Below MSRP");
    expect(r.benchmarkIsEstimate).toBe(false);
    expect(r.explanation).toMatch(/not with other vehicles/);
  });

  it.each([
    [46532, -1, 2],   // -468 / 47,000 = -0.9957% -> -1.00 -> below (<= -1)
    [46533, -0.99, 1],// -467 / 47,000 = -0.9936% -> -0.99 -> at
    [47472, 1, 1],    // 472 / 47,000 = 1.0043% -> 1.00 -> at (<= 1)
    [47473, 1.01, 0], // 473 / 47,000 = 1.0064% -> 1.01 -> above
  ])("new price %i -> %d%% -> segment %i", (price, pctExpected, segment) => {
    const r = pf(newRow({ price, advertised_price_before_doc: price }));
    expect(r.deltaPct).toBe(pctExpected);
    expect(r.segmentIndex).toBe(segment);
  });

  it("is unavailable without a factory-verified MSRP for the exact build", () => {
    const mc = { ...(newRow().mc_attributes as Record<string, unknown>), build_sheet: { generic: true, decoded_at: iso(3), pricing: { total_msrp: 47000 } } };
    const r = pf(newRow({ mc_attributes: mc }));
    expect(r.state).toBe("unavailable");
    expect(r.reasons).toContain("msrp_not_verified");
  });
});
