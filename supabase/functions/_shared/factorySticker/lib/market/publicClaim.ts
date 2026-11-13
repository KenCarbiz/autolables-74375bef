// GENERATED — do not edit.
// Mirror of src/lib/market/publicClaim.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { readMarketFlag } from "./flags.ts";
import { isLegacyPosition } from "./surfaceCompat.ts";
import { resolvePriceBasis } from "./priceBasis.ts";
export const PUBLIC_MARKET_FRESHNESS_DAYS = 7;
export const MARKET_CLAIM_UNAVAILABLE_MESSAGE = "Market comparison currently unavailable.";
export const MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE = "Market comparison temporarily unavailable. Contact the dealer for current pricing.";
export const NO_SUBJECT_PRICE_REASON = "no_subject_price";
export const NON_PUBLISHABLE_V2_STATUSES = ["limited", "unavailable", "abstained", "invalid", "conflicting"] as const;
export interface PublicClaimInput {
    marketValue?: unknown;
    marketPosition?: unknown;
    marketCheckedAt?: unknown;
    v2Status?: unknown;
    certificationConflict?: unknown;
    priceBasisStatus?: unknown;
    compatibilityIncomplete?: unknown;
    explicitlyInvalid?: unknown;
    subjectPrice?: unknown;
}
export interface PublicClaimDecision {
    show: boolean;
    suppressed: boolean;
    customerMessage: string | null;
    subjectPriceMissing: boolean;
    reasons: string[];
}
const truthy = (v: unknown): boolean => v === true;
const finitePositive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
export function claimAgeDays(checkedAt: unknown, now: number): number | null {
    if (typeof checkedAt !== "string" || !checkedAt.trim())
        return null;
    const t = Date.parse(checkedAt);
    if (!Number.isFinite(t))
        return null;
    return (now - t) / 86400000;
}
export function positionValueInconsistent(input: {
    marketValue: unknown;
    marketPosition: unknown;
    comparePrice: unknown;
}): boolean {
    if (!finitePositive(input.marketValue) || !finitePositive(input.comparePrice))
        return false;
    if (!isLegacyPosition(input.marketPosition))
        return false;
    const above = input.comparePrice > input.marketValue;
    if (input.marketPosition === "above_market")
        return !above;
    if (["below_market", "great_deal", "good_deal"].includes(input.marketPosition))
        return above;
    return false;
}
export function decidePublicMarketClaim(input: PublicClaimInput & {
    comparePrice?: unknown;
}, options: {
    suppressionEnabled: boolean;
    now?: number;
}): PublicClaimDecision {
    const reasons: string[] = [];
    if (!options.suppressionEnabled) {
        return {
            show: true,
            suppressed: false,
            customerMessage: null,
            subjectPriceMissing: false,
            reasons: ["suppression_disabled"],
        };
    }
    const now = options.now ?? Date.now();
    const age = claimAgeDays(input.marketCheckedAt, now);
    if (age == null)
        reasons.push("missing_market_timestamp");
    else if (age > PUBLIC_MARKET_FRESHNESS_DAYS)
        reasons.push("market_evidence_stale");
    if (!finitePositive(input.marketValue))
        reasons.push("market_value_invalid");
    if (truthy(input.certificationConflict))
        reasons.push("certification_conflict");
    const subjectPriceMissing = !finitePositive(input.subjectPrice);
    if (subjectPriceMissing)
        reasons.push(NO_SUBJECT_PRICE_REASON);
    const basis = typeof input.priceBasisStatus === "string" ? input.priceBasisStatus : null;
    if (basis && basis !== "verified")
        reasons.push(`price_basis_${basis}`);
    if (truthy(input.compatibilityIncomplete))
        reasons.push("compatibility_write_incomplete");
    if (truthy(input.explicitlyInvalid))
        reasons.push("claim_explicitly_invalid");
    const v2 = typeof input.v2Status === "string" ? input.v2Status : null;
    if (v2 && (NON_PUBLISHABLE_V2_STATUSES as readonly string[]).includes(v2)) {
        reasons.push(`v2_status_${v2}`);
    }
    if (positionValueInconsistent({
        marketValue: input.marketValue,
        marketPosition: input.marketPosition,
        comparePrice: input.comparePrice,
    })) {
        reasons.push("position_and_value_inconsistent");
    }
    if (reasons.length === 0) {
        return {
            show: true,
            suppressed: false,
            customerMessage: null,
            subjectPriceMissing: false,
            reasons: ["claim_publishable"],
        };
    }
    return {
        show: false,
        suppressed: true,
        customerMessage: subjectPriceMissing
            ? MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE
            : MARKET_CLAIM_UNAVAILABLE_MESSAGE,
        subjectPriceMissing,
        reasons,
    };
}
export function decidePublicMarketClaimForTenant(settings: unknown, input: PublicClaimInput & {
    comparePrice?: unknown;
}, now?: number): PublicClaimDecision {
    return decidePublicMarketClaim(input, {
        suppressionEnabled: readMarketFlag(settings, "market_invalid_claim_suppression"),
        now,
    });
}
export const INTERNAL_ONLY_PUBLIC_STRINGS = [
    "Limited Market Evidence",
    "Market Estimate Unavailable",
    "abstained",
    "insufficient_market_diversity",
] as const;
export const isInternalOnlyCopy = (text: unknown): boolean => typeof text === "string"
    && (INTERNAL_ONLY_PUBLIC_STRINGS as readonly string[]).some((s) => text.includes(s));
