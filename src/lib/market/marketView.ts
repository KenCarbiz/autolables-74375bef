// ── The one engine ─────────────────────────────────────────────────────────
//
// Every dealer screen, Passport, feed row and API response reads the DTO this
// module returns. Nothing recomputes a difference, a percentage, a position, a
// confidence, a colour, a staleness or a comparable count from raw columns
// again — that is how the same car came to read "$4,718 above market",
// "Fair Market" and "At market · verified" on one page.
//
// The pipeline, in order, because the order is load-bearing:
//   price basis -> provider validation -> canonicalize -> dedupe -> ownership
//   -> tier -> similarity -> outliers -> concentration -> statistics
//   -> confidence -> verdict.
//
// Statistics come after concentration because a median computed before the
// caps is a median of whoever listed the most cars. Confidence comes after
// statistics because it is an argument about the sample. The verdict comes
// last because it is allowed to say the least of anything here.

import { adjustComparablePrice } from "./adjustments.ts";
import {
  assignTier, canonicalizeComparable, dedupeByVin, inclusionFor, isPrimaryTier,
  selectTier, type SubjectIdentity,
} from "./comparables.ts";
import { resolveConfidence, providerDisagreement } from "./confidence.ts";
import { applyConcentrationCaps } from "./concentration.ts";
import { groupIdsKnown, groupKey, rooftopKey, tenantIdentityStability, type TenantDealerIdentity } from "./dealerIdentity.ts";
import { buildPredictionRequest, PROVIDER_FRESH_DAYS, validateProviderValuation, type SubjectForPrediction } from "./providerAdapter.ts";
import { resolvePriceBasis, type SubjectPriceInput } from "./priceBasis.ts";
import { reviewOutliers, type OutlierCandidate, type SupportingExclusionEvidence } from "./outliers.ts";

import {
  effectiveSampleSize, weightedMean, weightedMad, weightedQuantile, weightedStdDev,
} from "./statistics.ts";
import { shadowComposite } from "./composite.ts";
import {
  CONFIDENCE_RULES_VERSION, DEALER_IDENTITY_VERSION, VERDICT_RULES_VERSION,
  comparableSnapshotHash, valuationInputFingerprint,
} from "./fingerprints.ts";
import { SIMILARITY_VERSION, scoreSimilarity } from "./similarity.ts";
import { resolveVerdict } from "./verdict.ts";
import {
  MARKET_ENGINE_VERSION,
  type ComparableCandidate, type MarketComparable, type MarketExplanation,
  type MarketView, type ProviderValuation, type WeightedStats,
} from "./types.ts";

export const COMPARABLE_RANGE_LABEL = "Adjusted comparable range (weighted P25–P75)";

export interface MarketEngineInput {
  subject: SubjectIdentity & SubjectPriceInput & Omit<SubjectForPrediction, "vin" | "mileage" | "condition">;
  /** `vehicle_listings.condition`. CPO is what makes the provider request certified. */
  condition: "new" | "used" | "cpo" | null;
  candidates: ComparableCandidate[];
  identity: TenantDealerIdentity;
  provider: ProviderValuation | null;
  /** Specification fields the provider echoed, when it echoes any. */
  providerSpecs?: { year?: unknown; make?: unknown; model?: unknown; vin?: unknown } | null;
  /** Unresolved cross-source disagreements about history or condition. */
  materialContradictions?: string[];
  /** Known problems per comparable VIN, used only to SUPPORT an outlier exclusion. */
  comparableEvidence?: Record<string, SupportingExclusionEvidence[]>;
  nowMs: number;
}

export interface MarketEngineResult {
  view: MarketView;
  explanation: MarketExplanation;
}

const emptyStats = (): WeightedStats => ({
  rawCandidateCount: 0, eligiblePrimaryCount: 0, independentRooftopCount: 0,
  independentGroupCount: 0, effectiveSampleSize: 0,
  p10: null, p25: null, p50: null, p75: null, p90: null,
  mean: null, stdDev: null, mad: null,
  topRooftopShare: 0, topGroupShare: 0,
  effectiveRooftopCap: 1, effectiveGroupCap: 1,
  strictConcentrationSatisfied: false, insufficientMarketDiversity: true,
  marketFloor: null,
});

