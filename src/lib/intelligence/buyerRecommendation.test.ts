import { describe, it, expect } from "vitest";
import type {
  ConditionSummary, DataConfidenceResult, DealRatingResult, Freshness, ProvenanceSummary, RecallSummary,
  TitleOdometerSummary, VehicleScoreResult,
} from "./contracts";
import { HARD_GATES, RECOMMENDATION_STATES } from "./contracts";
import { DEFAULT_DEAL_RATING_THRESHOLDS } from "./dealRating";
import {
  buildBuyerRecommendation, BUYER_RECOMMENDATION_VERSION, evaluateHardGates, HARD_GATE_REASONS,
  type BuyerRecommendationInput,
} from "./buyerRecommendation";

const fresh: Freshness = {
  checkedAt: "2026-10-27T00:00:00Z", observedAt: null, ttlDays: 30, staleAt: "2026-11-26T00:00:00Z", state: "current",
};

const score = (n: number | null, applicable = true): VehicleScoreResult => ({
  version: "vehicle-score-test",
  score: n,
  label: n == null ? null : n >= 90 ? "Outstanding" : n >= 80 ? "Excellent" : n >= 70 ? "Good" : n >= 55 ? "Fair" : "Caution",
  domains: [],
  applicable,
  reasons: [],
});

const confidence = (level: DataConfidenceResult["level"], conflicts: string[] = []): DataConfidenceResult => ({
  version: "data-confidence-test",
  level,
  coveragePct: level === "high" ? 95 : level === "moderate" ? 75 : 40,
  ceiling: "high",
  domainCoverage: { integrity: null, condition: null, provenance: null, documentation_safety: null },
  conflicts,
  staleFacts: [],
  reasons: [],
});

const title = (state: TitleOdometerSummary["state"], odometerStatus: TitleOdometerSummary["odometerStatus"] = "consistent"): TitleOdometerSummary => ({
  state,
  titleBrandsReported: state === "ADVERSE" ? ["SALVAGE"] : [],
  junkSalvageTotalLossReported: [],
  odometerStatus,
  readings: [],
  reportDate: "2026-10-20",
  checkedAt: "2026-10-20T00:00:00Z",
  publicStatement: state === "VERIFIED_NO_ADVERSE_REPORTED" ? "No NMVTIS title brands reported as of 2026-10-20." : "",
  entitlementBlocked: false,
  providerFailed: false,
  reasons: [],
  freshness: fresh,
});

const condition = (state: ConditionSummary["state"], findings: ConditionSummary["findings"] = []): ConditionSummary => ({
  state,
  source: state === "verified" ? "dealer_inspection" : "none",
  inspectionDate: state === "verified" ? "2026-10-18" : null,
  tires32nds: [8, 8, 7, 7],
  brakesMm: [7, 6],
  openItems: findings.filter((f) => !f.resolved).length,
  completedRecon: 0,
  findings,
  reasons: [],
  freshness: fresh,
});

const provenance = (designation: ProvenanceSummary["designation"]): ProvenanceSummary => ({
  designation,
  soldHere: designation === "known_since_new",
  servicedHere: designation !== "unknown",
  serviceVisits: 12,
  serviceShare: 0.9,
  yearsKnown: 3,
  autofilmInspections: 10,
  directTrade: designation === "direct_trade",
  facts: [],
  source: designation === "unknown" ? "none" : "dms",
  freshness: fresh,
});

const recall = (vinState: RecallSummary["vinState"], doNotDrive = false): RecallSummary => ({
  vinState,
  truthState: vinState === "OPEN" ? "OPEN" : vinState === "NO_OPEN" ? "VERIFIED_CLEAR" : "UNKNOWN",
  openCount: vinState === "OPEN" ? 1 : vinState === "NO_OPEN" ? 0 : null,
  closedCount: null,
  modelState: null,
  modelCampaignCount: null,
  doNotDrive,
  checkedAt: "2026-10-21T00:00:00Z",
  publicState: vinState === "OPEN" ? "adverse" : vinState === "NO_OPEN" ? "verified" : "unknown",
  publicStatement: "",
  freshness: fresh,
});

const deal = (label: DealRatingResult["label"], deltaPct: number | null = -2.16): DealRatingResult => ({
  version: "deal-rating-test",
  label,
  askingPrice: 40995,
  marketValue: 41900,
  deltaDollars: deltaPct == null ? null : Math.round(41900 * deltaPct / 100),
  deltaPct,
  valuationConfidence: label === "unavailable" ? "low" : "high",
  thresholds: DEFAULT_DEAL_RATING_THRESHOLDS,
  applicable: true,
  reasons: [],
});

