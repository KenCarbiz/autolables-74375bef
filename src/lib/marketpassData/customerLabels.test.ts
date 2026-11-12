import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compSampleView, cohortExplanation, deriveRating, derivePassport, deriveSoldClaims, type PassportData,
} from "@/lib/passportV2Data";
import { checkCustomerExitWording } from "@/lib/market/soldLanguage";
import { MOCK_USED_FEE } from "@/pages/VehiclePassportV3";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const base = MOCK_USED_FEE as unknown as VehicleListing;
const withMeta = (market_meta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ ...base, ...extra, market_meta }) as unknown as VehicleListing;

describe("exited-listing evidence carries no sale claim and no invented period", () => {
  const soldStats = { count: 12, price_median: 30000, dom_median: 21, miles_median: 40000, scope: "model_year_state", state: "CT", checked_at: new Date().toISOString() };
  const d = derivePassport(withMeta({ sold_stats: soldStats }, { price: 28000 }));

  it("deriveSoldClaims says listings left the market, with no sold wording and no period", () => {
    const c = deriveSoldClaims(d, 41000, "used");
    // 28000 <= 30000 * 0.97 = 29100, count 12 >= 10, scope model_year_state: price claim shown.
    expect(c.soldPrice?.amount).toBe(2000);
    expect(c.soldPrice?.headline).toBe("Priced $2,000 below the typical last advertised price of similar listings that left the market");
    expect(c.velocity).toBe("12 similar vehicles left the market in CT (listing records, not confirmed sales)");
    expect(c.sellTime).toBe("Similar listings typically left the market after ~21 days listed here");
    for (const text of [c.soldPrice?.headline, c.soldPrice?.sub, c.velocity, c.sellTime, c.milesAdv]) {
      expect(checkCustomerExitWording(text).offending, String(text)).toEqual([]);
    }
  });

  it("the rating evidence line is neutral too", () => {
    const r = deriveRating(withMeta({ sold_stats: soldStats }, { price: 28000 }), d);
    const lines = r.factors.flatMap((f) => f.evidence);
    expect(lines).toContain("Similar listings were typically listed ~21 days before leaving the market here");
    for (const l of lines) expect(checkCustomerExitWording(l).offending, l).toEqual([]);
  });

  it("the enrich pass no longer stores a hard-coded 90 day window", () => {
    expect(read("supabase/functions/vehicle-enrich/index.ts")).not.toMatch(/window_days:\s*90/);
  });
});

describe("total matches are not 'analyzed'", () => {
  const cohort = {
    selection: "price_independent_cohort", total_matches: 140, returned_count: 50, analyzed_count: 44, sampled: true,
    sort_basis: "distance", radius_miles: 100, year: "2023", trim: "Sensory", miles_band: { percent: 25, range: "9000-15000" },
    excluded: { subject_vin: 1, dealer_own_listings: 3, unpriced: 1, trim_or_drivetrain_mismatch: 0, outliers: 1 },
    outlier_rule: "1.5x IQR of the cohort's own prices", median_method: "m",
  };

  it("cohort record: analyzed is 44 of 140 matches", () => {
    const m = derivePassport(withMeta({ similar_count: 140, search_radius: 100, cohort })).marketMeta;
    expect(compSampleView(m)).toMatchObject({ analyzed: true, n: 44, total: 140 });
    expect(compSampleView(m).caption).toBe("of 140 matches, within 100 mi");
  });

  it("legacy record with only num_found shows matches, never analyzed", () => {
    const m = derivePassport(withMeta({ similar_count: 140, search_radius: 100 })).marketMeta;
    expect(m.analyzedCount).toBeNull();
    expect(compSampleView(m)).toMatchObject({ analyzed: false, n: 140 });
  });

  it("explains cohort, geography, trim, mileage, exclusions and sample size", () => {
    expect(cohortExplanation(cohort)).toEqual([
      "44 listings analyzed out of 140 matching listings (a nearest-first sample)",
      "Selected by model year 2023, trim Sensory, mileage within the 9000 to 15000 mile band, within 100 miles; chosen without reference to this vehicle's price",
      "Excluded: this vehicle, 3 of this dealer's own listings, 1 without a price, 1 statistical outliers",
    ]);
  });
});

