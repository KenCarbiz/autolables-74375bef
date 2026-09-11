// ── One governed boundary for every public market surface ──────────────────
//
// `publicClaim.ts` decides whether a customer may see a market claim. That
// decision only protects a surface that ASKS it, and for a long time only two
// of the public pages did: the governed Passport and the classic PublicListing.
// The sibling Passport routes — great-buy, todays-price and every other
// `/v/:slug/:section` — built their own `derivePassport(listing)` and published
// "Priced $9,099 below market" from the same stale row the governed page was
// about to suppress. A shopper who opened a sibling URL got the claim policy
// had already refused.
//
// Two lessons are baked into the shape of this module:
//
//   1. Suppressing DERIVED data is not enough. `PassportPanel` reads
//      `listing.market_checked_at`, `listing.market_payload.checked_at` and the
//      comparison counters inside `listing.market_meta` directly, so a panel
//      could rebuild "Updated <date> · 42 similar vehicles · priced lower than
//      91%" out of fields nobody had nulled. Suppression therefore happens at
//      the LISTING, upstream of every derivation.
//
//   2. It happens ONCE, at the shared fetch (`usePublicListing`), not per page.
//      A per-page condition is a per-page opportunity to forget, and forgetting
//      is exactly how this defect reached production.
//
// OFF MEANS IDENTICAL. When the claim is shown — which is every vehicle while
// `market_invalid_claim_suppression` is false — `governPublicListing` returns
// the SAME object reference it was handed. Not a clone, not a rebuild: the same
// reference, so no consumer can observe that this module ran.

import { publicMarketClaimForListing, type PublicClaimDecision } from "@/lib/market/publicClaim";
import { derivePassport, suppressPassportMarketClaim, type PassportData } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

/**
 * Listing columns that carry, or can rebuild, a public market claim.
 *
 * `public_market_flags` is deliberately NOT here: it is the projection the
 * decision itself reads, and stripping it would make a second call to
 * `publicMarketClaimForListing` see an unflagged listing and answer "show".
 */
export const PROTECTED_LISTING_MARKET_FIELDS = [
  "market_value",
  "market_position",
  "market_checked_at",
  "market_payload",
  "market_meta",
  // The competitor set itself. `great-buy` reads its LENGTH to publish "Market
  // Data Verified" and to reason about same-trim scarcity, so leaving it in
  // place would keep a market claim alive with every price already stripped.
  // Not to be confused with `group_similar`, the dealer's own inventory, which
  // is an offer rather than price evidence and stays.
  "comparables",
] as const;

/**
 * Comparison evidence stored inside `mc_attributes`.
 *
 * The rest of that blob is vehicle description — engine, colours, options,
 * title and history facts — which no safeguard has any business hiding. Only
 * the keys that describe OTHER vehicles, or this one's rank among them, are
 * market claims.
 */
export const PROTECTED_MC_ATTRIBUTE_KEYS = [
  "avg_dom",
  "comp_price_cut_count",
  "comp_price_cut_total",
  "comparable_count",
  "inventory_change_pct",
  "inventory_count",
  "market_days_supply",
  "price_percentile",
  "search_radius",
  "similar_count",
  "trim_count",
  "trim_matched",
] as const;

/** `sold_price`, `sold_dom`, `sold_count`, … — delisted-comparable evidence. */
export const PROTECTED_MC_ATTRIBUTE_PREFIXES = ["sold_"] as const;

/**
 * Per-point fields of `value_history` that state a market position over time.
 *
 * `listing_price` and `captured_at` stay: the dealer's own published price and
 * when it changed are the dealer's facts, and a price-drop history is not a
 * claim about a market.
 */
export const PROTECTED_VALUE_HISTORY_FIELDS = ["market_value", "below_market", "position"] as const;

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag =>
  v != null && typeof v === "object" && !Array.isArray(v);

const isProtectedMcKey = (key: string): boolean =>
  (PROTECTED_MC_ATTRIBUTE_KEYS as readonly string[]).includes(key)
  || PROTECTED_MC_ATTRIBUTE_PREFIXES.some((p) => key.startsWith(p));

const stripMcAttributes = (value: unknown): unknown => {
  if (!isBag(value)) return value;
  const kept: Bag = {};
  for (const [k, v] of Object.entries(value)) if (!isProtectedMcKey(k)) kept[k] = v;
  return kept;
};

const stripValueHistory = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  return value.map((point) => {
    if (!isBag(point)) return point;
    const next: Bag = { ...point };
    for (const f of PROTECTED_VALUE_HISTORY_FIELDS) if (f in next) next[f] = null;
    return next;
  });
};

/**
 * The listing a public surface may render when the claim is suppressed.
 *
 * Every protected column becomes null rather than disappearing, so a consumer
 * that reads it gets "no answer" instead of `undefined` — which is what the
 * existing null/unavailable render paths already expect and what keeps `$0`,
 * `undefined` and empty badges off the page.
 */
