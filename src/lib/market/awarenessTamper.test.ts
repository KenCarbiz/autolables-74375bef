// ── Phase 18: what future code must not be able to do by accident ──────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildAwarenessState, AUTHORITATIVE_SOURCES } from "./awareness.ts";
import { buildCohortKey, cohortsMatch, mayShareMarketEvidence } from "./cohort.ts";
import { classifyEquipment } from "./equipmentClass.ts";
import { buildMarketSnapshot, vehicleValuationFingerprint } from "./marketSnapshot.ts";
import { planImpactedInventory, MAX_PROPAGATION_DEPTH, MAX_PLAN_PER_INVOCATION } from "./propagation.ts";
import { buildEvidenceState, decideClaimReadiness, MARKET_LANGUAGE, assertsComparison } from "./evidenceState.ts";
import { MAX_SHADOW_COHORT } from "./shadowPipeline.ts";
import { MARKET_ENGINE_VERSION } from "./types.ts";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const code = (p: string) => readFileSync(p, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BASE = {
  year: 2023, make: "INFINITI", model: "QX60", trim: "LUXE", drivetrain: "AWD",
  powertrain: "3.5L V6", bodyType: "SUV", condition: "cpo", certified: true,
  equipment: ["M93"], zip: "06120", radiusMiles: 100,
};
const key = (over: Record<string, unknown> = {}) => buildCohortKey({ ...BASE, ...over });

describe("unknown cannot become verified", () => {
  it("a missing field stays missing however many weak sources repeat it", () => {
    const a = buildAwarenessState({
      claims: { trim: [
        { value: null }, { value: undefined }, { value: "  " },
      ] },
      now: NOW,
    });
    expect(a.fields.trim.status).toBe("missing");
    expect(a.unknown).toContain("trim");
  });

  it("equipment from a non-authoritative source never becomes verified", () => {
    for (const source of ["listing_feed", "derived", "marketing_description", "none"] as const) {
      const a = buildAwarenessState({
        claims: {}, equipment: { entries: ["M93", "B10"], source }, now: NOW,
      });
      expect(a.fields.equipment.status, source).toBe("missing");
      expect(a.equipmentSignature, source).toBeNull();
    }
    // And only these three may.
    expect(AUTHORITATIVE_SOURCES).toEqual(["window_sticker", "build_sheet", "dealer_confirmed"]);
  });
});

describe("indeterminate cannot become compatible", () => {
  it("unknown equipment is never shareable, on either side", () => {
    for (const pair of [
      [key(), key({ equipment: null })],
      [key({ equipment: null }), key()],
      [key({ equipment: null }), key({ equipment: undefined })],
    ] as const) {
      const m = cohortsMatch(pair[0], pair[1]);
      expect(m.relation).toBe("indeterminate");
      expect(mayShareMarketEvidence(m)).toBe(false);
    }
  });

  it("the planner files it separately and plans nothing for it", () => {
    const plan = planImpactedInventory({
      tenantId: "t", cohortKey: key(), subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [{
        vin: "5N1DL1FS0PC900002", tenantId: "t",
        cohortKey: key({ equipment: null }), nextValuationFingerprint: "fp",
      }],
      pilotVins: ["5N1DL1FS0PC900002"], depth: 0, now: NOW,
    });
    expect(plan.planned).toEqual([]);
    expect(plan.indeterminate).toHaveLength(1);
    expect(plan.rejected).toHaveLength(0);
  });

  it("only `exact` is ever shareable — asserted on the predicate itself", () => {
    const src = code("src/lib/market/cohort.ts");
    expect(src).toContain('mayShareMarketEvidence = (m: CohortMatch): boolean => m.relation === "exact"');
  });
});

describe("description copy cannot become equipment truth", () => {
  it("marketing phrases classify to nothing cohort-defining", () => {
    for (const phrase of ["Fully Loaded", "every option", "Must See", "Like New", "rare find"]) {
      expect(classifyEquipment([phrase]).cohortDefining, phrase).toEqual([]);
    }
  });

  it("the awareness model refuses a marketing source outright", () => {
    const a = buildAwarenessState({
      claims: { trim: [{ value: "LUXE", source: "marketing_description" }] }, now: NOW,
    });
    expect(a.fields.trim.status).toBe("missing");
    expect(a.fields.trim.reasons).toContain("identity_marketing_copy_refused");
  });
});

describe("cohort dimensions cannot collapse", () => {
  it("AWD and FWD stay apart", () => {
    expect(cohortsMatch(key(), key({ drivetrain: "FWD" })).relation).toBe("incompatible");
  });

  it("CPO and non-CPO stay apart", () => {
    expect(cohortsMatch(key(), key({ condition: "used", certified: false })).relation).toBe("incompatible");
  });

  it("incompatible trims stay apart", () => {
    for (const trim of ["SENSORY", "Sport", "AUTOGRAPH", "PURE"]) {
      expect(cohortsMatch(key(), key({ trim })).relation, trim).toBe("incompatible");
    }
  });

  it("no equality is weakened to a substring or similarity test", () => {
    const src = code("src/lib/market/cohort.ts");
    for (const weak of ["includes(", "startswith(", "indexof(", "similarity", "levenshtein"]) {
      expect(src.toLowerCase(), weak).not.toContain(weak);
    }
  });
});

describe("nothing subject-specific crosses between vehicles", () => {
  it("a VIN never enters the shared snapshot", () => {
    const snap = buildMarketSnapshot({
      cohortKey: key(),
      observations: [{ vin: "COMP0000000000001", dealerName: "X", price: 100 }],
      algorithmVersion: MARKET_ENGINE_VERSION,
    });
    // The cohort key carries none, and the fingerprint block takes no subject.
    expect(JSON.stringify(key())).not.toMatch(/5N1DL1FS0PC/);
    const src = code("src/lib/market/marketSnapshot.ts");
    const block = src.slice(src.indexOf('kind: "market_snapshot"'));
    const fingerprintBlock = block.slice(0, block.indexOf("});"));
    for (const forbidden of ["subjectVin", "advertisedPrice", "internalComparisonPrice"]) {
      expect(fingerprintBlock, forbidden).not.toContain(forbidden);
    }
    expect(snap.fingerprint).toHaveLength(16);
  });

  it("a VIN can never be removed from the valuation fingerprint", () => {
    const a = vehicleValuationFingerprint({
      vin: "5N1DL1FS0PC900002", equipmentSignature: "e",
      marketSnapshotFingerprint: "s", algorithmVersion: MARKET_ENGINE_VERSION,
    });
    const b = vehicleValuationFingerprint({
      vin: "5N1DL1FS0PC900003", equipmentSignature: "e",
      marketSnapshotFingerprint: "s", algorithmVersion: MARKET_ENGINE_VERSION,
    });
    expect(a).not.toBe(b);
    const src = code("src/lib/market/marketSnapshot.ts");
    expect(src).toMatch(/vin: input\.vin\.trim\(\)\.toUpperCase\(\)/);
  });
});

describe("propagation cannot spend, recurse, cross or overflow", () => {
  const plan = (over: Partial<Parameters<typeof planImpactedInventory>[0]> = {}) =>
    planImpactedInventory({
      tenantId: "t", cohortKey: key(), subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [{ vin: "5N1DL1FS0PC900002", tenantId: "t", cohortKey: key(), nextValuationFingerprint: "fp" }],
      pilotVins: ["5N1DL1FS0PC900002"], depth: 0, now: NOW, ...over,
    });

  it("contains no spend symbol at all", () => {
    const src = code("src/lib/market/propagation.ts");
    for (const spend of ["fetch(", "MC_KEY", "market_reserve_provider_call", "callProvider", "budget", "predictionUrl"]) {
      expect(src, spend).not.toContain(spend);
    }
    expect(plan().providerCostCaused).toBe(0);
  });

  it("cannot recurse beyond one hop", () => {
    expect(MAX_PROPAGATION_DEPTH).toBe(1);
    expect(plan({ depth: 1 }).planned).toEqual([]);
  });

  it("cannot cross a tenant", () => {
    const p = plan({
      inventory: [{ vin: "5N1DL1FS0PC900002", tenantId: "other", cohortKey: key(), nextValuationFingerprint: "fp" }],
    });
    expect(p.planned).toEqual([]);
    expect(p.rejected[0].reasons).toEqual(["propagation_cross_tenant_refused"]);
  });

  it("cannot exceed the pilot cohort or the fan-out cap", () => {
    const many = Array.from({ length: MAX_SHADOW_COHORT + 5 }, (_, i) => `5N1DL1FS0PC9${String(10000 + i)}`);
    expect(plan({ pilotVins: many }).reasons).toContain("propagation_pilot_cohort_too_large");

    const inventory = many.slice(0, MAX_SHADOW_COHORT).map((vin) => ({
      vin, tenantId: "t", cohortKey: key(), nextValuationFingerprint: `fp-${vin}`,
    }));
    const capped = plan({ inventory, pilotVins: inventory.map((c) => c.vin) });
    expect(capped.planned.length).toBe(MAX_PLAN_PER_INVOCATION);
    expect(capped.continuationCursor).not.toBeNull();
  });
});

describe("stale and context-only evidence cannot become public", () => {
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
      mileage: [{ value: 1, source: "listing_feed" }],
      zip: [{ value: "06120", source: "dealer_confirmed" }],
    },
    equipment: { entries: ["M93"], source: "build_sheet" }, radiusMiles: 100, now: NOW,
  });

  it("stale evidence is never eligible, however strong it was", () => {
    const r = decideClaimReadiness({
      awareness: aware,
      evidence: buildEvidenceState({
        eligibleComparableCount: 50, independentRooftopCount: 20,
        observedAt: new Date(NOW - 30 * 86_400_000).toISOString(), now: NOW,
      }),
    });
    expect(r.readiness).toBe("stale");
    expect(assertsComparison(MARKET_LANGUAGE[r.readiness])).toBe(false);
  });

  it("context-only evidence never becomes a public claim", () => {
    const r = decideClaimReadiness({
      awareness: aware,
      evidence: buildEvidenceState({
        eligibleComparableCount: 9, independentRooftopCount: 5,
        observedAt: new Date(NOW - 3_600_000).toISOString(), now: NOW,
      }),
      contextOnlyEvidence: true,
    });
    expect(r.readiness).toBe("context_only");
    expect(MARKET_LANGUAGE[r.readiness]).toBe("Market comparison currently unavailable.");
  });
});

describe("no model may override the deterministic engine", () => {
  it("the readiness and language modules contain no generation step", () => {
    for (const file of [
      "src/lib/market/evidenceState.ts",
      "src/lib/market/awareness.ts",
      "src/lib/market/cohort.ts",
      "src/lib/market/propagation.ts",
    ]) {
      const src = code(file).toLowerCase();
      for (const generative of ["openai", "anthropic", "llm", "prompt", "completion", "gpt", "claude"]) {
        expect(src, `${file}: ${generative}`).not.toContain(generative);
      }
    }
  });

  it("every readiness state maps to a fixed sentence that asserts no comparison", () => {
    for (const [state, copy] of Object.entries(MARKET_LANGUAGE)) {
      expect(assertsComparison(copy), state).toBe(false);
    }
  });

  it("a comparative phrase is detectable wherever it comes from", () => {
    for (const generated of [
      "This QX60 is $1,200 below market!",
      "Great price on this one",
      "BEST DEAL in Hartford",
    ]) {
      expect(assertsComparison(generated), generated).toBe(true);
    }
  });
});
