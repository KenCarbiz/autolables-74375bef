import { describe, it, expect } from "vitest";
import { SCORE_DOMAINS, SCORE_NEVER_INFLUENCED_BY, SCORE_WEIGHTS } from "./contracts";
import {
  buildVehicleScore, DEFAULT_SCORE_LABEL_BANDS, SCORE_DEDUCTIONS, scoreLabel, VEHICLE_SCORE_VERSION,
  type VehicleScoreInput,
} from "./vehicleScore";
import {
  exactIdentity, fullInput, inspectedCondition, knownProvenance, recall, thinInput, unknownCondition, verifiedTitle,
} from "./scoreFixtures.test";

const domain = (r: ReturnType<typeof buildVehicleScore>, key: string) => r.domains.find((d) => d.key === key)!;

describe("the score has no market input, by construction", () => {
  it("price, value, deal rating, demand and MarketMatch cannot change the Vehicle Score", () => {
    const base = buildVehicleScore(fullInput());
    const marketBag = {
      price: 19_999, asking_price: 19_999, market_value: 31_000, deal_rating: "great_value", market_days_supply: 9,
      sales_velocity: "strong", marketmatch_rank: 1, cheapness: 0.4, incentives: [{ amount: 2_500 }],
    };
    const withMarket = buildVehicleScore({ ...fullInput(), ...marketBag } as unknown as VehicleScoreInput);
    expect(withMarket).toEqual(base);
    // The input type has no slot for any of them, and the contract names them.
    const keys = Object.keys(fullInput());
    for (const k of ["price", "market_value", "deal_rating", "market_days_supply", "marketmatch_rank"]) expect(keys).not.toContain(k);
    for (const banned of ["dealer_price", "deal_rating", "marketmatch", "cheapness", "market_demand"]) {
      expect(SCORE_NEVER_INFLUENCED_BY).toContain(banned);
    }
  });
});

describe("weights and renormalization", () => {
  it("carries the 35/30/20/15 weights and sums them to 100", () => {
    const r = buildVehicleScore(fullInput());
    expect(r.domains.map((d) => [d.key, d.weight])).toEqual([
      ["integrity", 35], ["condition", 30], ["provenance", 20], ["documentation_safety", 15],
    ]);
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(r.reasons).toContain("all_domains_assessed");
    expect(r.version).toBe(VEHICLE_SCORE_VERSION);
  });

  it("drops an unassessed domain and renormalizes the weights over the rest, and says so", () => {
    const r = buildVehicleScore(fullInput({ condition: unknownCondition() }));
    expect(domain(r, "condition").score).toBeNull();
    expect(domain(r, "condition").missing).toContain("no_inspection_on_file");
    const assessed = r.domains.filter((d) => d.score != null);
    const expected = Math.round(assessed.reduce((a, d) => a + d.weight * (d.score as number), 0) / assessed.reduce((a, d) => a + d.weight, 0));
    expect(r.score).toBe(expected);
    expect(r.reasons).toContain("weights_renormalized_over_assessed_domains:integrity,provenance,documentation_safety");
    expect(r.reasons).toContain("domains_not_assessed:condition");
  });

  it("accepts calibrated weights without changing the domain order", () => {
    const r = buildVehicleScore(fullInput(), { weights: { integrity: 40, condition: 25 } });
    expect(r.domains.map((d) => d.weight)).toEqual([40, 25, 20, 15]);
    expect(r.domains.map((d) => d.key)).toEqual([...SCORE_DOMAINS]);
  });
});

