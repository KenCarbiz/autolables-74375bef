import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildUsedPassportReadModel, type UsedPassportInputs } from "./usedPassport";
import { ReadModelInputError } from "./shared";
import { listingFacts } from "./listingFacts";
import {
  containsForbiddenKey, resolveFreshness, SCORE_LABELS,
  type BuyerRecommendationResult, type ConditionSummary, type DataConfidenceResult, type DealRatingResult,
  type MarketValueV3, type ProvenanceSummary, type TitleOdometerSummary, type UsedPassportReadModel, type VehicleScoreResult,
} from "../contracts";
import { COHORT_MATCH_LEVELS } from "../../market/cohortLadder";
import { iso, NOW, usedRow, vinFailed } from "./__fixtures__/rows";

const fresh = (daysAgo: number, ttlDays: number | null) => resolveFreshness({ checkedAt: iso(daysAgo), ttlDays, nowMs: NOW });

const vehicleScore = (): VehicleScoreResult => ({
  version: "vehicle-score-test",
  score: 94,
  label: "Outstanding",
  applicable: true,
  publication: "eligible",
  assessedWeightPct: 100,
  missingDomains: [],
  evidenceFreshness: { title_odometer: "current", condition: "current", recall: "current" },
  policyVersion: "public-score-policy-v1",
  reasons: [],
  domains: [
    { key: "integrity", weight: 35, score: 96, evidence: ["no_adverse_title_brand_reported"], adverse: [], missing: [] },
    { key: "condition", weight: 30, score: 92, evidence: ["verified_inspection"], adverse: [], missing: [] },
    { key: "provenance", weight: 20, score: 95, evidence: ["known_since_new"], adverse: [], missing: [] },
    { key: "documentation_safety", weight: 15, score: 90, evidence: ["vin_recall_no_open"], adverse: [], missing: ["owner_manual"] },
  ],
});

const dataConfidence = (): DataConfidenceResult => ({
  version: "data-confidence-test",
  level: "high",
  coveragePct: 97.4,
  ceiling: "high",
  domainCoverage: { integrity: 1, condition: 1, provenance: 1, documentation_safety: 0.9 },
  conflicts: [],
  staleFacts: [],
  reasons: ["exact_identity", "all_domains_assessed"],
});

const marketValue = (): MarketValueV3 => ({
  algorithmVersion: "market-value-v3-test",
  estimatedValue: 41900,
  rangeLow: 41100,
  rangeHigh: 42700,
  confidence: "high",
  confidenceReasons: ["qualified_comps_63"],
  qualifiedCompCount: 63,
  effectiveSampleSize: 48,
  matchingTier: "A",
  identityLevel: "EXACT_VIN",
  geography: { zip: null, radiusMiles: 100, scope: "local" },
  signals: [{ key: "qualified_comparables", estimate: 41900, weight: 1, used: true, reason: "primary_signal" }],
  providerAgreement: "agree",
  disagreementPct: 2.1,
  investigationFlagged: false,
  checkedAt: iso(0.5),
  freshness: fresh(0.5, 1),
  publishable: false,
});

const dealRating = (): DealRatingResult => ({
  version: "deal-rating-test",
  label: "great_value",
  askingPrice: 40995,
  marketValue: 41900,
  deltaDollars: -905,
  deltaPct: -2.16,
  valuationConfidence: "high",
  thresholds: { greatValueMaxPct: -2, goodValueMaxPct: 0, fairPriceMaxPct: 3, aboveMarketMaxPct: 8 },
  applicable: true,
  reasons: ["asking_below_estimated_value"],
});

const recommendation = (): BuyerRecommendationResult => ({
  version: "buyer-recommendation-test",
  state: "HIGHLY_RECOMMENDED",
  reasons: ["Strong documented condition", "No adverse NMVTIS title brands reported", "Dealer known vehicle", "Price below estimated market value"],
  hardGates: [],
  inputsUsed: ["title_odometer", "condition", "provenance", "recall", "deal_rating"],
  applicable: true,
});

