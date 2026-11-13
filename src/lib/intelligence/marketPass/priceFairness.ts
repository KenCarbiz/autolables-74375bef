// ── Price Fairness (PROPOSED) ──────────────────────────────────────────────
//
// Used: the comparison price measured against AutoLabels Market Value V3 by
// the Deal Rating. A segment is lit only when the value rests on a
// price-independent comparable distribution at medium or high confidence,
// is fresh, and the price basis is verified. A value resting on a single
// provider estimate is qualified; anything less is unavailable.
//
// New: no market comparison. The comparison price against the verified
// factory MSRP of this exact build, labelled as such.

import { buildDealRating } from "../dealRating.ts";
import { buildMarketValueV3, MARKET_VALUE_V3_TTL_DAYS } from "../marketValueV3.ts";
import type { DealRatingLabel, MarketValueV3 } from "../contracts.ts";
import type { MarketPriceBasis, MarketComparable } from "../../market/types.ts";
import { TIER_RADIUS } from "../../market/comparables.ts";
import type { ListingFacts } from "../readModels/listingFacts.ts";
import {
  NEW_PRICE_FAIRNESS_SEGMENTS, PRICE_FAIRNESS_VERSION, USED_PRICE_FAIRNESS_SEGMENTS,
  type ComparableCohortSummary, type EvidenceProvenance, type PriceFairnessAssessment, type VehicleType,
} from "./contracts.ts";
import type { StoredMarketEvidence } from "./rowEvidence.ts";

/** Minimum primary comparables analyzed for a lit segment. Medium valuation confidence already needs 3 effective. */
export const PRICE_FAIRNESS_MIN_ANALYZED = 3;

/** New-vehicle MSRP bands, signed percent of configured MSRP. */
export const NEW_MSRP_BANDS = { belowMaxPct: -1, atMaxPct: 1 } as const;

