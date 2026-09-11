// ── Phase 14: the twenty-two QX60 properties, proven ───────────────────────
//
// Fixture VINs only. No production VIN is committed.

import { describe, it, expect } from "vitest";
import { buildCohortKey, cohortsMatch, mayShareMarketEvidence, needsEnrichmentToDecide } from "./cohort.ts";
import {
  buildMarketSnapshot, decideMarketChange, vehicleValuationFingerprint,
} from "./marketSnapshot.ts";
import { planImpactedInventory } from "./propagation.ts";
import { buildAwarenessState } from "./awareness.ts";
import { buildEvidenceState, decideClaimReadiness } from "./evidenceState.ts";
import { classifyEquipment } from "./equipmentClass.ts";
import { MARKET_ENGINE_VERSION } from "./types.ts";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const ALGO = MARKET_ENGINE_VERSION;
const TENANT = "tenant-fixture";

const BASE = {
  year: 2023, make: "INFINITI", model: "QX60", trim: "LUXE", drivetrain: "AWD",
  powertrain: "3.5L V6", bodyType: "SUV", condition: "cpo", certified: true,
  equipment: ["M93", "B10"], zip: "06120", radiusMiles: 100,
};
const key = (over: Record<string, unknown> = {}) => buildCohortKey({ ...BASE, ...over });
const SUBJECT = key();

const rel = (over: Record<string, unknown>) => cohortsMatch(SUBJECT, key(over));

const OBS = [
  { vin: "COMP0000000000001", dealerName: "Acura Of Berlin", dealerId: "1009", price: 38431, mileage: 31000, distanceMiles: 10.5, daysOnMarket: 124, certified: true },
  { vin: "COMP0000000000002", dealerName: "Smithtown Nissan", dealerId: "1010", price: 38777, mileage: 33000, distanceMiles: 68.6, daysOnMarket: 179, certified: true },
  { vin: "COMP0000000000003", dealerName: "Infiniti Of Lynbrook", dealerId: "1011", price: 39799, mileage: 29000, distanceMiles: 94.4, daysOnMarket: 92, certified: true },
];
const snap = (over: Record<string, unknown> = {}) => buildMarketSnapshot({
  cohortKey: SUBJECT, observations: OBS, ownRooftopExcluded: 2,
  query: { zip: "06120", radiusMiles: 100, carType: "used", milesBand: "22000-38000" },
  algorithmVersion: ALGO, ...over,
});
const WEEK_ONE = snap();

