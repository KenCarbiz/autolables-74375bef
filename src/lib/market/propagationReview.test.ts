// ── What an operator sees after a market moves ─────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildPropagationReviewRow, cohortLabel } from "./shadowReview.ts";

const INPUT = {
  cohort: {
    hash: "abc123", year: 2023, make: "INFINITI", model: "QX60",
    trim: "luxe", drivetrain: "awd", vehicleClass: "cpo",
  },
  snapshot: {
    fingerprint: "fp-week-two", observedAt: "2026-09-18T03:15:00.000Z",
    eligibleCount: 3, independentRooftopCount: 3, ownRooftopExcluded: 2, p50: 41200,
  },
  prior: { eligibleCount: 5, independentRooftopCount: 4, p50: 39799, sufficiency: "sufficient" },
  change: {
    reasons: ["market_competitors_left_2", "market_p50_moved_1401"],
    currentSufficiency: "sufficient", percentileMovement: 1401,
  },
  plan: {
    planned: [{ vin: "5N1DL1FS0PC900002" }, { vin: "5N1DL1FS0PC900003" }],
    rejected: [{ vin: "5N1DL1FS0PC900006", reasons: ["cohort_drivetrain_differs"] }],
    providerCallsCaused: 0, providerCostCaused: 0, usedSharedEvidence: true,
  },
};

describe("the propagation review row", () => {
  const row = buildPropagationReviewRow(INPUT);

  it("names the cohort readably, with no VIN and no price", () => {
    expect(row.cohortLabel).toBe("2023 INFINITI QX60 luxe AWD CPO");
    expect(cohortLabel({ hash: "x" })).toBe("unknown cohort");
    expect(row.cohortLabel).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    expect(row.cohortLabel).not.toMatch(/\$|\d{5,}/);
  });

  it("shows the snapshot, its time and how many cars it reached", () => {
    expect(row.snapshotFingerprint).toBe("fp-week-two");
    expect(row.observedAt).toBe("2026-09-18T03:15:00.000Z");
    expect(row.affectedCount).toBe(2);
  });

  it("shows why the market was judged to have moved", () => {
    expect(row.materialChangeReasons).toEqual([
      "market_competitors_left_2", "market_p50_moved_1401",
    ]);
  });

  it("shows prior versus current sufficiency and percentile movement", () => {
    expect(row.priorSufficiency).toBe("sufficient");
    expect(row.currentSufficiency).toBe("sufficient");
    expect(row.priorEligibleCount).toBe(5);
    expect(row.currentEligibleCount).toBe(3);
    expect(row.priorRooftopCount).toBe(4);
    expect(row.currentRooftopCount).toBe(3);
    expect(row.priorP50).toBe(39799);
    expect(row.currentP50).toBe(41200);
    expect(row.percentileMovement).toBe(1401);
  });

  it("shows the own-rooftop exclusions that were not market evidence", () => {
    expect(row.ownRooftopExcluded).toBe(2);
  });

  it("lists what was reevaluated and what was rejected, with reasons", () => {
    expect(row.reevaluatedVins).toEqual(["5N1DL1FS0PC900002", "5N1DL1FS0PC900003"]);
    expect(row.rejected[0].reasons).toContain("cohort_drivetrain_differs");
  });

  it("states that shared evidence was used, and shows the two constants", () => {
    expect(row.usedSharedEvidence).toBe(true);
    // Displayed rather than assumed: a non-zero here is immediately visible.
    expect(row.providerCallsCaused).toBe(0);
    expect(row.providerCostCaused).toBe(0);
  });

  it("labels itself internal-only", () => {
    expect(row.audience).toBe("internal_only");
  });

  it("handles a first snapshot with no prior", () => {
    const first = buildPropagationReviewRow({ ...INPUT, prior: null });
    expect(first.priorSufficiency).toBeNull();
    expect(first.priorP50).toBeNull();
    expect(first.priorEligibleCount).toBeNull();
    expect(first.currentEligibleCount).toBe(3);
  });
});

describe("the review adapter stays read-only", () => {
  const src = readFileSync("src/lib/market/shadowReview.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("can invoke, mutate and spend nothing", () => {
    for (const forbidden of [
      ".update(", ".insert(", ".delete(", "functions.invoke", "fetch(",
      "market_reserve_provider_call", "market_provider_budgets",
    ]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("is still not routed publicly", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).not.toContain("PropagationReview");
    expect(app).not.toContain("buildPropagationReviewRow");
  });
});
