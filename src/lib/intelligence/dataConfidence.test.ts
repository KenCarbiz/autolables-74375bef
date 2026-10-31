import { describe, it, expect } from "vitest";
import { buildDataConfidence, DATA_CONFIDENCE_RULES, DATA_CONFIDENCE_VERSION, DEFAULT_DATA_CONFIDENCE_BANDS } from "./dataConfidence";
import { buildVehicleScore } from "./vehicleScore";
import {
  exactIdentity, fullInput, inspectedCondition, knownProvenance, recall, stale, thinInput, verifiedTitle,
} from "./scoreFixtures.test";

describe("coverage and the public level", () => {
  it("a full, fresh, authoritative file is HIGH; a thin one is LIMITED", () => {
    const full = buildDataConfidence(fullInput());
    expect(full.level).toBe("high");
    expect(full.coveragePct).toBe(100);
    expect(full.version).toBe(DATA_CONFIDENCE_VERSION);
    expect(full.domainCoverage).toEqual({ integrity: 100, condition: 100, provenance: 100, documentation_safety: 100 });
    const thin = buildDataConfidence(thinInput());
    expect(thin.level).toBe("limited");
    expect(thin.coveragePct).toBeLessThan(DEFAULT_DATA_CONFIDENCE_BANDS.moderate);
    expect(thin.reasons.some((r) => r.startsWith("missing_facts:"))).toBe(true);
  });

  it("partial evidence is MODERATE, and the bands are configurable", () => {
    const partialInput = fullInput({
      condition: inspectedCondition({ tires32nds: [], brakesMm: [] }),
      provenance: knownProvenance({ serviceVisits: null, autofilmInspections: null }),
    });
    const partial = buildDataConfidence(partialInput);
    expect(partial.level).toBe("moderate");
    expect(partial.coveragePct).toBe(75);
    expect(partial.domainCoverage).toEqual({ integrity: 100, condition: 50, provenance: 50, documentation_safety: 100 });
    expect(buildDataConfidence(fullInput(), { bands: { high: 101 } }).level).toBe("moderate");
    expect(buildDataConfidence(partialInput, { bands: { high: 70 } }).level).toBe("high");
  });
});

describe("missing evidence moves confidence, not the score", () => {
  it("a thin file earns no score or label and loses confidence; it is never scored worse for missing evidence", () => {
    const fullScore = buildVehicleScore(fullInput());
    const thinScore = buildVehicleScore(thinInput());
    expect(fullScore.label).not.toBeNull();
    expect(thinScore.score).toBeNull();
    expect(thinScore.label).toBeNull();
    expect(buildDataConfidence(fullInput()).level).toBe("high");
    expect(buildDataConfidence(thinInput()).level).toBe("limited");
  });
});

describe("what lowers confidence", () => {
  it("identity below exact caps the level however complete the file is", () => {
    const ymmt = buildDataConfidence(fullInput({ identity: exactIdentity({ matchLevel: "YMMT", factoryVerified: false }) }));
    expect(ymmt.ceiling).toBe("moderate");
    expect(ymmt.level).toBe("moderate");
    expect(ymmt.reasons).toContain("identity_ceiling_moderate:YMMT");
    const generic = buildDataConfidence(fullInput({ identity: exactIdentity({ matchLevel: "GENERIC_CANDIDATE", factoryVerified: false }) }));
    expect(generic.level).toBe("limited");
    const unknown = buildDataConfidence(fullInput({ identity: exactIdentity({ matchLevel: "UNKNOWN", factoryVerified: false }) }));
    expect(unknown.level).toBe("limited");
    expect(unknown.reasons).toContain("identity_unknown_confidence_limited");
  });

  it("an unresolved conflict is listed, lowers coverage and caps the level at moderate", () => {
    const r = buildDataConfidence({ ...fullInput(), conflicts: ["mileage_feed_vs_inspection"] });
    expect(r.conflicts).toEqual(["mileage_feed_vs_inspection"]);
    expect(r.coveragePct).toBe(100 - DATA_CONFIDENCE_RULES.conflictPenalty);
    expect(r.level).toBe("moderate");
    expect(r.reasons).toContain("conflicts_cap_confidence_at_moderate");
    const odo = buildDataConfidence(fullInput({ titleOdometer: verifiedTitle({ odometerStatus: "conflict", state: "REVIEW_REQUIRED" }) }));
    expect(odo.conflicts).toContain("odometer_conflict");
  });

  it("stale facts earn half credit and are named", () => {
    const r = buildDataConfidence(fullInput({ recall: recall({ freshness: stale() }), condition: inspectedCondition({ freshness: stale() }) }));
    expect(r.staleFacts).toContain("vin_recall_answered");
    expect(r.staleFacts).toContain("inspection_on_file");
    expect(r.coveragePct).toBeLessThan(100);
    expect(r.reasons).toContain(`stale_facts:${r.staleFacts.length}`);
  });

  it("a weak factory-decode confidence is discounted and reported", () => {
    const r = buildDataConfidence(fullInput({ identity: exactIdentity({ providerConfidence: 0.55 }) }));
    expect(r.coveragePct).toBe(100 - DATA_CONFIDENCE_RULES.providerConfidencePenalty);
    expect(r.reasons).toContain("factory_decode_confidence_low:0.55");
  });

  it("a raw confidence of unknown scale is never compared with the 0.7 floor", () => {
    const r = buildDataConfidence(fullInput({ identity: exactIdentity({ providerConfidence: null, providerConfidenceRaw: 55, providerConfidenceScale: "unknown" }) }));
    expect(r.reasons.some((x) => x.startsWith("factory_decode_confidence_low"))).toBe(false);
    expect(r.reasons).toContain("factory_decode_confidence_scale_unknown");
    expect(r.reasons).toContain("missing_facts:1");
  });

  it("a listing-derived decode is not a factory-verified identity", () => {
    const r = buildDataConfidence(fullInput({ identity: exactIdentity({ decodeAuthority: "listing_derived", factoryVerified: false }) }));
    expect(r.coveragePct).toBeLessThan(100);
    expect(r.reasons).toContain("decode_not_factory_build:listing_derived");
  });

  it("a seller self-report counts as weaker authority than an inspection", () => {
    const inspected = buildDataConfidence(fullInput());
    const self = buildDataConfidence(fullInput({ condition: inspectedCondition({ state: "self_reported", source: "seller_report" }) }));
    expect(self.domainCoverage.condition).toBeLessThan(inspected.domainCoverage.condition as number);
    expect(self.domainCoverage.condition).toBe(Math.round(DATA_CONFIDENCE_RULES.weakAuthorityCredit * 100));
  });
});

describe("new vehicles", () => {
  it("are measured on identity and documentation only; condition and provenance are not expected", () => {
    const r = buildDataConfidence(fullInput({ vehicleType: "new" }));
    expect(r.domainCoverage.condition).toBeNull();
    expect(r.domainCoverage.provenance).toBeNull();
    expect(r.domainCoverage.integrity).toBe(100);
    expect(r.level).toBe("high");
  });
});
