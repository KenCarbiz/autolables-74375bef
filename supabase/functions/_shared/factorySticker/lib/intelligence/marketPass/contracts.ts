// GENERATED — do not edit.
// Mirror of src/lib/intelligence/marketPass/contracts.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── MarketPass V2 assessment contracts ─────────────────────────────────────
//
// Four indicators, kept apart on purpose:
//   Price Fairness       public   asking price against defensible market evidence
//   Vehicle Confidence   public   vehicle and history evidence; no price input
//   Market Desirability  dealer   0-100 market supply and turnover; no page views
//   Data Confidence      dealer   0-100 evidence coverage, freshness, authority, conflicts
//
// Every equation, threshold and label here is PROPOSED and not approved by the
// owner. It runs only behind the marketpass_v2 flag, which defaults off.
//
// The gauge segments, their labels and colors travel inside the contract, so a
// renderer (AutoLabels or AutoFilm) draws what the server decided and holds no
// threshold of its own.

import type { AuthorityClass, FreshnessState } from "../contracts.ts";

export const MARKETPASS_ASSESSMENT_VERSION = "marketpass-assessment-0.1.0-proposed";
export const PRICE_FAIRNESS_VERSION = "price-fairness-0.1.0-proposed";
export const VEHICLE_CONFIDENCE_VERSION = "vehicle-confidence-0.1.0-proposed";
export const MARKET_DESIRABILITY_VERSION = "market-desirability-0.1.0-proposed";
export const MARKETPASS_DATA_CONFIDENCE_VERSION = "marketpass-data-confidence-0.1.0-proposed";
export const MARKETPASS_PUBLIC_CONTRACT_VERSION = "marketpass-public-0.1.0";
export const MARKETPASS_DEALER_CONTRACT_VERSION = "marketpass-dealer-0.1.0";

/** Marks every rule set as a proposal until the owner signs it off. */
export const MARKETPASS_RULES_STATUS = "proposed_not_approved" as const;

export type VehicleType = "new" | "used";

/**
 * assessed    the evidence minimum is met and a segment is shown
 * qualified   some evidence exists but not enough to rate; no segment is lit
 * unavailable nothing assessable; no segment is lit
 * adverse     an adverse finding is on record; segment 0 is lit and nothing can lift it
 * review      sources disagree or a finding needs review; segment 1 at most
 */
export type IndicatorState = "assessed" | "qualified" | "unavailable" | "adverse" | "review";

export interface GaugeSegment {
  index: number;
  label: string;
  /** Hex fill for the segment when lit. Unlit segments use the neutral track. */
  color: string;
}

export const GAUGE_NEUTRAL_TRACK = "#E5E7EB";
export const GAUGE_UNAVAILABLE_TEXT = "#6B7280";

/** Least favorable first, so index 0 sits on the left of the arc. */
export const GAUGE_COLORS = ["#DC2626", "#EA580C", "#CA8A04", "#65A30D", "#16A34A"] as const;

export const USED_PRICE_FAIRNESS_SEGMENTS: GaugeSegment[] = [
  { index: 0, label: "Well above market", color: GAUGE_COLORS[0] },
  { index: 1, label: "Above market", color: GAUGE_COLORS[1] },
  { index: 2, label: "Fair price", color: GAUGE_COLORS[2] },
  { index: 3, label: "Good price", color: GAUGE_COLORS[3] },
  { index: 4, label: "Great price", color: GAUGE_COLORS[4] },
];

export const NEW_PRICE_FAIRNESS_SEGMENTS: GaugeSegment[] = [
  { index: 0, label: "Above MSRP", color: GAUGE_COLORS[1] },
  { index: 1, label: "At MSRP", color: GAUGE_COLORS[2] },
  { index: 2, label: "Below MSRP", color: GAUGE_COLORS[4] },
];

export const USED_VEHICLE_CONFIDENCE_SEGMENTS: GaugeSegment[] = [
  { index: 0, label: "Concerns reported", color: GAUGE_COLORS[0] },
  { index: 1, label: "Review recommended", color: GAUGE_COLORS[1] },
  { index: 2, label: "Good", color: GAUGE_COLORS[2] },
  { index: 3, label: "Excellent", color: GAUGE_COLORS[3] },
  { index: 4, label: "Outstanding", color: GAUGE_COLORS[4] },
];

