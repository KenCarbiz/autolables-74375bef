// GENERATED — do not edit.
// Mirror of src/lib/intelligence/contracts.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { IdentityConfidenceCeiling, IdentityMatchLevel } from "../market/identityMatch.ts";
import type { CohortMatchLevel } from "../market/cohortLadder.ts";
import type { ComparableTier, MarketConfidence } from "../market/types.ts";
import type { RecallModelState, RecallVinState } from "../vehicleTruth/recallView.ts";
export const INTELLIGENCE_CONTRACT_VERSION = "vi-contracts-1.0.0";
export const PUBLIC_STATES = ["verified", "warning", "adverse", "unknown", "stale", "unavailable"] as const;
export type PublicState = (typeof PUBLIC_STATES)[number];
export const AUTHORITY_CLASSES = [
    "government_record",
    "manufacturer",
    "verified_inspection",
    "dealer_system",
    "market_evidence",
    "provider_listing",
    "public_safety",
    "dealer_claim",
    "customer_claim",
    "unknown",
] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];
export const FACT_CONFIDENCE_LEVELS = ["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"] as const;
export type FactConfidence = (typeof FACT_CONFIDENCE_LEVELS)[number];
export type Visibility = "public" | "dealer" | "internal";
export type FreshnessState = "current" | "stale" | "unknown";
export interface Freshness {
    checkedAt: string | null;
    observedAt: string | null;
    ttlDays: number | null;
    staleAt: string | null;
    state: FreshnessState;
}
const DAY_MS = 86400000;
const parseStamp = (v: string | null | undefined): number | null => {
    if (!v)
        return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
};
export function resolveFreshness(args: {
    checkedAt: string | null | undefined;
    observedAt?: string | null;
    ttlDays: number | null | undefined;
    nowMs: number;
}): Freshness {
    const checked = parseStamp(args.checkedAt);
    const ttl = args.ttlDays != null && Number.isFinite(args.ttlDays) && args.ttlDays > 0 ? args.ttlDays : null;
    if (checked == null) {
        return { checkedAt: null, observedAt: args.observedAt ?? null, ttlDays: ttl, staleAt: null, state: "unknown" };
    }
    const staleAtMs = ttl != null ? checked + ttl * DAY_MS : null;
    return {
        checkedAt: new Date(checked).toISOString(),
        observedAt: args.observedAt ?? null,
        ttlDays: ttl,
        staleAt: staleAtMs != null ? new Date(staleAtMs).toISOString() : null,
        state: staleAtMs != null && args.nowMs > staleAtMs ? "stale" : "current",
    };
}
export interface EvidenceRef {
    kind: string;
    id: string | null;
    label: string | null;
    visibility: Visibility;
}
export interface Fact<T> {
    value: T | null;
    state: PublicState;
    authority: AuthorityClass;
    source: string | null;
    confidence: FactConfidence;
    freshness: Freshness;
    evidence: EvidenceRef[];
    reasons: string[];
    visibility: Visibility;
}
export function unknownFact<T>(reason: string, visibility: Visibility = "public"): Fact<T> {
    return {
        value: null,
        state: "unknown",
        authority: "unknown",
        source: null,
        confidence: "UNVERIFIED",
        freshness: { checkedAt: null, observedAt: null, ttlDays: null, staleAt: null, state: "unknown" },
        evidence: [],
        reasons: [reason],
        visibility,
    };
}
export function makeFact<T>(value: T | null, args: {
    state: PublicState;
    authority: AuthorityClass;
    source?: string | null;
    confidence: FactConfidence;
    checkedAt?: string | null;
    observedAt?: string | null;
    ttlDays?: number | null;
    nowMs: number;
    evidence?: EvidenceRef[];
    reasons?: string[];
    visibility?: Visibility;
}): Fact<T> {
    const freshness = resolveFreshness({ checkedAt: args.checkedAt ?? null, observedAt: args.observedAt ?? null, ttlDays: args.ttlDays ?? null, nowMs: args.nowMs });
    const state: PublicState = freshness.state === "stale" && args.state === "verified" ? "stale" : args.state;
    return {
        value,
        state,
        authority: args.authority,
        source: args.source ?? null,
        confidence: args.confidence,
        freshness,
        evidence: args.evidence ?? [],
        reasons: args.reasons ?? [],
        visibility: args.visibility ?? "public",
    };
}
export type DecodeSource = "neovin" | "basic_decode" | "feed" | "none";
export interface IdentitySummary {
    vin: string;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    version: string | null;
    drivetrain: string | null;
    engine: string | null;
    transmission: string | null;
    exteriorColor: string | null;
    interiorColor: string | null;
    mileage: number | null;
    matchLevel: IdentityMatchLevel;
    factoryVerified: boolean;
    decodeSource: DecodeSource;
    decodeAuthority: DecodeAuthority;
    recordSource: string | null;
    providerConfidence: number | null;
    providerConfidenceRaw: number | string | null;
    providerConfidenceScale: ConfidenceScale;
    freshness: Freshness;
}
export type DecodeAuthority = "factory_build" | "listing_derived" | "unknown";
export type ConfidenceScale = "percent_0_100" | "unit_0_1" | "unknown";
export interface FactoryPackage {
    name: string;
    msrp: number | null;
    installed: boolean;
}
export interface MsrpBreakdown {
    baseMsrp: number | null;
    installedOptionsMsrp: number | null;
    destination: number | null;
    configuredMsrp: number | null;
    packages: FactoryPackage[];
    source: DecodeSource;
    state: PublicState;
    freshness: Freshness;
}
export type FeeBasis = "included" | "excluded" | "unknown";
export type PriceChannel = "feed" | "website" | "marketplace";
export interface DealerOfferSummary {
    advertisedPrice: number | null;
    feeBasis: FeeBasis;
    fees: number | null;
    docFee: number | null;
    websiteSalePrice: number | null;
    priceTerm: string | null;
    channel: PriceChannel | null;
    observedAt: string | null;
    freshness: Freshness;
    state: PublicState;
}
export type PriceIntegrityState = "consistent" | "channel_mismatch" | "stale_channel" | "single_channel" | "unknown";
export interface PriceChannelObservation {
    channel: PriceChannel;
    price: number;
    observedAt: string | null;
}
export interface PriceIntegritySummary {
    state: PriceIntegrityState;
    channels: PriceChannelObservation[];
    maxDeltaDollars: number | null;
    reasons: string[];
}
export type AvailabilityState = "available" | "in_transit" | "pending" | "sold" | "unknown";
export interface AvailabilitySummary {
    state: AvailabilityState;
    inTransit: boolean | null;
    vehicleStatus: string | null;
    lastSeenInFeedAt: string | null;
    freshness: Freshness;
}
export interface WarrantyTerm {
    name: string;
    months: number | null;
    miles: number | null;
}
export interface WarrantySummary {
    terms: WarrantyTerm[];
    basis: "original_factory" | "remaining" | "unknown";
    inServiceDate: string | null;
    remainingCoverage: "calculated" | "not_calculated_without_in_service_date" | "unknown";
    source: string | null;
    freshness: Freshness;
    state: PublicState;
}
export type IncentiveType = "cash" | "finance" | "lease" | "other";
export interface IncentiveSummary {
    title: string;
    type: IncentiveType;
    amount: number | null;
    apr: number | null;
    termMonths: number | null;
    validThrough: string | null;
    eligibility: string | null;
    source: string | null;
    freshness: Freshness;
}
export const TITLE_ODOMETER_STATES = [
    "VERIFIED_NO_ADVERSE_REPORTED",
    "ADVERSE",
    "REVIEW_REQUIRED",
    "NOT_VERIFIED",
] as const;
export type TitleOdometerState = (typeof TITLE_ODOMETER_STATES)[number];
export type OdometerStatus = "consistent" | "conflict" | "rollback_indicated" | "not_checked";
export interface OdometerReading {
    value: number;
    observedAt: string | null;
    source: string;
    authority: AuthorityClass;
}
export interface TitleOdometerSummary {
    state: TitleOdometerState;
    titleBrandsReported: string[];
    junkSalvageTotalLossReported: string[];
    odometerStatus: OdometerStatus;
    readings: OdometerReading[];
    reportDate: string | null;
    checkedAt: string | null;
    publicStatement: string;
    entitlementBlocked: boolean;
    providerFailed: boolean;
    reasons: string[];
    freshness: Freshness;
}
export const VIN_RECALL_CONTRACT_STATES = [
    "OPEN",
    "NO_OPEN",
    "CLOSED_CAMPAIGN_ONLY",
    "OEM_SERVICE_CAMPAIGN",
    "ENTITLEMENT_BLOCKED",
    "PROVIDER_UNAVAILABLE",
    "UNKNOWN",
] as const;
export type VinRecallContractState = (typeof VIN_RECALL_CONTRACT_STATES)[number];
export interface RecallSummary {
    vinState: VinRecallContractState;
    truthState: RecallVinState | null;
    openCount: number | null;
    closedCount: number | null;
    modelState: RecallModelState | null;
    modelCampaignCount: number | null;
    doNotDrive: boolean;
    checkedAt: string | null;
    publicState: PublicState;
    publicStatement: string;
    freshness: Freshness;
}
export type ConditionState = "verified" | "partial" | "self_reported" | "unknown";
export type ConditionSource = "autofilm" | "dealer_inspection" | "seller_report" | "none";
export type FindingSeverity = "minor" | "moderate" | "major";
export interface ConditionFinding {
    severity: FindingSeverity;
    label: string;
    resolved: boolean;
}
export interface ConditionSummary {
    state: ConditionState;
    source: ConditionSource;
    inspectionDate: string | null;
    tires32nds: number[];
    brakesMm: number[];
    openItems: number | null;
    completedRecon: number | null;
    findings: ConditionFinding[];
    reasons: string[];
    freshness: Freshness;
}
export const PROVENANCE_DESIGNATIONS = [
    "known_since_new",
    "serviced_here",
    "direct_trade",
    "dealer_buyback",
    "previous_dealer_sale",
    "first_seen",
    "unknown",
] as const;
export type ProvenanceDesignation = (typeof PROVENANCE_DESIGNATIONS)[number];
export interface ProvenanceSummary {
    designation: ProvenanceDesignation;
    soldHere: boolean | null;
    servicedHere: boolean | null;
    serviceVisits: number | null;
    serviceShare: number | null;
    yearsKnown: number | null;
    autofilmInspections: number | null;
    directTrade: boolean | null;
    facts: string[];
    source: "dms" | "dealer_claim" | "none";
    freshness: Freshness;
}
export interface DocumentationSummary {
    serviceRecordCount: number | null;
    inspectionEvidenceOnFile: boolean | null;
    warrantyDocumented: boolean | null;
    windowStickerOnFile: boolean | null;
    historyReportOnFile: boolean | null;
    source: "dealer_system" | "dealer_claim" | "none";
    freshness: Freshness;
}
export const COMPARABLE_EXCLUSION_REASONS = [
    "own_rooftop",
    "own_dealer_group",
    "aggregator_category",
    "marketing_category",
    "subject_vin",
    "fee_basis_unknown",
    "price_implausible",
    "identity_mismatch",
    "duplicate_vin",
    "outlier",
    "stale_listing",
] as const;
export type ComparableExclusionReason = (typeof COMPARABLE_EXCLUSION_REASONS)[number];
export type SalesVelocity = "strong" | "steady" | "slow" | "unknown";
export type MarketTrend = "rising" | "stable" | "softening" | "unknown";
export interface MarketContextSummary {
    mdsDays: number | null;
    mdsScope: CohortMatchLevel | null;
    mdsCheckedAt: string | null;
    daysOnSiteAtDealer?: number | null;
    daysOnMarketCumulative?: number | null;
    salesVelocity: SalesVelocity;
    velocityBasis: "inferred_sales_stats" | "mds_estimate" | "none";
    trend: MarketTrend;
    trendBasis: "sold_summary" | "none";
    inferredSoldWording: true;
    freshness: Freshness;
}
export type ValuationConfidence = MarketConfidence;
export type ProviderAgreement = "agree" | "disagree" | "single_signal" | "none";
export type GeographyScope = "local" | "regional" | "national" | "unknown";
export interface ValuationSignal {
    key: string;
    estimate: number | null;
    weight: number | null;
    used: boolean;
    reason: string;
}
export interface MarketValueV3 {
    algorithmVersion: string;
    estimatedValue: number | null;
    rangeLow: number | null;
    rangeHigh: number | null;
    rangeMethod?: "comparable_weighted_p25_p75" | "provider_reported_range" | "configured_fallback_band" | "none";
    rangeWidenedForDisagreement?: boolean;
    confidence: ValuationConfidence;
    confidenceReasons: string[];
    qualifiedCompCount: number;
    effectiveSampleSize: number;
    matchingTier: ComparableTier | null;
    identityLevel: IdentityMatchLevel;
    geography: {
        zip: string | null;
        radiusMiles: number | null;
        scope: GeographyScope;
    };
    signals: ValuationSignal[];
    providerAgreement: ProviderAgreement;
    disagreementPct: number | null;
    investigationFlagged: boolean;
    checkedAt: string | null;
    freshness: Freshness;
    publishable: boolean;
}
export const SCORE_DOMAINS = ["integrity", "condition", "provenance", "documentation_safety"] as const;
export type ScoreDomainKey = (typeof SCORE_DOMAINS)[number];
export const SCORE_WEIGHTS: Record<ScoreDomainKey, number> = {
    integrity: 35,
    condition: 30,
    provenance: 20,
    documentation_safety: 15,
};
export const SCORE_NEVER_INFLUENCED_BY = [
    "market_demand",
    "dealer_price",
    "deal_rating",
    "marketmatch",
    "auction",
    "fsbo",
    "cheapness",
    "market_days_supply",
    "sales_velocity",
    "incentives",
] as const;
export const SCORE_LABELS = ["Outstanding", "Excellent", "Good", "Fair", "Caution"] as const;
export type ScoreLabel = (typeof SCORE_LABELS)[number];
export interface ScoreDomainResult {
    key: ScoreDomainKey;
    weight: number;
    score: number | null;
    evidence: string[];
    adverse: string[];
    missing: string[];
}
export type ScorePublication = "eligible" | "provisional" | "insufficient_evidence" | "not_applicable";
export interface VehicleScoreResult {
    version: string;
    score: number | null;
    label: ScoreLabel | null;
    domains: ScoreDomainResult[];
    applicable: boolean;
    publication: ScorePublication;
    assessedWeightPct: number;
    missingDomains: ScoreDomainKey[];
    policyVersion: string;
    reasons: string[];
}
export type DataConfidenceLevel = "high" | "moderate" | "limited";
export interface DataConfidenceResult {
    version: string;
    level: DataConfidenceLevel;
    coveragePct: number | null;
    ceiling: IdentityConfidenceCeiling;
    domainCoverage: Record<ScoreDomainKey, number | null>;
    conflicts: string[];
    staleFacts: string[];
    reasons: string[];
}
export const DEAL_RATING_LABELS = [
    "great_value",
    "good_value",
    "fair_price",
    "above_market",
    "well_above_market",
    "unavailable",
] as const;
export type DealRatingLabel = (typeof DEAL_RATING_LABELS)[number];
export interface DealRatingThresholds {
    greatValueMaxPct: number;
    goodValueMaxPct: number;
    fairPriceMaxPct: number;
    aboveMarketMaxPct: number;
}
export interface DealRatingResult {
    version: string;
    label: DealRatingLabel;
    askingPrice: number | null;
    marketValue: number | null;
    deltaDollars: number | null;
    deltaPct: number | null;
    valuationConfidence: ValuationConfidence;
    thresholds: DealRatingThresholds;
    applicable: boolean;
    reasons: string[];
}
export const RECOMMENDATION_STATES = [
    "HIGHLY_RECOMMENDED",
    "RECOMMENDED",
    "CONSIDER",
    "REVIEW_BEFORE_PURCHASE",
    "NOT_ENOUGH_VERIFIED_INFORMATION",
] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];
export const HARD_GATES = [
    "unresolved_title_brand",
    "odometer_conflict",
    "identity_not_exact",
    "open_safety_recall",
    "do_not_drive",
    "major_condition_issue",
    "material_conflict",
] as const;
export type HardGate = (typeof HARD_GATES)[number];
export interface BuyerRecommendationResult {
    version: string;
    state: RecommendationState;
    reasons: string[];
    hardGates: HardGate[];
    inputsUsed: string[];
    applicable: boolean;
}
export interface VehicleMedia {
    heroImageUrl: string | null;
    photoCount: number;
    photos: string[];
}
export interface FreshnessSummary {
    key: string;
    label: string;
    checkedAt: string | null;
    state: PublicState;
    ttlDays: number | null;
    source: string | null;
}
export interface ScoreDomainView {
    key: ScoreDomainKey;
    score: number | null;
    weight: number;
}
export interface UsedPassportReadModel {
    passportVersion: "2.0";
    vehicleType: "used";
    vehicle: IdentitySummary;
    media: VehicleMedia;
    vehicleScore: {
        score: number | null;
        label: ScoreLabel | null;
        version: string;
        domains: ScoreDomainView[];
        publication: ScorePublication;
        assessedWeightPct: number;
        missingDomains: ScoreDomainKey[];
    };
    dataConfidence: {
        level: DataConfidenceLevel;
        coveragePct?: number;
        reasons: string[];
    };
    titleOdometer: TitleOdometerSummary;
    dealerProvenance: ProvenanceSummary;
    condition: ConditionSummary;
    marketValue: MarketValueV3;
    askingPrice: number | null;
    dealRating: DealRatingResult | null;
    buyerRecommendation: BuyerRecommendationResult;
    marketContext: MarketContextSummary;
    recall: RecallSummary;
    freshness: FreshnessSummary[];
}
export interface NewPassportReadModel {
    passportVersion: "2.0";
    vehicleType: "new";
    vehicle: IdentitySummary;
    media: VehicleMedia;
    factoryVerified: Fact<boolean>;
    configuration: IdentitySummary;
    msrp: MsrpBreakdown;
    dealerOffer: DealerOfferSummary;
    incentives: IncentiveSummary[];
    priceIntegrity: PriceIntegritySummary;
    availability: AvailabilitySummary;
    warranty: WarrantySummary;
    recall: RecallSummary;
    freshness: FreshnessSummary[];
}
export const isNewPassport = (m: UsedPassportReadModel | NewPassportReadModel): m is NewPassportReadModel => m.vehicleType === "new";
export const FORBIDDEN_READ_MODEL_KEYS = [
    "mc_raw",
    "api_key",
    "apiKey",
    "rawProvider",
    "raw_payload",
    "provider_pricing",
    "report_body",
    "aamva_report",
] as const;
export function containsForbiddenKey(value: unknown, depth = 0): string | null {
    if (depth > 12 || value == null || typeof value !== "object")
        return null;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if ((FORBIDDEN_READ_MODEL_KEYS as readonly string[]).includes(k))
            return k;
        const inner = containsForbiddenKey(v, depth + 1);
        if (inner)
            return inner;
    }
    return null;
}
