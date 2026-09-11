// ── Ken's QX60 scenario, end to end ────────────────────────────────────────
//
// A 2023 INFINITI QX60 LUXE lands. Three more are already on the lot, plus two
// that look similar and are not. A week later the market has thinned and
// prices have risen.
//
// What must happen: the compatible cars are reevaluated against the SAME
// evidence, independently, for nothing. What must not happen: the new car's
// answer being copied onto any of them, a price moving, a customer seeing
// anything, or a single provider call.
//
// The VINs here are fixtures. No production VIN is committed.

import { describe, it, expect } from "vitest";
import { buildCohortKey, cohortKeyHash, cohortsMatch } from "./cohort.ts";
import {
  buildMarketSnapshot, decideMarketChange, vehicleValuationFingerprint,
  evidenceSufficiency,
} from "./marketSnapshot.ts";
import { planImpactedInventory, NEVER_PROPAGATED_FIELDS } from "./propagation.ts";
import { MARKET_ENGINE_VERSION } from "./types.ts";

const TENANT = "tenant-harte-fixture";
const OTHER_TENANT = "tenant-someone-else";
const ALGO = MARKET_ENGINE_VERSION;

/** The shared cohort: 2023 QX60 LUXE AWD CPO, Premium + Cold Weather. */
const COHORT = {
  year: 2023, make: "INFINITI", model: "QX60", trim: "LUXE",
  drivetrain: "AWD", powertrain: "3.5L V6", bodyType: "SUV",
  condition: "cpo", certified: true,
  equipment: ["Premium Package", "Cold Weather Package"],
  zip: "06120", radiusMiles: 100,
};
const cohortKey = buildCohortKey(COHORT);

/** Fixture VINs. Valid shape, not real inventory. */
const SUBJECT   = "5N1DL1FS0PC900001";  // newly ingested
const SIBLING_A = "5N1DL1FS0PC900002";  // 2023 QX60 LUXE AWD CPO, 30,496 mi
const SIBLING_B = "5N1DL1FS0PC900003";  // 2023 QX60 LUXE AWD CPO, 44,660 mi
const SIBLING_C = "5N1DL1FS0PC900004";  // same, but NOT certified
const WRONG_PKG = "5N1DL1FS0PC900005";  // LUXE AWD CPO, different package
const WRONG_DT  = "5N1DL1FS0PC900006";  // LUXE FWD CPO

const candidate = (vin: string, cohortOver: Record<string, unknown>, over: Record<string, unknown> = {}) => {
  const key = buildCohortKey({ ...COHORT, ...cohortOver });
  return {
    vin, tenantId: TENANT, cohortKey: key,
    lastValuationFingerprint: null as string | null,
    nextValuationFingerprint: `fp-${vin}`,
    lastEvaluatedAt: null as string | null,
    ...over,
  };
};

const INVENTORY = [
  candidate(SUBJECT, {}),
  candidate(SIBLING_A, {}),
  candidate(SIBLING_B, {}),
  candidate(SIBLING_C, { condition: "used", certified: false }),
  candidate(WRONG_PKG, { equipment: ["Premium Package"] }),
  candidate(WRONG_DT, { drivetrain: "FWD" }),
];

const PILOT = [SUBJECT, SIBLING_A, SIBLING_B, SIBLING_C, WRONG_PKG, WRONG_DT];

/** Week one: five competitors, two of them Harte's own (already excluded). */
const WEEK_ONE = buildMarketSnapshot({
  cohortKey,
  observations: [
    { vin: "COMP00000000000A1", dealerName: "Acura Of Berlin", dealerId: "1009", price: 38431, mileage: 31000, distanceMiles: 10.5, daysOnMarket: 124, certified: true },
    { vin: "COMP00000000000A2", dealerName: "Smithtown Nissan", dealerId: "1010", price: 38777, mileage: 33000, distanceMiles: 68.6, daysOnMarket: 179, certified: true },
    { vin: "COMP00000000000A3", dealerName: "Infiniti Of Lynbrook", dealerId: "1011", price: 39799, mileage: 29000, distanceMiles: 94.4, daysOnMarket: 92, certified: true },
    { vin: "COMP00000000000A4", dealerName: "Infiniti Of Lynbrook", dealerId: "1011", price: 39898, mileage: 30500, distanceMiles: 94.4, daysOnMarket: 92, certified: true },
    { vin: "COMP00000000000A5", dealerName: "Danbury Infiniti", dealerId: "1012", price: 40181, mileage: 28000, distanceMiles: 51.2, daysOnMarket: 82, certified: false },
  ],
  ownRooftopExcluded: 2,
  query: { zip: "06120", radiusMiles: 100, carType: "used", milesBand: "22000-38000" },
  algorithmVersion: ALGO,
});

