// ── One home for the market arithmetic the surfaces do today ───────────────
//
// The same QX50 currently reads three different ways on one page:
//
//   "$4,718 above market"   dealer inventory — displayed total minus market_value
//   "Fair Market"           market_position, written by a different job
//   "At market · verified"  a badge that fires because market_value is non-null
//
// They disagree because several components each did their own subtraction
// against whichever price column was nearest. This module does not fix that —
// fixing it changes production numbers, which is Gate 14's decision. What it
// does is hold all of those calculations in one file, name each one, and
// return the shared MarketView DTO, so that no component performs market
// arithmetic and the divergence can be COUNTED rather than inferred.
//
// Two rules govern everything below:
//
//   1. With `market_invalid_claim_suppression` OFF — the production default —
//      every number here is byte-identical to what the surface produced
//      before. That includes the embarrassing ones. A refactor may not move a
//      customer-facing number as a side effect.
//   2. The contradiction metric compares what each surface ACTUALLY RENDERS.
//      Comparing a DTO field nothing renders measures this module, not the
//      product, and the first version of it did exactly that.

import { resolvePriceBasis } from "./priceBasis.ts";
import type { MarketConfidence, MarketView } from "./types.ts";

/** The surfaces that make a market claim to a human today. */
export type MarketSurface =
  | "dealer_inventory"   // InventoryModern grid
  | "command_center"     // InventoryCommandCenterV2
  | "trust_badge"        // TrustStrip
  | "passport"           // VehiclePassportGoverned / PublicListing
  | "insights";          // vehicleInsights strength badges