export function buildMarketView(input: MarketEngineInput): MarketEngineResult {
  const { subject, nowMs } = input;

  // 1 — Price truth.
  const priceBasis = resolvePriceBasis(subject);

  // 2 — Provider validation. The request is rebuilt from the subject so a
  // stored answer is judged against what we WOULD ask today, which is how a
  // certification change invalidates a cached prediction.
  const built = buildPredictionRequest({
    vin: subject.vin,
    mileage: subject.mileage,
    condition: input.condition,
    dealerType: subject.dealerType,
    zip: subject.zip,
    city: subject.city,
    state: subject.state,
  });
  const providerValidation = validateProviderValuation({
    subject: {
      vin: subject.vin, mileage: subject.mileage, condition: input.condition,
      dealerType: subject.dealerType, zip: subject.zip, city: subject.city, state: subject.state,
    },
    built,
    valuation: input.provider,
    providerSpecs: input.providerSpecs ?? null,
    subjectYear: subject.year,
    subjectMake: subject.make,
    subjectModel: subject.model,
    nowMs,
  });

  const providerAgeDays = input.provider && Number.isFinite(Date.parse(input.provider.receivedAt))
    ? (nowMs - Date.parse(input.provider.receivedAt)) / 86_400_000
    : null;
  const usableProviderPrediction = providerValidation.usable ? input.provider?.predictedValue ?? null : null;

  // 3 — Canonicalize and deduplicate.
  const canonical = input.candidates.map((c) => canonicalizeComparable(c, input.identity));
  const withoutSubject = canonical.filter((c) => c.vin !== subject.vin.toUpperCase());
  const subjectRows = canonical
    .filter((c) => c.vin === subject.vin.toUpperCase())
    .map((c) => ({ ...c, inclusionStatus: "excluded" as const, exclusionReasons: [...c.exclusionReasons, "subject_vin"] }));
  const { kept, dropped } = dedupeByVin(withoutSubject);

  // 4 — Tier every survivor, then stop relaxing as soon as there is enough.
  const tiered = kept.map((c) => ({ comp: c, ...assignTier(subject, c, nowMs) }));
  const externalTiers = tiered.filter((t) => t.comp.ownership === "external").map((t) => t.tier);
  const selection = selectTier(externalTiers);

  // 5 — Score, and keep the score off the price.
  const scored: MarketComparable[] = tiered.map(({ comp, tier, reasons }) => {
    const inclusion = inclusionFor(tier, comp.ownership, selection.acceptedTiers);
    const similarity = scoreSimilarity(
      {
        year: subject.year, make: subject.make, model: subject.model, trim: subject.trim,
        drivetrain: subject.drivetrain, powertrain: subject.powertrain,
        mileage: subject.mileage, certified: subject.certified, equipmentCodes: [],
      },
      {
        year: comp.year, make: comp.make, model: comp.model, trim: comp.trim,
        drivetrain: comp.drivetrain, powertrain: comp.powertrain, mileage: comp.mileage,
        certified: comp.certified, equipmentCodes: comp.equipmentCodes,
        distanceMiles: comp.distanceMiles, daysOnMarket: comp.daysOnMarket,
        observedAt: comp.listingObservedAt, historyStatus: comp.historyStatus,
        conditionStatus: comp.conditionStatus, priceBasisStatus: comp.priceBasisStatus,
        identityConfidence: comp.identityConfidence,
      },
      nowMs,
    );
    const adjustment = comp.normalizedVehiclePrice != null
      ? adjustComparablePrice(comp.normalizedVehiclePrice)
      : null;

    // Only a primary, external comparable carries weight into the market.
    const eligible = inclusion.inclusionStatus === "primary";
    return {
      ...comp,
      inclusionStatus: inclusion.inclusionStatus,
      exclusionReasons: [...comp.exclusionReasons, ...reasons, ...inclusion.reasons],
      similarityComponents: { ...similarity.components, tier: null },
      rawWeight: eligible ? similarity.rawWeight : 0,
      cappedWeight: 0,
      adjustedPrice: adjustment?.adjustedPrice ?? null,
    };
  });

  // 6 — Outlier review on the eligible set only.
  let eligible = scored.filter((c) => c.inclusionStatus === "primary" && c.adjustedPrice != null && c.rawWeight > 0);
  const outlierCandidates: OutlierCandidate[] = eligible.map((c) => ({
    key: c.vin,
    value: c.adjustedPrice as number,
    weight: c.rawWeight,
    supportingEvidence: input.comparableEvidence?.[c.vin] ?? [],
  }));
  const outliers = reviewOutliers(outlierCandidates);
  const removedVins = new Set(outliers.excluded.map((e) => e.key));
  const finalComparables = scored.map((c) => {
    if (!removedVins.has(c.vin) || c.inclusionStatus !== "primary") return c;
    const reasons = outliers.excluded.find((e) => e.key === c.vin)?.reasons ?? [];
    return { ...c, inclusionStatus: "excluded" as const, rawWeight: 0, exclusionReasons: [...c.exclusionReasons, ...reasons] };
  });
  eligible = finalComparables.filter((c) => c.inclusionStatus === "primary" && c.rawWeight > 0);

  // 7 — Concentration caps.
  const concentration = applyConcentrationCaps(eligible.map((c) => ({
    key: c.vin, rooftop: rooftopKey(c), group: groupKey(c), weight: c.rawWeight,
  })));
  const capped = finalComparables.map((c) => ({
    ...c,
    cappedWeight: concentration.cappedWeights.get(c.vin) ?? 0,
  }));
  const weighted = capped
    .filter((c) => c.inclusionStatus === "primary" && c.cappedWeight > 0 && c.adjustedPrice != null)
    .map((c) => ({ value: c.adjustedPrice as number, weight: c.cappedWeight }));

  // 8 — Statistics.
  const eligiblePrices = capped
    .filter((c) => c.inclusionStatus === "primary" && c.normalizedVehiclePrice != null)
    .map((c) => c.normalizedVehiclePrice as number);
  const stats: WeightedStats = weighted.length ? {
    rawCandidateCount: input.candidates.length,
    eligiblePrimaryCount: weighted.length,
    independentRooftopCount: concentration.independentRooftopCount,
    independentGroupCount: concentration.independentGroupCount,
    effectiveSampleSize: effectiveSampleSize(weighted.map((w) => w.weight)),
    p10: weightedQuantile(weighted, 0.1),
    p25: weightedQuantile(weighted, 0.25),
    p50: weightedQuantile(weighted, 0.5),
    p75: weightedQuantile(weighted, 0.75),
    p90: weightedQuantile(weighted, 0.9),
    mean: weightedMean(weighted),
    stdDev: weightedStdDev(weighted),
    mad: weightedMad(weighted),
    topRooftopShare: concentration.topRooftopShare,
    topGroupShare: concentration.topGroupShare,
    effectiveRooftopCap: concentration.effectiveRooftopCap,
    effectiveGroupCap: concentration.effectiveGroupCap,
    strictConcentrationSatisfied: concentration.strictConcentrationSatisfied,
    insufficientMarketDiversity: concentration.underAllocated,
    // The floor is context. It is the minimum eligible price and it gets no
    // weight, no special standing and no ability to become the market value.
    marketFloor: eligiblePrices.length ? Math.min(...eligiblePrices) : null,
  } : {
    ...emptyStats(),
    rawCandidateCount: input.candidates.length,
    effectiveRooftopCap: concentration.effectiveRooftopCap,
    effectiveGroupCap: concentration.effectiveGroupCap,
    strictConcentrationSatisfied: concentration.strictConcentrationSatisfied,
    insufficientMarketDiversity: concentration.underAllocated,
  };

  // 9 — Confidence.
  const { confidence, reasons: confidenceReasons } = resolveConfidence({
    priceBasis,
    providerValidation,
    providerAgeDays,
    providerPrediction: usableProviderPrediction,
    stats,
    winningTier: selection.winningTier,
    groupIdentityKnown: groupIdsKnown(capped),
    tenantIdentityStability: tenantIdentityStability(input.identity),
    concentrationUnderAllocated: concentration.underAllocated,
    materialContradictions: input.materialContradictions ?? [],
  });

  // 10 — Verdict.
  const verdictInput = {
    priceBasis, confidence, stats,
    winningTier: selection.winningTier,
    providerPrediction: usableProviderPrediction,
    concentrationUnderAllocated: concentration.underAllocated,
    materialContradictions: input.materialContradictions ?? [],
  };
  const verdict = resolveVerdict(verdictInput);

  const allReasons = [
    ...confidenceReasons,
    ...outliers.concerns,
    ...providerValidation.cautions,
    ...(priceBasis.basisStatus !== "verified" ? priceBasis.basisReasons : []),
  ];

  const status: MarketView["status"] =
    confidence === "unavailable" ? "unavailable" : confidence === "low" ? "limited" : "available";

  const checkedAt = input.provider?.receivedAt ?? null;
  const staleAt = checkedAt && Number.isFinite(Date.parse(checkedAt))
    ? new Date(Date.parse(checkedAt) + PROVIDER_FRESH_DAYS * 86_400_000).toISOString()
    : null;

  const view: MarketView = {
    status,
    displayedTotalPrice: priceBasis.displayedTotalPrice,
    vehicleComparisonPrice: priceBasis.vehicleComparisonPrice,
    docFee: priceBasis.docFee,
    marketP50: status === "unavailable" ? null : stats.p50,
    rangeLow: status === "unavailable" ? null : stats.p25,
    rangeHigh: status === "unavailable" ? null : stats.p75,
    rangeLabel: status === "unavailable" || stats.p25 == null ? null : COMPARABLE_RANGE_LABEL,
    marketFloor: status === "unavailable" ? null : stats.marketFloor,
    difference: verdict.difference,
    differencePercent: verdict.differencePercent,
    priceToMarketPercent: verdict.priceToMarketPercent,
    verdict: verdict.verdict,
    confidence,
    confidenceReasons: [...new Set(allReasons)],
    rawComparableCount: input.candidates.length,
    effectiveComparableCount: stats.effectiveSampleSize,
    independentDealerCount: stats.independentRooftopCount,
    provider: providerValidation.usable ? input.provider?.provider ?? null : null,
    selectedProviderField: providerValidation.usable ? input.provider?.selectedField ?? null : null,
    checkedAt,
    staleAt,
    explanationAvailable: true,
  };

  // The decision's own fingerprint. Distinct from the provider's, so a price
  // change invalidates the CONCLUSION without invalidating the paid prediction.
  const snapshotHash = comparableSnapshotHash(
    capped.map((c) => ({
      vin: c.vin,
      normalizedVehiclePrice: c.normalizedVehiclePrice,
      mileage: c.mileage,
      certified: c.certified,
      rooftopKey: rooftopKey(c),
      observedAt: c.listingObservedAt,
    })),
  );
  const decisionFingerprint = valuationInputFingerprint({
    algorithmVersion: MARKET_ENGINE_VERSION,
    providerRequestFingerprint: input.provider?.requestFingerprint ?? null,
    providerResponseHash: input.provider?.responseHash ?? null,
    vehicleComparisonPrice: priceBasis.vehicleComparisonPrice,
    priceBasisStatus: priceBasis.basisStatus,
    docFee: priceBasis.docFee,
    conditionalDiscounts: priceBasis.conditionalDiscountsExcluded,
    mandatoryDealerAddOns: priceBasis.mandatoryDealerAddOns,
    comparableSnapshotHash: snapshotHash,
    dealerIdentityVersion: DEALER_IDENTITY_VERSION,
    similarityVersion: SIMILARITY_VERSION,
    confidenceRulesVersion: CONFIDENCE_RULES_VERSION,
    verdictRulesVersion: VERDICT_RULES_VERSION,
  });

  const explanation: MarketExplanation = {
    engineVersion: MARKET_ENGINE_VERSION,
    providerRequestFingerprint: input.provider?.requestFingerprint ?? null,
    valuationInputFingerprint: decisionFingerprint,
    comparableSnapshotHash: snapshotHash,
    priceBasis,
    providerValidation,
    provider: input.provider,
    winningTier: selection.winningTier,
    relaxationSteps: selection.relaxationSteps,
    comparables: [...capped, ...dropped, ...subjectRows],
    stats,
    confidence,
    confidenceReasons: [...new Set(allReasons)],
    verdict,
    tone: verdict.tone,
    shadowComposite: shadowComposite({
      providerPrediction: usableProviderPrediction,
      comparableP50: stats.p50,
      providerUsable: providerValidation.usable,
      effectiveSampleSize: stats.effectiveSampleSize,
      disagreement: providerDisagreement(usableProviderPrediction, stats.p50),
    }),
  };

  return { view, explanation };
}


export { isPrimaryTier };