/** Week two: two competitors gone, prices up. */
const WEEK_TWO = buildMarketSnapshot({
  cohortKey,
  observations: [
    { vin: "COMP00000000000A1", dealerName: "Acura Of Berlin", dealerId: "1009", price: 39900, mileage: 31000, distanceMiles: 10.5, daysOnMarket: 131, certified: true },
    { vin: "COMP00000000000A3", dealerName: "Infiniti Of Lynbrook", dealerId: "1011", price: 41200, mileage: 29000, distanceMiles: 94.4, daysOnMarket: 99, certified: true },
    { vin: "COMP00000000000A5", dealerName: "Danbury Infiniti", dealerId: "1012", price: 41500, mileage: 28000, distanceMiles: 51.2, daysOnMarket: 89, certified: false },
  ],
  ownRooftopExcluded: 2,
  query: { zip: "06120", radiusMiles: 100, carType: "used", milesBand: "22000-38000" },
  algorithmVersion: ALGO,
});

describe("1-2. compatibility is decided, not assumed", () => {
  it("plans everyone in the same market and refuses everyone outside it", () => {
    // Gate 14G.1: the differently-packaged QX60 is in the SAME market and is
    // planned; it simply cannot serve as an unadjusted comparable. The FWD car
    // and the non-CPO car are different markets and are refused.
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey, subjectVin: SUBJECT, subjectAlreadyEvaluated: true,
      inventory: INVENTORY, pilotVins: PILOT, depth: 0,
    });
    expect(plan.planned.map((p) => p.vin)).toEqual([SIBLING_A, SIBLING_B, WRONG_PKG]);
    const rejectedVins = plan.rejected.map((r) => r.vin);
    expect(rejectedVins).toContain(SUBJECT);
    expect(rejectedVins).toContain(SIBLING_C);
    expect(rejectedVins).toContain(WRONG_DT);
  });

  it("separates exact comparables from same-market-but-differently-equipped", () => {
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey, subjectVin: SUBJECT, subjectAlreadyEvaluated: true,
      inventory: INVENTORY, pilotVins: PILOT, depth: 0,
    });
    const byVin = Object.fromEntries(plan.planned.map((p) => [p.vin, p]));
    for (const vin of [SIBLING_A, SIBLING_B]) {
      expect(byVin[vin].valuationCompatibility, vin).toBe("exact");
      expect(byVin[vin].evidenceContextOnly, vin).toBe(false);
    }
    expect(byVin[WRONG_PKG].valuationCompatibility).toBe("adjustment_required");
    expect(byVin[WRONG_PKG].evidenceContextOnly).toBe(true);
    expect(plan.reasons).toContain("propagation_exact_comparables_2");
    expect(plan.reasons).toContain("propagation_adjustment_required_1");
  });

  it("names why each refused vehicle was refused", () => {
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey, subjectVin: SUBJECT, subjectAlreadyEvaluated: true,
      inventory: INVENTORY, pilotVins: PILOT, depth: 0,
    });
    const reasonFor = (vin: string) => plan.rejected.find((r) => r.vin === vin)?.reasons ?? [];
    expect(reasonFor(WRONG_DT)).toContain("market_drivetrain_differs");
    expect(reasonFor(SIBLING_C).join(" ")).toMatch(/market_class_differs|market_certification_differs/);
    expect(reasonFor(SUBJECT)).toContain("propagation_subject_already_evaluated");
  });

  it("refuses a car whose trim merely looks similar", () => {
    const sensory = buildCohortKey({ ...COHORT, trim: "SENSORY" });
    expect(cohortsMatch(cohortKey, sensory).relation).toBe("incompatible");
  });
});