export function suppressListingMarketFields<T>(listing: T): T {
  if (!isBag(listing)) return listing;
  const next: Bag = { ...listing };
  for (const field of PROTECTED_LISTING_MARKET_FIELDS) if (field in next) next[field] = null;
  if ("mc_attributes" in next) next.mc_attributes = stripMcAttributes(next.mc_attributes);
  if ("value_history" in next) next.value_history = stripValueHistory(next.value_history);
  return next as T;
}

export interface GovernedPublicListing<T> {
  /** The listing every public surface must render from. */
  listing: T;
  claim: PublicClaimDecision;
}

/**
 * Resolve the claim once and hand back the listing the public may see.
 *
 * Returns the original reference untouched whenever the claim is shown, so a
 * flag-false page renders byte-identically to the page before this module
 * existed.
 */
export function governPublicListing<T>(listing: T | null, now?: number): GovernedPublicListing<T | null> {
  const claim = publicMarketClaimForListing((listing ?? {}) as never, now);
  if (listing == null || claim.show) return { listing, claim };
  return { listing: suppressListingMarketFields(listing), claim };
}

/**
 * Derived passport data a public page may render.
 *
 * The same two-step `VehiclePassportGoverned` has always used — decide, then
 * suppress the derived shape — so a page adopting it needs one line and cannot
 * invent a third spelling of the rule. Belt and braces over
 * `governPublicListing`: the listing arriving here is already governed, and
 * suppressing the derived form again is a no-op that keeps each page's
 * governance readable at the page itself.
 */
export function governedPassportData(
  listing: VehicleListing | null,
  now?: number,
): PassportData | null {
  if (!listing) return null;
  // Derive from the GOVERNED listing, not the raw one. `suppressPassportMarketClaim`
  // nulls the headline numbers but not `marketMeta.percentile` or the comparable
  // set, so deriving first and suppressing after would leave "priced lower than
  // 88% of similar vehicles" and "Market Data Verified" standing on a claim that
  // had just been refused.
  const { listing: governed, claim } = governPublicListing(listing, now);
  const derived = derivePassport(governed as VehicleListing);
  return claim.show ? derived : suppressPassportMarketClaim(derived);
}

// ── The registry ───────────────────────────────────────────────────────────
//
// Every live public route that can display a market claim, and how it is
// governed. `publicSurface.test.ts` walks this list against the real source
// tree, so a new public Passport route that renders a claim without appearing
// here fails the suite rather than shipping ungoverned.

export type PublicSurfaceGovernance =
  /** Renders market claims; must consume the governed listing or the helper. */
  | "governed"
  /** Renders no market claim at all — proven by source inspection, not assumed. */
  | "no_market_claim";

export interface PublicMarketSurface {
  route: string;
  entry: string;
  governance: PublicSurfaceGovernance;
  /** Why a `no_market_claim` surface genuinely renders none. */
  reason?: string;
}

export const PUBLIC_MARKET_SURFACE_REGISTRY: readonly PublicMarketSurface[] = [
  { route: "/v/:slug", entry: "src/pages/VehiclePassportGoverned.tsx", governance: "governed" },
  { route: "/v3/:slug", entry: "src/pages/VehiclePassportGoverned.tsx", governance: "governed" },
  { route: "/v-classic/:slug", entry: "src/pages/PublicListing.tsx", governance: "governed" },
  { route: "/v/:slug/great-buy", entry: "src/pages/VehiclePassportGreatBuy.tsx", governance: "governed" },
  { route: "/v/:slug/:section", entry: "src/pages/VehiclePassportV2Detail.tsx", governance: "governed" },
  { route: "/v/:slug/vehicle-history", entry: "src/pages/VehiclePassportHistory.tsx", governance: "governed" },
  {
    route: "/v/:slug/verification",
    entry: "src/pages/VehiclePassportVerification.tsx",
    governance: "no_market_claim",
    reason: "renders verification categories only; reads no protected market field",
  },
  {
    route: "/v/:slug/documents",
    entry: "src/pages/VehiclePassportDocuments.tsx",
    governance: "no_market_claim",
    reason: "renders the document list only; reads no protected market field",
  },
  {
    route: "/v/:slug/dealer",
    entry: "src/pages/VehiclePassportDealer.tsx",
    governance: "no_market_claim",
    reason: "renders dealer identity and contact only; reads no protected market field",
  },
  {
    route: "/v-classic/:slug/documents",
    entry: "src/pages/PublicDocuments.tsx",
    governance: "no_market_claim",
    reason: "renders the document list only; reads no protected market field",
  },
];

/**
 * The shared fetch every `/v/:slug…` surface reads through.
 *
 * Named here because the registry test asserts the governance happens inside
 * it: that single call is what makes a page's governance structural instead of
 * a habit each new page has to remember.
 */
export const PUBLIC_LISTING_FETCH_MODULE = "src/hooks/usePublicListing.ts";
