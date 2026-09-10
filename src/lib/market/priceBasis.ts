// ── Price truth and normalization ──────────────────────────────────────────
//
// One resolver, one answer, for the question every market comparison depends
// on: which number describes the VEHICLE, and which number describes what the
// customer is asked to hand over.
//
// The QX50 is the whole argument. `vehicle_listings.price` is 43,876 and
// already contains Harte's $895 conveyance fee. MarketCheck predicts the
// vehicle, not the fee. Comparing 43,876 against 39,158 charges the customer's
// doc fee to the car and manufactures $895 of "above market" before any
// valuation question has been asked. The comparison price is 42,981.
//
// The repository already had `resolveComparePrice` in priceModel.ts and no
// production caller — only its own test. That is the dead code this replaces:
// the concept was right and nothing was wired to it.
//
// The complete identity, both directions:
//
//   displayedTotalPrice    = vehicleComparisonPrice
//                          − conditionalDiscountsApplied
//                          + docFee
//                          + mandatoryDealerAddOns
//
//   vehicleComparisonPrice = displayedTotalPrice
//                          + conditionalDiscountsApplied
//                          − docFee
//                          − mandatoryDealerAddOns
//
// Conditional money is added BACK because a rebate only some buyers qualify
// for is not a lower price for the market; treating it as one makes every
// competitor running a military or college offer look cheaper than it is.
//
// Mandatory dealer-installed products come OFF, because they are not the
// vehicle. They are disclosed as their own line — never folded into the
// comparison, and never silently dropped from what the customer pays.
//
// The simplified `comparison + fee = displayed` holds only when conditional
// discounts and mandatory add-ons are both zero. That is every vehicle in the
// pilot lot today, and it is not something the resolver may assume: an unknown
// add-on treatment produces an AMBIGUOUS basis, which costs confidence and
// forecloses a red verdict, rather than a confident number built on a guess.

import {
  PRICE_BASIS_TOLERANCE,
  type ComparablePriceBasis,
  type MarketPriceBasis,
} from "./types.ts";

const money = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
};

/** A price a car could actually carry. Guards against 0, negatives and typos. */
const plausiblePrice = (n: number | null): n is number => n != null && n >= 500 && n <= 5_000_000;

export interface SubjectPriceInput {
  /** `vehicle_listings.price` — the feed's headline number. Its basis is what we must resolve. */
  price?: number | null;
  advertisedPriceBeforeDoc?: number | null;
  websiteSalePrice?: number | null;
  docFee?: number | null;
  /**
   * Tenant setting. TRUE when the advertised price EXCLUDES the doc fee, so the
   * customer total is advertised + fee. Absent or false is every Harte store:
   * the advertised price already contains the fee.
   */
  advertisedExcludesDocFee?: boolean | null;
  /**
   * Dealer-installed products the customer cannot decline, in dollars.
   *
   * A number — including 0 — means the question has been ANSWERED. `null` or
   * absent means nobody has told us, which is not the same as none, and yields
   * an ambiguous basis.
   */
  mandatoryDealerAddOns?: number | null;
  /** Rebates not available to every buyer. Added back so they cannot lower the comparison. */
  conditionalDiscounts?: number | null;
  provenance?: Record<string, unknown>;
}

/**
 * Resolve the two prices and prove they reconcile.
 *
 * The identity checked is the ADVERTISED leg, not the post-add-back
 * comparison price:
 *
 *   advertisedLeg + docFee = displayedTotalPrice
 *   vehicleComparisonPrice = advertisedLeg + conditionalDiscountsExcluded
 *
 * With no conditional discounts — every vehicle in the pilot lot — the two
 * collapse into the plain rule the invariant tests state:
 * comparison price + doc fee = displayed total.
 */