describe("3. Harte's own listings are not market evidence", () => {
  it("counts own-rooftop exclusions without letting them move the market", () => {
    expect(WEEK_ONE.ownRooftopExcluded).toBe(2);
    expect(WEEK_ONE.reasons).toContain("snapshot_own_rooftop_excluded_2");
    // Five observations, five eligible — the two own cars are already gone.
    expect(WEEK_ONE.eligibleCount).toBe(5);
    expect(WEEK_ONE.observations.every((o) => o.dealer !== "harte infiniti")).toBe(true);
  });

  it("cannot manufacture scarcity from own inventory", () => {
    // Adding our own cars back would have to change the fingerprint to matter,
    // and they are not in it.
    const withoutOwnCars = buildMarketSnapshot({
      cohortKey, observations: WEEK_ONE.observations, ownRooftopExcluded: 0,
      query: { zip: "06120", radiusMiles: 100, carType: "used", milesBand: "22000-38000" },
      algorithmVersion: ALGO,
    });
    // The exclusion COUNT is provenance, not evidence: it does not alter the
    // market the fingerprint describes.
    expect(withoutOwnCars.fingerprint).toBe(WEEK_ONE.fingerprint);
    expect(withoutOwnCars.independentRooftopCount).toBe(WEEK_ONE.independentRooftopCount);
  });
});

describe("4. the later snapshot is a different market", () => {
  const change = decideMarketChange(WEEK_ONE, WEEK_TWO);

  it("changes the shared fingerprint", () => {
    expect(WEEK_TWO.fingerprint).not.toBe(WEEK_ONE.fingerprint);
  });

  it("is material, and says how", () => {
    expect(change.material).toBe(true);
    expect(change.reasons).toContain("market_competitors_left_2");
    expect(change.reasons).toContain("market_eligible_count_5_to_3");
    expect(change.reasons.some((r) => r.startsWith("market_p50_moved_"))).toBe(true);
  });

  it("reports the percentile movement upward", () => {
    expect(WEEK_ONE.p50).toBe(39799);
    expect(WEEK_TWO.p50).toBe(41200);
    expect(change.percentileMovement).toBe(41200 - 39799);
  });

  it("keeps both weeks sufficient, and says so", () => {
    expect(evidenceSufficiency(WEEK_ONE)).toBe("sufficient");
    expect(evidenceSufficiency(WEEK_TWO)).toBe("sufficient");
    expect(change.priorSufficiency).toBe("sufficient");
    expect(change.currentSufficiency).toBe("sufficient");
  });
});

