import { describe, it, expect } from "vitest";
import {
  DEFAULT_COMP_SETTINGS, resolveCompSettings, filterCompsForValueStory,
  rankCompsForValueStory, normalizeDrivetrain, isWithinMileageBand,
} from "./compStrategy";

const vehicle = { price: 24876, mileage: 35820, trim: "LUXE", drivetrain: "AWD" };
const comp = (over: Record<string, unknown>) => ({ price: 27990, miles: 42100, trim: "LUXE", drivetrain: "AWD", distanceMiles: 18, daysOnMarket: 62, ...over });

describe("filterCompsForValueStory (value_building default)", () => {
  it("keeps higher-priced similar comps", () => {
    expect(filterCompsForValueStory([comp({})], vehicle, DEFAULT_COMP_SETTINGS)).toHaveLength(1);
  });
  it("drops cheaper comps by default", () => {
    expect(filterCompsForValueStory([comp({ price: 22990 })], vehicle, DEFAULT_COMP_SETTINGS)).toHaveLength(0);
  });
  it("allows slightly cheaper comps only when the dealer opts in", () => {
    const s = resolveCompSettings({ includeLowerPricedComps: true });
    expect(filterCompsForValueStory([comp({ price: 24200 })], vehicle, s)).toHaveLength(1); // within 3%
    expect(filterCompsForValueStory([comp({ price: 22000 })], vehicle, s)).toHaveLength(0); // below tolerance
  });
  it("drops unrelated expensive comps above the ceiling", () => {
    expect(filterCompsForValueStory([comp({ price: 39000 })], vehicle, DEFAULT_COMP_SETTINGS)).toHaveLength(0);
  });
  it("enforces the mileage band", () => {
    expect(filterCompsForValueStory([comp({ miles: 90000 })], vehicle, DEFAULT_COMP_SETTINGS)).toHaveLength(0);
  });
  it("requires trim match only when both sides have a trim", () => {
    expect(filterCompsForValueStory([comp({ trim: "SPORT" })], vehicle, DEFAULT_COMP_SETTINGS)).toHaveLength(0);
    expect(filterCompsForValueStory([comp({ trim: null })], vehicle, DEFAULT_COMP_SETTINGS)).toHaveLength(1);
  });
  it("never fabricates — missing subject price passes comps through on price", () => {
    expect(filterCompsForValueStory([comp({ price: 18000, miles: 36000 })], { ...vehicle, price: null }, DEFAULT_COMP_SETTINGS)).toHaveLength(1);
  });
  it("balanced_market admits moderately cheaper comps", () => {
    const s = resolveCompSettings({ compStrategy: "balanced_market" });
    expect(filterCompsForValueStory([comp({ price: 21000 })], vehicle, s)).toHaveLength(1);
  });
  it("all_comps passes everything", () => {
    const s = resolveCompSettings({ compStrategy: "all_comps" });
    expect(filterCompsForValueStory([comp({ price: 12000, miles: 120000, trim: "BASE" })], vehicle, s)).toHaveLength(1);
  });
});

describe("rankCompsForValueStory", () => {
  it("puts higher-priced same-trim comps first", () => {
    const weak = comp({ trim: null, drivetrain: null, price: 24900, distanceMiles: 80, daysOnMarket: 200 });
    const strong = comp({ price: 27990 });
    expect(rankCompsForValueStory([weak, strong], vehicle)[0]).toBe(strong);
  });
});

describe("helpers", () => {
  it("normalizes drivetrain synonyms", () => {
    expect(normalizeDrivetrain("Four Wheel Drive")).toBe("4wd");
    expect(normalizeDrivetrain("4x4")).toBe("4wd");
    expect(normalizeDrivetrain("All-Wheel Drive")).toBe(normalizeDrivetrain("AWD"));
  });
  it("mileage band is symmetric and tolerant of missing data", () => {
    expect(isWithinMileageBand(40000, 36000, 25)).toBe(true);
    expect(isWithinMileageBand(50000, 36000, 25)).toBe(false);
    expect(isWithinMileageBand(null, 36000, 25)).toBe(true);
  });
});
