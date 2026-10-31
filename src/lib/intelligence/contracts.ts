// ── Vehicle Intelligence contracts ─────────────────────────────────────────
//
// One vocabulary for every conclusion the intelligence layer produces: the
// used Vehicle Score, Data Confidence, AutoLabels Market Value V3, Deal
// Rating, Buyer Recommendation, the title, condition, provenance, recall and
// market-context summaries, and the two Passport read models the later UI
// renders without recreating any of this logic (master build prompt
// sections 27, 28, 31 to 35; package files 07 and 08).
//
// Rules the types enforce rather than document:
//   - every material fact carries value, authority, confidence, freshness,
//     evidence and visibility; an unknown is a state, never a zero or a clean;
//   - identity exactness is the level from market/identityMatch.ts, so a
//     generic or YMM match can never carry an exact-only claim;
//   - the Vehicle Score is used-only and lists what may never raise it;
//   - the Market Value is a separate conclusion from the score, and the Deal
//     Rating compares a price with it without touching the score;
//   - new vehicles get verified states, not a 0-100 quality score.
//
// Pure types and small pure helpers only. No provider calls, no I/O.

import type { IdentityConfidenceCeiling, IdentityMatchLevel } from "../market/identityMatch.ts";
import type { CohortMatchLevel } from "../market/cohortLadder.ts";
import type { ComparableTier, MarketConfidence } from "../market/types.ts";
import type { RecallModelState, RecallVinState } from "../vehicleTruth/recallView.ts";

export const INTELLIGENCE_CONTRACT_VERSION = "vi-contracts-1.0.0";

// ── States, authority, freshness, evidence ────────────────────────────────

/** The six states a customer may see (package file 08). */
export const PUBLIC_STATES = ["verified", "warning", "adverse", "unknown", "stale", "unavailable"] as const;
export type PublicState = (typeof PUBLIC_STATES)[number];

/**
 * Authority is field-specific (section 28). These are the classes a source
 * can hold; which class wins for which fact is decided by the module that
 * owns the fact, never by one global provider ranking.
 */
export const AUTHORITY_CLASSES = [
  "government_record",   // NMVTIS / AAMVA title and odometer
  "manufacturer",        // OEM, NeoVIN factory build
  "verified_inspection", // AutoFilm, dealer inspection with evidence
  "dealer_system",       // DMS / repair orders
  "market_evidence",     // qualified comparables, validated prediction
  "provider_listing",    // syndication feed and listing fields
  "public_safety",       // NHTSA model-level campaigns
  "dealer_claim",        // marketing copy, website badge
  "customer_claim",      // self-report
  "unknown",
] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

/** Same ladder as vehicleTruth/precedence.ts, restated so this module stays dependency-light. */
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

const DAY_MS = 86_400_000;

const parseStamp = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** A fact with no check date is unknown-fresh; one past its TTL is stale. The UI never invents TTLs (file 08). */
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
  /** What kind of record backs the fact: report, inspection, photo, feed row, provider answer. */
  kind: string;
  id: string | null;
  /** A label fit for the visibility it carries; never a raw provider payload. */
  label: string | null;
  visibility: Visibility;
}

/** Every material fact resolves to this shape (section 27, last paragraph). */
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
    value: null, state: "unknown", authority: "unknown", source: null, confidence: "UNVERIFIED",
    freshness: { checkedAt: null, observedAt: null, ttlDays: null, staleAt: null, state: "unknown" },
    evidence: [], reasons: [reason], visibility,
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
  // A fact that has aged past its TTL is presented as stale whatever it said.
  const state: PublicState = freshness.state === "stale" && args.state === "verified" ? "stale" : args.state;
  return {
    value, state, authority: args.authority, source: args.source ?? null, confidence: args.confidence,
    freshness, evidence: args.evidence ?? [], reasons: args.reasons ?? [], visibility: args.visibility ?? "public",
  };
}

