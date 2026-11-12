import { describe, it, expect } from "vitest";
import { buildMarketPassAssessment } from "./assessment";
import { buildVehicleConfidence, usedSegmentForScore, type VehicleConfidenceInput } from "./vehicleConfidence";
import { buildDataConfidence } from "../dataConfidence";
import { NOW, iso, newRow, settings, usedRow } from "./__fixtures__/rows";
import type { MarketPassRow } from "./rowEvidence";
import {
  exactIdentity, fullDocs, inspectedCondition, knownProvenance, recall, verifiedTitle,
} from "../scoreFixtures.test";

const vc = (row: MarketPassRow) => buildMarketPassAssessment({ row, settings: settings(), nowMs: NOW }).vehicleConfidence;
const noFlags = { titleBrand: null, carfaxCleanTitleFalse: false, accidentCount: null };

function full(over: Partial<VehicleConfidenceInput> = {}): VehicleConfidenceInput {
  const base = {
    vehicleType: "used" as const, identity: exactIdentity(), titleOdometer: verifiedTitle(), condition: inspectedCondition(),
    provenance: knownProvenance(), recall: recall(), documentation: fullDocs(),
  };
  const merged = { ...base, ...over };
  return {
    ...merged,
    feedFlags: over.feedFlags ?? noFlags,
    dataConfidence: over.dataConfidence ?? buildDataConfidence(merged),
    evidence: [],
  };
}

describe("price has no input to Vehicle Confidence", () => {
  it("a different price, a missing price, a market value and page views change nothing", () => {
    const base = vc(usedRow());
    expect(vc(usedRow({ price: 19900, advertised_price_before_doc: 19900 }))).toEqual(base);
    expect(vc(usedRow({ price: null, advertised_price_before_doc: null }))).toEqual(base);
    expect(vc(usedRow({ market_value: 99999, view_count: 50000 }))).toEqual(base);
  });

  it("a great price never lifts an adverse title, on the same vehicle", () => {
    const branded = { status: "branded", verified_at: iso(5), report_generated_at: iso(5), brand_note: "SALVAGE", source: "nmvtis" };
    // 25,000 against 31,000: -19.35% -> great_value.
    const a = buildMarketPassAssessment({ row: usedRow({ price: 25000, advertised_price_before_doc: 25000, title_verification: branded }), settings: settings(), nowMs: NOW });
    expect(a.priceFairness.label).toBe("Great price");
    expect(a.vehicleConfidence.state).toBe("adverse");
    expect(a.vehicleConfidence.segmentIndex).toBe(0);
    expect(a.vehicleConfidence.label).toBe("Concerns reported");
    expect(a.vehicleConfidence.findings[0]).toMatch(/SALVAGE/);
  });
});

describe("adverse history forces the adverse state, whatever the score", () => {
  it("an open recall on an otherwise complete file is adverse even though the score is high", () => {
    const r = buildVehicleConfidence(full({ recall: recall({ vinState: "OPEN", openCount: 1, publicState: "adverse", publicStatement: "1 open recall campaign reported on this VIN." }) }));
    // documentation_safety 100 - 40 = 60; (35 x 100 + 30 x 100 + 20 x 100 + 15 x 60) / 100 = 94.
    expect(r.internal.vehicleScore).toBe(94);
    expect(r.state).toBe("adverse");
    expect(r.segmentIndex).toBe(0);
  });

  it("feed-reported title brands and accidents are adverse; an unconfirmed CARFAX flag is review", () => {
    const mc = (extra: Record<string, unknown>) => ({ ...(usedRow().mc_attributes as Record<string, unknown>), ...extra });
    expect(vc(usedRow({ mc_attributes: mc({ title_brand: "Rebuilt" }) })).state).toBe("adverse");
    expect(vc(usedRow({ mc_attributes: mc({ accident_count: 2 }) })).state).toBe("adverse");
    const carfax = vc(usedRow({ mc_attributes: mc({ carfax_clean_title: false }) }));
    expect(carfax.state).toBe("review");
    expect(carfax.segmentIndex).toBe(1);
    expect(vc(usedRow({ mc_attributes: mc({ title_brand: "Clean" }) })).state).not.toBe("adverse");
  });

  it("an odometer conflict is review, with the readings named", () => {
    const r = buildVehicleConfidence(full({ titleOdometer: verifiedTitle({ state: "REVIEW_REQUIRED", odometerStatus: "conflict", publicStatement: "Title history needs review: odometer readings on record disagree." }) }));
    expect(r.state).toBe("review");
    expect(r.label).toBe("Review recommended");
  });

  it("a major open condition finding is adverse", () => {
    const r = buildVehicleConfidence(full({ condition: inspectedCondition({ findings: [{ severity: "major", label: "Frame damage", resolved: false }] }) }));
    expect(r.state).toBe("adverse");
  });
});

