import { describe, expect, it } from "vitest";
import { describeCohort } from "../../../../supabase/functions/_shared/compCohort";
import { comparableSelectionFromRow } from "./rowEvidence";

describe("the assessment reads the cohort the comparable writer stores", () => {
  const cohort = describeCohort({
    totalMatches: 212, returned: 50, analysed: 41, sortBasis: "dist",
    radius: 100, year: "2023", trim: "Luxe", milesBand: null,
    subject: 1, own: 2, unpriced: 3, outliers: 3, outlierRule: "1.5 x IQR",
  });

  it("treats a vehicle-enrich cohort as price-independent and keeps total matches apart from analyzed rows", () => {
    const sel = comparableSelectionFromRow({ market_meta: { cohort, checked_at: "2026-11-10T12:00:00Z" } } as never);
    expect(sel.selection).toBe("price_independent");
    expect(sel.totalSearchMatches).toBe(212);
    expect(cohort.analyzed_count).toBe(41);
    expect(sel.radiusMiles).toBe(100);
  });

  it("still reports a legacy row without a cohort record as not recorded", () => {
    expect(comparableSelectionFromRow({ market_meta: { similar_count: 30 } } as never).selection).toBe("not_recorded");
  });
});