const strong = (): BuyerRecommendationInput => ({
  vehicleType: "used",
  identityLevel: "EXACT_VIN",
  vehicleScore: score(94),
  dataConfidence: confidence("high"),
  titleOdometer: title("VERIFIED_NO_ADVERSE_REPORTED"),
  condition: condition("verified"),
  provenance: provenance("known_since_new"),
  recall: recall("NO_OPEN"),
  dealRating: deal("good_value"),
});

describe("hard gates", () => {
  it("every gate in the contract has a reason and a trigger", () => {
    expect(Object.keys(HARD_GATE_REASONS).sort()).toEqual([...HARD_GATES].sort());
    const triggers: Record<string, Partial<BuyerRecommendationInput>> = {
      unresolved_title_brand: { titleOdometer: title("ADVERSE") },
      odometer_conflict: { titleOdometer: title("VERIFIED_NO_ADVERSE_REPORTED", "rollback_indicated") },
      identity_not_exact: { identityLevel: "YMMT" },
      open_safety_recall: { recall: recall("OPEN") },
      do_not_drive: { recall: recall("OPEN", true) },
      major_condition_issue: { condition: condition("verified", [{ severity: "major", label: "Frame damage noted", resolved: false }]) },
      material_conflict: { materialConflicts: ["mileage_sources_disagree"] },
    };
    for (const gate of HARD_GATES) {
      const gates = evaluateHardGates({ ...strong(), ...triggers[gate] });
      expect(gates, gate).toContain(gate);
    }
    expect(evaluateHardGates(strong())).toEqual([]);
  });

  it("any gate forbids a favorable state and names itself", () => {
    const r = buildBuyerRecommendation({ ...strong(), titleOdometer: title("REVIEW_REQUIRED") });
    expect(r.state).toBe("REVIEW_BEFORE_PURCHASE");
    expect(r.hardGates).toEqual(["unresolved_title_brand"]);
    expect(r.reasons).toEqual([HARD_GATE_REASONS.unresolved_title_brand]);
    expect(r.version).toBe(BUYER_RECOMMENDATION_VERSION);
  });

  it("a conflict recorded by Data Confidence is a gate too, and a resolved major finding is not", () => {
    expect(buildBuyerRecommendation({ ...strong(), dataConfidence: confidence("high", ["odometer_vs_history"]) }).hardGates).toEqual(["material_conflict"]);
    expect(buildBuyerRecommendation({
      ...strong(), condition: condition("verified", [{ severity: "major", label: "Replaced tires", resolved: true }]),
    }).hardGates).toEqual([]);
  });

  it("a generic or YMM identity gates by itself even when everything else is perfect", () => {
    for (const level of ["GENERIC_CANDIDATE", "YMM", "UNKNOWN"] as const) {
      const r = buildBuyerRecommendation({ ...strong(), identityLevel: level });
      expect(r.state, level).toBe("REVIEW_BEFORE_PURCHASE");
      expect(r.hardGates).toContain("identity_not_exact");
    }
  });
});

describe("insufficient evidence", () => {
  it("is NOT_ENOUGH_VERIFIED_INFORMATION when the score is null or confidence is limited", () => {
    const noScore = buildBuyerRecommendation({ ...strong(), vehicleScore: score(null) });
    expect(noScore.state).toBe("NOT_ENOUGH_VERIFIED_INFORMATION");
    expect(noScore.reasons[0]).toMatch(/could not be assessed/);
    const limited = buildBuyerRecommendation({ ...strong(), dataConfidence: confidence("limited") });
    expect(limited.state).toBe("NOT_ENOUGH_VERIFIED_INFORMATION");
    expect(limited.reasons).toContain("Data Confidence is limited");
    const missing = buildBuyerRecommendation({ ...strong(), dataConfidence: null });
    expect(missing.state).toBe("NOT_ENOUGH_VERIFIED_INFORMATION");
  });

  it("a score that is not applicable counts as no score", () => {
    expect(buildBuyerRecommendation({ ...strong(), vehicleScore: score(94, false) }).state).toBe("NOT_ENOUGH_VERIFIED_INFORMATION");
  });
});

