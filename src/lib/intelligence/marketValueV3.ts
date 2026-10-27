// ── AutoLabels Market Value V3 ─────────────────────────────────────────────
//
// One canonical, server-side market value built from evidence that has
// already been gathered and validated: the V2 engine's fee-aware comparable
// distribution, the validated MarketCheck prediction, Premium comparables
// when they exist, inferred-sold context, Black Book when it is operational,
// and an exact-configuration adjustment where the evidence supports one.
//
// The rule that shapes everything below (master build prompt section 29):
// disagreement is never averaged away. When the strongest signals materially
// disagree the estimate follows the better evidence, the other signal is set
// aside with its reason, confidence falls, and the result is flagged for
// investigation. A value is a separate conclusion from the Vehicle Score,
// and the dealer's asking price is not an input to it.
//
// Shadow only: `publishable` is false until a server surface reads the
// market_value_v3_public flag.

import { providerDisagreement, resolveConfidence } from "../market/confidence.ts";
import { isPrimaryTier, TIER_RADIUS } from "../market/comparables.ts";
import { identityConfidenceCeiling, isExactIdentity, type IdentityMatchLevel } from "../market/identityMatch.ts";
import { MEDIUM_MAX_PROVIDER_AGE_DAYS } from "../market/confidence.ts";
import type {
  ComparableTier, MarketConfidence, MarketPriceBasis, ProviderValidation, ProviderValuation, WeightedStats,
} from "../market/types.ts";
import {
  resolveFreshness, type GeographyScope, type MarketValueV3, type ProviderAgreement, type ValuationSignal,
} from "./contracts.ts";

export const MARKET_VALUE_V3_VERSION = "market-value-v3.0.0-shadow";

/** A value older than this is a stale baseline; the used policy refreshes on this cadence. */
export const MARKET_VALUE_V3_TTL_DAYS = 7;

export const DEFAULT_DISAGREEMENT_THRESHOLD = 0.07;
export const DEFAULT_FALLBACK_RANGE_PCT = 0.05;
export const DEFAULT_MIN_PREMIUM_COUNT = 3;
export const DEFAULT_MIN_SOLD_CONTEXT_COUNT = 5;
/** Effective comparables at which the distribution counts as a complete signal. */
export const COMPARABLE_SATURATION = 5;

/** Base weights before completeness; configuration, not a UI constant. */
export const DEFAULT_SIGNAL_WEIGHTS: Record<SignalKey, number> = {
  comparable_distribution: 1.0,
  marketcheck_prediction: 0.8,
  premium_comparables: 0.9,
  sold_context: 0.4,
  black_book: 0.5,
};

