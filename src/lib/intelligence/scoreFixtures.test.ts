// Shared synthetic fixtures for the score and confidence tests. Nothing here
// is a real vehicle, dealer or report; every value is invented.
import { describe, it, expect } from "vitest";
import type {
  ConditionSummary, Freshness, IdentitySummary, ProvenanceSummary, RecallSummary, TitleOdometerSummary,
} from "./contracts";
import type { DocumentationFacts, VehicleScoreInput } from "./vehicleScore";

export const NOW = Date.parse("2026-10-28T00:00:00Z");
export const VIN = "1ABCD23EFGH456789";

export const current = (checkedAt = "2026-10-27T00:00:00Z"): Freshness =>
  ({ checkedAt, observedAt: null, ttlDays: 30, staleAt: "2026-11-26T00:00:00Z", state: "current" });
export const stale = (checkedAt = "2026-08-01T00:00:00Z"): Freshness =>
  ({ checkedAt, observedAt: null, ttlDays: 30, staleAt: "2026-08-31T00:00:00Z", state: "stale" });
export const unknownFreshness = (): Freshness =>
  ({ checkedAt: null, observedAt: null, ttlDays: null, staleAt: null, state: "unknown" });

export const exactIdentity = (over: Partial<IdentitySummary> = {}): IdentitySummary => ({
  vin: VIN, year: 2024, make: "EXAMPLE", model: "CROSSOVER", trim: "TOURING", version: null,
  drivetrain: "AWD", engine: "2.0T", transmission: "AT", exteriorColor: "Blue", interiorColor: "Black",
  mileage: 24_000, matchLevel: "EXACT_VIN", factoryVerified: true, decodeSource: "neovin",
  decodeAuthority: "factory_build", recordSource: "build_oem",
  providerConfidence: 0.96, providerConfidenceRaw: 96, providerConfidenceScale: "percent_0_100", freshness: current(), ...over,
});

export const verifiedTitle = (over: Partial<TitleOdometerSummary> = {}): TitleOdometerSummary => ({
  state: "VERIFIED_NO_ADVERSE_REPORTED", titleBrandsReported: [], junkSalvageTotalLossReported: [],
  odometerStatus: "consistent",
  readings: [{ value: 24_000, observedAt: "2026-10-20T00:00:00Z", source: "inspection", authority: "verified_inspection" }],
  reportDate: "2026-10-20", checkedAt: "2026-10-20T00:00:00Z",
  publicStatement: "No NMVTIS title brands reported as of 2026-10-20.",
  entitlementBlocked: false, providerFailed: false, reasons: [], freshness: current("2026-10-20T00:00:00Z"), ...over,
});

export const unverifiedTitle = (): TitleOdometerSummary => ({
  state: "NOT_VERIFIED", titleBrandsReported: [], junkSalvageTotalLossReported: [], odometerStatus: "not_checked",
  readings: [], reportDate: null, checkedAt: null, publicStatement: "Title history not verified.",
  entitlementBlocked: false, providerFailed: false, reasons: ["no_report"], freshness: unknownFreshness(),
});

export const inspectedCondition = (over: Partial<ConditionSummary> = {}): ConditionSummary => ({
  state: "verified", source: "autofilm", inspectionDate: "2026-10-18", tires32nds: [8, 8, 7, 7], brakesMm: [7, 6],
  openItems: 0, completedRecon: 2, findings: [], reasons: [], freshness: current("2026-10-18T00:00:00Z"), ...over,
});

export const unknownCondition = (): ConditionSummary => ({
  state: "unknown", source: "none", inspectionDate: null, tires32nds: [], brakesMm: [], openItems: null,
  completedRecon: null, findings: [], reasons: ["no_inspection"], freshness: unknownFreshness(),
});

export const knownProvenance = (over: Partial<ProvenanceSummary> = {}): ProvenanceSummary => ({
  designation: "known_since_new", soldHere: true, servicedHere: true, serviceVisits: 12, serviceShare: 0.9,
  yearsKnown: 2, autofilmInspections: 10, directTrade: true, facts: ["Originally sold here"], source: "dms",
  freshness: current(), ...over,
});

export const unknownProvenance = (): ProvenanceSummary => ({
  designation: "unknown", soldHere: null, servicedHere: null, serviceVisits: null, serviceShare: null,
  yearsKnown: null, autofilmInspections: null, directTrade: null, facts: [], source: "none", freshness: unknownFreshness(),
});

export const recall = (over: Partial<RecallSummary> = {}): RecallSummary => ({
  vinState: "NO_OPEN", truthState: "VERIFIED_CLEAR", openCount: 0, closedCount: 0, modelState: null,
  modelCampaignCount: null, doNotDrive: false, checkedAt: "2026-10-25T00:00:00Z", publicState: "verified",
  publicStatement: "No open recalls reported for this VIN as of 2026-10-25.", freshness: current("2026-10-25T00:00:00Z"), ...over,
});

export const unknownRecall = (): RecallSummary => recall({
  vinState: "UNKNOWN", truthState: "UNKNOWN", openCount: null, closedCount: null, checkedAt: null,
  publicState: "unknown", publicStatement: "VIN recall status unknown.", freshness: unknownFreshness(),
});

export const fullDocs = (over: Partial<DocumentationFacts> = {}): DocumentationFacts => ({
  serviceRecordCount: 9, inspectionEvidenceOnFile: true, warrantyDocumented: true, windowStickerOnFile: true, ...over,
});

export const noDocs = (): DocumentationFacts => ({
  serviceRecordCount: null, inspectionEvidenceOnFile: null, warrantyDocumented: null, windowStickerOnFile: null,
});

export const fullInput = (over: Partial<VehicleScoreInput> = {}): VehicleScoreInput => ({
  vehicleType: "used", identity: exactIdentity(), titleOdometer: verifiedTitle(), condition: inspectedCondition(),
  provenance: knownProvenance(), recall: recall(), documentation: fullDocs(), ...over,
});

export const thinInput = (over: Partial<VehicleScoreInput> = {}): VehicleScoreInput => ({
  vehicleType: "used", identity: exactIdentity(), titleOdometer: unverifiedTitle(), condition: unknownCondition(),
  provenance: unknownProvenance(), recall: unknownRecall(), documentation: noDocs(), ...over,
});

describe("fixtures", () => {
  it("describe no real vehicle", () => {
    expect(VIN).toMatch(/^1ABCD/);
    expect(fullInput().identity.make).toBe("EXAMPLE");
  });
});
