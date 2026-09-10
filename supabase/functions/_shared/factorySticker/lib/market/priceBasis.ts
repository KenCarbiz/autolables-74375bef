// GENERATED — do not edit.
// Mirror of src/lib/market/priceBasis.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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
//
// MANDATORY ADD-ONS ARE TWO QUESTIONS, NOT ONE:
//
//   1. How much?  — resolved per vehicle first, then from a tenant default
//      that is used ONLY when someone has explicitly verified it, then
//      unknown. A tenant-wide default is a claim about every car on the lot;
//      it does not get to be inferred from silence.
//   2. Where does it sit? — INSIDE the displayed price, or added on top of it
//      at the desk. The two produce different customer totals from the same
//      dollars, and the second is what Harte actually does: on all six of the
//      lot's cars carrying priced installed items, `price − advertised −
//      doc_fee` is exactly 0.00, so the money is NOT inside the displayed
//      price. Folding it in would restate the advertised price of a published
//      vehicle.
//
// Either question unanswered makes the basis ambiguous. Unknown never becomes
// an assumed zero, is never added to the displayed price on its own authority,
// and is never described to a customer as a mandatory charge — an unverified
// guess about what a dealer requires is a disclosure claim we cannot make.

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
   * Per-vehicle shorthand: dealer-installed products the customer cannot
   * decline, in dollars, ALREADY INSIDE the displayed price.
   *
   * A number — including 0 — means the question has been ANSWERED for this
   * vehicle. `null` or absent means nobody has told us, which is not the same
   * as none, and yields an ambiguous basis. This is the historical shape and
   * carries the historical assumption; a dealer who adds the product at the
   * desk instead must use `vehicleMandatoryAddOns` and say so.
   */
  mandatoryDealerAddOns?: number | null;
  /** The per-vehicle answer. Overrides the tenant default whenever it exists. */
  vehicleMandatoryAddOns?: MandatoryAddOnAnswer | null;
  /**
   * The tenant-wide default. Used ONLY when `verified` is explicitly true: a
   * default nobody has confirmed is a guess about every car on the lot, and a
   * guess is exactly what the ambiguous basis exists to refuse.
   */
  tenantMandatoryAddOns?: MandatoryAddOnAnswer | null;
  /** Rebates not available to every buyer. Added back so they cannot lower the comparison. */
  conditionalDiscounts?: number | null;
  provenance?: Record<string, unknown>;
}

export type MandatoryAddOnSource = "vehicle" | "tenant_default" | "unknown";

export interface MandatoryAddOnAnswer {
  /** Dollars. 0 is a real answer; null or absent is not an answer at all. */
  amountUsd?: number | null;
  /**
   * Whether a human has confirmed this answer for this scope. Required for a
   * tenant default; a per-vehicle answer is taken as confirmed unless this is
   * explicitly false.
   */
  verified?: boolean | null;
  /**
   * TRUE when the money is already inside the displayed price, FALSE when it
   * is added at the desk on top of it. Null means we do not know where it
   * sits, which is not a smaller problem than not knowing the amount.
   */
  includedInDisplayedPrice?: boolean | null;
}

export interface MandatoryAddOnResolution {
  amountUsd: number | null;
  includedInDisplayedPrice: boolean | null;
  source: MandatoryAddOnSource;
  /** An amount has been answered. */
  known: boolean;
  /** Amount AND placement are both answered, so the price identity may use it. */
  usableForIdentity: boolean;
  reasons: string[];
}

const answerAmount = (a: MandatoryAddOnAnswer | null | undefined): number | null => {
  const n = money(a?.amountUsd);
  return n != null && n >= 0 ? n : null;
};

/**
 * Per vehicle, then a verified tenant default, then unknown.
 *
 * Zero is the one amount whose placement does not matter — nothing moves
 * whichever side of the displayed price it sits on — so it alone is usable for
 * the identity without a placement answer.
 */
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
  } else if (legacyAmount != null && legacyAmount >= 0) {
    amountUsd = legacyAmount;
    includedInDisplayedPrice = true;
    source = "vehicle";
  } else {
    const tenant = input.tenantMandatoryAddOns;
    const tenantAmount = answerAmount(tenant);
    if (tenantAmount != null && tenant?.verified === true) {
      amountUsd = tenantAmount;
      includedInDisplayedPrice = tenant?.includedInDisplayedPrice ?? null;
      source = "tenant_default";
      reasons.push("mandatory_add_ons_from_verified_tenant_default");
    } else if (tenantAmount != null) {
      reasons.push("tenant_mandatory_add_on_default_not_verified");
    }
  }

  if (amountUsd == null) {
    reasons.push("mandatory_add_on_treatment_unknown");
    return {
      amountUsd: null, includedInDisplayedPrice: null, source: "unknown",
      known: false, usableForIdentity: false, reasons,
    };
  }

  const placementKnown = amountUsd === 0 || includedInDisplayedPrice != null;
  if (!placementKnown) reasons.push("mandatory_add_on_placement_unknown");
  if (amountUsd > 0) {
    reasons.push(`mandatory_add_ons_disclosed_${amountUsd}`);
    if (includedInDisplayedPrice === false) reasons.push("mandatory_add_ons_outside_displayed_price");
    else if (includedInDisplayedPrice === true) reasons.push("mandatory_add_ons_inside_displayed_price");
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
  const addOns = resolveMandatoryAddOns(input);
  const conditional = money(input.conditionalDiscounts) ?? 0;

  if (rawDocFee != null && rawDocFee < 0) reasons.push("doc_fee_negative");
  const rawMandatory = money(input.mandatoryDealerAddOns) ?? money(input.vehicleMandatoryAddOns?.amountUsd);
  if (rawMandatory != null && rawMandatory < 0) reasons.push("mandatory_add_ons_negative");

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
  // Only money that is INSIDE the displayed price belongs in the identity. An
  // add-on charged at the desk never entered this arithmetic, so subtracting it
  // here would restate a published advertised price by the size of the add-on.
  const mandatoryForIdentity =
    addOns.usableForIdentity && addOns.includedInDisplayedPrice === true ? (addOns.amountUsd as number) : 0;
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
  // car, or — knowing the amount — whether it sits inside the advertised price
  // or lands at the desk. Absent either answer the customer total is a guess,
  // so the basis is ambiguous — which costs confidence and forecloses red —
  // rather than confidently wrong.
  if (!addOns.usableForIdentity && status === "verified") {
    status = "ambiguous";
  }
  reasons.push(...addOns.reasons);
  if (conditional > 0) {
    reasons.push(`conditional_discounts_added_back_${conditional}`);
  }

  // comparison = displayed + conditional − fee − mandatory-inside-the-price
  const vehicleComparisonPrice =
    status === "invalid" || advertisedLeg == null ? null : advertisedLeg + conditional;

  // The displayed price is never rewritten by an add-on. What the customer
  // actually owes, when a mandatory product is charged on top of it, is
  // published as its OWN number so a surface can disclose the charge without
  // the advertised price silently changing underneath it. Null while unknown —
  // there is no honest total to state.
  const totalWithMandatoryAddOns =
    status === "invalid" || displayedTotalPrice == null || !addOns.usableForIdentity
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