describe("thin, stale or missing evidence is qualified or unavailable, never a favorable default", () => {
  it("a clean NMVTIS attestation without an inspection is qualified, not rated", () => {
    const r = vc(usedRow());
    expect(r.state).toBe("qualified");
    expect(r.segmentIndex).toBeNull();
    expect(r.gaps).toContain("Current condition has not been verified by an inspection.");
    expect(r.gaps).toContain("The title check on record carries no odometer reading.");
    expect(r.internal.hardGates).not.toContain("unresolved_title_brand");
  });

  it("no title, no recall answer and no decode is unavailable", () => {
    const r = vc(usedRow({ title_verification: null, recall_status: null, recall_check: null, recall_checked_at: null, open_recall_count: null, closed_recall_count: null, mc_attributes: {} }));
    expect(r.state).toBe("unavailable");
    expect(r.label).toBe("Vehicle evidence not available");
  });

  it("a stale recall answer is a gap, not a finding", () => {
    const r = vc(usedRow({ recall_checked_at: iso(200), recall_check: { scope: "vin", state: "verified_clear", source: "marketcheck", checked_at: iso(200), open_count: 0, closed_count: 0, has_open: false, campaigns: [] } }));
    expect(r.findings.some((f) => /No open recall/.test(f))).toBe(false);
    expect(r.state).not.toBe("assessed");
  });

  it("moderate Data Confidence caps the segment at Excellent", () => {
    const input = full();
    const r = buildVehicleConfidence({ ...input, dataConfidence: { ...input.dataConfidence, level: "moderate" } });
    expect(r.internal.vehicleScore).toBe(100);
    expect(r.segmentIndex).toBe(3);
    expect(r.reasons).toContain("data_confidence_moderate_caps_segment_3");
  });
});

describe("the assessed used path and its segment boundaries", () => {
  it("a complete, verified file reaches Outstanding", () => {
    const r = buildVehicleConfidence(full());
    expect(r.state).toBe("assessed");
    expect(r.internal.vehicleScore).toBe(100);
    expect(r.segmentIndex).toBe(4);
    expect(r.label).toBe("Outstanding");
  });

  it("first-seen provenance and two moderate findings score 82, Excellent", () => {
    const r = buildVehicleConfidence(full({
      provenance: knownProvenance({ designation: "first_seen" }),
      condition: inspectedCondition({ findings: [
        { severity: "moderate", label: "Worn wipers", resolved: false },
        { severity: "moderate", label: "Chipped glass", resolved: false },
      ] }),
    }));
    // condition 100 - 2 x 15 = 70; provenance 55.
    // (35 x 100 + 30 x 70 + 20 x 55 + 15 x 100) / 100 = (3500 + 2100 + 1100 + 1500) / 100 = 82.
    expect(r.internal.vehicleScore).toBe(82);
    expect(r.segmentIndex).toBe(3);
    expect(r.label).toBe("Excellent");
  });

  it.each([[100, 4], [90, 4], [89, 3], [80, 3], [79, 2], [70, 2], [69, 1], [60, 1], [59, 0], [0, 0]])("score %i -> segment %i", (score, seg) => {
    expect(usedSegmentForScore(score)).toBe(seg);
  });
});

describe("new vehicles: factory and recall verification, no used score", () => {
  it("a factory-verified build with a current clear recall check is Factory verified", () => {
    const r = vc(newRow());
    expect(r.vehicleType).toBe("new");
    expect(r.state).toBe("assessed");
    expect(r.segmentIndex).toBe(2);
    expect(r.label).toBe("Factory verified");
    expect(r.internal.vehicleScore).toBeNull();
  });

  it("an open recall on a new vehicle is adverse", () => {
    const r = vc(newRow({ recall_status: "open_recalls", open_recall_count: 1, recall_check: { scope: "vin", state: "open_recalls", source: "marketcheck", checked_at: iso(2), open_count: 1, closed_count: 0, has_open: true, campaigns: [{ campaignNumber: "26V000", status: "open" }] } }));
    expect(r.state).toBe("adverse");
  });

  it("a generic decode without a recall answer is unavailable or qualified, never verified", () => {
    const mc = { build_sheet: { generic: true, decoded_at: iso(3) } };
    const r = vc(newRow({ mc_attributes: mc, recall_status: null, recall_check: null, recall_checked_at: null, open_recall_count: null, closed_recall_count: null }));
    expect(["qualified", "unavailable"]).toContain(r.state);
    expect(r.segmentIndex).toBeNull();
  });
});