const titleOdometer = (): TitleOdometerSummary => ({
  state: "VERIFIED_NO_ADVERSE_REPORTED",
  titleBrandsReported: [],
  junkSalvageTotalLossReported: [],
  odometerStatus: "consistent",
  readings: [{ value: 41287, observedAt: iso(7), source: "listing", authority: "provider_listing" }],
  reportDate: "2026-10-21",
  checkedAt: iso(7),
  publicStatement: "No NMVTIS title brands reported as of 2026-10-21.",
  entitlementBlocked: false,
  providerFailed: false,
  reasons: [],
  freshness: fresh(7, 90),
});

const condition = (): ConditionSummary => ({
  state: "verified",
  source: "dealer_inspection",
  inspectionDate: "2026-10-18",
  tires32nds: [8, 8, 7, 7],
  brakesMm: [7, 6],
  openItems: 0,
  completedRecon: 3,
  findings: [],
  reasons: [],
  freshness: fresh(10, 90),
});

const provenance = (): ProvenanceSummary => ({
  designation: "known_since_new",
  soldHere: true,
  servicedHere: true,
  serviceVisits: 12,
  serviceShare: 1,
  yearsKnown: 1.6,
  autofilmInspections: 10,
  directTrade: true,
  facts: ["Originally sold here", "12 dealer service visits", "10 AutoFilm inspections", "Direct customer trade"],
  source: "dms",
  freshness: fresh(1, 30),
});

const inputs = (patch: Partial<UsedPassportInputs> = {}): UsedPassportInputs => ({
  row: usedRow(),
  nowMs: NOW,
  vehicleScore: vehicleScore(),
  dataConfidence: dataConfidence(),
  marketValue: marketValue(),
  dealRating: dealRating(),
  buyerRecommendation: recommendation(),
  titleOdometer: titleOdometer(),
  condition: condition(),
  provenance: provenance(),
  ...patch,
});

const example = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "used_passport_example.json"), "utf8")) as Record<string, Record<string, unknown>>;

