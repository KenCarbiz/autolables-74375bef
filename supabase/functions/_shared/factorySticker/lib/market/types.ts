// GENERATED — do not edit.
// Mirror of src/lib/market/types.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const MARKET_ENGINE_VERSION = "v2.0.0-shadow";
export const PRICE_BASIS_TOLERANCE = 1;
export type PriceBasisStatus = "verified" | "ambiguous" | "invalid";
export interface MarketPriceBasis {
    displayedTotalPrice: number | null;
    vehicleComparisonPrice: number | null;
    advertisedPriceBeforeDoc: number | null;
    docFee: number | null;
    mandatoryDealerAddOns: number | null;
    mandatoryAddOnsIncludedInDisplayedPrice: boolean | null;
    mandatoryAddOnSource: "vehicle" | "tenant_default" | "unknown";
    totalWithMandatoryAddOns: number | null;
    conditionalDiscountsExcluded: number | null;
    governmentFeesIncluded: false;
    advertisedIncludesDocFee: boolean | null;
    basisStatus: PriceBasisStatus;
    basisReasons: string[];
    provenance: Record<string, unknown>;
}
export type SubjectCondition = "new" | "used" | "cpo";
export type DealerType = "franchise" | "independent";
export interface MarketPredictionRequest {
    vin: string;
    miles: number;
    dealerType: DealerType;
    zip?: string;
    city?: string;
    state?: string;
    isCertified: boolean;
    subjectCondition: SubjectCondition;
    requestVersion: string;
}
export type ProviderResponseField = "marketcheck_price" | "predicted_price" | "price" | "market_price" | "mean_price" | "price_stats.mean";
export interface ProviderValuation {
    provider: "marketcheck";
    endpointVersion: string;
    selectedField: ProviderResponseField;
    predictedValue: number;
    providerRangeLow: number | null;
    providerRangeHigh: number | null;
    providerRangeMeaning: string | null;
    providerCertifiedEcho: boolean | null;
    requestFingerprint: string;
    responseHash: string;
    requestedAt: string;
    receivedAt: string;
    rawResponseSanitized: Record<string, unknown>;
}
export type ProviderRejectionCode = "invalid_vin" | "missing_mileage" | "implausible_mileage" | "missing_dealer_type" | "missing_location" | "provider_input_mismatch" | "provider_certification_conflict" | "specification_conflict" | "missing_prediction" | "implausible_prediction" | "inverted_range" | "stale_response" | "unreconstructable_request";
export interface ProviderValidation {
    usable: boolean;
    rejections: ProviderRejectionCode[];
    cautions: string[];
}
export type ComparableInclusion = "primary" | "secondary" | "context_only" | "excluded";
export type HistoryStatus = "clean" | "adverse" | "unknown";
export type ConditionStatus = "verified" | "unknown";
export type ComparablePriceBasis = "verified" | "unknown" | "invalid";
export type ComparableTier = "A" | "B50" | "B100" | "B200" | "C" | "D" | "E" | "F";
export interface MarketComparable {
    vin: string;
    listingId: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    drivetrain: string | null;
    powertrain: string | null;
    transmission: string | null;
    mileage: number | null;
    advertisedPrice: number | null;
    normalizedVehiclePrice: number | null;
    priceBasisStatus: ComparablePriceBasis;
    certified: boolean | null;
    certificationProgram: string | null;
    dealerName: string | null;
    dealerId: string | null;
    rooftopId: string | null;
    dealerGroupId: string | null;
    dealerGroupName: string | null;
    dealerDomain: string | null;
    dealerType: string | null;
    distanceMiles: number | null;
    daysOnMarket: number | null;
    listingObservedAt: string | null;
    equipmentCodes: string[];
    historyStatus: HistoryStatus;
    conditionStatus: ConditionStatus;
    inclusionStatus: ComparableInclusion;
    exclusionReasons: string[];
    similarityComponents: Record<string, number | null>;
    rawWeight: number;
    cappedWeight: number;
    adjustedPrice: number | null;
}
export interface ComparableCandidate {
    vin?: unknown;
    listingId?: unknown;
    year?: unknown;
    make?: unknown;
    model?: unknown;
    trim?: unknown;
    drivetrain?: unknown;
    powertrain?: unknown;
    transmission?: unknown;
    mileage?: unknown;
    price?: unknown;
    docFeeIncluded?: unknown;
    docFee?: unknown;
    certified?: unknown;
    certificationProgram?: unknown;
    dealerName?: unknown;
    dealerId?: unknown;
    rooftopId?: unknown;
    dealerGroupId?: unknown;
    dealerGroupName?: unknown;
    dealerDomain?: unknown;
    dealerType?: unknown;
    distanceMiles?: unknown;
    daysOnMarket?: unknown;
    observedAt?: unknown;
    equipmentCodes?: unknown;
    historyStatus?: unknown;
    conditionStatus?: unknown;
}
export interface WeightedStats {
    rawCandidateCount: number;
    eligiblePrimaryCount: number;
    independentRooftopCount: number;
    independentGroupCount: number;
    effectiveSampleSize: number;
    p10: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
    mean: number | null;
    stdDev: number | null;
    mad: number | null;
    topRooftopShare: number;
    topGroupShare: number;
    effectiveRooftopCap: number;
    effectiveGroupCap: number;
    strictConcentrationSatisfied: boolean;
    insufficientMarketDiversity: boolean;
    marketFloor: number | null;
}
export type MarketConfidence = "high" | "medium" | "low" | "unavailable";
export type MarketVerdict = "Market Estimate Unavailable" | "Limited Market Evidence" | "Competitive Market Position" | "Below Adjusted Market" | "Within Adjusted Market" | "High End of Adjusted Market" | "High End of Adjusted Market \u2014 Review Recommended" | "Above Adjusted Market";
export type VerdictTone = "neutral" | "green" | "amber" | "red";
export interface VerdictResult {
    verdict: MarketVerdict;
    tone: VerdictTone;
    difference: number | null;
    differencePercent: number | null;
    priceToMarketPercent: number | null;
    buffer: number | null;
    reasons: string[];
}
export type MarketViewStatus = "available" | "limited" | "unavailable";
export interface MarketView {
    status: MarketViewStatus;
    displayedTotalPrice: number | null;
    vehicleComparisonPrice: number | null;
    docFee: number | null;
    marketP50: number | null;
    rangeLow: number | null;
    rangeHigh: number | null;
    rangeLabel: string | null;
    marketFloor: number | null;
    difference: number | null;
    differencePercent: number | null;
    priceToMarketPercent: number | null;
    verdict: string;
    confidence: MarketConfidence;
    confidenceReasons: string[];
    rawComparableCount: number;
    effectiveComparableCount: number;
    independentDealerCount: number;
    provider: string | null;
    selectedProviderField: string | null;
    checkedAt: string | null;
    staleAt: string | null;
    explanationAvailable: boolean;
}
export interface MarketExplanation {
    engineVersion: string;
    providerRequestFingerprint: string | null;
    valuationInputFingerprint: string;
    comparableSnapshotHash: string;
    priceBasis: MarketPriceBasis;
    providerValidation: ProviderValidation;
    provider: ProviderValuation | null;
    winningTier: ComparableTier | null;
    relaxationSteps: string[];
    comparables: MarketComparable[];
    stats: WeightedStats;
    confidence: MarketConfidence;
    confidenceReasons: string[];
    verdict: VerdictResult;
    tone: VerdictTone;
    shadowComposite: ShadowComposite | null;
}
export interface ShadowComposite {
    value: number | null;
    signals: {
        key: string;
        estimate: number | null;
        quality: number;
        share: number;
    }[];
    publishable: false;
    reasons: string[];
}
