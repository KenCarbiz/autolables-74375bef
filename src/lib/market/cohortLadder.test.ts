import { describe, it, expect } from "vitest";
import { COHORT_REFRESH_DAYS, buildCohortLadder, cohortAnswerDue, recordCohortAnswer } from "./cohortLadder.ts";

const SUBJECT = {
  vin: "1ABCDEFGH12345678", year: 2025, make: "Example", model: "Model", trim: "Base",
  zip: "00000", state: "ct", radiusMiles: 100, carType: "used" as const,
};

describe("the MDS ladder is exact first", () => {
  it("starts at the VIN with exact=true and descends YMMT, YMM, model, national", () => {
    const rungs = buildCohortLadder(SUBJECT, "mds");
    expect(rungs.map((r) => r.level)).toEqual(["VIN_EXACT", "YMMT", "YMMT", "YMM", "YMM", "MODEL", "NATIONAL"]);
    expect(rungs[0].params).toEqual({ car_type: "used", vin: "1ABCDEFGH12345678", exact: "true", zip: "00000", radius: "100" });
    expect(rungs[0].geography).toEqual({ scope: "local", zip: "00000", radius: 100 });
    expect(rungs[rungs.length - 1].geography).toEqual({ scope: "national" });
  });

  it("skips rungs it cannot build instead of guessing", () => {
    const noTrim = buildCohortLadder({ ...SUBJECT, trim: null }, "mds");
    expect(noTrim.map((r) => r.level)).not.toContain("YMMT");
    const noVin = buildCohortLadder({ ...SUBJECT, vin: "bad" }, "mds");
    expect(noVin.map((r) => r.level)).not.toContain("VIN_EXACT");
    const noGeo = buildCohortLadder({ ...SUBJECT, zip: null, state: null }, "mds");
    expect(noGeo.map((r) => r.level)).toEqual(["VIN_EXACT", "NATIONAL"]);
    expect(noGeo[0].geography.scope).toBe("national");
  });

  it("never emits a rung without a make and model at the bottom", () => {
    expect(buildCohortLadder({ vin: "1ABCDEFGH12345678" }, "mds").map((r) => r.level)).toEqual(["VIN_EXACT"]);
    expect(buildCohortLadder({}, "mds")).toEqual([]);
  });
});

describe("the Sales Stats ladder follows the same hierarchy with its own shape", () => {
  it("asks by VIN locally then by state, then YMMT, YMM, model, national", () => {
    const rungs = buildCohortLadder(SUBJECT, "sales_stats");
    expect(rungs.map((r) => r.level)).toEqual(["VIN_EXACT", "VIN_EXACT", "YMMT", "YMMT", "YMM", "YMM", "MODEL", "NATIONAL"]);
    expect(rungs[1].params).toEqual({ car_type: "used", vin: "1ABCDEFGH12345678", state: "CT" });
    expect(rungs[2].params.ymmt).toBe("2025|Example|Model|Base");
  });
});

describe("match tier is recorded with the answer", () => {
  it("records level, geography, sample size, period, rungs tried and checked_at", () => {
    const rungs = buildCohortLadder(SUBJECT, "sales_stats");
    const rec = recordCohortAnswer({
      rung: rungs[2], value: 14, sampleSize: "27", period: { start: "2026-07-01", end: "2026-09-30" },
      checkedAt: "2026-10-27T00:00:00Z", triedBefore: ["VIN_EXACT", "VIN_EXACT"],
    });
    expect(rec.match_level).toBe("YMMT");
    expect(rec.geography.scope).toBe("local");
    expect(rec.sample_size).toBe(27);
    expect(rec.period).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(rec.rungs_tried).toEqual(["VIN_EXACT", "VIN_EXACT"]);
    expect(rec.checked_at).toBe("2026-10-27T00:00:00Z");
  });

  it("keeps an unparseable sample size as null", () => {
    const rung = buildCohortLadder(SUBJECT, "mds")[0];
    expect(recordCohortAnswer({ rung, value: 38, sampleSize: "n/a", checkedAt: "2026-10-27T00:00:00Z", triedBefore: [] }).sample_size).toBeNull();
  });
});

describe("refresh follows provider regeneration, not price", () => {
  it("uses 7 days for MDS and 30 for Sales Stats", () => {
    expect(COHORT_REFRESH_DAYS).toEqual({ mds: 7, sales_stats: 30 });
    const now = Date.parse("2026-10-27T00:00:00Z");
    expect(cohortAnswerDue("mds", "2026-10-25T00:00:00Z", now)).toBe(false);
    expect(cohortAnswerDue("mds", "2026-10-19T00:00:00Z", now)).toBe(true);
    expect(cohortAnswerDue("sales_stats", "2026-10-05T00:00:00Z", now)).toBe(false);
    expect(cohortAnswerDue("sales_stats", "2026-09-20T00:00:00Z", now)).toBe(true);
  });

  it("is due on a material event or when never checked", () => {
    const now = Date.parse("2026-10-27T00:00:00Z");
    expect(cohortAnswerDue("mds", "2026-10-26T00:00:00Z", now, true)).toBe(true);
    expect(cohortAnswerDue("mds", null, now)).toBe(true);
    expect(cohortAnswerDue("mds", "not a date", now)).toBe(true);
  });
});