export const MARKET_SURFACES: MarketSurface[] = [
  "dealer_inventory", "command_center", "trust_badge", "passport", "insights",
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
  market_meta?: { similar_count?: number | null; like_count?: number | null; checked_at?: string | null } | null;
  /** True when the stored market basis is known to be weak (legacy model-wide median). */
  market_basis_weak?: boolean | null;
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A subject price that can support any market claim at all. */
export const SUBJECT_PRICE_FLOOR = 500;
export const isUsableSubjectPrice = (price: number | null): price is number =>
  price != null && Number.isFinite(price) && price >= SUBJECT_PRICE_FLOOR;

// ── Legacy vocabulary ──────────────────────────────────────────────────────
//
// Every value production actually holds, counted 2026-09-10:
//   below_market 103 · at_market 65 · above_market 65 · great_deal 26
//   fair_deal 10 · good_deal 9 · unknown 7
//
// The first draft of this map omitted `below_market` and `at_market` — the two
// most common — so 168 of 285 vehicles silently fell through to "Limited
// Market Evidence" and the contradiction metric counted them all as
// disagreements. An unknown or unrecognised value maps to limited evidence and
// never to a positive or verified result.

export const LEGACY_POSITIONS = [
  "below_market", "at_market", "above_market",
  "great_deal", "good_deal", "fair_deal", "unknown",
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

export const isLegacyPosition = (v: unknown): v is LegacyPosition =>
  typeof v === "string" && (LEGACY_POSITIONS as readonly string[]).includes(v);

export function legacyVerdictFor(position: unknown): string {
  return isLegacyPosition(position) ? LEGACY_POSITION_TO_VERDICT[position] : "Limited Market Evidence";
}

/** Positions that assert the car is priced under the market. */
const BELOW_POSITIONS: LegacyPosition[] = ["below_market", "great_deal", "good_deal"];
const WITHIN_POSITIONS: LegacyPosition[] = ["at_market", "fair_deal"];

// ── The compat view ────────────────────────────────────────────────────────

export interface LegacyViewOptions {
  /**
   * The price this surface already resolved for display.
   *
   * The Passport runs `resolveDisplayPrice` first, and on a tenant using the
   * default `advertised_before_doc` mode that is the fee-EXCLUDED 42,981 while
   * the inventory grid subtracts from the fee-included 43,876. Passing the
   * surface's own number in is what keeps this refactor behaviour-identical.
   */
  comparePrice?: number | null;
  /**
   * The tenant's `price_display_mode`. The Passport resolves its own price
   * from it and every other surface anchors on the raw price column — which is
   * precisely why one car shows $4,718 on the grid and $3,823 on the Passport.
   * Defaults to the repository default, which is also Harte's setting.
   */
  priceDisplayMode?: "advertised_before_doc" | "website_sale_price";
  /**
   * P10. OFF in production by default.
   *
   * When off, a missing or absurd subject price still produces whatever the
   * old arithmetic produced — including "$104,109 below market" on a car with
   * no price at all. When on, no such claim is made and the reason is
   * `invalid_subject_price`. Turning it on is a deliberate, canaried change.
   */
  suppressInvalidClaims?: boolean;
}

const emptyView = (
  basis: ReturnType<typeof resolvePriceBasis>,
  reason: string,
): MarketView => ({
  status: "unavailable",
  displayedTotalPrice: basis.displayedTotalPrice,
  vehicleComparisonPrice: basis.vehicleComparisonPrice,
  docFee: basis.docFee,
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
 * The number the Passport actually shows, mirroring `resolveDisplayPrice`.
 *
 * On the default mode that is the LOWER of the advertised price and the price
 * column — the fee-excluded 42,981 for the QX50 — while every dealer surface
 * subtracts from the fee-inclusive 43,876. Reproducing that here is the whole
 * point: it is the disagreement, not an artefact of measuring it.
 */
export function passportDisplayPrice(
  listing: LegacyListingFields,
  mode: "advertised_before_doc" | "website_sale_price",
): number | null {
  const advertised = numOrNull(listing.advertised_price_before_doc);
  const price = numOrNull(listing.price);
  if (mode === "website_sale_price") return price ?? numOrNull(listing.website_sale_price) ?? advertised;
  if (advertised != null && price != null) return Math.min(advertised, price);
  return advertised ?? price;
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
    mandatoryDealerAddOns: listing.mandatory_dealer_add_ons,
  });

  const marketValue = numOrNull(listing.market_value);
  if (marketValue == null || marketValue <= 0) return emptyView(basis, "no_stored_market_value");

  // COMPAT: the legacy comparison anchors on the RAW price column, which is
  // what every one of these surfaces used. Deriving it from the price basis
  // instead would move the number on five production rows.
  const comparePrice = options.comparePrice !== undefined
    ? options.comparePrice
    : surface === "passport"
      ? passportDisplayPrice(listing, options.priceDisplayMode ?? "advertised_before_doc")
      : numOrNull(listing.price);

  if (comparePrice == null) return emptyView(basis, "no_stored_price");

  // P10 — the explicit safety rule, off by default.
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
    // COMPAT DEFECT: the Passport hides the number instead of correcting it,
    // which is why one page can say "above market" and "Fair Market" at once.
    verdict = "Limited Market Evidence";
    confidence = "low";
    reasons.push("passport_suppresses_weak_market_basis");
  } else if (surface === "trust_badge" && !isLegacyPosition(listing.market_position)) {
    // COMPAT DEFECT: the badge asserts a market standing from the mere
    // presence of a market_value, with no check of what produced it.
    verdict = "Within Adjusted Market";
    confidence = "low";
    reasons.push("badge_asserts_verified_from_non_null_market_value");
  } else {
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

// ── What each surface actually renders ─────────────────────────────────────
//
// Not the DTO's verdict — the words and the dollar figure a human sees. This
// is the only comparison that can honestly answer "does this vehicle say
// different things in different places".

export type RenderedDirection = "below" | "within" | "above" | "none";

export interface RenderedClaim {
  surface: MarketSurface;
  direction: RenderedDirection;
  /** The dollar figure shown, if the surface shows one. */
  amount: number | null;
  label: string;
}

const roundOrNull = (n: number | null): number | null => (n == null ? null : Math.round(n));

/**
 * Reproduce one surface's rendered claim from a stored row.
 *
 * Each branch mirrors the live component. Where a component's behaviour is
 * odd — the badge that fires on any non-null market value, the grid that shows
 * "Above market" from a stored string while also showing a dollar delta — the
 * oddity is reproduced, because measuring a corrected version would understate
 * the disagreement we are trying to size.
 */
export function renderedClaim(
  listing: LegacyListingFields,
  surface: MarketSurface,
  options: LegacyViewOptions = {},
): RenderedClaim {
  const view = legacyMarketView(listing, surface, options);
  const position = listing.market_position;
  const belowBy = view.difference != null ? -view.difference : null;
  const none = (label: string): RenderedClaim => ({ surface, direction: "none", amount: null, label });

  if (view.marketP50 == null || view.difference == null) return none("Not checked");

  switch (surface) {
    case "dealer_inventory":
      // A position badge, and a dollar delta beside it.
      if (position === "above_market") return { surface, direction: "above", amount: roundOrNull(view.difference), label: "Above Market" };
      if (isLegacyPosition(position) && BELOW_POSITIONS.includes(position)) {
        return { surface, direction: "below", amount: roundOrNull(belowBy), label: "Below Market" };
      }
      if (isLegacyPosition(position) && WITHIN_POSITIONS.includes(position)) {
        return { surface, direction: "within", amount: roundOrNull(view.difference), label: "Fair Price" };
      }
      return none("Not checked");

    case "command_center":
      // "Above market" from the stored string, otherwise a below-figure from
      // the delta regardless of what the stored string says.
      if (position === "above_market") return { surface, direction: "above", amount: roundOrNull(view.difference), label: "Above market" };
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
      // A dollar badge when the gap clears $250, otherwise a position word.
      if (belowBy != null && belowBy >= 250) return { surface, direction: "below", amount: roundOrNull(belowBy), label: "below market" };
      if (isLegacyPosition(position) && BELOW_POSITIONS.includes(position)) return { surface, direction: "below", amount: null, label: "Great price" };
      if (isLegacyPosition(position) && WITHIN_POSITIONS.includes(position)) return { surface, direction: "within", amount: null, label: "Fair market price" };
      return none("no badge");

    case "passport":
      if (belowBy != null && belowBy > 0) return { surface, direction: "below", amount: roundOrNull(belowBy), label: "below value" };
      if (view.difference > 250 && !listing.market_basis_weak) {
        return { surface, direction: "above", amount: roundOrNull(view.difference), label: "vs value" };
      }
      return none("—");
  }
}

export interface SurfaceDisagreement {
  surfaces: Record<MarketSurface, RenderedClaim>;
  distinctDirections: RenderedDirection[];
  distinctAmounts: number[];
  /** Two surfaces point opposite ways about the same car. */
  directionalContradiction: boolean;
  /** Two surfaces show different dollar figures for the same car. */
  numericContradiction: boolean;
  contradictory: boolean;
}

/**
 * How many different answers this one vehicle gives today.
 *
 * A surface that says nothing is not a contradiction — silence and a claim can
 * coexist. Two surfaces pointing OPPOSITE ways, or showing different dollar
 * figures, are.
 */
export function contradictoryVerdicts(
  listing: LegacyListingFields,
  options: LegacyViewOptions = {},
): SurfaceDisagreement {
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
