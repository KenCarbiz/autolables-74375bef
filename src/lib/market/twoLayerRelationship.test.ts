// ── Same market, different equipment ───────────────────────────────────────
//
// Ken's real pair, with the option lists the feed actually holds. One has a
// Vision Package and a BOSE Performance Package; the other does not. They are
// not interchangeable — and they are unmistakably in the same market, so when
// two competing 2023 QX60 LUXEs leave and prices rise, both must look again.
//
// Fixture VINs. No production VIN is committed.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildCohortKey, equipmentSignature, equipmentDifference, EQUIPMENT_UNKNOWN } from "./cohort.ts";
import {
  marketAwarenessRelationship, valuationCompatibility, describeEquipmentGap,
  mayReceiveMarketAwareness, mayServeAsPrimaryComparable, isContextOnlyEvidence,
  needsEquipmentEvidence, mayContributeToMarketValue, COMPATIBILITY_LABEL,
  VALUE_BEARING_COMPATIBILITIES,
} from "./relationship.ts";
import { planImpactedInventory } from "./propagation.ts";
import { buildMarketSnapshot, decideMarketChange } from "./marketSnapshot.ts";
import { MARKET_ENGINE_VERSION } from "./types.ts";

const TENANT = "tenant-fixture";

/** Vehicle A — Vision Package, BOSE Performance Package, six factory codes. */
const A_EQUIPMENT = [
  "B92", "B93", "B96", "H01", "M92", "V01",
  "BOSE Performance Package", "Vision Package",
  "Cargo Package (PIO)", "Cross Bar Silver (PIO)", "Splash Guards (PIO)",
  "Radiant Grille Emblem",
];
/** Vehicle B — three factory codes, no material packages. */
const B_EQUIPMENT = [
  "B92", "E10", "M92",
  "Cargo Package (PIO)", "Splash Guards (PIO)", "Premium Paint",
];

const CORE = {
  year: 2023, make: "INFINITI", model: "QX60", trim: "LUXE",
  drivetrain: "AWD", powertrain: "3.5L V6", bodyType: "SUV",
  condition: "cpo", certified: true, zip: "06120", radiusMiles: 100,
};
const A = buildCohortKey({ ...CORE, equipment: A_EQUIPMENT });
const B = buildCohortKey({ ...CORE, equipment: B_EQUIPMENT });

describe("Phase 4 — Ken's QX60 pair, decided", () => {
  const market = marketAwarenessRelationship(A, B);
  const comparable = valuationCompatibility(A, B);

  it("market-awareness relationship is same_market", () => {
    expect(market.relationship).toBe("same_market");
    expect(mayReceiveMarketAwareness(market)).toBe(true);
    expect(market.reasons).toContain("market_same");
    // Said out loud, so equipment cannot creep back into the market question.
    expect(market.reasons).toContain("market_equipment_differs_but_market_is_shared");
  });

  it("valuation compatibility is adjustment_required", () => {
    expect(comparable.compatibility).toBe("adjustment_required");
    expect(comparable.awareness).toBe("same_market");
  });

  it("propagation is permitted", () => {
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey: A, subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [{ vin: "5N1DL1FS0PC900002", tenantId: TENANT, cohortKey: B, nextValuationFingerprint: "fp-b" }],
      pilotVins: ["5N1DL1FS0PC900002"], depth: 0,
    });
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0].valuationCompatibility).toBe("adjustment_required");
  });

  it("unadjusted primary-comparable eligibility is NO", () => {
    expect(mayServeAsPrimaryComparable(comparable)).toBe(false);
    expect(mayContributeToMarketValue(comparable.compatibility)).toBe(false);
    expect(VALUE_BEARING_COMPATIBILITIES).toEqual(["exact"]);
  });

  it("evidence use is context-only", () => {
    expect(isContextOnlyEvidence(comparable)).toBe(true);
    expect(comparable.reasons).toContain("comparable_context_only_until_adjustment_approved");
  });

  it("no dollar equipment adjustment is produced anywhere", () => {
    const gap = describeEquipmentGap(A_EQUIPMENT, B_EQUIPMENT);
    expect(gap.known).toBe(true);
    // It names the packages. It prices nothing.
    expect(gap.onlyInSubject).toContain("vision package");
    expect(gap.onlyInSubject).toContain("bose performance package");
    expect(gap.onlyInCandidate).toContain("e10");
    expect(gap.shared).toContain("b92");
    expect(gap.shared).toContain("m92");
    for (const key of Object.keys(gap)) {
      expect(["known", "onlyInSubject", "onlyInCandidate", "shared", "reasons"]).toContain(key);
    }
    // Comments AND the label table excised. `COMPATIBILITY_LABEL` contains the
    // words "not price-adjusted", which is the sentence whose whole job is to
    // say no price adjustment happened — a guard that fires on it would push
    // someone to delete the warning.
    const src = readFileSync("src/lib/market/relationship.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/export const COMPATIBILITY_LABEL[\s\S]*?\n\};/, "")
      .toLowerCase();
    for (const money of [
      "msrp", "depreciation", "residual", "adjustmentusd", "adjustment_usd",
      "dollar", "usd", "amount", "* 0.", "tomoney", "currency",
    ]) {
      expect(src, money).not.toContain(money);
    }
    // And no arithmetic on a price at all.
    expect(src).not.toMatch(/price\s*[-+*/]/);
  });

  it("a public market claim from this relationship is prohibited", () => {
    expect(comparable.reasons).toContain("comparable_adjustment_method_not_approved");
    expect(COMPATIBILITY_LABEL.adjustment_required)
      .toBe("Same market — equipment differs, not price-adjusted");
    // Never rendered as a bare "comparable".
    expect(COMPATIBILITY_LABEL.adjustment_required).toMatch(/not price-adjusted/);
  });

  it("independent reevaluation is required when the shared snapshot changes", () => {
    const obs = [
      { vin: "COMP0000000000001", dealerName: "Acura Of Berlin", dealerId: "9", price: 38431 },
      { vin: "COMP0000000000002", dealerName: "Smithtown Nissan", dealerId: "10", price: 38777 },
      { vin: "COMP0000000000003", dealerName: "Infiniti Of Lynbrook", dealerId: "11", price: 39799 },
    ];
    const before = buildMarketSnapshot({ cohortKey: A, observations: obs, algorithmVersion: MARKET_ENGINE_VERSION });
    const after = buildMarketSnapshot({
      cohortKey: A, observations: obs.slice(0, 2).map((o) => ({ ...o, price: o.price + 1500 })),
      algorithmVersion: MARKET_ENGINE_VERSION,
    });
    const change = decideMarketChange(before, after);
    expect(change.material).toBe(true);
    expect(change.reasons).toContain("market_competitors_left_1");

    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey: A, subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [{ vin: "5N1DL1FS0PC900002", tenantId: TENANT, cohortKey: B, nextValuationFingerprint: "fp-new" }],
      pilotVins: ["5N1DL1FS0PC900002"], depth: 0,
    });
    expect(plan.planned.map((p) => p.vin)).toEqual(["5N1DL1FS0PC900002"]);
    expect(plan.providerCallsCaused).toBe(0);
    expect(plan.providerCostCaused).toBe(0);
  });
});