describe("page views are not market demand", () => {
  it("a very high view count does not change the demand factor", () => {
    const l = withMeta({ avg_dom: 40, market_days_supply: 20 });
    const low = deriveRating({ ...l, view_count: 0 } as unknown as VehicleListing, derivePassport({ ...l, view_count: 0 } as unknown as VehicleListing));
    const high = deriveRating({ ...l, view_count: 900 } as unknown as VehicleListing, derivePassport({ ...l, view_count: 900 } as unknown as VehicleListing));
    const dem = (r: typeof low) => r.factors.find((f) => f.key === "demand");
    expect(dem(high)?.score).toBe(dem(low)?.score);
    expect(dem(high)?.evidence.join(" ")).not.toMatch(/viewed/i);
  });

  it("PassportPanel's demand score does not read view counts", () => {
    const src = read("src/components/passport/PassportPanel.tsx");
    const score = src.slice(src.indexOf("const score = (() => {"), src.indexOf("const level = score"));
    expect(score).not.toMatch(/viewsShown|viewCount/);
  });
});

describe("the price-blended Confidence ring is retired", () => {
  const panel = read("src/components/passport/PassportPanel.tsx");
  it("PassportPanel renders no Confidence score, ring or Solid/Strong/Exceptional scale", () => {
    for (const s of ["Confidence Score", "AutoLabels Confidence", "`Confidence ${", "Exceptional\", r:", "Confidence Stability"]) {
      expect(panel.includes(s), s).toBe(false);
    }
    expect(panel).not.toMatch(/const conf = rating\.overall/);
  });
  it("V2Detail renders no Excellent/Fair confidence card", () => {
    const v2 = read("src/pages/VehiclePassportV2Detail.tsx");
    expect(v2).not.toMatch(/Price Confidence|How sure we are/);
  });
});

describe("estimate and retrieval labelling", () => {
  const governed = read("src/pages/VehiclePassportGoverned.tsx");
  const panel = read("src/components/passport/PassportPanel.tsx");
  it("fetch times are labelled as our retrieval, not data age", () => {
    expect(governed).toMatch(/Market data retrieved \{marketCheckedLabel\}/);
    expect(governed).not.toMatch(/>Updated \{marketCheckedLabel\}/);
    expect(panel).not.toMatch(/`Updated \$\{new Date/);
  });
  it("market predictions are labelled as estimates", () => {
    expect(panel).toMatch(/Estimated Market Value/);
    expect(panel).not.toMatch(/>Low Market<|>High Market<|>Market Average</);
    expect(governed).toMatch(/Est\. Below Market/);
  });
  it("median is not labelled average", () => {
    expect(panel).not.toMatch(/Avg Days to Sell/);
  });
  it("no invented market multipliers remain in the owned surfaces", () => {
    for (const f of ["src/pages/VehiclePassportGoverned.tsx", "src/lib/passport/nextPassportData.ts", "src/lib/passportV2Data.ts", "src/components/passport/PassportPanel.tsx", "src/pages/VehiclePassportV2Detail.tsx"]) {
      expect(read(f), f).not.toMatch(/(marketAvg|marketValue|market_value|marketLow|marketHigh)\s*\*\s*(0\.[0-9]+|1\.[0-9]+)/);
    }
  });
});

describe("missing evidence stays unavailable", () => {
  it("no cohort record and no provider range: no scale, no analyzed count", () => {
    const d: PassportData = derivePassport(withMeta({ similar_count: 30 }));
    expect(d.marketMeta.cohort).toBeNull();
    expect(compSampleView(d.marketMeta).analyzed).toBe(false);
  });
});