export const NEW_VEHICLE_CONFIDENCE_SEGMENTS: GaugeSegment[] = [
  { index: 0, label: "Concerns reported", color: GAUGE_COLORS[0] },
  { index: 1, label: "Review recommended", color: GAUGE_COLORS[1] },
  { index: 2, label: "Factory verified", color: GAUGE_COLORS[4] },
];

/** One line of evidence. retrievedAt is when AutoLabels fetched it; observedAt is when the provider says it was true. */
export interface EvidenceProvenance {
  key: string;
  label: string;
  source: string | null;
  authority: AuthorityClass;
  retrievedAt: string | null;
  observedAt: string | null;
  freshness: FreshnessState;
  ttlDays: number | null;
  /** False when the field's provider meaning has not been verified against live documentation. */
  meaningVerified: boolean;
}

export interface ComparableExclusionCount { reason: string; count: number }

export interface ComparableCohortSummary {
  /** Rows the engine actually weighed as primary evidence. */
  analyzedCount: number;
  /** Rows stored for this vehicle and read into the engine. */
  storedCount: number;
  /** What the provider search reported as total matches; never the analyzed count. Null when not recorded. */
  totalSearchMatches: number | null;
  effectiveSampleSize: number;
  independentDealerCount: number;
  tier: string | null;
  geography: { scope: string; radiusMiles: number | null; zip: string | null };
  /** How the comparables were selected, as recorded by the writer. */
  selection: "price_independent" | "conditioned_on_subject_price" | "not_recorded";
  description: string;
  exclusions: ComparableExclusionCount[];
}

export interface PriceFairnessAssessment {
  indicator: "price_fairness";
  version: string;
  vehicleType: VehicleType;
  state: Extract<IndicatorState, "assessed" | "qualified" | "unavailable">;
  label: string;
  explanation: string;
  segments: GaugeSegment[];
  segmentIndex: number | null;
  basis: "market_value_estimate" | "factory_msrp" | "none";
  /** The price compared: doc fee excluded, conditional discounts added back. */
  comparisonPrice: number | null;
  benchmarkValue: number | null;
  benchmarkLabel: string | null;
  /** Always true for a market benchmark: it is an estimate, never a transaction price. */
  benchmarkIsEstimate: boolean;
  deltaDollars: number | null;
  /** Signed, two decimals, (comparisonPrice - benchmarkValue) / benchmarkValue * 100. */
  deltaPct: number | null;
  deltaDenominator: "market_value_estimate" | "factory_msrp" | null;
  comparables: ComparableCohortSummary | null;
  reasons: string[];
  evidence: EvidenceProvenance[];
  /** Dealer-only working: valuation confidence, signals, rating reasons. */
  internal: {
    valuationConfidence: string;
    valuationVersion: string | null;
    dealRatingLabel: string | null;
    dealRatingVersion: string | null;
    signals: Array<{ key: string; estimate: number | null; weight: number | null; used: boolean; reason: string }>;
    rangeLow: number | null;
    rangeHigh: number | null;
    rangeMethod: string;
  };
}

export interface VehicleConfidenceAssessment {
  indicator: "vehicle_confidence";
  version: string;
  vehicleType: VehicleType;
  state: IndicatorState;
  label: string;
  explanation: string;
  segments: GaugeSegment[];
  segmentIndex: number | null;
  /** Evidence-exact public sentences: what was found. */
  findings: string[];
  /** Public sentences: what has not been verified. */
  gaps: string[];
  reasons: string[];
  evidence: EvidenceProvenance[];
  internal: {
    vehicleScore: number | null;
    vehicleScoreVersion: string | null;
    publication: string;
    hardGates: string[];
    recommendationState: string | null;
    recommendationVersion: string | null;
  };
}

export interface DesirabilityComponent {
  key: "supply_turnover";
  input: "market_days_supply" | "inferred_sold_dom_median" | null;
  rawValue: number | null;
  score: number | null;
  sampleCount: number | null;
  scope: string | null;
  used: boolean;
  reason: string;
  meaningVerified: boolean;
}

export interface MarketDesirabilityAssessment {
  indicator: "market_desirability";
  version: string;
  vehicleType: VehicleType;
  /** provisional: computed from inputs whose provider meaning is not verified against live documentation. */
  state: "available" | "provisional" | "unavailable";
  score: number | null;
  band: "high" | "steady" | "soft" | "slow" | null;
  label: string;
  explanation: string;
  components: DesirabilityComponent[];
  context: { activeCohortSupply: number | null; crossCheck: DesirabilityComponent | null };
  reasons: string[];
  evidence: EvidenceProvenance[];
}