// ── Identity and configuration ────────────────────────────────────────────

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
  /**
   * True only when the VIN is exactly identified AND the decode says its
   * record came from factory build data (NeoVIN record_source build_oem or
   * build_specs). A non-generic decode built from listings identifies the VIN
   * but does not verify the factory build.
   */
  factoryVerified: boolean;
  decodeSource: DecodeSource;
  /** Where the decoded record came from, per the provider. */
  decodeAuthority: DecodeAuthority;
  /** The provider's record_source value as sent, or null. */
  recordSource: string | null;
  /** Normalized to 0-1 by an explicit adapter; null when the raw value or its scale is unknown. */
  providerConfidence: number | null;
  /** The raw value exactly as stored, and the scale the adapter applied to it. */
  providerConfidenceRaw: number | string | null;
  providerConfidenceScale: ConfidenceScale;
  freshness: Freshness;
}

export type DecodeAuthority = "factory_build" | "listing_derived" | "unknown";

/** "percent_0_100" is NeoVIN record_confidence, documented as max(0, 100 - penalty). */
export type ConfidenceScale = "percent_0_100" | "unit_0_1" | "unknown";

export interface FactoryPackage { name: string; msrp: number | null; installed: boolean }

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

// ── Offer, price integrity, availability, warranty, incentives ────────────

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

export interface PriceChannelObservation { channel: PriceChannel; price: number; observedAt: string | null }

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

export interface WarrantyTerm { name: string; months: number | null; miles: number | null }

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

// ── Title and odometer (section 16) ────────────────────────────────────────

export const TITLE_ODOMETER_STATES = [
  "VERIFIED_NO_ADVERSE_REPORTED", "ADVERSE", "REVIEW_REQUIRED", "NOT_VERIFIED",
] as const;
export type TitleOdometerState = (typeof TITLE_ODOMETER_STATES)[number];

export type OdometerStatus = "consistent" | "conflict" | "rollback_indicated" | "not_checked";

export interface OdometerReading { value: number; observedAt: string | null; source: string; authority: AuthorityClass }

export interface TitleOdometerSummary {
  state: TitleOdometerState;
  titleBrandsReported: string[];
  junkSalvageTotalLossReported: string[];
  odometerStatus: OdometerStatus;
  readings: OdometerReading[];
  reportDate: string | null;
  checkedAt: string | null;
  /** Evidence-exact wording, e.g. "No NMVTIS title brands reported as of <date>." Never "clean". */
  publicStatement: string;
  entitlementBlocked: boolean;
  providerFailed: boolean;
  reasons: string[];
  freshness: Freshness;
}

// ── Recall (section 17) ───────────────────────────────────────────────────

export const VIN_RECALL_CONTRACT_STATES = [
  "OPEN", "NO_OPEN", "CLOSED_CAMPAIGN_ONLY", "OEM_SERVICE_CAMPAIGN",
  "ENTITLEMENT_BLOCKED", "PROVIDER_UNAVAILABLE", "UNKNOWN",
] as const;
export type VinRecallContractState = (typeof VIN_RECALL_CONTRACT_STATES)[number];

export interface RecallSummary {
  vinState: VinRecallContractState;
  /** The stored vehicleTruth state this maps to, for surfaces that still read it. */
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

// ── Condition and provenance ──────────────────────────────────────────────

export type ConditionState = "verified" | "partial" | "self_reported" | "unknown";
export type ConditionSource = "autofilm" | "dealer_inspection" | "seller_report" | "none";
export type FindingSeverity = "minor" | "moderate" | "major";

export interface ConditionFinding { severity: FindingSeverity; label: string; resolved: boolean }

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
  "known_since_new", "serviced_here", "direct_trade", "dealer_buyback", "previous_dealer_sale", "first_seen", "unknown",
] as const;
export type ProvenanceDesignation = (typeof PROVENANCE_DESIGNATIONS)[number];

export interface ProvenanceSummary {
  designation: ProvenanceDesignation;
  soldHere: boolean | null;
  servicedHere: boolean | null;
  serviceVisits: number | null;
  /** Share of the vehicle's known service life seen by this dealer, 0 to 1. */
  serviceShare: number | null;
  yearsKnown: number | null;
  autofilmInspections: number | null;
  directTrade: boolean | null;
  facts: string[];
  source: "dms" | "dealer_claim" | "none";
  freshness: Freshness;
}

// ── Documentation on file (section 27, Safety / Documentation) ────────────

