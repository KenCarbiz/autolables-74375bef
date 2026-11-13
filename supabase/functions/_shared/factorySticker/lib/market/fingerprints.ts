// GENERATED — do not edit.
// Mirror of src/lib/market/fingerprints.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { digest } from "./hash.ts";
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
    const sameProviderInputs = args.storedProviderFingerprint != null
        && args.storedProviderFingerprint === args.currentProviderFingerprint;
    if (!sameProviderInputs)
        reasons.push("provider_inputs_changed");
    const age = args.providerAgeDays;
    const expired = age == null || age > args.providerHardExpiryDays;
    const fresh = age != null && age <= args.providerFreshDays;
    if (expired)
        reasons.push("provider_answer_expired");
    else if (!fresh)
        reasons.push("provider_answer_stale_but_usable");
    const providerReusable = sameProviderInputs && !expired;
    const sameDecision = args.storedValuationFingerprint != null
        && args.storedValuationFingerprint === args.currentValuationFingerprint;
    if (!sameDecision)
        reasons.push("valuation_inputs_changed");
    return {
        providerReusable,
        valuationReusable: providerReusable && sameDecision,
        reasons,
    };
}