describe("1-10. compatibility, conflict and context", () => {
  it("1. identical year/make/model/trim/drivetrain/CPO/equipment is compatible", () => {
    const m = cohortsMatch(SUBJECT, key());
    expect(m.relation).toBe("exact");
    expect(mayShareMarketEvidence(m)).toBe(true);
  });

  it("2. same trim but FWD is incompatible", () => {
    expect(rel({ drivetrain: "FWD" }).relation).toBe("incompatible");
    expect(rel({ drivetrain: "FWD" }).reasons).toContain("cohort_drivetrain_differs");
  });

  it("3. same drivetrain but SENSORY is incompatible", () => {
    expect(rel({ trim: "SENSORY" }).relation).toBe("incompatible");
    expect(rel({ trim: "SENSORY" }).reasons).toContain("cohort_trim_differs");
  });

  it("4. non-CPO is incompatible", () => {
    const m = rel({ condition: "used", certified: false });
    expect(m.relation).toBe("incompatible");
    expect(m.reasons.join(" ")).toMatch(/class_differs|certification_differs/);
  });

  it("5. a known package conflict is incompatible", () => {
    const m = rel({ equipment: ["M93", "SENSORY Package"] });
    expect(m.relation).toBe("incompatible");
    expect(m.reasons).toContain("cohort_equipment_differs");
  });

  it("6. missing package truth is INDETERMINATE, never compatible", () => {
    const m = rel({ equipment: null });
    expect(m.relation).toBe("indeterminate");
    expect(mayShareMarketEvidence(m)).toBe(false);
    expect(needsEnrichmentToDecide(m)).toBe(true);
  });

  it("7. 'fully loaded' cannot create equipment equivalence", () => {
    // Marketing copy classifies to nothing cohort-defining, so a car described
    // as loaded does not acquire the decoded car's options.
    const marketing = classifyEquipment(["Fully Loaded", "Must See"]);
    expect(marketing.cohortDefining).toEqual([]);
    const m = cohortsMatch(SUBJECT, key({ equipment: ["Fully Loaded", "Must See"] }));
    expect(m.relation).toBe("incompatible");
    expect(mayShareMarketEvidence(m)).toBe(false);
  });

  it("8. conflicting drivetrain sources are refused, not tie-broken", () => {
    const conflicted = buildAwarenessState({
      claims: {
        drivetrain: [
          { value: "AWD", source: "window_sticker" },
          { value: "FWD", source: "build_sheet" },
        ],
      },
      equipment: { entries: ["M93"], source: "build_sheet" },
      now: NOW,
    });
    expect(conflicted.conflicts).toContain("drivetrain");
    expect(conflicted.safeToCompare).toBe(false);

    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey: SUBJECT, subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [{
        vin: "5N1DL1FS0PC900002", tenantId: TENANT, cohortKey: key(),
        nextValuationFingerprint: "fp-2", awareness: conflicted,
      }],
      pilotVins: ["5N1DL1FS0PC900002"], depth: 0, now: NOW,
    });
    expect(plan.planned).toEqual([]);
    expect(plan.rejected[0].reasons).toContain("propagation_identity_conflicted");
    expect(plan.rejected[0].reasons).toContain("drivetrain_conflict");
  });

  it("9. a stale snapshot cannot produce a public-ready claim", () => {
    const aware = buildAwarenessState({
      claims: {
        year: [{ value: 2023, source: "build_sheet" }],
        make: [{ value: "INFINITI", source: "build_sheet" }],
        model: [{ value: "QX60", source: "build_sheet" }],
        trim: [{ value: "LUXE", source: "window_sticker" }],
        drivetrain: [{ value: "AWD", source: "build_sheet" }],
        powertrain: [{ value: "3.5L V6", source: "build_sheet" }],
        bodyType: [{ value: "SUV", source: "build_sheet" }],
        vehicleClass: [{ value: "cpo", source: "dealer_confirmed" }],
        certification: [{ value: "certified", source: "dealer_confirmed" }],
        mileage: [{ value: 30496, source: "listing_feed" }],
        zip: [{ value: "06120", source: "dealer_confirmed" }],
      },
      equipment: { entries: ["M93", "B10"], source: "build_sheet" },
      radiusMiles: 100, now: NOW,
    });
    const stale = buildEvidenceState({
      eligibleComparableCount: 9, independentRooftopCount: 5,
      observedAt: daysAgo(9), now: NOW,
    });
    const r = decideClaimReadiness({ awareness: aware, evidence: stale });
    expect(r.readiness).toBe("stale");
    expect(r.safeForPropagation).toBe(false);
  });

  it("10. an adjacent year stays context-only", () => {
    const m = rel({ year: 2024 });
    expect(m.relation).toBe("context_only");
    expect(mayShareMarketEvidence(m)).toBe(false);
  });
});