describe("Phase 4 — market-defining differences stay out of the cohort", () => {
  const variant = (over: Record<string, unknown>) =>
    buildCohortKey({ ...CORE, equipment: A_EQUIPMENT, ...over });

  it.each([
    ["trim", { trim: "SENSORY" }, "market_trim_differs"],
    ["drivetrain", { drivetrain: "FWD" }, "market_drivetrain_differs"],
    ["powertrain", { powertrain: "2.0L I4 Hybrid" }, "market_powertrain_differs"],
    ["body", { bodyType: "Sedan" }, "market_body_differs"],
    ["class", { condition: "used", certified: false }, "market_class_differs"],
    ["geography", { zip: "06106" }, "market_geography_differs"],
    ["radius", { radiusMiles: 50 }, "market_radius_differs"],
  ])("a different %s is a different market", (_label, over, reason) => {
    const m = marketAwarenessRelationship(A, variant(over));
    expect(m.relationship).toBe("different_market");
    expect(m.reasons).toContain(reason);
    expect(mayReceiveMarketAwareness(m)).toBe(false);

    const c = valuationCompatibility(A, variant(over));
    expect(c.compatibility).toBe("incompatible");
    expect(mayServeAsPrimaryComparable(c)).toBe(false);
  });

  it("a certification-class difference alone is a different market", () => {
    const nonCpo = buildCohortKey({ ...CORE, equipment: A_EQUIPMENT, condition: "used", certified: false });
    const m = marketAwarenessRelationship(A, nonCpo);
    expect(m.relationship).toBe("different_market");
    expect(mayReceiveMarketAwareness(m)).toBe(false);
  });

  it("an adjacent model year is a related market, never the same one", () => {
    const m = marketAwarenessRelationship(A, buildCohortKey({ ...CORE, year: 2024, equipment: A_EQUIPMENT }));
    expect(m.relationship).toBe("related_market");
    expect(mayReceiveMarketAwareness(m)).toBe(false);
    expect(valuationCompatibility(A, buildCohortKey({ ...CORE, year: 2024, equipment: A_EQUIPMENT })).compatibility)
      .toBe("context_only");
  });
});

