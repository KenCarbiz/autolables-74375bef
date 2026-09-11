// ── One decision about whether a customer sees a market claim ──────────────
//
// Today 131 published vehicles carry a legacy market claim, 65 of them say
// "above market", and 131 rows were last checked more than seven days ago.
// Four surfaces decide independently whether to show any of it — PublicListing,
// TrustStrip, MarketValueReport and the Passport — which is how one QX50 came
// to read "$4,718 above market", "Fair Market" and "At market · verified" on
// the same afternoon.
//
// This module is the one answer. It is deliberately NOT a renderer: it returns
// show/suppress plus reasons, and each surface keeps its own layout.
//
// THE FLAG IS OFF, AND OFF MEANS IDENTICAL. With
// `market_invalid_claim_suppression` false, `decidePublicMarketClaim` returns
// `show: true` for every input, including the embarrassing ones. A safeguard
// that quietly changed 131 published pages the moment it merged would be the
// same class of event it exists to prevent. Turning it on is a supervised,
// measured step with a pre/post count, not a side effect of a deploy.
//
// What suppression removes is the CLAIM, never the car:
//
//   • the advertised price stays visible — it is the dealer's published price
//     and has nothing to do with whether we can compare it to a market;
//   • the $42,981 internal comparison basis is never shown as a price;
//   • the $40,661 provider prediction is never shown as a market value;
//   • "Limited Market Evidence" is an INTERNAL verdict and never appears to a
//     customer — it invites the question "limited how?", which is a
//     conversation about our data quality held on the dealer's page;
//   • no fingerprint, confidence tier, comparable count, provider field or
//     abstention reason is rendered publicly.
//
// The customer sees one neutral sentence, or nothing at all.

import { readMarketFlag } from "./flags.ts";
import { isLegacyPosition } from "./surfaceCompat.ts";

/** The approved public freshness window. Older than this is not a current claim. */
export const PUBLIC_MARKET_FRESHNESS_DAYS = 7;

/** The only sentence a customer is shown in place of a claim. */
export const MARKET_CLAIM_UNAVAILABLE_MESSAGE = "Market comparison currently unavailable.";

/** Verdict-side states that cannot support a public claim. */
export const NON_PUBLISHABLE_V2_STATUSES = ["limited", "unavailable", "abstained", "invalid", "conflicting"] as const;

export interface PublicClaimInput {
  /** Legacy `vehicle_listings.market_value`. */
  marketValue?: unknown;
  /** Legacy `vehicle_listings.market_position`. */
  marketPosition?: unknown;
  /** Legacy `vehicle_listings.market_checked_at`. */
  marketCheckedAt?: unknown;
  /** The V2 status, when one has been recorded for this vehicle. */
  v2Status?: unknown;
  /** A provider echo that contradicts an authoritative certification record. */
  certificationConflict?: unknown;
  /** `price_basis_status` when it is anything but verified. */
  priceBasisStatus?: unknown;
  /** The compatibility write was attempted and did not complete. */
  compatibilityIncomplete?: unknown;
  /** An operator or an earlier gate marked this claim invalid outright. */
  explicitlyInvalid?: unknown;
}

export interface PublicClaimDecision {
  /** May the surface render a market claim at all. */
  show: boolean;
  suppressed: boolean;
  /** Null when nothing should be said. Never a diagnostic. */
  customerMessage: string | null;
  /** INTERNAL ONLY. Never render these. */
  reasons: string[];
}

const truthy = (v: unknown): boolean => v === true;

const finitePositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/** Milliseconds since a stored timestamp, or null when it is unreadable. */
export function claimAgeDays(checkedAt: unknown, now: number): number | null {
  if (typeof checkedAt !== "string" || !checkedAt.trim()) return null;
  const t = Date.parse(checkedAt);
  if (!Number.isFinite(t)) return null;
  return (now - t) / 86_400_000;
}

/**
 * Do the stored value and the stored word agree?
 *
 * `market_position` was written by one job and `market_value` by another, so
 * a row can hold `below_market` beside a value the price is above. Neither
 * number is trustworthy once they disagree, and a customer-facing claim built
 * from half of a contradiction is worse than silence.
 */
export function positionValueInconsistent(input: {
  marketValue: unknown;
  marketPosition: unknown;
  comparePrice: unknown;
}): boolean {
  if (!finitePositive(input.marketValue) || !finitePositive(input.comparePrice)) return false;
  if (!isLegacyPosition(input.marketPosition)) return false;
  const above = input.comparePrice > input.marketValue;
  if (input.marketPosition === "above_market") return !above;
  if (["below_market", "great_deal", "good_deal"].includes(input.marketPosition)) return above;
  return false;
}

/**
 * The one decision. Every public surface calls this and nothing else.
 *
 * `options.suppressionEnabled` is the tenant's `market_invalid_claim_suppression`
 * flag, read through `readMarketFlag` so only a literal true switches it on.
 */
