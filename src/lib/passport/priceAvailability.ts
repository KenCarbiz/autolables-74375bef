// ── Zero is not a price ─────────────────────────────────────────────────────
//
// `listing.price ?? 0` put "Our Price $0" on the classic listing and
// "$0/mo · For 72 months" on Today's Price for every vehicle the dealer had
// not priced yet. Both read as a real offer. The nullish default is the whole
// bug: it converts "we don't know" into "it costs nothing", and every
// downstream calculation then treats that zero as a fact — a payment schedule,
// a down-payment slider, an amount financed.
//
// This module is the one answer to "may a public surface print a price for
// this vehicle". It returns a RESULT, never a number, so a caller cannot
// accidentally coerce the unavailable case back into 0. There is no
// `.amountOrZero()` and there will not be one.
//
// It is deliberately NOT a second price resolver. The amount comes from
// `resolveSubjectPrice`, the canonical subject/display-price resolver built on
// `resolvePriceBasis`, so the approved advertised/dealer-price sources stay
// defined in exactly one place. Market value, provider prediction, comparable
// median, value-history figures and MSRP are not inputs to that resolver, so
// none of them can become a vehicle price here either.
//
// Separation of concerns, all three governed independently:
//   • no subject price  -> the public MARKET CLAIM is suppressed (publicClaim)
//   • no subject price  -> PRICE presentation says contact the dealer (here)
//   • no subject price  -> PAYMENT presentation abstains entirely (here)
//   • internal shadow keeps its incomplete-price work item, untouched.

import { resolveSubjectPrice, type PublicListingLike } from "@/lib/market/publicClaim";

/** Why a vehicle has no publishable price. Internal; never rendered verbatim. */
export type PriceUnavailableReason =
  /** No approved advertised/dealer-price source resolved at all. */
  | "no_price_source"
  /** A source resolved, but to zero, a negative, or an implausible figure. */
  | "non_positive";

export type PriceAvailability =
  | { available: true; amount: number }
  | { available: false; reason: PriceUnavailableReason };

/** The approved customer-facing string when the dealer has published no price. */
export const CONTACT_DEALER_FOR_PRICE = "Contact Dealer for Price";

/** The approved customer-facing string when no payment can honestly be estimated. */
export const PAYMENT_UNAVAILABLE_MESSAGE =
  "Payment estimate unavailable until dealer pricing is available.";

const positiveFinite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Can a public surface print a price for this vehicle?
 *
 * Pass the listing. The amount is whatever the canonical resolver says, and
 * nothing else — this function adds no fallback of its own.
 */
export function resolvePriceAvailability(listing: PublicListingLike | null | undefined): PriceAvailability {
  if (listing == null) return { available: false, reason: "no_price_source" };
  const resolved = resolveSubjectPrice(listing);
  if (resolved == null) return { available: false, reason: "no_price_source" };
  if (!positiveFinite(resolved)) return { available: false, reason: "non_positive" };
  return { available: true, amount: resolved };
}

/**
 * The same question for a surface that already holds a derived price.
 *
 * `PassportData.price` is produced upstream from the same approved sources, so
 * a page that has it need not re-resolve the listing. A null, a zero and a
 * negative all mean unavailable — never 0.
 */
export function priceAvailabilityFromAmount(amount: unknown): PriceAvailability {
  if (amount == null) return { available: false, reason: "no_price_source" };
  if (!positiveFinite(amount)) return { available: false, reason: "non_positive" };
  return { available: true, amount };
}

/**
 * May a payment estimate be calculated and shown?
 *
 * A payment is a claim about what the shopper will owe every month. Without a
 * price there is no amount financed, so there is no honest estimate — and a
 * term ("For 72 months") must not be printed beside a payment that does not
 * exist, because the term makes the absent number look deliberate.
 */
export function canEstimatePayment(price: PriceAvailability): boolean {
  return price.available;
}