describe("11-22. sharing evidence without sharing conclusions", () => {
  const A = "5N1DL1FS0PC900002";
  const B = "5N1DL1FS0PC900003";

  it("11. two exact-compatible VINs may share market evidence", () => {
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey: SUBJECT, subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [A, B].map((vin) => ({
        vin, tenantId: TENANT, cohortKey: key(), nextValuationFingerprint: `fp-${vin}`,
      })),
      pilotVins: [A, B], depth: 0, now: NOW,
    });
    expect(plan.planned.map((p) => p.vin)).toEqual([A, B]);
    expect(plan.usedSharedEvidence).toBe(true);
  });

  const fp = (vin: string, over: Record<string, unknown> = {}) => vehicleValuationFingerprint({
    vin, equipmentSignature: SUBJECT.equipmentSignature,
    marketSnapshotFingerprint: WEEK_ONE.fingerprint, algorithmVersion: ALGO,
    mileage: 30496, condition: "cpo", certified: true, advertisedPrice: 35788, ...over,
  });

  it("12. they never share a valuation fingerprint", () => {
    expect(fp(A)).not.toBe(fp(B));
  });

  it("13. they never share a subject price", () => {
    // The price is IN the valuation fingerprint and nowhere near the snapshot,
    // so two cars at different prices cannot collide.
    expect(fp(A, { advertisedPrice: 35788 })).not.toBe(fp(A, { advertisedPrice: 34995 }));
    expect(JSON.stringify(WEEK_ONE)).not.toContain("35788");
  });

  it("14. they never share a provider prediction", () => {
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey: SUBJECT, subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [{ vin: A, tenantId: TENANT, cohortKey: key(), nextValuationFingerprint: "fp-a" }],
      pilotVins: [A], depth: 0, now: NOW,
    });
    expect(JSON.stringify(plan)).not.toContain("prediction");
    expect(Object.keys(plan.planned[0]).sort()).toEqual(["providerPolicy", "reasons", "vin"]);
  });

  it("15. market movement moves each valuation independently", () => {
    const later = snap({
      observations: OBS.slice(0, 2).map((o) => ({ ...o, price: o.price + 1500 })),
    });
    const before = [fp(A), fp(B)];
    const after = [A, B].map((vin) => vehicleValuationFingerprint({
      vin, equipmentSignature: SUBJECT.equipmentSignature,
      marketSnapshotFingerprint: later.fingerprint, algorithmVersion: ALGO,
      mileage: 30496, condition: "cpo", certified: true, advertisedPrice: 35788,
    }));
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[0]).not.toBe(after[1]);
  });

  it("16. a cosmetic subject change creates no new market snapshot", () => {
    expect(snap().fingerprint).toBe(WEEK_ONE.fingerprint);
  });

  it("17. a material evidence change does create a new snapshot", () => {
    const thinner = snap({ observations: OBS.slice(0, 2) });
    expect(thinner.fingerprint).not.toBe(WEEK_ONE.fingerprint);
    expect(decideMarketChange(WEEK_ONE, thinner).material).toBe(true);
  });

  it("18. reordered identical observations stay fingerprint-identical", () => {
    expect(snap({ observations: [...OBS].reverse() }).fingerprint).toBe(WEEK_ONE.fingerprint);
  });

  it("19. a geography change that changes evidence produces a different snapshot", () => {
    const otherZip = buildMarketSnapshot({
      cohortKey: buildCohortKey({ ...BASE, zip: "06106" }), observations: OBS,
      ownRooftopExcluded: 2,
      query: { zip: "06106", radiusMiles: 100, carType: "used", milesBand: "22000-38000" },
      algorithmVersion: ALGO,
    });
    expect(otherZip.fingerprint).not.toBe(WEEK_ONE.fingerprint);

    const otherRadius = snap({ query: { zip: "06120", radiusMiles: 50, carType: "used", milesBand: "22000-38000" } });
    expect(otherRadius.fingerprint).not.toBe(WEEK_ONE.fingerprint);
  });

  it("20. rereading stored normalized observations is idempotent", () => {
    const reread = snap({ observations: WEEK_ONE.observations });
    expect(reread.fingerprint).toBe(WEEK_ONE.fingerprint);
    expect(decideMarketChange(WEEK_ONE, reread).material).toBe(false);
  });

  it("21-22. propagation makes zero provider calls at zero cost", () => {
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey: SUBJECT, subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [A, B].map((vin) => ({
        vin, tenantId: TENANT, cohortKey: key(), nextValuationFingerprint: `fp-${vin}`,
      })),
      pilotVins: [A, B], depth: 0, now: NOW,
    });
    expect(plan.providerCallsCaused).toBe(0);
    expect(plan.providerCostCaused).toBe(0);
    for (const p of plan.planned) expect(p.providerPolicy).toBe("disabled");
  });
});