describe("Phase 2 — descriptive equipment must not fracture a cohort", () => {
  it("PIO accessories, paint and emblems do not change the signature", () => {
    const plain = equipmentSignature(["B92", "E10", "M92"]);
    const dressed = equipmentSignature([
      "B92", "E10", "M92",
      "Cargo Package (PIO)", "Splash Guards (PIO)", "Premium Paint",
      "Radiant Grille Emblem", "Floor Mats", "Wheel Locks",
    ]);
    expect(dressed).toBe(plain);
  });

  it("two cars differing only in accessories are EXACT comparables", () => {
    const bare = buildCohortKey({ ...CORE, equipment: ["B92", "E10", "M92"] });
    const accessorised = buildCohortKey({ ...CORE, equipment: B_EQUIPMENT });
    const c = valuationCompatibility(bare, accessorised);
    expect(c.compatibility).toBe("exact");
    expect(mayServeAsPrimaryComparable(c)).toBe(true);
  });

  it("a material package DOES change the signature", () => {
    expect(equipmentSignature(["B92", "E10", "M92", "Vision Package"]))
      .not.toBe(equipmentSignature(["B92", "E10", "M92"]));
  });

  it("missing equipment is not empty equipment", () => {
    expect(equipmentSignature(null)).toBe(EQUIPMENT_UNKNOWN);
    expect(equipmentSignature([])).toBe(EQUIPMENT_UNKNOWN);
    // Decoded, and genuinely no material options: an answer, not a silence.
    expect(equipmentSignature(["Premium Paint", "Floor Mats"])).not.toBe(EQUIPMENT_UNKNOWN);
    expect(equipmentDifference(null, ["B92"]).known).toBe(false);
  });
});

describe("Phase 6 — what each relationship is allowed to do", () => {
  const bare = buildCohortKey({ ...CORE, equipment: ["B92", "E10", "M92"] });
  const undecoded = buildCohortKey({ ...CORE, equipment: null });

  it("only exact may contribute to a market value", () => {
    for (const c of ["exact", "adjustment_required", "context_only", "indeterminate", "incompatible"] as const) {
      expect(mayContributeToMarketValue(c), c).toBe(c === "exact");
    }
  });

  it("adjustment_required and context_only are evidence, not values", () => {
    expect(isContextOnlyEvidence(valuationCompatibility(A, B))).toBe(true);
    expect(isContextOnlyEvidence(valuationCompatibility(A, buildCohortKey({ ...CORE, year: 2024, equipment: A_EQUIPMENT })))).toBe(true);
    expect(isContextOnlyEvidence(valuationCompatibility(bare, bare))).toBe(false);
  });

  it("indeterminate is a work item, never an upgrade", () => {
    const c = valuationCompatibility(A, undecoded);
    expect(c.compatibility).toBe("indeterminate");
    expect(needsEquipmentEvidence(c)).toBe(true);
    expect(mayServeAsPrimaryComparable(c)).toBe(false);
    expect(c.reasons).toContain("comparable_equipment_enrichment_would_resolve");
    // And it is STILL the same market, which is why it gets a fresh look.
    expect(c.awareness).toBe("same_market");
  });

  it("incompatible can neither propagate nor contribute", () => {
    const fwd = buildCohortKey({ ...CORE, drivetrain: "FWD", equipment: A_EQUIPMENT });
    const c = valuationCompatibility(A, fwd);
    expect(c.compatibility).toBe("incompatible");
    expect(mayReceiveMarketAwareness(marketAwarenessRelationship(A, fwd))).toBe(false);
    expect(mayContributeToMarketValue(c.compatibility)).toBe(false);
  });

  it("every compatibility has a label that cannot be mistaken for a price", () => {
    expect(Object.keys(COMPATIBILITY_LABEL).sort()).toEqual([
      "adjustment_required", "context_only", "exact", "incompatible", "indeterminate",
    ]);
    for (const [state, label] of Object.entries(COMPATIBILITY_LABEL)) {
      expect(label, state).not.toMatch(/\$|below|above|worth|value of/i);
    }
  });

  it("no generative model may decide either relationship", () => {
    const src = readFileSync("src/lib/market/relationship.ts", "utf8").toLowerCase();
    for (const generative of ["openai", "anthropic", "llm", "prompt", "completion", "gpt"]) {
      expect(src, generative).not.toContain(generative);
    }
  });
});

describe("tamper: adjustment_required cannot become an unadjusted comparable", () => {
  it("is refused by the predicate, whatever else is true", () => {
    const c = valuationCompatibility(A, B);
    expect(mayServeAsPrimaryComparable(c)).toBe(false);
    expect(mayServeAsPrimaryComparable({ ...c, compatibility: "exact" })).toBe(true);
    // The predicate is a single equality; there is no second condition to
    // satisfy that could let adjustment_required through.
    const src = readFileSync("src/lib/market/relationship.ts", "utf8");
    expect(src).toContain('mayServeAsPrimaryComparable = (m: CompatibilityMatch): boolean =>\n  m.compatibility === "exact"');
  });

  it("is marked context-only on the plan itself", () => {
    const plan = planImpactedInventory({
      tenantId: TENANT, cohortKey: A, subjectVin: "5N1DL1FS0PC900001",
      subjectAlreadyEvaluated: true,
      inventory: [{ vin: "5N1DL1FS0PC900002", tenantId: TENANT, cohortKey: B, nextValuationFingerprint: "fp" }],
      pilotVins: ["5N1DL1FS0PC900002"], depth: 0,
    });
    expect(plan.planned[0].evidenceContextOnly).toBe(true);
  });

  it("the value-bearing list has exactly one member", () => {
    expect(VALUE_BEARING_COMPATIBILITIES).toHaveLength(1);
    expect(VALUE_BEARING_COMPATIBILITIES[0]).toBe("exact");
  });
});
