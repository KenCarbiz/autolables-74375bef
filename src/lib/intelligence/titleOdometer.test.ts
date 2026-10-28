import { describe, it, expect } from "vitest";
import {
  assembleReadings, assessOdometer, classifyTitleOdometer, DEFAULT_TITLE_REPORT_TTL_DAYS, FORBIDDEN_TITLE_WORDS,
  type TitleReportInput,
} from "./titleOdometer";
import type { OdometerReading } from "./contracts";

// Synthetic fixtures throughout; no real vehicle.
const NOW = Date.parse("2026-10-28T00:00:00Z");
const day = 86_400_000;

const answered = (over: Partial<TitleReportInput> = {}): TitleReportInput => ({
  outcome: "answered",
  reportDate: "2026-10-21T14:00:00Z",
  brands: [],
  junkSalvageTotalLoss: [],
  odometerReadings: [{ value: "38,900", date: "2025-06-01" }, { value: 41287, date: "2026-10-01" }],
  latestTitle: { state: "CT", date: "2025-06-01", odometer: "38900", type: "Original" },
  complete: true,
  ...over,
});

const reading = (value: number, observedAt: string, authority: OdometerReading["authority"], source = "test"): OdometerReading =>
  ({ value, observedAt, source, authority });

describe("classifyTitleOdometer", () => {
  it("verifies only an answered report with no brands, no JSTL and a consistent chronology", () => {
    const s = classifyTitleOdometer({ report: answered(), nowMs: NOW });
    expect(s.state).toBe("VERIFIED_NO_ADVERSE_REPORTED");
    expect(s.odometerStatus).toBe("consistent");
    expect(s.titleBrandsReported).toEqual([]);
    expect(s.publicStatement).toBe("No NMVTIS title brands reported as of October 21, 2026. No junk, salvage or total-loss records reported. Odometer readings on record are consistent.");
    expect(s.freshness.state).toBe("current");
    expect(s.freshness.ttlDays).toBe(DEFAULT_TITLE_REPORT_TTL_DAYS);
    expect(s.entitlementBlocked).toBe(false);
    expect(s.providerFailed).toBe(false);
  });

  it("is adverse on a title brand and names it with its state and date", () => {
    const s = classifyTitleOdometer({ report: answered({ brands: [{ brand: "Salvage", state: "CT", date: "2024-03-02" }] }), nowMs: NOW });
    expect(s.state).toBe("ADVERSE");
    expect(s.titleBrandsReported).toEqual(["Salvage (CT, March 2, 2024)"]);
    expect(s.publicStatement).toBe("NMVTIS reports as of October 21, 2026: Salvage (CT, March 2, 2024).");
    expect(s.reasons).toContain("title_brand_reported");
  });

  it("is adverse on a junk, salvage or total-loss record even with no brand", () => {
    const s = classifyTitleOdometer({
      report: answered({ junkSalvageTotalLoss: [{ disposition: "Total loss", entity: "An insurer", date: "2023-11-10" }] }),
      nowMs: NOW,
    });
    expect(s.state).toBe("ADVERSE");
    expect(s.junkSalvageTotalLossReported).toEqual(["Total loss (An insurer, November 10, 2023)"]);
    expect(s.publicStatement).toMatch(/^Junk, salvage or total-loss record reported: Total loss/);
  });

  it("is adverse on a rollback indication from strong authorities, and only review on a weak conflict", () => {
    const rollback = classifyTitleOdometer({
      report: answered(),
      otherReadings: [reading(36000, "2026-10-15", "verified_inspection", "autofilm")],
      nowMs: NOW,
    });
    expect(rollback.state).toBe("ADVERSE");
    expect(rollback.odometerStatus).toBe("rollback_indicated");
    expect(rollback.publicStatement).toMatch(/Odometer readings on record decrease over time: 41,287 miles on October 1, 2026 and 36,000 miles on October 15, 2026\./);

    const weak = classifyTitleOdometer({
      report: answered(),
      otherReadings: [reading(36000, "2026-10-15", "provider_listing", "feed")],
      nowMs: NOW,
    });
    expect(weak.state).toBe("REVIEW_REQUIRED");
    expect(weak.odometerStatus).toBe("conflict");
    expect(weak.publicStatement).toMatch(/^Title history needs review: odometer readings on record disagree/);
  });

  it("tolerates small disagreements and later higher readings", () => {
    const s = classifyTitleOdometer({
      report: answered(),
      otherReadings: [reading(41000, "2026-10-20", "provider_listing", "feed"), reading(41900, "2026-10-27", "dealer_system", "dms")],
      nowMs: NOW,
    });
    expect(s.state).toBe("VERIFIED_NO_ADVERSE_REPORTED");
    expect(s.readings.map((r) => r.value)).toEqual([38900, 38900, 41287, 41000, 41900]);
  });

  it("requires review when the report is older than its TTL, incomplete, or has no odometer reading", () => {
    const stale = classifyTitleOdometer({ report: answered({ reportDate: new Date(NOW - 120 * day).toISOString() }), nowMs: NOW });
    expect(stale.state).toBe("REVIEW_REQUIRED");
    expect(stale.freshness.state).toBe("stale");
    expect(stale.publicStatement).toContain("older than 90 days");
    const incomplete = classifyTitleOdometer({ report: answered({ complete: false }), nowMs: NOW });
    expect(incomplete.state).toBe("REVIEW_REQUIRED");
    expect(incomplete.reasons).toContain("report_incomplete");
    const noOdo = classifyTitleOdometer({ report: answered({ odometerReadings: [], latestTitle: null }), nowMs: NOW });
    expect(noOdo.state).toBe("REVIEW_REQUIRED");
    expect(noOdo.odometerStatus).toBe("not_checked");
    expect(noOdo.publicStatement).toContain("carries no odometer reading");
  });

  it("is never verified when the report is absent, entitlement-blocked or failed", () => {
    for (const outcome of ["not_requested", "entitlement_blocked", "provider_failed"] as const) {
      const s = classifyTitleOdometer({ report: { outcome, brands: [] }, nowMs: NOW });
      expect(s.state, outcome).toBe("NOT_VERIFIED");
      expect(s.publicStatement).toBe("Title history not verified.");
      expect(s.checkedAt).toBeNull();
      expect(s.freshness.state).toBe("unknown");
      expect(s.reasons).toEqual([`report_${outcome}`]);
    }
    expect(classifyTitleOdometer({ report: { outcome: "entitlement_blocked" }, nowMs: NOW }).entitlementBlocked).toBe(true);
    expect(classifyTitleOdometer({ report: { outcome: "provider_failed" }, nowMs: NOW }).providerFailed).toBe(true);
  });

  it("never says clean, guaranteed, owner or accident in any public statement", () => {
    const statements = [
      classifyTitleOdometer({ report: answered(), nowMs: NOW }),
      classifyTitleOdometer({ report: answered({ brands: [{ brand: "Rebuilt" }] }), nowMs: NOW }),
      classifyTitleOdometer({ report: answered({ complete: false }), nowMs: NOW }),
      classifyTitleOdometer({ report: { outcome: "not_requested" }, nowMs: NOW }),
    ].map((s) => s.publicStatement);
    for (const s of statements) expect(s, s).not.toMatch(FORBIDDEN_TITLE_WORDS);
  });

  it("honours configurable tolerances and TTL", () => {
    const s = classifyTitleOdometer(
      { report: answered(), otherReadings: [reading(40900, "2026-10-15", "verified_inspection")], nowMs: NOW },
      { conflictToleranceMiles: 100, rollbackToleranceMiles: 5000, reportTtlDays: 3 },
    );
    expect(s.odometerStatus).toBe("conflict");
    expect(s.freshness.state).toBe("stale");
    expect(s.state).toBe("REVIEW_REQUIRED");
  });
});

describe("assembleReadings and assessOdometer", () => {
  it("orders dated readings oldest first and keeps undated ones last, uncounted", () => {
    const readings = assembleReadings(
      { outcome: "answered", odometerReadings: [{ value: 50000, date: "2026-01-01" }, { value: "junk" }], latestTitle: { odometer: 49000, date: "2025-01-01" } },
      [{ value: 52000, observedAt: null, source: "feed", authority: "provider_listing" }],
    );
    expect(readings.map((r) => r.value)).toEqual([49000, 50000, 52000]);
    const a = assessOdometer(readings);
    expect(a.status).toBe("consistent");
    expect(a.reasons).toContain("undated_readings_not_cross_checked");
    expect(assessOdometer([]).status).toBe("not_checked");
  });
});