export function resolvePriceBasis(input: SubjectPriceInput): MarketPriceBasis {
  const reasons: string[] = [];
  const price = money(input.price);
  const advertised = money(input.advertisedPriceBeforeDoc);
  const website = money(input.websiteSalePrice);
  const rawDocFee = money(input.docFee);
  const docFee = rawDocFee != null && rawDocFee >= 0 ? rawDocFee : null;
  const mandatory = money(input.mandatoryDealerAddOns);
  const mandatoryKnown = mandatory != null && mandatory >= 0;
  const conditional = money(input.conditionalDiscounts) ?? 0;

  if (rawDocFee != null && rawDocFee < 0) reasons.push("doc_fee_negative");
  if (mandatory != null && mandatory < 0) reasons.push("mandatory_add_ons_negative");

  // Which side of the fee the dealer's advertised price sits on.
  let includesDocFee: boolean | null =
    input.advertisedExcludesDocFee === true ? false
    : input.advertisedExcludesDocFee === false ? true
    : null;

  // No tenant setting: the two stored numbers can still prove it. When
  // price − advertised reconciles to the fee, the price is the inclusive one.
  if (includesDocFee == null && price != null && advertised != null && docFee != null) {
    if (Math.abs(price - advertised - docFee) <= PRICE_BASIS_TOLERANCE) {
      includesDocFee = true;
      reasons.push("fee_treatment_inferred_from_stored_prices");
    } else if (Math.abs(price - advertised) <= PRICE_BASIS_TOLERANCE) {
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
  } else if (includesDocFee === false) {
    displayedTotalPrice = website ?? (advertised != null && docFee != null ? advertised + docFee : price);
  } else {
    displayedTotalPrice = price ?? website ?? null;
    reasons.push("fee_treatment_unknown");
  }

  // The advertised leg: what the dealer advertises for the VEHICLE, with the
  // fee and any mandatory product taken back off, before conditional money is
  // restored. This is the leg the stored `advertised_price_before_doc` column
  // is supposed to hold, so it is also what the identity is checked against.
  const mandatoryForIdentity = mandatoryKnown ? (mandatory as number) : 0;
  let advertisedLeg: number | null = advertised;
  if (advertisedLeg == null && displayedTotalPrice != null && docFee != null) {
    advertisedLeg = displayedTotalPrice - docFee - mandatoryForIdentity;
    reasons.push("advertised_leg_derived_from_displayed_total");
  }

  let status: MarketPriceBasis["basisStatus"] = "verified";

  if (!plausiblePrice(displayedTotalPrice) || !plausiblePrice(advertisedLeg)) {
    status = "invalid";
    reasons.push("no_usable_price");
  } else if (docFee == null) {
    status = "ambiguous";
    reasons.push("doc_fee_unknown");
  } else if (
    Math.abs(advertisedLeg + docFee + mandatoryForIdentity - displayedTotalPrice) > PRICE_BASIS_TOLERANCE
  ) {
    status = "invalid";
    reasons.push(
      `price_identity_failed advertised=${advertisedLeg} doc_fee=${docFee}`
      + ` mandatory=${mandatoryForIdentity} displayed=${displayedTotalPrice}`,
    );
  } else if (includesDocFee == null) {
    status = "ambiguous";
  }

  // Nobody has told us whether this dealer bolts a mandatory product onto every
  // car. Absent that answer the comparison price is a guess, so the basis is
  // ambiguous — which costs confidence and forecloses red — rather than
  // confidently wrong.
  if (!mandatoryKnown && status === "verified") {
    status = "ambiguous";
  }
  if (!mandatoryKnown) {
    reasons.push("mandatory_add_on_treatment_unknown");
  } else if ((mandatory as number) > 0) {
    reasons.push(`mandatory_add_ons_disclosed_${mandatory}`);
  }
  if (conditional > 0) {
    reasons.push(`conditional_discounts_added_back_${conditional}`);
  }

  // comparison = displayed + conditional − fee − mandatory
  const vehicleComparisonPrice =
    status === "invalid" || advertisedLeg == null ? null : advertisedLeg + conditional;

  return {
    displayedTotalPrice: status === "invalid" ? displayedTotalPrice ?? null : displayedTotalPrice,
    vehicleComparisonPrice,
    advertisedPriceBeforeDoc: advertisedLeg,
    docFee,
    mandatoryDealerAddOns: mandatoryKnown ? mandatory : null,
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
      mandatory_dealer_add_ons: input.mandatoryDealerAddOns ?? null,
      mandatory_add_on_treatment: mandatoryKnown ? "known" : "unknown",
      conditional_discounts: input.conditionalDiscounts ?? null,
      ...(input.provenance ?? {}),
    },
  };
}

export interface ComparablePriceInput {
  advertisedPrice?: number | null;
  /** TRUE when the competitor's advertised price is known to contain a doc fee. */
  docFeeIncluded?: boolean | null;
  docFee?: number | null;
  conditionalDiscounts?: number | null;
}

export interface ComparableBasePrice {
  normalizedVehiclePrice: number | null;
  priceBasisStatus: ComparablePriceBasis;
  reasons: string[];
}

/**
 * The same formula for a competitor, where the honest answer is usually
 * "unknown". MarketCheck returns an asking price and says nothing about
 * whether a conveyance fee sits inside it. Guessing that it does not is the
 * mirror of the subject-side defect: it would make every competitor look
 * cheaper than the subject by exactly one doc fee.
 *
 * So an unknown fee treatment is recorded as unknown. The listing still counts
 * as evidence — refusing every competitor would leave no market at all — but
 * it carries a data-quality penalty into the weight and a reason into the
 * explanation.
 */
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
  } else if (input.docFeeIncluded === false) {
    status = "verified";
    reasons.push("advertised_excludes_doc_fee");
  } else {
    status = "unknown";
    reasons.push("competitor_doc_fee_treatment_unknown");
  }
  if (conditional > 0) reasons.push(`conditional_discounts_added_back_${conditional}`);

  return {
    normalizedVehiclePrice: plausiblePrice(base) ? base : null,
    priceBasisStatus: plausiblePrice(base) ? status : "invalid",
    reasons,
  };
}