describe("missing evidence does not lower the score", () => {
  it("a thin file and a full file with no adverse findings land on the same score", () => {
    const full = buildVehicleScore(fullInput());
    const thin = buildVehicleScore(thinInput());
    expect(full.score).toBe(100);
    expect(thin.score).toBe(100);
    expect(thin.reasons.some((x) => x.startsWith("weights_renormalized"))).toBe(true);
    expect(domain(thin, "integrity").missing).toEqual(["title_not_verified", "odometer_not_checked"]);
  });

  it("a documentation fact known to be absent is evidence, not a finding", () => {
    const r = buildVehicleScore(fullInput({ documentation: { serviceRecordCount: 0, inspectionEvidenceOnFile: false, warrantyDocumented: false, windowStickerOnFile: false } }));
    expect(domain(r, "documentation_safety").score).toBe(100);
    expect(domain(r, "documentation_safety").evidence).toContain("warranty_documented_absent");
    expect(domain(r, "documentation_safety").adverse).toEqual([]);
  });
});

describe("adverse evidence lowers the correct domain only", () => {
  it("a title brand lowers integrity and nothing else", () => {
    const clean = buildVehicleScore(fullInput());
    const branded = buildVehicleScore(fullInput({ titleOdometer: verifiedTitle({ state: "ADVERSE", titleBrandsReported: ["FLOOD"] }) }));
    expect(domain(branded, "integrity").score).toBe(100 - SCORE_DEDUCTIONS.integrity.titleBrand);
    expect(domain(branded, "integrity").adverse).toEqual(["title_brand:FLOOD"]);
    for (const key of ["condition", "provenance", "documentation_safety"]) {
      expect(domain(branded, key).score).toBe(domain(clean, key).score);
    }
    expect(branded.score).toBeLessThan(clean.score as number);
  });

  it("junk, salvage or total loss takes integrity to the floor of the brand scale", () => {
    const r = buildVehicleScore(fullInput({ titleOdometer: verifiedTitle({ state: "ADVERSE", titleBrandsReported: ["SALVAGE"], junkSalvageTotalLossReported: ["SALVAGE"] }) }));
    expect(domain(r, "integrity").score).toBe(100 - SCORE_DEDUCTIONS.integrity.junkSalvageTotalLoss);
    expect(domain(r, "integrity").adverse).toEqual(["junk_salvage_total_loss:SALVAGE"]);
  });

  it("an odometer rollback lowers integrity more than a conflict", () => {
    const conflict = buildVehicleScore(fullInput({ titleOdometer: verifiedTitle({ state: "REVIEW_REQUIRED", odometerStatus: "conflict" }) }));
    const rollback = buildVehicleScore(fullInput({ titleOdometer: verifiedTitle({ state: "ADVERSE", odometerStatus: "rollback_indicated" }) }));
    expect(domain(conflict, "integrity").score).toBe(100 - SCORE_DEDUCTIONS.integrity.odometerConflict - SCORE_DEDUCTIONS.integrity.reviewRequired);
    expect(domain(rollback, "integrity").score).toBe(100 - SCORE_DEDUCTIONS.integrity.odometerRollback);
    expect(domain(conflict, "condition").score).toBe(100);
  });

  it("an open recall lowers documentation and safety and nothing else", () => {
    const r = buildVehicleScore(fullInput({ recall: recall({ vinState: "OPEN", truthState: "OPEN", openCount: 2, publicState: "adverse" }) }));
    expect(domain(r, "documentation_safety").score).toBe(100 - Math.min(SCORE_DEDUCTIONS.documentation_safety.openRecallCap, 2 * SCORE_DEDUCTIONS.documentation_safety.openRecall));
    expect(domain(r, "documentation_safety").adverse).toEqual(["vin_recall_open:2"]);
    expect(domain(r, "integrity").score).toBe(100);
    expect(domain(r, "condition").score).toBe(100);
  });

  it("a do-not-drive campaign takes documentation and safety to zero, never below", () => {
    const r = buildVehicleScore(fullInput({ recall: recall({ vinState: "OPEN", openCount: 1, doNotDrive: true }) }));
    expect(domain(r, "documentation_safety").score).toBe(0);
  });

  it("a major open condition finding lowers condition and nothing else", () => {
    const r = buildVehicleScore(fullInput({ condition: inspectedCondition({ findings: [{ severity: "major", label: "Transmission leak", resolved: false }], openItems: 1 }) }));
    expect(domain(r, "condition").score).toBe(100 - SCORE_DEDUCTIONS.condition.majorFinding);
    expect(domain(r, "condition").adverse).toEqual(["major_findings_open:1"]);
    expect(domain(r, "integrity").score).toBe(100);
    expect(domain(r, "provenance").score).toBe(100);
  });

  it("a resolved finding is evidence of work done, not a deduction", () => {
    const r = buildVehicleScore(fullInput({ condition: inspectedCondition({ findings: [{ severity: "major", label: "Brake pads", resolved: true }] }) }));
    expect(domain(r, "condition").score).toBe(100);
    expect(domain(r, "condition").evidence).toContain("findings_resolved:1");
  });

  it("worn tires and brakes are findings; a seller self-report is capped, not deducted", () => {
    const worn = buildVehicleScore(fullInput({ condition: inspectedCondition({ tires32nds: [3, 8, 8, 8], brakesMm: [2.5, 7] }) }));
    expect(domain(worn, "condition").score).toBe(100 - SCORE_DEDUCTIONS.condition.tireWorn - SCORE_DEDUCTIONS.condition.brakeWorn);
    const self = buildVehicleScore(fullInput({ condition: inspectedCondition({ state: "self_reported", source: "seller_report" }) }));
    expect(domain(self, "condition").score).toBe(SCORE_DEDUCTIONS.condition.selfReportCeiling);
    expect(domain(self, "condition").adverse).toEqual([]);
  });

  it("provenance scores the depth of the dealer's relationship, with no adverse entries", () => {
    const sinceNew = buildVehicleScore(fullInput());
    const firstSeen = buildVehicleScore(fullInput({ provenance: knownProvenance({ designation: "first_seen", soldHere: false, servicedHere: false, serviceVisits: 0, autofilmInspections: 1, directTrade: false, facts: [] }) }));
    expect(domain(sinceNew, "provenance").score).toBe(100);
    expect(domain(firstSeen, "provenance").score).toBe(SCORE_DEDUCTIONS.provenance.base.first_seen);
    expect(domain(firstSeen, "provenance").adverse).toEqual([]);
  });
});