describe("the used passport read model", () => {
  it("places every conclusion without recomputing it", () => {
    const m = buildUsedPassportReadModel(inputs());
    expect(m.passportVersion).toBe("2.0");
    expect(m.vehicleType).toBe("used");
    expect(m.vehicleScore).toEqual({
      score: 94, label: "Outstanding", version: "vehicle-score-test",
      domains: [
        { key: "integrity", score: 96, weight: 35 },
        { key: "condition", score: 92, weight: 30 },
        { key: "provenance", score: 95, weight: 20 },
        { key: "documentation_safety", score: 90, weight: 15 },
      ],
      publication: "eligible", assessedWeightPct: 100, missingDomains: [],
      evidenceFreshness: { title_odometer: "current", condition: "current", recall: "current" },
    });
    expect(m.dataConfidence).toEqual({ level: "high", coveragePct: 97, reasons: ["exact_identity", "all_domains_assessed"] });
    expect(m.marketValue).toBe(inputs().marketValue === m.marketValue ? m.marketValue : m.marketValue);
    expect(m.marketValue.estimatedValue).toBe(41900);
    expect(m.askingPrice).toBe(40995);
    expect(m.dealRating?.label).toBe("great_value");
    expect(m.buyerRecommendation.state).toBe("HIGHLY_RECOMMENDED");
    expect(m.titleOdometer.state).toBe("VERIFIED_NO_ADVERSE_REPORTED");
    expect(m.recall.vinState).toBe("NO_OPEN");
    expect(m.marketContext.inferredSoldWording).toBe(true);
    expect(m.media.photoCount).toBe(2);
    expect(SCORE_LABELS).toContain(m.vehicleScore.label);
  });

  it("covers every block of the used example and carries its values", () => {
    const m = buildUsedPassportReadModel(inputs());
    const blocks: Record<string, unknown> = {
      vehicle: m.vehicle, vehicle_score: m.vehicleScore, title_odometer: m.titleOdometer, dealer_provenance: m.dealerProvenance,
      condition: m.condition, market_value: m.marketValue, asking_price: m.askingPrice, deal_rating: m.dealRating,
      buyer_recommendation: m.buyerRecommendation, market_context: m.marketContext,
    };
    for (const key of Object.keys(example).filter((k) => k !== "meta")) expect(blocks[key], key).toBeDefined();

    expect(m.vehicle).toMatchObject({
      vin: example.vehicle.vin, year: example.vehicle.year, make: example.vehicle.make, model: example.vehicle.model,
      trim: example.vehicle.trim, drivetrain: example.vehicle.drivetrain, mileage: example.vehicle.mileage,
    });
    const score = example.vehicle_score as { score: number; label: string; data_confidence: { level: string; coverage_pct: number }; domains: { key: string; score: number }[] };
    expect(m.vehicleScore.score).toBe(score.score);
    expect(m.vehicleScore.label).toBe(score.label);
    expect(m.vehicleScore.domains.map((d) => ({ key: d.key, score: d.score }))).toEqual(score.domains);
    expect(m.dataConfidence.level).toBe(score.data_confidence.level);
    expect(m.dataConfidence.coveragePct).toBe(score.data_confidence.coverage_pct);

    expect(m.titleOdometer.state.toLowerCase()).toBe(example.title_odometer.status);
    expect(m.titleOdometer.titleBrandsReported).toEqual(example.title_odometer.title_brands_reported);
    expect(m.titleOdometer.odometerStatus).toBe(example.title_odometer.odometer_status);
    expect(m.dealerProvenance.designation).toBe(example.dealer_provenance.designation);
    expect(m.dealerProvenance.facts).toEqual(example.dealer_provenance.facts);
    expect(m.condition.state).toBe(example.condition.status);
    expect(m.condition.inspectionDate).toBe(example.condition.inspection_date);
    expect(m.condition.tires32nds).toHaveLength((example.condition.tires as unknown[]).length);
    expect(m.condition.brakesMm).toHaveLength((example.condition.brakes as unknown[]).length);
    expect(m.condition.openItems).toBe(example.condition.open_items);
    expect(m.marketValue).toMatchObject({
      estimatedValue: example.market_value.amount, rangeLow: example.market_value.range_low, rangeHigh: example.market_value.range_high,
      confidence: example.market_value.confidence, qualifiedCompCount: example.market_value.qualified_comps,
    });
    expect(m.askingPrice).toBe(example.asking_price);
    expect(m.dealRating).toMatchObject({ label: example.deal_rating.label, deltaDollars: example.deal_rating.delta_dollars, deltaPct: example.deal_rating.delta_pct });
    expect(m.buyerRecommendation.state.toLowerCase()).toBe(example.buyer_recommendation.state);
    expect(m.buyerRecommendation.hardGates).toEqual(example.buyer_recommendation.hard_gates);
    expect(m.marketContext.mdsDays).toBe(example.market_context.mds_days);
    expect(m.marketContext.salesVelocity).toBe(example.market_context.sales_velocity);
    expect(m.marketContext.trend).toBe(example.market_context.trend);
    expect(COHORT_MATCH_LEVELS).toContain(m.marketContext.mdsScope);
  });

  it("lists one freshness row per dated conclusion", () => {
    const m = buildUsedPassportReadModel(inputs());
    expect(m.freshness.map((f) => f.key)).toEqual([
      "factory_identity", "title_odometer", "condition", "dealer_provenance", "market_value", "asking_price", "market_context", "recall",
    ]);
    for (const f of m.freshness) expect(f.state).toBe("verified");
    expect(m.freshness.find((f) => f.key === "market_value")?.source).toBe("market-value-v3-test");
    expect(m.freshness.find((f) => f.key === "asking_price")?.source).toBe("feed");
  });

  it("carries a provider failure as unavailable, never as a clean or zero answer", () => {
    const m = buildUsedPassportReadModel(inputs({
      row: { ...usedRow(), ...vinFailed("marketcheck_rate_limited") },
      titleOdometer: {
        ...titleOdometer(), state: "NOT_VERIFIED", providerFailed: true, checkedAt: null, reportDate: null,
        publicStatement: "Title and odometer records could not be retrieved.", freshness: resolveFreshness({ checkedAt: null, ttlDays: 90, nowMs: NOW }),
      },
      marketValue: { ...marketValue(), estimatedValue: null, rangeLow: null, rangeHigh: null, confidence: "unavailable", qualifiedCompCount: 0, effectiveSampleSize: 0, checkedAt: null, freshness: resolveFreshness({ checkedAt: null, ttlDays: 1, nowMs: NOW }) },
      dealRating: null,
    }));
    const byKey = Object.fromEntries(m.freshness.map((f) => [f.key, f.state]));
    expect(byKey.title_odometer).toBe("unavailable");
    expect(byKey.market_value).toBe("unavailable");
    expect(byKey.recall).toBe("unavailable");
    expect(m.recall.vinState).toBe("PROVIDER_UNAVAILABLE");
    expect(m.recall.openCount).toBeNull();
    expect(m.dealRating).toBeNull();
    expect(m.askingPrice).toBe(40995);
    expect(m.titleOdometer.titleBrandsReported).toEqual([]);
    expect(m.titleOdometer.state).toBe("NOT_VERIFIED");
  });

  it("shows no score when the score module says it does not apply", () => {
    const m = buildUsedPassportReadModel(inputs({ vehicleScore: { ...vehicleScore(), applicable: false, score: null, label: null, reasons: ["not_enough_verified_information"] } }));
    expect(m.vehicleScore.score).toBeNull();
    expect(m.vehicleScore.label).toBeNull();
    expect(m.vehicleScore.domains).toHaveLength(4);
    const noCoverage = buildUsedPassportReadModel(inputs({ dataConfidence: { ...dataConfidence(), level: "limited", coveragePct: null } }));
    expect(noCoverage.dataConfidence).toEqual({ level: "limited", reasons: ["exact_identity", "all_domains_assessed"] });
  });

  it("uses an override for a row-derived block when one is passed", () => {
    const facts = listingFacts(usedRow(), NOW);
    const recall = { ...facts.recall, publicStatement: "override" };
    const m = buildUsedPassportReadModel(inputs({ recall, media: { heroImageUrl: null, photoCount: 0, photos: [] } }));
    expect(m.recall.publicStatement).toBe("override");
    expect(m.media.photoCount).toBe(0);
  });

  it("refuses a new vehicle", () => {
    expect(() => buildUsedPassportReadModel(inputs({ row: { ...usedRow(), condition: "New" } }))).toThrow(ReadModelInputError);
    try {
      buildUsedPassportReadModel(inputs({ row: { ...usedRow(), condition: "new" } }));
    } catch (e) {
      expect((e as ReadModelInputError).code).toBe("vehicle_type_mismatch");
    }
    expect(() => buildUsedPassportReadModel(inputs({ row: { ...usedRow(), condition: "certified" } }))).not.toThrow();
    expect(() => buildUsedPassportReadModel(inputs({ row: { ...usedRow(), condition: null } }))).not.toThrow();
  });

  it("refuses a conclusion that carries raw provider material", () => {
    const tainted = { ...marketValue(), signals: [{ key: "x", estimate: 1, weight: 1, used: true, reason: "r", raw_payload: {} } as never] };
    try {
      buildUsedPassportReadModel(inputs({ marketValue: tainted }));
      expect.unreachable("a forbidden key must be refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ReadModelInputError);
      expect((e as ReadModelInputError).code).toBe("forbidden_key");
      expect((e as Error).message).toContain("raw_payload");
    }
  });

  it("is a plain serializable document with no raw provider material", () => {
    const m = buildUsedPassportReadModel(inputs());
    expect(containsForbiddenKey(m)).toBeNull();
    const roundTrip = JSON.parse(JSON.stringify(m)) as UsedPassportReadModel;
    expect(roundTrip).toEqual(m);
    expect(JSON.stringify(m)).not.toContain("mc_raw");
  });
});