/** What the dealer holds for this vehicle; the score's documentation domain and the read models read it from one place. */
export interface DocumentationSummary {
  serviceRecordCount: number | null;
  inspectionEvidenceOnFile: boolean | null;
  warrantyDocumented: boolean | null;
  windowStickerOnFile: boolean | null;
  historyReportOnFile: boolean | null;
  source: "dealer_system" | "dealer_claim" | "none";
  freshness: Freshness;
}

// ── Comparable eligibility (section 11, 25) ───────────────────────────────

/** Why a candidate listing was kept out of the comparable set; recorded, never silent. */
export const COMPARABLE_EXCLUSION_REASONS = [
  "own_rooftop", "own_dealer_group", "aggregator_category", "marketing_category", "subject_vin",
  "fee_basis_unknown", "price_implausible", "identity_mismatch", "duplicate_vin", "outlier", "stale_listing",
] as const;
export type ComparableExclusionReason = (typeof COMPARABLE_EXCLUSION_REASONS)[number];

// ── Market context (sections 12 to 14) ────────────────────────────────────

export type SalesVelocity = "strong" | "steady" | "slow" | "unknown";
export type MarketTrend = "rising" | "stable" | "softening" | "unknown";

export interface MarketContextSummary {
  mdsDays: number | null;
  mdsScope: CohortMatchLevel | null;
  mdsCheckedAt: string | null;
  /** Days this listing has been live at the current dealer (provider dos_active). Optional until the reader lands. */
  daysOnSiteAtDealer?: number | null;
  /** Cumulative days the vehicle has been listed across dealers (provider dom_active). Optional until the reader lands. */
  daysOnMarketCumulative?: number | null;
  salesVelocity: SalesVelocity;
  velocityBasis: "inferred_sales_stats" | "mds_estimate" | "none";
  trend: MarketTrend;
  trendBasis: "sold_summary" | "none";
  /** The provider's sold figures are inferred from listings leaving the market; the copy must say so. */
  inferredSoldWording: true;
  freshness: Freshness;
}

// ── AutoLabels Market Value V3 (section 29) ───────────────────────────────

export type ValuationConfidence = MarketConfidence;
export type ProviderAgreement = "agree" | "disagree" | "single_signal" | "none";
export type GeographyScope = "local" | "regional" | "national" | "unknown";

export interface ValuationSignal {
  key: string;
  estimate: number | null;
  /** Share of the final estimate, 0 to 1; null when the signal was not used. */
  weight: number | null;
  used: boolean;
  reason: string;
}

export interface MarketValueV3 {
  algorithmVersion: string;
  estimatedValue: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  confidence: ValuationConfidence;
  confidenceReasons: string[];
  qualifiedCompCount: number;
  effectiveSampleSize: number;
  matchingTier: ComparableTier | null;
  identityLevel: IdentityMatchLevel;
  geography: { zip: string | null; radiusMiles: number | null; scope: GeographyScope };
  signals: ValuationSignal[];
  providerAgreement: ProviderAgreement;
  disagreementPct: number | null;
  /** Material disagreement is surfaced for investigation, never averaged away. */
  investigationFlagged: boolean;
  checkedAt: string | null;
  freshness: Freshness;
  /** Shadow until the flag market_value_v3_public is read by a server surface. */
  publishable: boolean;
}

// ── Used Vehicle Score and Data Confidence (sections 30, 31) ──────────────

export const SCORE_DOMAINS = ["integrity", "condition", "provenance", "documentation_safety"] as const;
export type ScoreDomainKey = (typeof SCORE_DOMAINS)[number];

/** Starting weights; calibrate before public lock, never change the core model by accident. */
export const SCORE_WEIGHTS: Record<ScoreDomainKey, number> = {
  integrity: 35,
  condition: 30,
  provenance: 20,
  documentation_safety: 15,
};

/** Inputs that may never raise the Vehicle Score (sections 30 and 37). */
export const SCORE_NEVER_INFLUENCED_BY = [
  "market_demand", "dealer_price", "deal_rating", "marketmatch", "auction", "fsbo", "cheapness",
  "market_days_supply", "sales_velocity", "incentives",
] as const;