describe("who gets a score", () => {
  it("a new vehicle gets no used score", () => {
    const r = buildVehicleScore(fullInput({ vehicleType: "new" }));
    expect(r).toMatchObject({ applicable: false, score: null, label: null, domains: [] });
    expect(r.reasons).toEqual(["vehicle_type_new_no_used_score"]);
  });

  it("a vehicle identified below exact cannot carry a score", () => {
    for (const level of ["YMMT", "YMM", "GENERIC_CANDIDATE", "UNKNOWN"] as const) {
      const r = buildVehicleScore(fullInput({ identity: exactIdentity({ matchLevel: level, factoryVerified: false }) }));
      expect(r.score, level).toBeNull();
      expect(r.applicable).toBe(true);
      expect(r.reasons).toEqual([`identity_not_exact:${level}`]);
    }
    expect(buildVehicleScore(fullInput({ identity: exactIdentity({ matchLevel: "EXACT_BUILD" }) })).score).toBe(100);
  });
});

describe("labels", () => {
  it("map bands on the default boundaries and accept overrides", () => {
    expect(scoreLabel(95)).toBe("Outstanding");
    expect(scoreLabel(90)).toBe("Outstanding");
    expect(scoreLabel(85)).toBe("Excellent");
    expect(scoreLabel(72)).toBe("Good");
    expect(scoreLabel(60)).toBe("Fair");
    expect(scoreLabel(59)).toBe("Caution");
    expect(scoreLabel(null)).toBeNull();
    expect(scoreLabel(85, { ...DEFAULT_SCORE_LABEL_BANDS, excellent: 86 })).toBe("Good");
    const r = buildVehicleScore(fullInput({ titleOdometer: verifiedTitle({ state: "REVIEW_REQUIRED" }) }), { labelBands: { outstanding: 96 } });
    expect(r.score).toBe(95);
    expect(r.label).toBe("Excellent");
  });
});