export const SIGNAL_KEYS = [
  "comparable_distribution", "marketcheck_prediction", "premium_comparables", "sold_context", "black_book",
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export interface ComparableEvidence {
  stats: WeightedStats;
  winningTier: ComparableTier | null;
  relaxationSteps: string[];
  /** True when every comparable in the distribution shares one fee basis (section 8). */
  feeNormalized: boolean;
  priceBasis: MarketPriceBasis;
  groupIdentityKnown: boolean;
  tenantIdentityStability: "stable" | "name_only" | "none";
  concentrationUnderAllocated: boolean;
  materialContradictions: string[];
}

export interface ProviderPredictionEvidence {
  valuation: ProviderValuation | null;
  validation: ProviderValidation;
  ageDays: number | null;
}

export interface PremiumComparableEvidence {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  count: number;
  feeNormalized: boolean;
  checkedAt: string | null;
}

/** Inferred-sold evidence: the median last advertised price before sale, never a transaction price. */
export interface SoldContextEvidence {
  medianLastAdvertisedBeforeSale: number | null;
  count: number;
  scope: string;
  windowDays: number;
  checkedAt: string | null;
}

export interface BlackBookEvidence {
  retail: number | null;
  operational: boolean;
  checkedAt: string | null;
}

export interface ExactConfigurationEvidence {
  /** True only when the adjustment is empirically supported for this cohort. */
  supported: boolean;
  adjustmentDollars: number | null;
  reason: string;
}

export interface MarketValueV3Input {
  comparables: ComparableEvidence | null;
  provider: ProviderPredictionEvidence | null;
  premium?: PremiumComparableEvidence | null;
  soldContext?: SoldContextEvidence | null;
  blackBook?: BlackBookEvidence | null;
  exactConfiguration?: ExactConfigurationEvidence | null;
  identityLevel: IdentityMatchLevel;
  geography: { zip: string | null; radiusMiles: number | null };
  /** When the evidence was assembled; null falls back to the newest evidence stamp. */
  checkedAt: string | null;
  nowMs: number;
  /**
   * Carried for the audit trail only. The valuation never reads it: a market
   * value that moved with the dealer's asking price would not be a market
   * value (section 32), and the price-blind test holds this to it.
   */
  subjectAskingPrice?: number | null;
}

export interface MarketValueV3Options {
  disagreementThreshold?: number;
  ttlDays?: number;
  fallbackRangePct?: number;
  minPremiumCount?: number;
  minSoldContextCount?: number;
  signalWeights?: Partial<Record<SignalKey, number>>;
}

const CONFIDENCE_RANK: Record<MarketConfidence, number> = { high: 3, medium: 2, low: 1, unavailable: 0 };

const capConfidence = (current: MarketConfidence, cap: MarketConfidence): MarketConfidence =>
  CONFIDENCE_RANK[cap] < CONFIDENCE_RANK[current] ? cap : current;

const isMoney = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0;

const newestStamp = (...stamps: Array<string | null | undefined>): string | null => {
  const valid = stamps
    .map((s) => (s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null))
    .filter((t): t is number => t != null);
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null;
};

interface Candidate {
  key: SignalKey;
  estimate: number;
  weight: number;
}

function geographyScope(tier: ComparableTier | null, requestedRadius: number | null): GeographyScope {
  const radius = tier != null ? TIER_RADIUS[tier] ?? null : null;
  const effective = radius ?? requestedRadius;
  if (tier != null && !isPrimaryTier(tier)) return "national";
  if (effective == null) return tier == null ? "unknown" : "regional";
  if (effective <= 100) return "local";
  if (effective <= 300) return "regional";
  return "national";
}

export function buildMarketValueV3(input: MarketValueV3Input, options: MarketValueV3Options = {}): MarketValueV3 {
  const threshold = options.disagreementThreshold ?? DEFAULT_DISAGREEMENT_THRESHOLD;
  const fallbackRangePct = options.fallbackRangePct ?? DEFAULT_FALLBACK_RANGE_PCT;
  const minPremium = options.minPremiumCount ?? DEFAULT_MIN_PREMIUM_COUNT;
  const minSold = options.minSoldContextCount ?? DEFAULT_MIN_SOLD_CONTEXT_COUNT;
  const weights = { ...DEFAULT_SIGNAL_WEIGHTS, ...(options.signalWeights ?? {}) };

  const signals: ValuationSignal[] = [];
  const candidates: Candidate[] = [];
  const reasons: string[] = [];

  // ── Signal 1: the fee-normalized comparable distribution ─────────────────
  const comps = input.comparables;
  const stats = comps?.stats ?? null;
  const compsP50 = stats && isMoney(stats.p50) && stats.effectiveSampleSize > 0 ? stats.p50 : null;
  if (!comps || compsP50 == null) {
    signals.push({ key: "comparable_distribution", estimate: compsP50, weight: null, used: false, reason: comps ? "no_effective_comparables" : "no_comparable_evidence" });
  } else if (!comps.feeNormalized) {
    // Section 8: a distribution that mixes fee bases is not one distribution.
    // It stays visible as context and contributes nothing to the number.
    signals.push({ key: "comparable_distribution", estimate: compsP50, weight: null, used: false, reason: "comparables_fee_basis_not_normalized" });
    reasons.push("comparables_fee_basis_not_normalized");
  } else {
    const completeness = Math.min(1, (stats as WeightedStats).effectiveSampleSize / COMPARABLE_SATURATION);
    candidates.push({ key: "comparable_distribution", estimate: compsP50, weight: weights.comparable_distribution * completeness });
  }

  // ── Signal 2: the validated MarketCheck prediction ──────────────────────
  const prov = input.provider;
  const prediction = prov?.valuation?.predictedValue ?? null;
  if (!prov || !isMoney(prediction)) {
    signals.push({ key: "marketcheck_prediction", estimate: null, weight: null, used: false, reason: "no_provider_prediction" });
  } else if (!prov.validation.usable) {
    signals.push({ key: "marketcheck_prediction", estimate: prediction, weight: null, used: false, reason: `provider_answer_not_usable:${prov.validation.rejections.join(",") || "unspecified"}` });
  } else if (prov.ageDays == null || prov.ageDays > MEDIUM_MAX_PROVIDER_AGE_DAYS) {
    signals.push({ key: "marketcheck_prediction", estimate: prediction, weight: null, used: false, reason: "provider_answer_expired" });
  } else {
    candidates.push({ key: "marketcheck_prediction", estimate: prediction, weight: weights.marketcheck_prediction });
  }

  // ── Signal 3: Premium comparables (blocked on entitlement until proven) ──
  const premium = input.premium ?? null;
  if (!premium || !isMoney(premium.p50)) {
    signals.push({ key: "premium_comparables", estimate: premium?.p50 ?? null, weight: null, used: false, reason: "premium_comparables_absent" });
  } else if (!premium.feeNormalized) {
    signals.push({ key: "premium_comparables", estimate: premium.p50, weight: null, used: false, reason: "premium_fee_basis_not_normalized" });
  } else if (premium.count < minPremium) {
    signals.push({ key: "premium_comparables", estimate: premium.p50, weight: null, used: false, reason: `premium_sample_below_${minPremium}` });
  } else {
    candidates.push({ key: "premium_comparables", estimate: premium.p50, weight: weights.premium_comparables * Math.min(1, premium.count / COMPARABLE_SATURATION) });
  }

  // ── Signal 4: inferred-sold context ─────────────────────────────────────
  const sold = input.soldContext ?? null;
  if (!sold || !isMoney(sold.medianLastAdvertisedBeforeSale)) {
    signals.push({ key: "sold_context", estimate: null, weight: null, used: false, reason: "no_inferred_sold_context" });
  } else if (sold.count < minSold) {
    signals.push({ key: "sold_context", estimate: sold.medianLastAdvertisedBeforeSale, weight: null, used: false, reason: `inferred_sold_sample_below_${minSold}` });
  } else {
    candidates.push({ key: "sold_context", estimate: sold.medianLastAdvertisedBeforeSale, weight: weights.sold_context });
  }

  // ── Signal 5: Black Book, only when the integration is operational ──────
  const bb = input.blackBook ?? null;
  if (!bb || !bb.operational) {
    signals.push({ key: "black_book", estimate: bb?.retail ?? null, weight: null, used: false, reason: bb ? "black_book_not_operational" : "black_book_absent" });
  } else if (!isMoney(bb.retail)) {
    signals.push({ key: "black_book", estimate: null, weight: null, used: false, reason: "black_book_no_figure" });
  } else {
    candidates.push({ key: "black_book", estimate: bb.retail, weight: weights.black_book });
  }

  // ── Agreement ───────────────────────────────────────────────────────────
  let providerAgreement: ProviderAgreement;
  let investigationFlagged = false;
  let disagreementPct: number | null = null;
  let used: Candidate[] = candidates;

  if (candidates.length === 0) {
    providerAgreement = "none";
  } else if (candidates.length === 1) {
    providerAgreement = "single_signal";
  } else {
    const estimates = candidates.map((c) => c.estimate);
    const anchor = candidates.find((c) => c.key === "comparable_distribution")?.estimate
      ?? candidates.find((c) => c.key === "premium_comparables")?.estimate
      ?? estimates[0];
    const spread = (Math.max(...estimates) - Math.min(...estimates)) / anchor;
    disagreementPct = Math.round(spread * 10_000) / 10_000;
    if (spread > threshold) {
      providerAgreement = "disagree";
      investigationFlagged = true;
      reasons.push("sources_materially_disagree");
      // Evidence over opinion: the strongest-weighted signal decides alone and
      // the rest are set aside by name, so the disagreement stays visible.
      const strongest = [...candidates].sort((a, b) => b.weight - a.weight)[0];
      used = [strongest];
      for (const c of candidates) {
        if (c !== strongest) {
          signals.push({ key: c.key, estimate: c.estimate, weight: null, used: false, reason: "excluded_material_disagreement" });
        }
      }
    } else {
      providerAgreement = "agree";
    }
  }

  const totalWeight = used.reduce((a, c) => a + c.weight, 0);
  let estimate: number | null = null;
  if (used.length && totalWeight > 0) {
    estimate = used.reduce((a, c) => a + c.estimate * (c.weight / totalWeight), 0);
    for (const c of used) {
      signals.push({ key: c.key, estimate: c.estimate, weight: Math.round((c.weight / totalWeight) * 10_000) / 10_000, used: true, reason: providerAgreement === "disagree" ? "strongest_signal_under_disagreement" : "weighted_by_quality" });
    }
  }

  // ── Exact configuration adjustment ──────────────────────────────────────
  const cfg = input.exactConfiguration ?? null;
  if (estimate != null && cfg?.supported && isMoney(Math.abs(cfg.adjustmentDollars ?? 0)) && isExactIdentity(input.identityLevel)) {
    estimate += cfg.adjustmentDollars as number;
    reasons.push(`exact_configuration_adjustment_applied:${cfg.reason}`);
  } else if (cfg && !cfg.supported) {
    reasons.push(`exact_configuration_adjustment_not_supported:${cfg.reason}`);
  }

  // ── Range: never narrower than the evidence ────────────────────────────
  let rangeLow: number | null = null;
  let rangeHigh: number | null = null;
  if (estimate != null) {
    const compsUsed = used.some((c) => c.key === "comparable_distribution") && stats;
    if (compsUsed && isMoney(stats.p25) && isMoney(stats.p75)) {
      rangeLow = Math.min(stats.p25, estimate);
      rangeHigh = Math.max(stats.p75, estimate);
    } else if (used.some((c) => c.key === "marketcheck_prediction") && isMoney(prov?.valuation?.providerRangeLow ?? null) && isMoney(prov?.valuation?.providerRangeHigh ?? null)) {
      rangeLow = Math.min(prov!.valuation!.providerRangeLow as number, estimate);
      rangeHigh = Math.max(prov!.valuation!.providerRangeHigh as number, estimate);
    } else {
      rangeLow = estimate * (1 - fallbackRangePct);
      rangeHigh = estimate * (1 + fallbackRangePct);
    }
    if (disagreementPct != null && disagreementPct > threshold) {
      rangeLow = Math.min(rangeLow, estimate * (1 - disagreementPct));
      rangeHigh = Math.max(rangeHigh, estimate * (1 + disagreementPct));
    }
    rangeLow = Math.round(rangeLow);
    rangeHigh = Math.round(rangeHigh);
    estimate = Math.round(estimate);
  }

  // ── Confidence: V2 rules first, then the V3 caps ───────────────────────
  let confidence: MarketConfidence;
  const confidenceReasons: string[] = [];
  if (estimate == null) {
    confidence = "unavailable";
    confidenceReasons.push("no_usable_signal");
  } else if (comps && used.some((c) => c.key === "comparable_distribution")) {
    const v2 = resolveConfidence({
      priceBasis: comps.priceBasis,
      providerValidation: prov?.validation ?? { usable: false, rejections: [], cautions: [] },
      providerAgeDays: prov?.ageDays ?? null,
      providerPrediction: used.some((c) => c.key === "marketcheck_prediction") ? prediction : null,
      stats: comps.stats,
      winningTier: comps.winningTier,
      groupIdentityKnown: comps.groupIdentityKnown,
      tenantIdentityStability: comps.tenantIdentityStability,
      concentrationUnderAllocated: comps.concentrationUnderAllocated,
      materialContradictions: comps.materialContradictions,
    });
    confidence = v2.confidence;
    confidenceReasons.push(...v2.reasons);
    if (comps.relaxationSteps.length) {
      confidence = capConfidence(confidence, "medium");
      confidenceReasons.push(`comparable_tier_relaxed:${comps.relaxationSteps.join(">")}`);
    }
  } else {
    // No comparable distribution behind the number: one or more secondary
    // signals. Never high.
    confidence = "medium";
    confidenceReasons.push("no_comparable_distribution_in_estimate");
  }

  if (estimate != null) {
    if (providerAgreement === "single_signal") {
      confidence = capConfidence(confidence, "medium");
      confidenceReasons.push("single_signal");
    }
    if (providerAgreement === "disagree") {
      confidence = capConfidence(confidence, "low");
      confidenceReasons.push("sources_materially_disagree");
    }
    const ceiling = identityConfidenceCeiling(input.identityLevel);
    if (ceiling === "none") {
      confidence = capConfidence(confidence, "low");
      confidenceReasons.push("identity_unknown");
    } else if (ceiling !== "high") {
      confidence = capConfidence(confidence, "medium");
      confidenceReasons.push(`identity_${input.identityLevel.toLowerCase()}_caps_confidence`);
    }
  }

  const checkedAt = input.checkedAt
    ?? newestStamp(prov?.valuation?.receivedAt ?? null, premium?.checkedAt ?? null, sold?.checkedAt ?? null, bb?.checkedAt ?? null);
  const freshness = resolveFreshness({ checkedAt, ttlDays: options.ttlDays ?? MARKET_VALUE_V3_TTL_DAYS, nowMs: input.nowMs });

  return {
    algorithmVersion: MARKET_VALUE_V3_VERSION,
    estimatedValue: estimate,
    rangeLow,
    rangeHigh,
    confidence,
    confidenceReasons: [...new Set([...confidenceReasons, ...reasons])],
    qualifiedCompCount: stats?.eligiblePrimaryCount ?? 0,
    effectiveSampleSize: stats?.effectiveSampleSize ?? 0,
    matchingTier: comps?.winningTier ?? null,
    identityLevel: input.identityLevel,
    geography: {
      zip: input.geography.zip,
      radiusMiles: (comps?.winningTier != null ? TIER_RADIUS[comps.winningTier] ?? null : null) ?? input.geography.radiusMiles,
      scope: geographyScope(comps?.winningTier ?? null, input.geography.radiusMiles),
    },
    signals: SIGNAL_KEYS.map((k) => signals.find((s) => s.key === k) as ValuationSignal),
    providerAgreement,
    disagreementPct,
    investigationFlagged,
    checkedAt,
    freshness,
    publishable: false,
  };
}
