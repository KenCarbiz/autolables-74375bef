// The hand-recomputed examples the AutoFilm build prompt (section 12) asks
// for: typical, sparse, zero values, stale data, unknown history, title brand,
// accident, open recall, decode conflict, absent range and extreme prediction.
// Each expected value is worked by hand in MARKETPASS_SCORING_SPEC.md section 8
// under the same name. All rules here are PROPOSED, not approved.

import { describe, expect, it } from "vitest";
import { buildMarketPassAssessment, identityConflicts } from "./assessment";
import { toPublicContract } from "./publicContract";
import { NOW, iso, settings, usedRow, providerValuation } from "./__fixtures__/rows";
import type { MarketPassRow } from "./rowEvidence";

const assess = (row: MarketPassRow) => buildMarketPassAssessment({ row, settings: settings(), nowMs: NOW });
const pub = (row: MarketPassRow) => toPublicContract(assess(row));
const mc = () => usedRow().mc_attributes as Record<string, unknown>;
const meta = () => usedRow().market_meta as Record<string, unknown>;

describe("AutoFilm prompt section 12 examples", () => {
  it("typical: median of 30,000..32,000 is 31,000; 29,900 is -3.55%, Good price", () => {
    const p = pub(usedRow());
    expect(p.priceFairness.deltaDollars).toBe(-1100);
    expect(p.priceFairness.deltaPct).toBe(-3.55);
    expect(p.priceFairness.label).toBe("Good price");
    expect(p.priceFairness.segmentIndex).toBe(3);
  });

  it("zero price: $0 is not a price, so nothing is rated", () => {
    const p = pub(usedRow({ price: 0, advertised_price_before_doc: 0 }));
    expect(p.priceFairness.state).toBe("unavailable");
    expect(p.priceFairness.segmentIndex).toBeNull();
    expect(p.priceFairness.deltaDollars).toBeNull();
  });

  it("zero mileage: a true 0 stays 0, and its 0-5,000 mile band excludes 30,000-mile comparables", () => {
    const a = assess(usedRow({ mileage: 0 }));
    expect(a.priceFairness.state).toBe("unavailable");
    expect(a.priceFairness.reasons).toContain("market_value_unavailable");
  });

  it("zero accidents is not an adverse finding and not a clean-history claim", () => {
    const p = pub(usedRow({ mc_attributes: { ...mc(), accident_count: 0 } }));
    expect(p.vehicleConfidence.state).not.toBe("adverse");
    expect(JSON.stringify(p.vehicleConfidence.findings)).not.toMatch(/no accident/i);
  });

  it("stale data: comparables retrieved 120 days ago are out of date, so nothing is rated", () => {
    const old = iso(120);
    const p = pub(usedRow({ market_meta: { ...meta(), checked_at: old, search_checked_at: old, comp_selection: { price_independent: true, total_matches: 212, radius_miles: 50, zip: "06001", checked_at: old } } }));
    expect(p.priceFairness.state).toBe("unavailable");
    expect(p.priceFairness.explanation).toMatch(/out of date/);
  });

  it("unknown history: no title check and no recall answer are gaps, never clean", () => {
    const p = pub(usedRow({ title_verification: null, recall_status: null, open_recall_count: null, recall_check: null, recall_checked_at: null }));
    expect(p.vehicleConfidence.state).toBe("qualified");
    expect(p.vehicleConfidence.segmentIndex).toBeNull();
    expect(p.vehicleConfidence.gaps).toContain("Title history has not been verified against NMVTIS.");
    expect(JSON.stringify(p.vehicleConfidence)).not.toMatch(/clean title|no accidents/i);
  });

  it("title brand: SALVAGE is adverse, segment 0, while the price is still rated on its own", () => {
    const p = pub(usedRow({ title_verification: { status: "branded", verified_at: iso(5), report_generated_at: iso(5), brand_note: "SALVAGE", source: "nmvtis" } }));
    expect(p.vehicleConfidence.state).toBe("adverse");
    expect(p.vehicleConfidence.segmentIndex).toBe(0);
    expect(p.priceFairness.label).toBe("Good price");
  });

  it("accident: one reported accident is adverse and says it is unverified", () => {
    const p = pub(usedRow({ mc_attributes: { ...mc(), accident_count: 1 } }));
    expect(p.vehicleConfidence.state).toBe("adverse");
    expect(p.vehicleConfidence.segmentIndex).toBe(0);
    expect(p.vehicleConfidence.explanation + p.vehicleConfidence.findings.join(" ")).toMatch(/1 accident; this has not been verified/);
  });

  it("open recall: an open VIN recall is adverse", () => {
    const a = assess(usedRow({ recall_status: "open", open_recall_count: 1, recall_check: { scope: "vin", state: "open", source: "marketcheck", checked_at: iso(5), open_count: 1, closed_count: 0, has_open: true, campaigns: [{ id: "26V001" }] } }));
    expect(a.vehicleConfidence.state).toBe("adverse");
    expect(a.vehicleConfidence.internal.hardGates).toContain("open_safety_recall");
  });

  it("decode conflict: advertised SPORT against a BASE FWD build is review, segment 1, and costs Data Confidence 10 points", () => {
    const clean = assess(usedRow());
    const row = usedRow({ mc_attributes: { ...mc(), build_sheet: { ...(mc().build_sheet as Record<string, unknown>), version: "BASE FWD" } } });
    const a = assess(row);
    expect(a.dataConfidence.conflicts).toContain("trim_decode_conflict");
    expect(a.vehicleConfidence.state).toBe("review");
    expect(a.vehicleConfidence.segmentIndex).toBe(1);
    expect(toPublicContract(a).vehicleConfidence.explanation + JSON.stringify(toPublicContract(a).vehicleConfidence))
      .toMatch(/advertised trim does not match the factory build record/);
    expect((clean.dataConfidence.score ?? 0) - (a.dataConfidence.score ?? 0)).toBe(10);
  });

  it("the trim rule: every advertised word must be in the decoded version", () => {
    expect(identityConflicts("SPORT", { version: "SPORT AWD", matchLevel: "EXACT_VIN" })).toEqual([]);
    expect(identityConflicts("Sport", { version: "BASE FWD", matchLevel: "EXACT_VIN" })).toEqual(["trim_decode_conflict"]);
    expect(identityConflicts("SPORT", { version: null, matchLevel: "EXACT_VIN" })).toEqual([]);
    expect(identityConflicts("SPORT", { version: "BASE", matchLevel: "YMM" })).toEqual([]);
  });

  it("absent range: no comparables and a bare stored value give no rating and no range", () => {
    const p = pub(usedRow({ comparables: [], market_value: 31000, market_payload: { marketValue: 31000 } }));
    expect(p.priceFairness.state).toBe("unavailable");
    expect(JSON.stringify(p)).not.toMatch(/rangeLow|rangeHigh|"low"|"high"/);
  });

  it("extreme prediction: a $95,000 provider estimate above the $47,000 factory MSRP is discarded, never shown", () => {
    const a = assess(usedRow({ market_payload: { provider_valuation: providerValuation(95000) } }));
    expect(a.priceFairness.reasons).toContain("provider_prediction_exceeds_original_factory_msrp");
    expect(a.priceFairness.deltaPct).toBe(-3.55);
    expect(JSON.stringify(toPublicContract(a))).not.toContain("95000");
  });

  it("sparse: nothing lit on either public gauge", () => {
    const p = pub(usedRow({ comparables: [], market_meta: {}, mc_attributes: {}, title_verification: null }));
    expect(p.priceFairness.segmentIndex).toBeNull();
    expect(p.vehicleConfidence.segmentIndex).toBeNull();
  });
});
