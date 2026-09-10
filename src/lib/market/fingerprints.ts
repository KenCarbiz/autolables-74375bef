// ── Two fingerprints, because there are two questions ──────────────────────
//
// One hash cannot answer both of these, and using one for both is how a
// dealer's price change either costs a needless $0.07 or silently reuses a
// stale conclusion:
//
//   "May I reuse the PAID PREDICTION?"   — depends only on what the provider
//                                          was asked about the vehicle.
//   "May I reuse the DECISION?"          — depends on everything: the price we
//                                          compared, the fee treatment, the
//                                          comparable snapshot, and the version
//                                          of every rule that produced it.
//
// So the provider fingerprint deliberately excludes the subject's asking
// price. A dealer dropping a car by $500 has not changed anything MarketCheck
// was asked, so the cached prediction still stands — but the valuation
// fingerprint moves, a new audit row is written, and the difference,
// price-to-market, confidence and verdict are all recomputed.

import { digest } from "./hash.ts";

/** Bump when the meaning of a stored valuation changes. */
export const CONFIDENCE_RULES_VERSION = "confidence-v2.0.0";
export const VERDICT_RULES_VERSION = "verdict-v2.0.0";
export const DEALER_IDENTITY_VERSION = "dealer-identity-v2.0.0";

export interface ProviderFingerprintInput {
  provider: string;
  endpointVersion: string;
  vin: string;
  miles: number;
  dealerType: string;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  isCertified: boolean;
  requestVersion: string;
}

/**
 * What the provider was asked. No price, ever.
 *
 * Anything added here becomes a reason to spend money again, so a field only
 * belongs if changing it genuinely changes the provider's answer.
 */
export function providerRequestFingerprint(input: ProviderFingerprintInput): string {
  return digest({
    kind: "provider_request",
    provider: input.provider,
    endpoint: input.endpointVersion,
    vin: input.vin.toUpperCase(),
    miles: input.miles,
    dealer_type: input.dealerType,
    zip: input.zip ?? null,
    city: input.zip ? null : input.city ?? null,
    state: input.zip ? null : input.state ?? null,
    is_certified: input.isCertified,
    v: input.requestVersion,
  });
}

export interface ComparableSnapshotEntry {
  vin: string | null;
  normalizedVehiclePrice: number | null;
  mileage: number | null;
  certified: boolean | null;
  rooftopKey: string;
  observedAt: string | null;
}

/**
 * The comparable set, as a single value.
 *
 * Order-independent: the same market discovered in a different order is the
 * same market, and sorting first stops a provider paging change from
 * invalidating every valuation on the lot.
 */
export function comparableSnapshotHash(entries: ComparableSnapshotEntry[]): string {
  const normalized = entries
    .map((e) => ({
      vin: (e.vin ?? "").toUpperCase(),
      price: e.normalizedVehiclePrice,
      miles: e.mileage,
      certified: e.certified,
      rooftop: e.rooftopKey,
      observed: e.observedAt,
    }))
    .sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : 0));
  return digest({ kind: "comparable_snapshot", entries: normalized });
}

export interface ValuationFingerprintInput {
  algorithmVersion: string;
  providerRequestFingerprint: string | null;
  providerResponseHash: string | null;
  vehicleComparisonPrice: number | null;
  priceBasisStatus: string;
  docFee: number | null;
  conditionalDiscounts: number | null;
  mandatoryDealerAddOns: number | null;
  mandatoryAddOnsIncludedInDisplayedPrice: boolean | null;
  comparableSnapshotHash: string;
  dealerIdentityVersion: string;
  similarityVersion: string;
  confidenceRulesVersion: string;
  verdictRulesVersion: string;
}

/** The whole decision. If any of this moved, the answer has to be recomputed. */
export function valuationInputFingerprint(input: ValuationFingerprintInput): string {
  return digest({
    kind: "valuation_input",
    algorithm: input.algorithmVersion,
    provider_request: input.providerRequestFingerprint,
    provider_response: input.providerResponseHash,
    comparison_price: input.vehicleComparisonPrice,
    price_basis: input.priceBasisStatus,
    doc_fee: input.docFee,
    conditional_discounts: input.conditionalDiscounts,
    mandatory_add_ons: input.mandatoryDealerAddOns,
    mandatory_add_ons_inside_price: input.mandatoryAddOnsIncludedInDisplayedPrice,
    comparables: input.comparableSnapshotHash,
    dealer_identity: input.dealerIdentityVersion,
    similarity: input.similarityVersion,
    confidence_rules: input.confidenceRulesVersion,
    verdict_rules: input.verdictRulesVersion,
  });
}

/**
 * Whether a cached provider prediction may be reused, and whether the decision
 * built on it may be.
 *
 * The two answers are independent on purpose: `providerReusable` true with
 * `valuationReusable` false is the ordinary case after a price change, and it
 * is exactly the case that must not cost anything.
 */
export interface ReuseDecision {
  providerReusable: boolean;
  valuationReusable: boolean;
  reasons: string[];
}

export function decideReuse(args: {
  storedProviderFingerprint: string | null;
  currentProviderFingerprint: string | null;
  storedValuationFingerprint: string | null;
  currentValuationFingerprint: string | null;
  providerAgeDays: number | null;
  providerFreshDays: number;
  providerHardExpiryDays: number;
}): ReuseDecision {
  const reasons: string[] = [];
  const sameProviderInputs =
    args.storedProviderFingerprint != null
    && args.storedProviderFingerprint === args.currentProviderFingerprint;

  if (!sameProviderInputs) reasons.push("provider_inputs_changed");

  const age = args.providerAgeDays;
  const expired = age == null || age > args.providerHardExpiryDays;
  const fresh = age != null && age <= args.providerFreshDays;
  if (expired) reasons.push("provider_answer_expired");
  else if (!fresh) reasons.push("provider_answer_stale_but_usable");

  const providerReusable = sameProviderInputs && !expired;

  const sameDecision =
    args.storedValuationFingerprint != null
    && args.storedValuationFingerprint === args.currentValuationFingerprint;
  if (!sameDecision) reasons.push("valuation_inputs_changed");

  return {
    providerReusable,
    valuationReusable: providerReusable && sameDecision,
    reasons,
  };
}