describe("5-7. every vehicle is recalculated independently", () => {
  const fingerprintFor = (vin: string, over: Record<string, unknown>) =>
    vehicleValuationFingerprint({
      vin, equipmentSignature: cohortKey.equipmentSignature,
      marketSnapshotFingerprint: WEEK_TWO.fingerprint,
      algorithmVersion: ALGO,
      mileage: 30496, condition: "cpo", certified: true,
      advertisedPrice: 35788, internalComparisonPrice: 34893,
      tenantConfig: { docFee: 895, includesDocFee: true },
      ...over,
    });

  it("gives each VIN a distinct valuation fingerprint from one snapshot", () => {
    const a = fingerprintFor(SIBLING_A, {});
    const b = fingerprintFor(SIBLING_B, {});
    const c = fingerprintFor(SUBJECT, {});
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("moves a fingerprint on mileage, certification and price independently", () => {
    const base = fingerprintFor(SIBLING_A, {});
    expect(fingerprintFor(SIBLING_A, { mileage: 44660 })).not.toBe(base);
    expect(fingerprintFor(SIBLING_A, { certified: false })).not.toBe(base);
    expect(fingerprintFor(SIBLING_A, { advertisedPrice: 34995 })).not.toBe(base);
  });

  it("moves every vehicle's fingerprint when only the market moved", () => {
    const weekOne = vehicleValuationFingerprint({
      vin: SIBLING_A, equipmentSignature: cohortKey.equipmentSignature,
      marketSnapshotFingerprint: WEEK_ONE.fingerprint, algorithmVersion: ALGO,
      mileage: 30496, condition: "cpo", certified: true, advertisedPrice: 35788,
    });
    const weekTwo = vehicleValuationFingerprint({
      vin: SIBLING_A, equipmentSignature: cohortKey.equipmentSignature,
      marketSnapshotFingerprint: WEEK_TWO.fingerprint, algorithmVersion: ALGO,
      mileage: 30496, condition: "cpo", certified: true, advertisedPrice: 35788,
    });
    expect(weekTwo).not.toBe(weekOne);
  });

  it("does not let a price change fabricate a new market", () => {
    // The subject's asking price is in the VALUATION fingerprint and nowhere
    // near the snapshot.
    const priced = buildMarketSnapshot({
      cohortKey, observations: WEEK_TWO.observations, ownRooftopExcluded: 2,
      query: { zip: "06120", radiusMiles: 100, carType: "used", milesBand: "22000-38000" },
      algorithmVersion: ALGO,
    });
    expect(priced.fingerprint).toBe(WEEK_TWO.fingerprint);
  });
});

describe("8-11. nothing customer-facing, nothing paid for, nothing copied", () => {
  const plan = planImpactedInventory({
    tenantId: TENANT, cohortKey, subjectVin: SUBJECT, subjectAlreadyEvaluated: true,
    inventory: INVENTORY, pilotVins: PILOT, depth: 0,
  });

  it("causes zero provider calls and zero cost", () => {
    expect(plan.providerCallsCaused).toBe(0);
    expect(plan.providerCostCaused).toBe(0);
    expect(plan.usedSharedEvidence).toBe(true);
  });

  it("marks every planned reevaluation provider-disabled", () => {
    for (const entry of plan.planned) expect(entry.providerPolicy).toBe("disabled");
  });

  it("carries no result from the triggering vehicle", () => {
    const serialized = JSON.stringify(plan);
    for (const field of NEVER_PROPAGATED_FIELDS) {
      expect(serialized, field).not.toContain(field);
    }
    // A plan entry names the VIN, what its evidence may be used for, and why.
    // Still nowhere to put a prediction, a value or a verdict.
    for (const entry of plan.planned) {
      expect(Object.keys(entry).sort()).toEqual([
        "evidenceContextOnly", "providerPolicy", "reasons", "valuationCompatibility", "vin",
      ]);
    }
  });

  it("contains no price, no verdict and no market position at all", () => {
    const serialized = JSON.stringify(plan);
    for (const forbidden of ["35788", "39799", "41200", "above_market", "Limited Market Evidence"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("12. reprocessing the identical snapshot creates no work", () => {
  it("is not material the second time", () => {
    const again = decideMarketChange(WEEK_TWO, WEEK_TWO);
    expect(again.material).toBe(false);
    expect(again.reasons).toContain("market_snapshot_unchanged");
  });

  it("plans nothing for vehicles whose valuation fingerprint already matches", () => {
    const settled = INVENTORY.map((c) => ({
      ...c, lastValuationFingerprint: c.nextValuationFingerprint,
    }));
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey, subjectVin: SUBJECT, subjectAlreadyEvaluated: true,
      inventory: settled, pilotVins: PILOT, depth: 0,
    });
    expect(plan.planned).toEqual([]);
    expect(plan.rejected.find((r) => r.vin === SIBLING_A)?.reasons)
      .toContain("propagation_valuation_fingerprint_unchanged");
  });

  it("is insensitive to comparable ordering", () => {
    const reordered = buildMarketSnapshot({
      cohortKey,
      observations: [...WEEK_TWO.observations].reverse(),
      ownRooftopExcluded: 2,
      query: { zip: "06120", radiusMiles: 100, carType: "used", milesBand: "22000-38000" },
      algorithmVersion: ALGO,
    });
    expect(reordered.fingerprint).toBe(WEEK_TWO.fingerprint);
    expect(decideMarketChange(WEEK_TWO, reordered).material).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("never plans another tenant's vehicle", () => {
    const mixed = [...INVENTORY, { ...candidate(SIBLING_A, {}), tenantId: OTHER_TENANT, vin: "5N1DL1FS0PC900007" }];
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey, subjectVin: SUBJECT, subjectAlreadyEvaluated: true,
      inventory: mixed, pilotVins: [...PILOT, "5N1DL1FS0PC900007"], depth: 0,
    });
    expect(plan.planned.map((p) => p.vin)).not.toContain("5N1DL1FS0PC900007");
    expect(plan.rejected.find((r) => r.vin === "5N1DL1FS0PC900007")?.reasons)
      .toContain("propagation_cross_tenant_refused");
  });

  it("uses the same cohort hash for the same market regardless of tenant", () => {
    // The cohort describes a MARKET, not an owner — so it carries no tenant,
    // and tenant isolation is enforced by the planner and by RLS, not by
    // hiding the market behind a per-tenant hash.
    expect(cohortKeyHash(cohortKey)).toBe(cohortKeyHash(buildCohortKey(COHORT)));
    expect(JSON.stringify(cohortKey)).not.toContain(TENANT);
  });
});