export const SCORE_LABELS = ["Outstanding", "Excellent", "Good", "Fair", "Caution"] as const;
export type ScoreLabel = (typeof SCORE_LABELS)[number];

export interface ScoreDomainResult {
  key: ScoreDomainKey;
  weight: number;
  /** 0 to 100 within the domain; null when nothing in the domain could be assessed. */
  score: number | null;
  evidence: string[];
  adverse: string[];
  missing: string[];
}

export type ScorePublication = "eligible" | "provisional" | "insufficient_evidence" | "not_applicable";

export interface VehicleScoreResult {
  version: string;
  /** Null for new vehicles and when no domain could be assessed. Internal unless publication is eligible. */
  score: number | null;
  /** Null unless the result meets the public evidence minimum. */
  label: ScoreLabel | null;
  domains: ScoreDomainResult[];
  applicable: boolean;
  publication: ScorePublication;
  /** Share of total domain weight that was actually assessed, 0-100. */
  assessedWeightPct: number;
  missingDomains: ScoreDomainKey[];
  /** Freshness of the evidence behind the required domains; stale evidence blocks the public label. */
  evidenceFreshness: Record<"title_odometer" | "condition" | "recall", "current" | "stale" | "unknown">;
  policyVersion: string;
  reasons: string[];
}

export type DataConfidenceLevel = "high" | "moderate" | "limited";

export interface DataConfidenceResult {
  version: string;
  level: DataConfidenceLevel;
  /** Internal coverage figure; the public surface shows the level, not a false-precision percentage. */
  coveragePct: number | null;
  ceiling: IdentityConfidenceCeiling;
  domainCoverage: Record<ScoreDomainKey, number | null>;
  conflicts: string[];
  staleFacts: string[];
  reasons: string[];
}

// ── Deal Rating and Buyer Recommendation (sections 32, 33) ────────────────

export const DEAL_RATING_LABELS = [
  "great_value", "good_value", "fair_price", "above_market", "well_above_market", "unavailable",
] as const;
export type DealRatingLabel = (typeof DEAL_RATING_LABELS)[number];

/** Calibratable, configuration not UI constants. Percent of market value, signed; asking below value is negative. */
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
  "HIGHLY_RECOMMENDED", "RECOMMENDED", "CONSIDER", "REVIEW_BEFORE_PURCHASE", "NOT_ENOUGH_VERIFIED_INFORMATION",
] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];

export const HARD_GATES = [
  "unresolved_title_brand", "odometer_conflict", "identity_not_exact", "open_safety_recall",
  "do_not_drive", "major_condition_issue", "material_conflict",
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

// ── Passport read models (sections 34, 35; package file 07) ───────────────

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

export interface ScoreDomainView { key: ScoreDomainKey; score: number | null; weight: number }

export interface UsedPassportReadModel {
  passportVersion: "2.0";
  vehicleType: "used";
  vehicle: IdentitySummary;
  media: VehicleMedia;
  /** Score and label are null unless publication is eligible; a provisional file shows its coverage and missing domains instead. */
  vehicleScore: {
    score: number | null; label: ScoreLabel | null; version: string; domains: ScoreDomainView[];
    publication: ScorePublication; assessedWeightPct: number; missingDomains: ScoreDomainKey[];
    evidenceFreshness: VehicleScoreResult["evidenceFreshness"];
  };
  dataConfidence: { level: DataConfidenceLevel; coveragePct?: number; reasons: string[] };
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

/** New vehicles never carry the used score; the type has no slot for it, and this guard says so at run time too. */
export const isNewPassport = (m: UsedPassportReadModel | NewPassportReadModel): m is NewPassportReadModel =>
  m.vehicleType === "new";

/** What the public read models must never contain (file 07). */
export const FORBIDDEN_READ_MODEL_KEYS = [
  "mc_raw", "api_key", "apiKey", "rawProvider", "raw_payload", "provider_pricing", "report_body", "aamva_report",
] as const;

export function containsForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > 12 || value == null || typeof value !== "object") return null;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_READ_MODEL_KEYS as readonly string[]).includes(k)) return k;
    const inner = containsForbiddenKey(v, depth + 1);
    if (inner) return inner;
  }
  return null;
}
