// GENERATED — do not edit.
// Mirror of src/lib/market/priceBasis.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { PRICE_BASIS_TOLERANCE, type ComparablePriceBasis, type MarketPriceBasis, } from "./types.ts";
const money = (v: unknown): number | null => {
    if (typeof v === "number")
        return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
        const n = Number(v.replace(/[$,\s]/g, ""));
        return Number.isFinite(n) && v.trim() !== "" ? n : null;
    }
    return null;
};
const plausiblePrice = (n: number | null): n is number => n != null && n >= 500 && n <= 5000000;
export interface SubjectPriceInput {
    price?: number | null;
    advertisedPriceBeforeDoc?: number | null;
    websiteSalePrice?: number | null;
    docFee?: number | null;
    advertisedExcludesDocFee?: boolean | null;
    mandatoryDealerAddOns?: number | null;
    vehicleMandatoryAddOns?: MandatoryAddOnAnswer | null;
    tenantMandatoryAddOns?: MandatoryAddOnAnswer | null;
    conditionalDiscounts?: number | null;
    provenance?: Record<string, unknown>;
}
export type MandatoryAddOnSource = "vehicle" | "tenant_default" | "unknown";
export interface MandatoryAddOnAnswer {
    amountUsd?: number | null;
    verified?: boolean | null;
    includedInDisplayedPrice?: boolean | null;
}
export interface MandatoryAddOnResolution {
    amountUsd: number | null;
    includedInDisplayedPrice: boolean | null;
    source: MandatoryAddOnSource;
    known: boolean;
    usableForIdentity: boolean;
    reasons: string[];
}
const answerAmount = (a: MandatoryAddOnAnswer | null | undefined): number | null => {
    const n = money(a?.amountUsd);
    return n != null && n >= 0 ? n : null;
};
export function resolveMandatoryAddOns(input: SubjectPriceInput): MandatoryAddOnResolution {
    const reasons: string[] = [];
    const vehicle = input.vehicleMandatoryAddOns;
    const vehicleAmount = answerAmount(vehicle);
    const legacyAmount = money(input.mandatoryDealerAddOns);
    let amountUsd: number | null = null;
    let includedInDisplayedPrice: boolean | null = null;
    let source: MandatoryAddOnSource = "unknown";
    if (vehicleAmount != null && vehicle?.verified !== false) {
        amountUsd = vehicleAmount;
        includedInDisplayedPrice = vehicle?.includedInDisplayedPrice ?? null;
        source = "vehicle";
    }
    else if (legacyAmount != null && legacyAmount >= 0) {
        amountUsd = legacyAmount;
        includedInDisplayedPrice = true;
        source = "vehicle";
    }
    else {
        const tenant = input.tenantMandatoryAddOns;
        const tenantAmount = answerAmount(tenant);
        if (tenantAmount != null && tenant?.verified === true) {
            amountUsd = tenantAmount;
            includedInDisplayedPrice = tenant?.includedInDisplayedPrice ?? null;
            source = "tenant_default";
            reasons.push("mandatory_add_ons_from_verified_tenant_default");
        }
        else if (tenantAmount != null) {
            reasons.push("tenant_mandatory_add_on_default_not_verified");
        }
    }
    if (amountUsd == null) {
        reasons.push("mandatory_add_on_treatment_unknown");
        return {
            amountUsd: null,
            includedInDisplayedPrice: null,
            source: "unknown",
            known: false,
            usableForIdentity: false,
            reasons,
        };
    }
    const placementKnown = amountUsd === 0 || includedInDisplayedPrice != null;
    if (!placementKnown)
        reasons.push("mandatory_add_on_placement_unknown");
    if (amountUsd > 0) {
        reasons.push(`mandatory_add_ons_disclosed_${amountUsd}`);
        if (includedInDisplayedPrice === false)
            reasons.push("mandatory_add_ons_outside_displayed_price");
        else if (includedInDisplayedPrice === true)
            reasons.push("mandatory_add_ons_inside_displayed_price");
    }
    return {
        amountUsd,
        includedInDisplayedPrice,
        source,
        known: true,
        usableForIdentity: placementKnown,
        reasons,
    };
}
export function resolvePriceBasis(input: SubjectPriceInput): MarketPriceBasis {
    const reasons: string[] = [];
    const price = money(input.price);
    const advertised = money(input.advertisedPriceBeforeDoc);
    const website = money(input.websiteSalePrice);
    const rawDocFee = money(input.docFee);
    const docFee = rawDocFee != null && rawDocFee >= 0 ? rawDocFee : null;
    const addOns = resolveMandatoryAddOns(input);
    const conditional = money(input.conditionalDiscounts) ?? 0;
    if (rawDocFee != null && rawDocFee < 0)
        reasons.push("doc_fee_negative");
    const rawMandatory = money(input.mandatoryDealerAddOns) ?? money(input.vehicleMandatoryAddOns?.amountUsd);
    if (rawMandatory != null && rawMandatory < 0)
        reasons.push("mandatory_add_ons_negative");
    let includesDocFee: boolean | null = input.advertisedExcludesDocFee === true ? false
        : input.advertisedExcludesDocFee === false ? true
            : null;
    if (includesDocFee == null && price != null && advertised != null && docFee != null) {
        if (Math.abs(price - advertised - docFee) <= PRICE_BASIS_TOLERANCE) {
            includesDocFee = true;
            reasons.push("fee_treatment_inferred_from_stored_prices");
        }
        else if (Math.abs(price - advertised) <= PRICE_BASIS_TOLERANCE) {
            includesDocFee = false;
            reasons.push("fee_treatment_inferred_advertised_equals_price");
        }
    }
    if (includesDocFee == null && docFee === 0) {
        includesDocFee = true;
        reasons.push("no_doc_fee_configured");
    }
    let displayedTotalPrice: number | null;
    if (includesDocFee === true) {
        displayedTotalPrice = price ?? website ?? (advertised != null && docFee != null ? advertised + docFee : null);
    }
    else if (includesDocFee === false) {
        displayedTotalPrice = website ?? (advertised != null && docFee != null ? advertised + docFee : price);
    }
    else {
        displayedTotalPrice = price ?? website ?? null;
        reasons.push("fee_treatment_unknown");
    }
    const mandatoryForIdentity = addOns.usableForIdentity && addOns.includedInDisplayedPrice === true ? (addOns.amountUsd as number) : 0;
    let advertisedLeg: number | null = advertised;
    if (advertisedLeg == null && displayedTotalPrice != null && docFee != null) {
        advertisedLeg = displayedTotalPrice - docFee - mandatoryForIdentity;
        reasons.push("advertised_leg_derived_from_displayed_total");
    }
    let status: MarketPriceBasis["basisStatus"] = "verified";
    if (!plausiblePrice(displayedTotalPrice) || !plausiblePrice(advertisedLeg)) {
        status = "invalid";
        reasons.push("no_usable_price");
    }
    else if (docFee == null) {
        status = "ambiguous";
        reasons.push("doc_fee_unknown");
    }
    else if (Math.abs(advertisedLeg + docFee + mandatoryForIdentity - displayedTotalPrice) > PRICE_BASIS_TOLERANCE) {
        status = "invalid";
        reasons.push(`price_identity_failed advertised=${advertisedLeg} doc_fee=${docFee}`
            + ` mandatory=${mandatoryForIdentity} displayed=${displayedTotalPrice}`);
    }
    else if (includesDocFee == null) {
        status = "ambiguous";
    }
    if (!addOns.usableForIdentity && status === "verified") {
        status = "ambiguous";
    }
    reasons.push(...addOns.reasons);
    if (conditional > 0) {
        reasons.push(`conditional_discounts_added_back_${conditional}`);
    }
    const vehicleComparisonPrice = status === "invalid" || advertisedLeg == null ? null : advertisedLeg + conditional;
    const totalWithMandatoryAddOns = status === "invalid" || displayedTotalPrice == null || !addOns.usableForIdentity
        ? null
        : displayedTotalPrice + (addOns.includedInDisplayedPrice === false ? (addOns.amountUsd as number) : 0);
    return {
        displayedTotalPrice: status === "invalid" ? displayedTotalPrice ?? null : displayedTotalPrice,
        vehicleComparisonPrice,
        advertisedPriceBeforeDoc: advertisedLeg,
        docFee,
        mandatoryDealerAddOns: addOns.amountUsd,
        mandatoryAddOnsIncludedInDisplayedPrice: addOns.includedInDisplayedPrice,
        mandatoryAddOnSource: addOns.source,
        totalWithMandatoryAddOns,
        conditionalDiscountsExcluded: conditional || null,
        governmentFeesIncluded: false,
        advertisedIncludesDocFee: includesDocFee,
        basisStatus: status,
        basisReasons: reasons,
        provenance: {
            price_column: input.price ?? null,
            advertised_price_before_doc: input.advertisedPriceBeforeDoc ?? null,
            website_sale_price: input.websiteSalePrice ?? null,
            doc_fee: input.docFee ?? null,
            advertised_excludes_doc_fee: input.advertisedExcludesDocFee ?? null,
            mandatory_dealer_add_ons: addOns.amountUsd,
            mandatory_add_on_source: addOns.source,
            mandatory_add_on_included_in_displayed_price: addOns.includedInDisplayedPrice,
            mandatory_add_on_treatment: addOns.usableForIdentity ? "known" : "unknown",
            conditional_discounts: input.conditionalDiscounts ?? null,
            ...(input.provenance ?? {}),
        },
    };
}
export interface ComparablePriceInput {
    advertisedPrice?: number | null;
    docFeeIncluded?: boolean | null;
    docFee?: number | null;
    conditionalDiscounts?: number | null;
}
export interface ComparableBasePrice {
    normalizedVehiclePrice: number | null;
    priceBasisStatus: ComparablePriceBasis;
    reasons: string[];
}
export function resolveComparableBasePrice(input: ComparablePriceInput): ComparableBasePrice {
    const reasons: string[] = [];
    const advertised = money(input.advertisedPrice);
    const conditional = money(input.conditionalDiscounts) ?? 0;
    const fee = money(input.docFee);
    if (!plausiblePrice(advertised)) {
        return { normalizedVehiclePrice: null, priceBasisStatus: "invalid", reasons: ["no_usable_price"] };
    }
    let base = advertised + conditional;
    let status: ComparablePriceBasis;
    if (input.docFeeIncluded === true && fee != null && fee >= 0) {
        base -= fee;
        status = "verified";
        reasons.push(`doc_fee_removed_${fee}`);
    }
    else if (input.docFeeIncluded === false) {
        status = "verified";
        reasons.push("advertised_excludes_doc_fee");
    }
    else {
        status = "unknown";
        reasons.push("competitor_doc_fee_treatment_unknown");
    }
    if (conditional > 0)
        reasons.push(`conditional_discounts_added_back_${conditional}`);
    return {
        normalizedVehiclePrice: plausiblePrice(base) ? base : null,
        priceBasisStatus: plausiblePrice(base) ? status : "invalid",
        reasons,
    };
}
export const DOC_FEE_INCLUDES_SETTING = "advertised_includes_doc_fee";
export const DOC_FEE_EXCLUDES_SETTING = "advertised_excludes_doc_fee";
export function parseConfiguredBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (s === "true")
            return true;
        if (s === "false")
            return false;
    }
    return null;
}
export type DocFeeTreatmentSource = "includes_setting" | "excludes_setting" | "both_settings_agree" | "conflict" | "unknown";
export interface DocFeeTreatment {
    advertisedIncludesDocFee: boolean | null;
    advertisedExcludesDocFee: boolean | null;
    source: DocFeeTreatmentSource;
    conflict: boolean;
    reasons: string[];
}
const UNKNOWN_TREATMENT = (reasons: string[]): DocFeeTreatment => ({
    advertisedIncludesDocFee: null,
    advertisedExcludesDocFee: null,
    source: "unknown",
    conflict: false,
    reasons,
});
const plainObject = (v: unknown): Record<string, unknown> | null => v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export function resolveDocFeeTreatment(settings: unknown): DocFeeTreatment {
    const bag = plainObject(settings);
    if (!bag)
        return UNKNOWN_TREATMENT(["doc_fee_treatment_unconfigured"]);
    const reasons: string[] = [];
    const hasIncludes = Object.prototype.hasOwnProperty.call(bag, DOC_FEE_INCLUDES_SETTING);
    const hasExcludes = Object.prototype.hasOwnProperty.call(bag, DOC_FEE_EXCLUDES_SETTING);
    const includes = hasIncludes ? parseConfiguredBoolean(bag[DOC_FEE_INCLUDES_SETTING]) : null;
    const excludes = hasExcludes ? parseConfiguredBoolean(bag[DOC_FEE_EXCLUDES_SETTING]) : null;
    if (hasIncludes && includes == null)
        reasons.push(`${DOC_FEE_INCLUDES_SETTING}_unreadable`);
    if (hasExcludes && excludes == null)
        reasons.push(`${DOC_FEE_EXCLUDES_SETTING}_unreadable`);
    if (includes != null && excludes != null) {
        if (includes === !excludes) {
            reasons.push("doc_fee_treatment_both_settings_agree");
            return {
                advertisedIncludesDocFee: includes,
                advertisedExcludesDocFee: !includes,
                source: "both_settings_agree",
                conflict: false,
                reasons,
            };
        }
        reasons.push("doc_fee_treatment_conflict");
        return {
            advertisedIncludesDocFee: null,
            advertisedExcludesDocFee: null,
            source: "conflict",
            conflict: true,
            reasons,
        };
    }
    if (includes != null) {
        reasons.push(`doc_fee_treatment_from_${DOC_FEE_INCLUDES_SETTING}`);
        return {
            advertisedIncludesDocFee: includes,
            advertisedExcludesDocFee: !includes,
            source: "includes_setting",
            conflict: false,
            reasons,
        };
    }
    if (excludes != null) {
        reasons.push(`doc_fee_treatment_from_${DOC_FEE_EXCLUDES_SETTING}`);
        return {
            advertisedIncludesDocFee: !excludes,
            advertisedExcludesDocFee: excludes,
            source: "excludes_setting",
            conflict: false,
            reasons,
        };
    }
    reasons.push("doc_fee_treatment_unconfigured");
    return UNKNOWN_TREATMENT(reasons);
}
export interface AdvertisedPriceSplit {
    customerAdvertisedPrice: number | null;
    documentationFeeInsideAdvertisedPrice: number | null;
    internalComparisonPrice: number | null;
    advertisedPriceIncludingDealerFees: number | null;
    excludesGovernmentCharges: boolean;
    reasons: string[];
}
export function splitAdvertisedPrice(basis: MarketPriceBasis): AdvertisedPriceSplit {
    const reasons: string[] = [];
    const advertisedToCustomer = basis.displayedTotalPrice;
    const fee = basis.docFee;
    let feeInside: number | null = null;
    if (basis.advertisedIncludesDocFee === true && fee != null) {
        feeInside = fee;
        reasons.push(`documentation_fee_itemized_inside_advertised_price_${fee}`);
    }
    else if (basis.advertisedIncludesDocFee === false) {
        reasons.push("documentation_fee_outside_advertised_price");
    }
    else {
        reasons.push("documentation_fee_placement_unknown");
    }
    reasons.push("advertised_price_excludes_government_charges");
    return {
        customerAdvertisedPrice: advertisedToCustomer,
        documentationFeeInsideAdvertisedPrice: feeInside,
        internalComparisonPrice: basis.vehicleComparisonPrice,
        advertisedPriceIncludingDealerFees: advertisedToCustomer,
        excludesGovernmentCharges: true,
        reasons,
    };
}
export function isDoubleCountedTotal(split: AdvertisedPriceSplit, candidate: number): boolean {
    const base = split.customerAdvertisedPrice;
    const fee = split.documentationFeeInsideAdvertisedPrice;
    if (base == null || fee == null || fee <= 0)
        return false;
    return Math.abs(candidate - (base + fee)) <= PRICE_BASIS_TOLERANCE;
}
export function isInternalComparisonPrice(split: AdvertisedPriceSplit, candidate: number): boolean {
    const internal = split.internalComparisonPrice;
    const customer = split.customerAdvertisedPrice;
    if (internal == null)
        return false;
    if (customer != null && Math.abs(customer - internal) <= PRICE_BASIS_TOLERANCE)
        return false;
    return Math.abs(candidate - internal) <= PRICE_BASIS_TOLERANCE;
}