export interface PublicListingLike {
    market_value?: unknown;
    market_position?: unknown;
    market_checked_at?: unknown;
    price?: unknown;
    website_sale_price?: unknown;
    advertised_price_before_doc?: unknown;
    doc_fee?: unknown;
    advertised_excludes_doc_fee?: unknown;
    public_market_flags?: unknown;
    dealer_snapshot?: unknown;
    certification?: unknown;
    price_basis_status?: unknown;
    v2_status?: unknown;
}
export function listingCertificationConflict(listing: PublicListingLike): boolean {
    const cert = listing.certification;
    if (cert == null || typeof cert !== "object" || Array.isArray(cert))
        return false;
    return (cert as Record<string, unknown>).provider_conflict === true;
}
const asMoney = (v: unknown): number | null => {
    if (typeof v === "number")
        return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v.replace(/[$,\s]/g, ""));
        return Number.isFinite(n) ? n : null;
    }
    return null;
};
export function resolveSubjectPrice(listing: PublicListingLike): number | null {
    const basis = resolvePriceBasis({
        price: asMoney(listing.price),
        websiteSalePrice: asMoney(listing.website_sale_price),
        advertisedPriceBeforeDoc: asMoney(listing.advertised_price_before_doc),
        docFee: asMoney(listing.doc_fee),
        advertisedExcludesDocFee: typeof listing.advertised_excludes_doc_fee === "boolean"
            ? listing.advertised_excludes_doc_fee
            : null,
    });
    const displayed = basis.displayedTotalPrice;
    return typeof displayed === "number" && Number.isFinite(displayed)
        && displayed >= 500 && displayed <= 5000000
        ? displayed
        : null;
}
export function publicMarketClaimForListing(listing: PublicListingLike, now?: number): PublicClaimDecision {
    return decidePublicMarketClaimForTenant(readPublicMarketFlags(listing), {
        subjectPrice: resolveSubjectPrice(listing),
        marketValue: typeof listing.market_value === "string"
            ? Number(listing.market_value)
            : listing.market_value,
        marketPosition: listing.market_position,
        marketCheckedAt: listing.market_checked_at,
        comparePrice: typeof listing.price === "string" ? Number(listing.price) : listing.price,
        certificationConflict: listingCertificationConflict(listing),
        priceBasisStatus: listing.price_basis_status,
        v2Status: listing.v2_status,
    }, now);
}
export const PUBLIC_MARKET_FLAG_ALLOWLIST = ["market_invalid_claim_suppression"] as const;
export type PublicMarketFlag = (typeof PUBLIC_MARKET_FLAG_ALLOWLIST)[number];
export const PUBLIC_MARKET_FLAGS_FIELD = "public_market_flags";
export function projectPublicMarketFlags(settings: unknown): Record<PublicMarketFlag, boolean> {
    const out = {} as Record<PublicMarketFlag, boolean>;
    for (const flag of PUBLIC_MARKET_FLAG_ALLOWLIST) {
        out[flag] = readMarketFlag(settings, flag);
    }
    return out;
}
export function readPublicMarketFlags(listing: {
    public_market_flags?: unknown;
    dealer_snapshot?: unknown;
}): unknown {
    const projected = listing.public_market_flags;
    if (projected != null && typeof projected === "object" && !Array.isArray(projected)) {
        return { market_flags: projected };
    }
    return listing.dealer_snapshot;
}