export interface DataConfidenceAssessment {
  indicator: "data_confidence";
  version: string;
  moduleVersion: string;
  vehicleType: VehicleType;
  score: number | null;
  level: "high" | "moderate" | "limited";
  label: string;
  domainCoverage: Record<string, number | null>;
  conflicts: string[];
  staleFacts: string[];
  reasons: string[];
}

export interface MarketPassAssessment {
  assessmentVersion: string;
  rulesStatus: typeof MARKETPASS_RULES_STATUS;
  computedAt: string;
  /** Digest of every input the assessment read; equal inputs give an equal hash. */
  inputsHash: string;
  vehicle: { vin: string; vehicleType: VehicleType; tenantId: string | null; slug: string | null };
  priceFairness: PriceFairnessAssessment;
  vehicleConfidence: VehicleConfidenceAssessment;
  marketDesirability: MarketDesirabilityAssessment;
  dataConfidence: DataConfidenceAssessment;
}

// ── The two published shapes ───────────────────────────────────────────────

export interface PublicEvidence {
  key: string;
  label: string;
  source: string | null;
  retrievedAt: string | null;
  observedAt: string | null;
  freshness: FreshnessState;
}

export interface PublicComparableSummary {
  analyzedCount: number;
  totalSearchMatches: number | null;
  geographyScope: string;
  radiusMiles: number | null;
  selection: ComparableCohortSummary["selection"];
  description: string;
}

export interface PublicIndicator {
  version: string;
  state: IndicatorState;
  label: string;
  explanation: string;
  segments: GaugeSegment[];
  segmentIndex: number | null;
  ariaLabel: string;
  evidence: PublicEvidence[];
}

export interface PublicPriceFairness extends PublicIndicator {
  basis: PriceFairnessAssessment["basis"];
  benchmarkLabel: string | null;
  benchmarkIsEstimate: boolean;
  deltaDollars: number | null;
  deltaPct: number | null;
  deltaDenominator: PriceFairnessAssessment["deltaDenominator"];
  comparables: PublicComparableSummary | null;
}

export interface PublicVehicleConfidence extends PublicIndicator {
  findings: string[];
  gaps: string[];
}

export interface MarketPassPublicContract {
  contractVersion: string;
  audience: "public";
  assessmentVersion: string;
  rulesStatus: typeof MARKETPASS_RULES_STATUS;
  computedAt: string;
  inputsHash: string;
  vehicle: { vin: string; vehicleType: VehicleType };
  priceFairness: PublicPriceFairness;
  vehicleConfidence: PublicVehicleConfidence;
}

export interface MarketPassDealerContract {
  contractVersion: string;
  audience: "dealer";
  assessment: MarketPassAssessment;
}

/**
 * Keys that must never appear anywhere in a public contract, at any depth.
 * Dealer intelligence, private valuations, cost and raw provider material.
 */
export const PUBLIC_FORBIDDEN_KEYS = [
  "marketDesirability", "market_desirability", "dataConfidence", "data_confidence",
  "components", "coveragePct", "domainCoverage", "internal", "signals", "tenantId", "tenant_id",
  "blackbook", "blackBook", "black_book", "tradein", "trade_in", "retail", "acv", "ACV", "cost", "unitCost",
  "reconCost", "recon_cost", "floorplan", "holdback", "gross", "margin",
  "mc_raw", "mc_attributes", "market_meta", "market_payload", "rawResponseSanitized", "raw_payload",
  "provider_valuation", "providerValuation", "price_percentile", "cheaper_count", "rank_basis",
  "like_median", "comp_price_cut_count", "comp_price_cut_total", "last_visit_plan", "trim_count",
  "vehicleScore", "hardGates", "recommendationState", "valuationConfidence", "rangeLow", "rangeHigh",
  "view_count", "api_key", "apiKey",
] as const;

export function findForbiddenKey(value: unknown, forbidden: readonly string[] = PUBLIC_FORBIDDEN_KEYS, path = "$", depth = 0): string | null {
  if (depth > 16 || value == null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findForbiddenKey(value[i], forbidden, `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.includes(k)) return `${path}.${k}`;
    const hit = findForbiddenKey(v, forbidden, `${path}.${k}`, depth + 1);
    if (hit) return hit;
  }
  return null;
}
