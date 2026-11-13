// GENERATED — do not edit.
// Mirror of src/lib/market/surfaceCompat.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { resolvePriceBasis } from "./priceBasis.ts";
import type { MarketConfidence, MarketView } from "./types.ts";
export type MarketSurface = "dealer_inventory" | "command_center" | "trust_badge" | "passport" | "insights";
export const MARKET_SURFACES: MarketSurface[] = [
    "dealer_inventory",
    "command_center",
    "trust_badge",
    "passport",
    "insights",
];
export interface LegacyListingFields {
    price?: number | null;
    advertised_price_before_doc?: number | null;
    website_sale_price?: number | null;
    doc_fee?: number | null;
    advertised_excludes_doc_fee?: boolean | null;
    mandatory_dealer_add_ons?: number | null;
    market_value?: number | null;
    market_position?: string | null;
    market_checked_at?: string | null;
    market_meta?: {
        similar_count?: number | null;
        like_count?: number | null;
        checked_at?: string | null;
    } | null;
    market_basis_weak?: boolean | null;
}
const numOrNull = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
};
export const SUBJECT_PRICE_FLOOR = 500;
export const isUsableSubjectPrice = (price: number | null): price is number => price != null && Number.isFinite(price) && price >= SUBJECT_PRICE_FLOOR;
export const LEGACY_POSITIONS = [
    "below_market",
    "at_market",
    "above_market",
    "great_deal",
    "good_deal",
    "fair_deal",
    "unknown",
] as const;
export type LegacyPosition = (typeof LEGACY_POSITIONS)[number];
export const LEGACY_POSITION_TO_VERDICT: Record<LegacyPosition, string> = {
    below_market: "Below Adjusted Market",
    great_deal: "Below Adjusted Market",
    good_deal: "Below Adjusted Market",
    at_market: "Within Adjusted Market",
    fair_deal: "Within Adjusted Market",
    above_market: "High End of Adjusted Market",
    unknown: "Limited Market Evidence",
};
export const isLegacyPosition = (v: unknown): v is LegacyPosition => typeof v === "string" && (LEGACY_POSITIONS as readonly string[]).includes(v);
export function legacyVerdictFor(position: unknown): string {
    return isLegacyPosition(position) ? LEGACY_POSITION_TO_VERDICT[position] : "Limited Market Evidence";
}
const BELOW_POSITIONS: LegacyPosition[] = ["below_market", "great_deal", "good_deal"];
const WITHIN_POSITIONS: LegacyPosition[] = ["at_market", "fair_deal"];
export interface LegacyViewOptions {
    comparePrice?: number | null;
    priceDisplayMode?: "advertised_before_doc" | "website_sale_price";
    suppressInvalidClaims?: boolean;
}
const emptyView = (basis: ReturnType<typeof resolvePriceBasis>, reason: string): MarketView => ({
    status: "unavailable",
    displayedTotalPrice: basis.displayedTotalPrice,
    vehicleComparisonPrice: basis.vehicleComparisonPrice,
    docFee: basis.docFee,
    marketP50: null,
    rangeLow: null,
    rangeHigh: null,
    rangeLabel: null,
    marketFloor: null,
    difference: null,
    differencePercent: null,
    priceToMarketPercent: null,
    verdict: "Market Estimate Unavailable",
    confidence: "unavailable",
    confidenceReasons: [reason],
    rawComparableCount: 0,
    effectiveComparableCount: 0,
    independentDealerCount: 0,
    provider: null,
    selectedProviderField: null,
    checkedAt: null,
    staleAt: null,
    explanationAvailable: false,
});
export function passportDisplayPrice(listing: LegacyListingFields, mode: "advertised_before_doc" | "website_sale_price"): number | null {
    const advertised = numOrNull(listing.advertised_price_before_doc);
    const price = numOrNull(listing.price);
    if (mode === "website_sale_price")
        return price ?? numOrNull(listing.website_sale_price) ?? advertised;
    if (advertised != null && price != null)
        return Math.min(advertised, price);
    return advertised ?? price;
}
export function legacyMarketView(listing: LegacyListingFields, surface: MarketSurface, options: LegacyViewOptions = {}): MarketView {
    const basis = resolvePriceBasis({
        price: listing.price,
        advertisedPriceBeforeDoc: listing.advertised_price_before_doc,
        websiteSalePrice: listing.website_sale_price,
        docFee: listing.doc_fee,
        advertisedExcludesDocFee: listing.advertised_excludes_doc_fee,
        mandatoryDealerAddOns: listing.mandatory_dealer_add_ons,
    });
    const marketValue = numOrNull(listing.market_value);
    if (marketValue == null || marketValue <= 0)
        return emptyView(basis, "no_stored_market_value");
    const comparePrice = options.comparePrice !== undefined
        ? options.comparePrice
        : surface === "passport"
            ? passportDisplayPrice(listing, options.priceDisplayMode ?? "advertised_before_doc")
            : numOrNull(listing.price);
    if (comparePrice == null)
        return emptyView(basis, "no_stored_price");
    if (options.suppressInvalidClaims && !isUsableSubjectPrice(comparePrice)) {
        return emptyView(basis, "invalid_subject_price");
    }
    const weakBasis = listing.market_basis_weak === true;
    const difference = comparePrice - marketValue;
    const differencePercent = difference / marketValue;
    const storedPosition = String(listing.market_position ?? "unknown");
    const checkedAt = listing.market_checked_at ?? listing.market_meta?.checked_at ?? null;
    const similarCount = numOrNull(listing.market_meta?.similar_count) ?? 0;
    let verdict: string;
    let confidence: MarketConfidence;
    const reasons: string[] = ["legacy_compat_view", `surface_${surface}`];
    if (surface === "passport" && weakBasis) {
        verdict = "Limited Market Evidence";
        confidence = "low";
        reasons.push("passport_suppresses_weak_market_basis");
    }
    else if (surface === "trust_badge" && !isLegacyPosition(listing.market_position)) {
        verdict = "Within Adjusted Market";
        confidence = "low";
        reasons.push("badge_asserts_verified_from_non_null_market_value");
    }
    else {
        verdict = legacyVerdictFor(listing.market_position);
        confidence = isLegacyPosition(listing.market_position) && listing.market_position !== "unknown"
            ? "medium" : "low";
        reasons.push(`stored_position_${storedPosition}`);
    }
    return {
        status: confidence === "low" ? "limited" : "available",
        displayedTotalPrice: basis.displayedTotalPrice,
        vehicleComparisonPrice: basis.vehicleComparisonPrice,
        docFee: basis.docFee,
        marketP50: marketValue,
        rangeLow: null,
        rangeHigh: null,
        rangeLabel: null,
        marketFloor: null,
        difference,
        differencePercent,
        priceToMarketPercent: (comparePrice / marketValue) * 100,
        verdict,
        confidence,
        confidenceReasons: reasons,
        rawComparableCount: similarCount,
        effectiveComparableCount: 0,
        independentDealerCount: 0,
        provider: "marketcheck",
        selectedProviderField: null,
        checkedAt,
        staleAt: null,
        explanationAvailable: false,
    };
}
export type RenderedDirection = "below" | "within" | "above" | "none";
export interface RenderedClaim {
    surface: MarketSurface;
    direction: RenderedDirection;
    amount: number | null;
    label: string;
}
const roundOrNull = (n: number | null): number | null => (n == null ? null : Math.round(n));
export function renderedClaim(listing: LegacyListingFields, surface: MarketSurface, options: LegacyViewOptions = {}): RenderedClaim {
    const view = legacyMarketView(listing, surface, options);
    const position = listing.market_position;
    const belowBy = view.difference != null ? -view.difference : null;
    const none = (label: string): RenderedClaim => ({ surface, direction: "none", amount: null, label });
    if (view.marketP50 == null || view.difference == null)
        return none("Not checked");
    switch (surface) {
        case "dealer_inventory":
            if (position === "above_market")
                return { surface, direction: "above", amount: roundOrNull(view.difference), label: "Above Market" };
            if (isLegacyPosition(position) && BELOW_POSITIONS.includes(position)) {
                return { surface, direction: "below", amount: roundOrNull(belowBy), label: "Below Market" };
            }
            if (isLegacyPosition(position) && WITHIN_POSITIONS.includes(position)) {
                return { surface, direction: "within", amount: roundOrNull(view.difference), label: "Fair Price" };
            }
            return none("Not checked");
        case "command_center":
            if (position === "above_market")
                return { surface, direction: "above", amount: roundOrNull(view.difference), label: "Above market" };
            return { surface, direction: "below", amount: roundOrNull(belowBy), label: "below" };
        case "trust_badge":
            if (isLegacyPosition(position) && BELOW_POSITIONS.includes(position)) {
                return { surface, direction: "below", amount: null, label: "Priced below market" };
            }
            if (isLegacyPosition(position) && WITHIN_POSITIONS.includes(position)) {
                return { surface, direction: "within", amount: null, label: "At market" };
            }
            return none("no badge");
        case "insights":
            if (belowBy != null && belowBy >= 250)
                return { surface, direction: "below", amount: roundOrNull(belowBy), label: "below market" };
            if (isLegacyPosition(position) && BELOW_POSITIONS.includes(position))
                return { surface, direction: "below", amount: null, label: "Great price" };
            if (isLegacyPosition(position) && WITHIN_POSITIONS.includes(position))
                return { surface, direction: "within", amount: null, label: "Fair market price" };
            return none("no badge");
        case "passport":
            if (belowBy != null && belowBy > 0)
                return { surface, direction: "below", amount: roundOrNull(belowBy), label: "below value" };
            if (view.difference > 250 && !listing.market_basis_weak) {
                return { surface, direction: "above", amount: roundOrNull(view.difference), label: "vs value" };
            }
            return none("\u2014");
    }
}
export interface SurfaceDisagreement {
    surfaces: Record<MarketSurface, RenderedClaim>;
    distinctDirections: RenderedDirection[];
    distinctAmounts: number[];
    directionalContradiction: boolean;
    numericContradiction: boolean;
    contradictory: boolean;
}
export function contradictoryVerdicts(listing: LegacyListingFields, options: LegacyViewOptions = {}): SurfaceDisagreement {
    const surfaces = {} as Record<MarketSurface, RenderedClaim>;
    for (const surface of MARKET_SURFACES) {
        surfaces[surface] = renderedClaim(listing, surface, options);
    }
    const claiming = Object.values(surfaces).filter((c) => c.direction !== "none");
    const distinctDirections = [...new Set(claiming.map((c) => c.direction))];
    const distinctAmounts = [...new Set(claiming.map((c) => c.amount).filter((a): a is number => a != null))];
    const directionalContradiction = distinctDirections.length > 1;
    const numericContradiction = distinctAmounts.length > 1;
    return {
        surfaces,
        distinctDirections,
        distinctAmounts,
        directionalContradiction,
        numericContradiction,
        contradictory: directionalContradiction || numericContradiction,
    };
}
