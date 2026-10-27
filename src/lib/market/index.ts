// The public surface of the market engine. Import from here, never from a
// private module, so the set of things a consumer can reach stays reviewable.

export * from "./types.ts";
export { resolvePriceBasis, resolveComparableBasePrice } from "./priceBasis.ts";
export {
  MARKETCHECK_PREDICT_PATH, MARKETCHECK_COMPARABLES_PATH, MARKETCHECK_ENDPOINT_VERSION,
  PROVIDER_FRESH_DAYS, PROVIDER_HARD_EXPIRY_DAYS,
  buildPredictionRequest, parsePredictionResponse, predictionUrl, sanitizeForAudit,
  readCertifiedEcho, readHistoryFlag, resolveDealerType, validateProviderValuation,
} from "./providerAdapter.ts";
export {
  assignTier, canonicalizeComparable, dedupeByVin, inclusionFor, isInternalInventory,
  isPrimaryTier, isContextTier, readCertified, selectTier, TIER_ORDER,
} from "./comparables.ts";
export {
  classifyOwnership, groupKey, rooftopKey, normalizeDealerName, normalizeDomain,
  identityConfigIssues, tenantIdentityStability,
} from "./dealerIdentity.ts";
export { scoreSimilarity, SIMILARITY_COEFFICIENTS, SIMILARITY_VERSION } from "./similarity.ts";
export { applyConcentrationCaps, CONCENTRATION_CAP, MIN_SOURCES_FOR_CAP } from "./concentration.ts";
export { reviewOutliers, MIN_SAMPLE_FOR_OUTLIER_REMOVAL, DEFAULT_MAD_THRESHOLD } from "./outliers.ts";
export {
  trueMedian, weightedQuantile, weightedMedian, weightedMean, weightedStdDev,
  weightedMad, effectiveSampleSize,
} from "./statistics.ts";
export { adjustComparablePrice, ADJUSTMENT_MODEL_VERSION, missingModelFeatures } from "./adjustments.ts";
export { resolveConfidence, providerDisagreement } from "./confidence.ts";
export { resolveVerdict, redWarningGate, verdictBuffer } from "./verdict.ts";
export { buildMarketView, COMPARABLE_RANGE_LABEL } from "./marketView.ts";
export { shadowComposite } from "./composite.ts";
export { recommendPricingPosition } from "./pricingPosition.ts";
export { MARKET_FLAGS, MARKET_FLAG_NAMES, readMarketFlag, readMarketFlags, type MarketFlag } from "./flags.ts";
export {
  PROVIDER_CAPABILITIES, PROVIDER_CAPABILITY_KEYS, capability, capabilityForPath, effectiveCost,
  policyFor, publicBrowseMayTrigger, routineCapabilities,
  type ProviderCapability, type CapabilityPolicy, type CapabilityStatus, type CapabilityTrigger,
} from "./providerRegistry.ts";
export { resolveListingFeeBasis, type ListingFeeBasis, type ListingFeeInput } from "./listingFeeBasis.ts";
export {
  IDENTITY_MATCH_LEVELS, EXACT_ONLY_CLAIMS, identityConfidenceCeiling, isExactIdentity, mayClaim,
  mergeByIdentity, readIdentityResolution, type IdentityMatchLevel, type IdentityResolution,
} from "./identityMatch.ts";
export {
  APPROVED_SOLD_PHRASES, FORBIDDEN_SOLD_PHRASES, INFERRED_SOLD_PRICE_LABEL, assertInferredSoldWording,
  checkInferredSoldWording, isAcceptableSoldColumnName,
} from "./soldLanguage.ts";
export {
  buildProviderEnvelope, classifyOutcome, envelopeFresh, filtersDiverged,
  type ProviderResultEnvelope, type EnvelopeInput, type ProviderOutcomeClass,
} from "./providerEnvelope.ts";
export { resolveDealershipGroup, sameDealershipGroup, dealerGroupMayInfluence, type DealershipGroupIdentity } from "./dealerGroup.ts";
export {
  COHORT_MATCH_LEVELS, COHORT_REFRESH_DAYS, buildCohortLadder, cohortAnswerDue, recordCohortAnswer,
  type CohortMatchLevel, type LadderRung, type RecordedCohortAnswer,
} from "./cohortLadder.ts";
export {
  EQUIPMENT_CATEGORIES, INSTALLED_CATEGORIES, compareConfiguration, emptyEquipmentLedger, fileEquipment,
  installedEquipment, isInstalledCategory, type EquipmentCategory, type EquipmentLedger,
} from "./equipmentClass.ts";
export { classifyRawPayload, LEGACY_PRICING_SQL_PREDICATE, type RawPayloadKind } from "./rawPayloadBoundary.ts";
export { digest, stableStringify } from "./hash.ts";
