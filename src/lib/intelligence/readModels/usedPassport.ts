// ── Used Passport 2.0 read model ───────────────────────────────────────────
//
// Assembles the server read model a used-vehicle Passport renders from
// conclusions the intelligence modules already computed and the facts the
// listing row carries. Nothing here recomputes a conclusion: the score,
// confidence, value, rating and recommendation arrive finished and are only
// placed. The builder refuses a new vehicle and any input that carries raw
// provider material, so the model that leaves is publishable by shape.

import type {
  BuyerRecommendationResult, ConditionSummary, DataConfidenceResult, DealRatingResult, FreshnessSummary,
  IdentitySummary, MarketContextSummary, MarketValueV3, ProvenanceSummary, PublicState, RecallSummary,
  TitleOdometerSummary, UsedPassportReadModel, VehicleMedia, VehicleScoreResult,
} from "../contracts.ts";
import { listingFacts, type ListingRowLike } from "./listingFacts.ts";
import { assertPublishableShape, freshnessEntry, isNewCondition, ReadModelInputError } from "./shared.ts";

export interface UsedPassportInputs {
  row: ListingRowLike;
  nowMs: number;
  vehicleScore: VehicleScoreResult;
  dataConfidence: DataConfidenceResult;
  marketValue: MarketValueV3;
  dealRating: DealRatingResult | null;
  buyerRecommendation: BuyerRecommendationResult;
  titleOdometer: TitleOdometerSummary;
  condition: ConditionSummary;
  provenance: ProvenanceSummary;
  /** Defaults derived from the row; pass one to override, for example from a fresher check. */
  recall?: RecallSummary;
  marketContext?: MarketContextSummary;
  identity?: IdentitySummary;
  media?: VehicleMedia;
}

const titleState = (t: TitleOdometerSummary): PublicState =>
  t.state === "ADVERSE" ? "adverse"
  : t.state === "REVIEW_REQUIRED" ? "warning"
  : t.state === "VERIFIED_NO_ADVERSE_REPORTED" ? "verified"
  : t.entitlementBlocked || t.providerFailed ? "unavailable"
  : "unknown";

const conditionState = (c: ConditionSummary): PublicState =>
  c.state === "verified" ? "verified" : c.state === "unknown" ? "unknown" : "warning";

const provenanceState = (p: ProvenanceSummary): PublicState =>
  p.designation === "unknown" || p.source === "none" ? "unknown" : p.source === "dealer_claim" ? "warning" : "verified";

const valueState = (v: MarketValueV3): PublicState =>
  v.confidence === "unavailable" || v.estimatedValue == null ? "unavailable" : "verified";

const identityState = (v: IdentitySummary): PublicState =>
  v.factoryVerified ? "verified" : v.matchLevel === "UNKNOWN" ? "unknown" : "warning";

export function buildUsedPassportReadModel(input: UsedPassportInputs): UsedPassportReadModel {
  if (isNewCondition(input.row.condition)) {
    throw new ReadModelInputError("vehicle_type_mismatch", "a new vehicle takes the new passport read model");
  }
  const facts = listingFacts(input.row, input.nowMs);
  const vehicle = input.identity ?? facts.identity;
  const recall = input.recall ?? facts.recall;
  const marketContext = input.marketContext ?? facts.marketContext;
  const offer = facts.dealerOffer;
  const score = input.vehicleScore;
  const scoreApplies = score.applicable && score.score != null;
  const coverage = input.dataConfidence.coveragePct;

  const freshness: FreshnessSummary[] = [
    freshnessEntry({ key: "factory_identity", label: "Factory identity", freshness: vehicle.freshness, source: vehicle.decodeSource === "none" ? null : vehicle.decodeSource, factState: identityState(vehicle) }),
    freshnessEntry({ key: "title_odometer", label: "Title and odometer", freshness: input.titleOdometer.freshness, source: null, factState: titleState(input.titleOdometer) }),
    freshnessEntry({ key: "condition", label: "Condition", freshness: input.condition.freshness, source: input.condition.source === "none" ? null : input.condition.source, factState: conditionState(input.condition) }),
    freshnessEntry({ key: "dealer_provenance", label: "Dealer provenance", freshness: input.provenance.freshness, source: input.provenance.source === "none" ? null : input.provenance.source, factState: provenanceState(input.provenance) }),
    freshnessEntry({ key: "market_value", label: "Market value", freshness: input.marketValue.freshness, source: input.marketValue.algorithmVersion, factState: valueState(input.marketValue) }),
    freshnessEntry({ key: "asking_price", label: "Asking price", freshness: offer.freshness, source: offer.channel, factState: offer.state }),
    freshnessEntry({ key: "market_context", label: "Market context", freshness: marketContext.freshness, source: marketContext.velocityBasis === "none" ? null : marketContext.velocityBasis }),
    freshnessEntry({ key: "recall", label: "Recall", freshness: recall.freshness, source: null, factState: recall.publicState }),
  ];

  const model: UsedPassportReadModel = {
    passportVersion: "2.0",
    vehicleType: "used",
    vehicle,
    media: input.media ?? facts.media,
    vehicleScore: {
      score: scoreApplies ? score.score : null,
      label: scoreApplies ? score.label : null,
      version: score.version,
      domains: score.domains.map((d) => ({ key: d.key, score: d.score, weight: d.weight })),
    },
    dataConfidence: {
      level: input.dataConfidence.level,
      ...(coverage != null ? { coveragePct: Math.round(coverage) } : {}),
      reasons: [...input.dataConfidence.reasons],
    },
    titleOdometer: input.titleOdometer,
    dealerProvenance: input.provenance,
    condition: input.condition,
    marketValue: input.marketValue,
    askingPrice: input.dealRating?.askingPrice ?? offer.advertisedPrice,
    dealRating: input.dealRating,
    buyerRecommendation: input.buyerRecommendation,
    marketContext,
    recall,
    freshness,
  };
  assertPublishableShape(model, "UsedPassportReadModel");
  return model;
}
