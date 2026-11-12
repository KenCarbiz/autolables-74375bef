import { describe, it, expect } from "vitest";
import { buildMarketDesirability, desirabilityBand, linearScore } from "./marketDesirability";
import { buildMarketPassAssessment } from "./assessment";
import { NOW, iso, settings, usedRow } from "./__fixtures__/rows";

const md = (meta: Record<string, unknown>) => buildMarketDesirability({ vehicleType: "used", marketMeta: meta, nowMs: NOW, evidence: [] });
const sold = (over: Record<string, unknown> = {}) => ({ count: 14, dom_median: 34, scope: "model_year_state", checked_at: iso(4), ...over });

describe("market days supply score", () => {
  it.each([
    [20, 100], // below 30 clamps to 100
    [30, 100], // 100 x (120 - 30) / 90 = 100
    [48, 80],  // 100 x 72 / 90 = 80
    [75, 50],  // 100 x 45 / 90 = 50
    [97.5, 25],// 100 x 22.5 / 90 = 25
    [98, 24],  // 100 x 22 / 90 = 24.4 -> 24
    [120, 0],
    [200, 0],
  ])("%d days -> %i", (days, score) => {
    expect(linearScore(days, 30, 120)).toBe(score);
    expect(md({ market_days_supply: days, inventory_count: 40, mds_checked_at: iso(1) }).score).toBe(score);
  });

  it.each([[75, "high"], [74, "steady"], [50, "steady"], [49, "soft"], [25, "soft"], [24, "slow"]])("band boundary %i -> %s", (s, band) => {
    expect(desirabilityBand(s)).toBe(band);
  });
});

describe("one construct, one input: no double counting", () => {
  it("days supply leads; the inferred-sold median is a cross-check only", () => {
    const r = md({ market_days_supply: 48, inventory_count: 64, mds_checked_at: iso(2), sold_stats: sold({ dom_median: 76 }) });
    // Days supply alone: 80. The DOM median 76 would score 100 x (90 - 76) / 70 = 20; it is not averaged in.
    expect(r.score).toBe(80);
    expect(r.components).toHaveLength(1);
    expect(r.components[0].input).toBe("market_days_supply");
    expect(r.context.crossCheck?.score).toBe(20);
    expect(r.context.crossCheck?.used).toBe(false);
    // |80 - 20| = 60 > 40.
    expect(r.reasons).toContain("supply_and_inferred_sold_velocity_disagree");
  });

  it("falls back to the inferred-sold median when days supply is not usable", () => {
    const r = md({ market_days_supply: 48, inventory_count: 9, mds_checked_at: iso(2), sold_stats: sold() });
    // Days supply cohort 9 < 10. DOM 34: 100 x (90 - 34) / 70 = 80.
    expect(r.components[0].input).toBe("inferred_sold_dom_median");
    expect(r.score).toBe(80);
    expect(r.reasons).toContain("cohort_inventory_below_10");
  });
});

describe("missing, stale, thin or unverified inputs", () => {
  it("nothing usable is unavailable with a null score", () => {
    const r = md({});
    expect(r.state).toBe("unavailable");
    expect(r.score).toBeNull();
    expect(r.band).toBeNull();
  });

  it("stale days supply and a make-wide sold figure are both refused", () => {
    const r = md({ market_days_supply: 40, inventory_count: 50, mds_checked_at: iso(10), sold_stats: sold({ scope: "make_state" }) });
    // Days supply retrieved 10 days ago against a 7-day TTL; make_state is too broad.
    expect(r.state).toBe("unavailable");
    expect(r.reasons).toContain("market_days_supply_stale");
    expect(r.reasons).toContain("inferred_sold_scope_make_state_too_broad");
  });

  it("a computed score stays provisional while the provider meaning is unverified", () => {
    const r = md({ market_days_supply: 48, inventory_count: 64, mds_checked_at: iso(2) });
    expect(r.state).toBe("provisional");
    expect(r.reasons).toContain("input_meaning_unverified:market_days_supply");
  });

  it("Passport page views are not market demand", () => {
    const a = buildMarketPassAssessment({ row: usedRow({ view_count: 0 }), settings: settings(), nowMs: NOW }).marketDesirability;
    const b = buildMarketPassAssessment({ row: usedRow({ view_count: 90000 }), settings: settings(), nowMs: NOW }).marketDesirability;
    expect(b).toEqual(a);
  });
});