describe("synthesis", () => {
  it("a strong, verified, well-priced vehicle is HIGHLY_RECOMMENDED with explainable reasons", () => {
    const r = buildBuyerRecommendation(strong());
    expect(r.state).toBe("HIGHLY_RECOMMENDED");
    expect(r.hardGates).toEqual([]);
    expect(r.reasons).toEqual(expect.arrayContaining([
      "Vehicle Score 94, Outstanding",
      "Data Confidence high",
      "No NMVTIS title brands reported as of 2026-10-20.",
      "Condition verified by inspection on 2026-10-18",
      "Dealer has known this vehicle since new",
      "Price is below estimated market value by 2.16%",
      "No open VIN recall reported",
    ]));
    expect(r.inputsUsed).toEqual(["identity", "vehicle_score", "data_confidence", "title_odometer", "condition", "provenance", "recall", "deal_rating"]);
    expect(RECOMMENDATION_STATES).toContain(r.state);
  });

  it("a good vehicle with a bad deal lands on CONSIDER with the price reason", () => {
    const r = buildBuyerRecommendation({ ...strong(), dealRating: deal("well_above_market", 9.4) });
    expect(r.state).toBe("CONSIDER");
    expect(r.reasons).toContain("Price is well above estimated market value by 9.4%");
    const above = buildBuyerRecommendation({ ...strong(), dealRating: deal("above_market", 4) });
    expect(above.state).toBe("RECOMMENDED");
  });

  it("a weak vehicle with a great deal never rises above CONSIDER", () => {
    const weak = buildBuyerRecommendation({ ...strong(), vehicleScore: score(48), dealRating: deal("great_value", -9) });
    expect(weak.state).toBe("REVIEW_BEFORE_PURCHASE");
    const fair = buildBuyerRecommendation({ ...strong(), vehicleScore: score(60), dealRating: deal("great_value", -9) });
    expect(fair.state).toBe("CONSIDER");
    expect(fair.reasons).toContain("Price is below estimated market value by 9%");
  });

  it("an unavailable deal rating never allows HIGHLY_RECOMMENDED", () => {
    const r = buildBuyerRecommendation({ ...strong(), dealRating: deal("unavailable", null) });
    expect(r.state).toBe("RECOMMENDED");
    expect(r.reasons).toContain("Price position against market value is not available");
    expect(buildBuyerRecommendation({ ...strong(), dealRating: null }).state).toBe("RECOMMENDED");
  });

  it("moderate confidence stops at RECOMMENDED unless configured otherwise", () => {
    const r = buildBuyerRecommendation({ ...strong(), dataConfidence: confidence("moderate") });
    expect(r.state).toBe("RECOMMENDED");
    expect(r.reasons).toContain("Data Confidence is moderate, so the recommendation stops at Recommended");
    const relaxed = buildBuyerRecommendation({ ...strong(), dataConfidence: confidence("moderate") }, { requireHighConfidenceForHighly: false });
    expect(relaxed.state).toBe("HIGHLY_RECOMMENDED");
  });

  it("an unverified title or condition caps at CONSIDER by default, and the cap is configurable", () => {
    const noTitle = buildBuyerRecommendation({ ...strong(), titleOdometer: title("NOT_VERIFIED") });
    expect(noTitle.state).toBe("CONSIDER");
    expect(noTitle.reasons).toContain("Title and odometer have not been verified against NMVTIS");
    const noCondition = buildBuyerRecommendation({ ...strong(), condition: condition("unknown") });
    expect(noCondition.state).toBe("CONSIDER");
    const relaxed = buildBuyerRecommendation({ ...strong(), titleOdometer: null }, { titleNotVerifiedCap: "RECOMMENDED" });
    expect(relaxed.state).toBe("RECOMMENDED");
  });

  it("a moderate open finding caps at CONSIDER", () => {
    const r = buildBuyerRecommendation({
      ...strong(), condition: condition("verified", [{ severity: "moderate", label: "Rear brakes at 3mm", resolved: false }]),
    });
    expect(r.state).toBe("CONSIDER");
    expect(r.reasons).toContain("A moderate condition finding is still open");
  });

  it("bands are configuration", () => {
    const r = buildBuyerRecommendation({ ...strong(), vehicleScore: score(80) }, { bands: { highlyRecommendedMinScore: 78 } });
    expect(r.state).toBe("HIGHLY_RECOMMENDED");
    expect(buildBuyerRecommendation({ ...strong(), vehicleScore: score(80) }).state).toBe("RECOMMENDED");
  });

  it("the price never reaches the score: the recommendation reads the score result, not the asking price", () => {
    const cheap = buildBuyerRecommendation({ ...strong(), dealRating: deal("great_value", -12) });
    const dear = buildBuyerRecommendation({ ...strong(), dealRating: deal("fair_price", 0.5) });
    expect(cheap.reasons[0]).toBe("Vehicle Score 94, Outstanding");
    expect(dear.reasons[0]).toBe("Vehicle Score 94, Outstanding");
  });
});

describe("new vehicles", () => {
  it("get no used-vehicle recommendation", () => {
    const r = buildBuyerRecommendation({ ...strong(), vehicleType: "new" });
    expect(r.applicable).toBe(false);
    expect(r.state).toBe("NOT_ENOUGH_VERIFIED_INFORMATION");
    expect(r.hardGates).toEqual([]);
  });
});
