// GENERATED — do not edit.
// Mirror of src/lib/market/surfaceCompat.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── One home for the market arithmetic the surfaces do today ───────────────
//
// The same QX50 currently reads three different ways on one page:
//
//   "$4,718 above market"   dealer inventory — displayed total minus market_value
//   "Fair Market"           market_position, written by a different job
//   "At market · verified"  a badge that fires because market_value is non-null
//
// They disagree because three components each did their own subtraction
// against whichever price column was nearest to hand. This module does not fix
// that — fixing it changes production numbers, and that is Gate 14's decision
// to make, not a side effect of a refactor. What it does is move all three
// calculations into one file, name each one, and return the shared MarketView
// DTO, so that:
//
//   • no component performs market arithmetic any more;
//   • the divergence is visible in one place instead of inferred from four;
//   • `contradictoryVerdicts()` can COUNT the disagreement per vehicle, which
//     is what the shadow fleet report needs to tell the owner how big the
//     problem actually is.
//
// Every function here is COMPAT. Each is documented with the defect it
// preserves. When the V2 flag is on, callers use buildMarketView instead and
// none of this runs.

import { resolvePriceBasis } from "./priceBasis.ts";
import type { MarketConfidence, MarketView } from "./types.ts";

export type MarketSurface = "dealer_inventory" | "passport" | "trust_badge";

export interface LegacyListingFields {
  price?: number | null;
  advertised_price_before_doc?: number | null;
  website_sale_price?: number | null;
  doc_fee?: number | null;
  advertised_excludes_doc_fee?: boolean | null;
  market_value?: number | null;
  market_position?: string | null;
  market_checked_at?: string | null;
  market_meta?: { similar_count?: number | null; like_count?: number | null; checked_at?: string | null } | null;
  /** True when the stored market basis is known to be weak (legacy model-wide median). */
  market_basis_weak?: boolean | null;
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Today's stored position vocabulary, which no two writers agree on. */
export const LEGACY_POSITIONS = [
  "great_deal", "good_deal", "fair_deal", "above_market", "unknown",
] as const;

/**
 * The single vocabulary every surface will speak after Gate 14. Kept here so
 * the mapping is reviewable now rather than invented at rollout.
 */
export const LEGACY_POSITION_TO_VERDICT: Record<string, string> = {
  great_deal: "Below Adjusted Market",
  good_deal: "Below Adjusted Market",
  fair_deal: "Within Adjusted Market",
  above_market: "High End of Adjusted Market",
  unknown: "Limited Market Evidence",
};

const emptyView = (basisPrice: ReturnType<typeof resolvePriceBasis>, reason: string): MarketView => ({
  status: "unavailable",
  displayedTotalPrice: basisPrice.displayedTotalPrice,
  vehicleComparisonPrice: basisPrice.vehicleComparisonPrice,
  docFee: basisPrice.docFee,
  marketP50: null, rangeLow: null, rangeHigh: null, rangeLabel: null, marketFloor: null,
  difference: null, differencePercent: null, priceToMarketPercent: null,
  verdict: "Market Estimate Unavailable",
  confidence: "unavailable",
  confidenceReasons: [reason],
  rawComparableCount: 0, effectiveComparableCount: 0, independentDealerCount: 0,
  provider: null, selectedProviderField: null,
  checkedAt: null, staleAt: null, explanationAvailable: false,
});

/**
 * Build the compat view for one surface.
 *
 * `compareOn` is the entire disagreement. The dealer inventory subtracts from
 * the DISPLAYED total, which charges the customer's doc fee to the car and is
 * where the QX50's $4,718 comes from; the Passport subtracts from the same
 * displayed number but suppresses the claim when the basis is weak, which is
 * why the same car reads "Fair Market" there. Neither is corrected here.
 */
export interface LegacyViewOptions {
  /**
   * The price this surface already resolved for display.
   *
   * The Passport runs `resolveDisplayPrice` first, and on a tenant using the
   * default `advertised_before_doc` mode that is the fee-EXCLUDED 42,981 while
   * the inventory grid subtracts from the fee-included 43,876. Passing the
   * surface's own number in is what keeps this refactor behaviour-identical;
   * removing the difference is Gate 14's decision, not this file's.
   */
  comparePrice?: number | null;
}

export function legacyMarketView(
  listing: LegacyListingFields,
  surface: MarketSurface,
  options: LegacyViewOptions = {},
): MarketView {
  const basis = resolvePriceBasis({
    price: listing.price,
    advertisedPriceBeforeDoc: listing.advertised_price_before_doc,
    websiteSalePrice: listing.website_sale_price,
    docFee: listing.doc_fee,
    advertisedExcludesDocFee: listing.advertised_excludes_doc_fee,
  });

  const marketValue = numOrNull(listing.market_value);
  if (marketValue == null || marketValue <= 0) return emptyView(basis, "no_stored_market_value");

  // COMPAT DEFECT, preserved deliberately: the default comparison uses the
  // displayed total, fee included, against a provider prediction of the
  // vehicle alone. A surface that already resolved its own price passes it in.
  const comparePrice = options.comparePrice !== undefined
    ? options.comparePrice
    : basis.displayedTotalPrice;
  if (comparePrice == null) return emptyView(basis, "no_stored_price");

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
    // COMPAT DEFECT: the Passport hides the number instead of correcting it,
    // which is why one page can say "above market" and "Fair Market" at once.
    verdict = "Limited Market Evidence";
    confidence = "low";
    reasons.push("passport_suppresses_weak_market_basis");
  } else if (surface === "trust_badge") {
    // COMPAT DEFECT: the badge asserts verification from the mere presence of
    // a market_value, with no check of what produced it.
    verdict = "Within Adjusted Market";
    confidence = "low";
    reasons.push("badge_asserts_verified_from_non_null_market_value");
  } else {
    verdict = LEGACY_POSITION_TO_VERDICT[storedPosition] ?? "Limited Market Evidence";
    confidence = storedPosition === "unknown" ? "low" : "medium";
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

export interface SurfaceDisagreement {
  surfaces: Record<MarketSurface, string>;
  distinctVerdicts: string[];
  contradictory: boolean;
}

/**
 * How many different answers this one vehicle gives today.
 *
 * The shadow report counts these across the lot. A vehicle whose three
 * surfaces produce three different verdicts is not a display inconsistency,
 * it is three separate calculations that were never reconciled.
 */
export function contradictoryVerdicts(listing: LegacyListingFields): SurfaceDisagreement {
  const surfaces: Record<MarketSurface, string> = {
    dealer_inventory: legacyMarketView(listing, "dealer_inventory").verdict,
    passport: legacyMarketView(listing, "passport").verdict,
    trust_badge: legacyMarketView(listing, "trust_badge").verdict,
  };
  // Numeric disagreement counts too: the same car reading "$4,718 above" on
  // one surface and "$3,823 above" on another is one defect, not two views.
  const differences = new Set(
    (["dealer_inventory", "passport", "trust_badge"] as MarketSurface[])
      .map((s) => legacyMarketView(listing, s).difference)
      .filter((d): d is number => d != null)
      .map((d) => Math.round(d)),
  );
  const distinctVerdicts = [...new Set(Object.values(surfaces))];
  return { surfaces, distinctVerdicts, contradictory: distinctVerdicts.length > 1 || differences.size > 1 };
}
