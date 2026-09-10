// ── Market Intelligence V2 — the shared contracts ───────────────────────────
//
// Six things this product used to answer with one number, and the reason the
// QX50 shows "$4,718 Above Market" on a car nobody has actually priced:
//
//   1. what the customer is asked to pay        (displayedTotalPrice)
//   2. what the VEHICLE costs, fee excluded     (vehicleComparisonPrice)
//   3. what a provider predicts it is worth     (ProviderValuation)
//   4. what qualified competitors are asking    (ComparableEvidence)
//   5. how much any of that can be trusted      (MarketConfidence)
//   6. where the dealer should choose to price  (PricingPosition — separate)
//
// They are separate types on purpose. A fee-inclusive number and a
// fee-exclusive number are both "the price", and the whole defect class this
// module exists to end is one of them being handed to a function expecting the
// other. Nothing downstream may re-derive any of these; every surface reads
// the assembled MarketView.

/** The algorithm version stamped onto every valuation record. */
export const MARKET_ENGINE_VERSION = "v2.0.0-shadow";

/** Dollar tolerance for the price-basis identity. Section 4 rule 5. */
export const PRICE_BASIS_TOLERANCE = 1;

// ── 1. Price truth ─────────────────────────────────────────────────────────

export type PriceBasisStatus = "verified" | "ambiguous" | "invalid";

export interface MarketPriceBasis {
  /** What the customer is asked to pay, before government tax, title and registration. */
  displayedTotalPrice: number | null;
  /** Vehicle selling price, dealer doc/conveyance fee excluded. THE market-comparison price. */
  vehicleComparisonPrice: number | null;
  advertisedPriceBeforeDoc: number | null;
  docFee: number | null;
  /** Dealer-installed products the customer cannot decline. Disclosed, never folded into the comparison. */
  mandatoryDealerAddOns: number | null;
  /** Incentives not available to every buyer, added BACK so they cannot lower the comparison price. */
  conditionalDiscountsExcluded: number | null;
  /** Always false: tax, title and registration are never inside either price. */
  governmentFeesIncluded: false;
  /** Whether the tenant's advertised price already contains the doc fee. Null when unknown. */
  advertisedIncludesDocFee: boolean | null;
  basisStatus: PriceBasisStatus;
  basisReasons: string[];
  provenance: Record<string, unknown>;
}

// ── 2. Provider valuation ──────────────────────────────────────────────────

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

export type ProviderResponseField =
  | "marketcheck_price"
  | "predicted_price"
  | "price"
  | "market_price"
  | "mean_price"
  | "price_stats.mean";

export interface ProviderValuation {
  provider: "marketcheck";
  endpointVersion: string;
  selectedField: ProviderResponseField;
  predictedValue: number;
  providerRangeLow: number | null;
  providerRangeHigh: number | null;
  /** What the provider says its own range means. Never assumed to be a confidence interval. */
  providerRangeMeaning: string | null;
  /** What the response echoed back for certification. Null when the endpoint does not echo. */
  providerCertifiedEcho: boolean | null;
  requestFingerprint: string;
  responseHash: string;
  requestedAt: string;
  receivedAt: string;
  rawResponseSanitized: Record<string, unknown>;
}

/** Why a provider answer may not be used. Section 5. */
export type ProviderRejectionCode =
  | "invalid_vin"
  | "missing_mileage"
  | "implausible_mileage"
  | "missing_dealer_type"
  | "missing_location"
  | "provider_input_mismatch"
  | "provider_certification_conflict"
  | "specification_conflict"
  | "missing_prediction"
  | "implausible_prediction"
  | "inverted_range"
  | "stale_response"
  | "unreconstructable_request";

export interface ProviderValidation {
  usable: boolean;
  rejections: ProviderRejectionCode[];
  /** Softer findings that lower confidence without invalidating the answer. */
  cautions: string[];
}

// ── 3. Comparable evidence ─────────────────────────────────────────────────

export type ComparableInclusion = "primary" | "secondary" | "context_only" | "excluded";
export type HistoryStatus = "clean" | "adverse" | "unknown";
export type ConditionStatus = "verified" | "unknown";
export type ComparablePriceBasis = "verified" | "unknown" | "invalid";

/** The relaxation ladder. Never widened silently; the winner is recorded. */
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
  /** null means UNKNOWN certification. It never means "not certified". */
  certified: boolean | null;
  certificationProgram: string | null;
  dealerName: string | null;
  dealerId: string | null;
  rooftopId: string | null;
  dealerGroupId: string | null;
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

/** A raw candidate as it arrives from a provider or a stored snapshot. */
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
  dealerDomain?: unknown;
  dealerType?: unknown;
  distanceMiles?: unknown;
  daysOnMarket?: unknown;
  observedAt?: unknown;
  equipmentCodes?: unknown;
  historyStatus?: unknown;
  conditionStatus?: unknown;
}

// ── 4. Statistics ──────────────────────────────────────────────────────────

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
  /** Largest share of total weight held by one rooftop, 0–1. */
  topRooftopShare: number;
  topGroupShare: number;
  /** The tightest share actually enforceable given how many sources exist. */
  effectiveRooftopCap: number;
  effectiveGroupCap: number;
  /**
   * TRUE only when the strict 20% rule was genuinely met — five or more
   * independent sources AND no source above 0.20. A relaxed 1/n allocation is
   * never reported as satisfying it.
   */
  strictConcentrationSatisfied: boolean;
  /** Fewer than five independent qualified external sources. */
  insufficientMarketDiversity: boolean;
  marketFloor: number | null;
}

// ── 5. Confidence and verdict ──────────────────────────────────────────────

export type MarketConfidence = "high" | "medium" | "low" | "unavailable";

export type MarketVerdict =
  | "Market Estimate Unavailable"
  | "Limited Market Evidence"
  | "Competitive Market Position"
  | "Below Adjusted Market"
  | "Within Adjusted Market"
  | "High End of Adjusted Market"
  | "High End of Adjusted Market — Review Recommended"
  | "Above Adjusted Market";

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

// ── 6. The one DTO every surface reads ─────────────────────────────────────

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

/** Everything a UI or an auditor needs to reconstruct a verdict. Never public verbatim. */
export interface MarketExplanation {
  engineVersion: string;
  /** What the provider was asked. Excludes price, so a price change is free. */
  providerRequestFingerprint: string | null;
  /** The whole decision. Moves whenever any input to the conclusion moves. */
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
  /** Shadow-only. Never rendered while the composite is unvalidated. */
  shadowComposite: ShadowComposite | null;
}

export interface ShadowComposite {
  value: number | null;
  signals: { key: string; estimate: number | null; quality: number; share: number }[];
  publishable: false;
  reasons: string[];
}