const SEGMENT_FOR_LABEL: Record<Exclude<DealRatingLabel, "unavailable">, number> = {
  well_above_market: 0, above_market: 1, fair_price: 2, good_value: 3, great_value: 4,
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.abs(n).toFixed(1)}%`;

const TIER_TEXT: Record<string, string> = {
  A: "same model year, make, model, trim and certification class, mileage within 20% (or 5,000 miles), within 50 miles",
  B50: "same model year, make, model, trim and certification class, mileage within 20% (or 5,000 miles), within 50 miles",
  B100: "same model year, make, model, trim and certification class, mileage within 20% (or 5,000 miles), within 100 miles",
  B200: "same model year, make, model, trim and certification class, mileage within 20% (or 5,000 miles), within 200 miles or distance unknown",
  C: "same model year, make, model, trim and certification class, mileage within 35% (or 10,000 miles), any distance",
};

function exclusionCounts(comps: MarketComparable[]): ComparableCohortSummary["exclusions"] {
  const counts = new Map<string, number>();
  for (const c of comps) {
    if (c.inclusionStatus === "primary") continue;
    for (const r of new Set(c.exclusionReasons)) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function cohortSummary(market: StoredMarketEvidence, mv: MarketValueV3 | null): ComparableCohortSummary | null {
  if (!market.candidateCount) return null;
  const ex = market.engine.explanation;
  const analyzed = ex.stats.eligiblePrimaryCount;
  const tier = ex.winningTier;
  const radius = tier ? TIER_RADIUS[tier] ?? null : market.selection.radiusMiles;
  const selectionText = market.selection.selection === "price_independent"
    ? "selected without reference to this vehicle's price"
    : market.selection.selection === "conditioned_on_subject_price"
      ? "selected inside a price band built from this vehicle's own price, so they cannot rate it"
      : "selection method not recorded, so they cannot rate this price";
  const cohort = tier && TIER_TEXT[tier] ? TIER_TEXT[tier] : "no comparable met the matching rules";
  const matches = market.selection.totalSearchMatches != null ? `; the search reported ${market.selection.totalSearchMatches.toLocaleString("en-US")} total matches` : "";
  return {
    analyzedCount: analyzed,
    storedCount: market.candidateCount,
    totalSearchMatches: market.selection.totalSearchMatches,
    effectiveSampleSize: Math.round(ex.stats.effectiveSampleSize * 100) / 100,
    independentDealerCount: ex.stats.independentRooftopCount,
    tier,
    geography: { scope: mv?.geography.scope ?? "unknown", radiusMiles: radius, zip: market.selection.zip },
    selection: market.selection.selection,
    description: `${analyzed} of ${market.candidateCount} stored listings analyzed (${cohort}); ${selectionText}${matches}.`,
    exclusions: exclusionCounts(ex.comparables),
  };
}

const oldestStamp = (...stamps: Array<string | null>): string | null => {
  const t = stamps.filter((s): s is string => s != null).map((s) => Date.parse(s)).filter(Number.isFinite);
  return t.length ? new Date(Math.min(...t)).toISOString() : null;
};

export interface PriceFairnessInput {
  vehicleType: VehicleType;
  facts: ListingFacts;
  market: StoredMarketEvidence;
  nowMs: number;
  evidence: EvidenceProvenance[];
}

const UNAVAILABLE_TEXT: Record<string, string> = {
  asking_price_missing: "this vehicle's price is not on record",
  asking_price_implausible: "this vehicle's price is outside a plausible range",
  price_basis_invalid: "the price on record does not reconcile with its fees",
  market_value_unavailable: "no usable market evidence is on record",
  market_evidence_stale: "the market evidence on record is out of date",
  msrp_not_verified: "a verified factory MSRP for this exact build is not on record",
};

const unavailableReason = (reasons: string[]): string => {
  for (const r of reasons) {
    if (UNAVAILABLE_TEXT[r]) return UNAVAILABLE_TEXT[r];
    if (r.startsWith("valuation_confidence_")) return "the market evidence on record is too thin to rely on";
  }
  return "there is not enough market evidence";
};

function usedFairness(input: PriceFairnessInput): PriceFairnessAssessment {
  const { market, nowMs } = input;
  const basis: MarketPriceBasis = market.engine.explanation.priceBasis;
  const checkedAt = oldestStamp(
    market.comparables ? market.selection.retrievedAt : null,
    market.provider ? market.providerRetrievedAt : null,
  );
  const mv = buildMarketValueV3({
    comparables: market.comparables,
    provider: market.provider,
    premium: null,
    // Inferred-sold figures come from /search/car/recents without sold=true,
    // so expired and sold exits are mixed: context, never a value signal.
    soldContext: null,
    // Black Book is dealer-private and not operational.
    blackBook: null,
    identityLevel: input.facts.identity.matchLevel,
    geography: { zip: market.selection.zip, radiusMiles: market.selection.radiusMiles },
    checkedAt,
    nowMs,
  }, { ttlDays: MARKET_VALUE_V3_TTL_DAYS });
  const deal = buildDealRating({
    askingPrice: basis.vehicleComparisonPrice,
    basisStatus: basis.basisStatus,
    marketValue: mv,
    vehicleType: "used",
  });
  const comps = cohortSummary(market, mv);
  const compsUsed = mv.signals.some((s) => s.key === "comparable_distribution" && s.used);
  const reasons = [...market.reasons, ...deal.reasons, ...mv.confidenceReasons];

  let state: PriceFairnessAssessment["state"];
  if (deal.label === "unavailable") state = "unavailable";
  else if (mv.freshness.state !== "current") { state = "unavailable"; reasons.push("market_evidence_stale"); }
  else if (!compsUsed) { state = "qualified"; reasons.push("benchmark_is_a_single_provider_estimate"); }
  else if (basis.basisStatus !== "verified") { state = "qualified"; reasons.push("price_basis_not_verified"); }
  else if ((comps?.analyzedCount ?? 0) < PRICE_FAIRNESS_MIN_ANALYZED) { state = "qualified"; reasons.push(`analyzed_comparables_below_${PRICE_FAIRNESS_MIN_ANALYZED}`); }
  else state = "assessed";

  const segmentIndex = state === "assessed" && deal.label !== "unavailable" ? SEGMENT_FOR_LABEL[deal.label] : null;
  const segments = USED_PRICE_FAIRNESS_SEGMENTS;
  let label: string;
  let explanation: string;
  if (state === "assessed" && segmentIndex != null && deal.deltaDollars != null && deal.deltaPct != null) {
    label = segments[segmentIndex].label;
    const dir = deal.deltaDollars < 0 ? "below" : deal.deltaDollars > 0 ? "above" : "at";
    const amount = dir === "at" ? "Priced at" : `Priced ${money(deal.deltaDollars)} (${pct(deal.deltaPct)}) ${dir}`;
    explanation = `${amount} the AutoLabels market value estimate, which is calculated from ${comps?.analyzedCount ?? 0} comparable listings${comps?.geography.radiusMiles ? ` within ${comps.geography.radiusMiles} miles` : ""}. The estimate is not a transaction price.`;
  } else if (state === "qualified") {
    label = "Limited market evidence";
    explanation = compsUsed
      ? "Some market evidence is on record, but not enough to rate this price with confidence."
      : "Only a single provider price estimate is on record, which is not enough independent evidence to rate this price.";
  } else {
    label = "Not enough market data";
    explanation = `Price fairness is not available because ${unavailableReason(reasons)}.`;
  }
  const show = state === "assessed";
  const used = mv.signals.filter((s) => s.used).map((s) => s.key);
  return {
    indicator: "price_fairness",
    version: PRICE_FAIRNESS_VERSION,
    vehicleType: "used",
    state,
    label,
    explanation,
    segments,
    segmentIndex,
    basis: mv.estimatedValue != null ? "market_value_estimate" : "none",
    comparisonPrice: basis.vehicleComparisonPrice,
    benchmarkValue: show ? mv.estimatedValue : null,
    benchmarkLabel: mv.estimatedValue != null ? "AutoLabels market value estimate" : null,
    benchmarkIsEstimate: true,
    deltaDollars: show ? deal.deltaDollars : null,
    deltaPct: show ? deal.deltaPct : null,
    deltaDenominator: show ? "market_value_estimate" : null,
    comparables: comps,
    reasons: [...new Set(reasons)],
    evidence: input.evidence.filter((e) => e.key === "asking_price" || (e.key === "comparables" && used.includes("comparable_distribution")) || (e.key === "provider_estimate" && used.includes("marketcheck_prediction"))),
    internal: {
      valuationConfidence: mv.confidence,
      valuationVersion: mv.algorithmVersion,
      dealRatingLabel: deal.label,
      dealRatingVersion: deal.version,
      signals: mv.signals.map((s) => ({ key: s.key, estimate: s.estimate, weight: s.weight, used: s.used, reason: s.reason })),
      rangeLow: mv.rangeLow,
      rangeHigh: mv.rangeHigh,
      rangeMethod: mv.rangeMethod ?? "none",
    },
  };
}

function newFairness(input: PriceFairnessInput): PriceFairnessAssessment {
  const { facts, market } = input;
  const basis = market.engine.explanation.priceBasis;
  const msrp = facts.msrp;
  const price = basis.vehicleComparisonPrice;
  const reasons: string[] = [...basis.basisReasons];
  const verifiedMsrp = msrp.source === "neovin" && msrp.state === "verified" && facts.identity.factoryVerified ? msrp.configuredMsrp : null;
  let state: PriceFairnessAssessment["state"];
  if (basis.basisStatus === "invalid") { state = "unavailable"; reasons.push("price_basis_invalid"); }
  else if (price == null) { state = "unavailable"; reasons.push("asking_price_missing"); }
  else if (verifiedMsrp == null) { state = "unavailable"; reasons.push("msrp_not_verified"); }
  else if (basis.basisStatus !== "verified") { state = "qualified"; reasons.push("price_basis_not_verified"); }
  else state = "assessed";

  const deltaDollars = price != null && verifiedMsrp != null ? Math.round(price - verifiedMsrp) : null;
  const deltaPct = price != null && verifiedMsrp != null ? round2(((price - verifiedMsrp) / verifiedMsrp) * 100) : null;
  const segmentIndex = state === "assessed" && deltaPct != null
    ? deltaPct <= NEW_MSRP_BANDS.belowMaxPct ? 2 : deltaPct <= NEW_MSRP_BANDS.atMaxPct ? 1 : 0
    : null;
  const segments = NEW_PRICE_FAIRNESS_SEGMENTS;
  let label: string;
  let explanation: string;
  if (segmentIndex != null && deltaDollars != null && deltaPct != null && verifiedMsrp != null) {
    label = segments[segmentIndex].label;
    const rel = deltaDollars === 0 ? "equal to" : `${money(deltaDollars)} (${pct(deltaPct)}) ${deltaDollars < 0 ? "below" : "above"}`;
    explanation = `Priced ${rel} the factory MSRP of ${money(verifiedMsrp)} for this exact build. This compares the price with the manufacturer's sticker, not with other vehicles for sale.`;
  } else if (state === "qualified") {
    label = "Limited price evidence";
    explanation = "The factory MSRP is verified, but how this price treats dealer fees is not confirmed, so it is not rated.";
  } else {
    label = "Not enough price data";
    explanation = `Price fairness is not available because ${unavailableReason(reasons)}.`;
  }
  const show = state === "assessed";
  return {
    indicator: "price_fairness",
    version: PRICE_FAIRNESS_VERSION,
    vehicleType: "new",
    state,
    label,
    explanation,
    segments,
    segmentIndex,
    basis: verifiedMsrp != null ? "factory_msrp" : "none",
    comparisonPrice: price,
    benchmarkValue: show ? verifiedMsrp : null,
    benchmarkLabel: verifiedMsrp != null ? "Factory MSRP for this build" : null,
    benchmarkIsEstimate: false,
    deltaDollars: show ? deltaDollars : null,
    deltaPct: show ? deltaPct : null,
    deltaDenominator: show ? "factory_msrp" : null,
    comparables: null,
    reasons: [...new Set(reasons)],
    evidence: input.evidence.filter((e) => e.key === "asking_price" || e.key === "factory_decode"),
    internal: {
      valuationConfidence: "not_applicable", valuationVersion: null, dealRatingLabel: null, dealRatingVersion: null,
      signals: [], rangeLow: null, rangeHigh: null, rangeMethod: "none",
    },
  };
}

export function buildPriceFairness(input: PriceFairnessInput): PriceFairnessAssessment {
  return input.vehicleType === "new" ? newFairness(input) : usedFairness(input);
}