export function decidePublicMarketClaim(
  input: PublicClaimInput & { comparePrice?: unknown },
  options: { suppressionEnabled: boolean; now?: number },
): PublicClaimDecision {
  const reasons: string[] = [];

  // OFF means byte-identical to today. Checked first and returning
  // immediately, so no condition below can leak into the flag-off path.
  if (!options.suppressionEnabled) {
    return { show: true, suppressed: false, customerMessage: null, reasons: ["suppression_disabled"] };
  }

  const now = options.now ?? Date.now();
  const age = claimAgeDays(input.marketCheckedAt, now);

  if (age == null) reasons.push("missing_market_timestamp");
  else if (age > PUBLIC_MARKET_FRESHNESS_DAYS) reasons.push("market_evidence_stale");

  if (!finitePositive(input.marketValue)) reasons.push("market_value_invalid");
  if (truthy(input.certificationConflict)) reasons.push("certification_conflict");

  const basis = typeof input.priceBasisStatus === "string" ? input.priceBasisStatus : null;
  if (basis && basis !== "verified") reasons.push(`price_basis_${basis}`);

  if (truthy(input.compatibilityIncomplete)) reasons.push("compatibility_write_incomplete");
  if (truthy(input.explicitlyInvalid)) reasons.push("claim_explicitly_invalid");

  const v2 = typeof input.v2Status === "string" ? input.v2Status : null;
  if (v2 && (NON_PUBLISHABLE_V2_STATUSES as readonly string[]).includes(v2)) {
    // The status name never reaches the customer; only this reason, internally.
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
    return { show: true, suppressed: false, customerMessage: null, reasons: ["claim_publishable"] };
  }
  return { show: false, suppressed: true, customerMessage: MARKET_CLAIM_UNAVAILABLE_MESSAGE, reasons };
}

/** Read the flag and decide, in one call, for a surface that holds tenant settings. */
export function decidePublicMarketClaimForTenant(
  settings: unknown,
  input: PublicClaimInput & { comparePrice?: unknown },
  now?: number,
): PublicClaimDecision {
  return decidePublicMarketClaim(input, {
    suppressionEnabled: readMarketFlag(settings, "market_invalid_claim_suppression"),
    now,
  });
}

/**
 * Values that must never appear in a customer-facing market field.
 *
 * The tamper surface: an internal comparison basis rendered as a price, a
 * provider prediction rendered as a market value, or an internal verdict
 * rendered as customer copy.
 */
export const INTERNAL_ONLY_PUBLIC_STRINGS = [
  "Limited Market Evidence",
  "Market Estimate Unavailable",
  "abstained",
  "insufficient_market_diversity",
] as const;

export const isInternalOnlyCopy = (text: unknown): boolean =>
  typeof text === "string"
  && (INTERNAL_ONLY_PUBLIC_STRINGS as readonly string[]).some((s) => text.includes(s));

// ── The one entry point every public surface uses ──────────────────────────
//
// A published listing carries its dealer's profile in `dealer_snapshot`, which
// is the only tenant-scoped data a public page has. The flag is read from
// there through `readMarketFlag`, so an absent snapshot, an absent
// `market_flags` object and an explicit false all resolve to OFF — and off is
// today's UI, unchanged.
//
// PREREQUISITE, stated here because it is easy to miss and expensive to
// discover late: suppression cannot be ACTIVATED until `market_flags` actually
// reaches the public payload. Until it does, this returns `show: true` for
// every vehicle no matter what is stored on the tenant. That is the correct
// failure mode — a safeguard that cannot read its flag must not guess — but it
// means "set the flag" is not by itself enough to turn suppression on, and the
// deployment packet has to verify the flag is visible here before counting a
// pre/post suppression delta.

export interface PublicListingLike {
  market_value?: unknown;
  market_position?: unknown;
  market_checked_at?: unknown;
  price?: unknown;
  dealer_snapshot?: unknown;
  certification?: unknown;
  price_basis_status?: unknown;
  v2_status?: unknown;
}

/** Does the stored certification record carry a recorded provider conflict? */
export function listingCertificationConflict(listing: PublicListingLike): boolean {
  const cert = listing.certification;
  if (cert == null || typeof cert !== "object" || Array.isArray(cert)) return false;
  return (cert as Record<string, unknown>).provider_conflict === true;
}

export function publicMarketClaimForListing(
  listing: PublicListingLike,
  now?: number,
): PublicClaimDecision {
  return decidePublicMarketClaimForTenant(
    listing.dealer_snapshot,
    {
      marketValue: typeof listing.market_value === "string"
        ? Number(listing.market_value)
        : listing.market_value,
      marketPosition: listing.market_position,
      marketCheckedAt: listing.market_checked_at,
      comparePrice: typeof listing.price === "string" ? Number(listing.price) : listing.price,
      certificationConflict: listingCertificationConflict(listing),
      priceBasisStatus: listing.price_basis_status,
      v2Status: listing.v2_status,
    },
    now,
  );
}
