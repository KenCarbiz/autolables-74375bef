// GENERATED — do not edit.
// Mirror of src/lib/market/listingFeeBasis.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Fee basis of one provider listing ──────────────────────────────────────
//
// The feed already says, per listing, whether the advertised price includes
// the dealer's fees (`price_includes_fees`) and what those fees are (`fees`).
// On the pilot lot 139 rows carry `fees` and 115 carry `price_includes_fees`,
// and nothing reads either: the price basis of every comparable comes from one
// tenant-level switch about OUR doc fee, applied to OTHER dealers' cars.
//
// This resolves a listing's own evidence into a comparison basis. The rule
// that matters is the one §8 states: unknown stays unknown. A listing whose
// fees are excluded but unstated has NO normalized price, not a price with $0
// added; a listing whose inclusion is unstated has a range, not a number.
//
// Pure. The `fees` shape is not documented in anything this repo holds, so the
// parser accepts the shapes a feed is likely to use (number, numeric string,
// list of items, map of amounts) and records which one it saw, so the shape
// monitor can tell us when the provider changes it.

export type FeeInclusion = "included" | "excluded" | "unknown";
export type FeeBasisStatus = "verified" | "ambiguous" | "unknown";
export type FeeShape = "number" | "string" | "items" | "map" | "absent" | "unrecognised";

export interface ListingFeeInput {
  price?: unknown;
  fees?: unknown;
  price_includes_fees?: unknown;
}

export interface FeeItem { name: string; amount: number }

export interface ListingFeeBasis {
  advertisedPrice: number | null;
  /** Sum of identified fees; null when the feed did not say. Never 0 by default. */
  identifiedFees: number | null;
  feeItems: FeeItem[];
  feeShape: FeeShape;
  priceIncludesFees: FeeInclusion;
  /** The fee-normalized comparison price, when the evidence supports one. */
  normalizedComparisonPrice: number | null;
  /** Bounds when inclusion is unknown but a fee amount is: [advertised, advertised + fees]. */
  range: { low: number; high: number } | null;
  basisStatus: FeeBasisStatus;
  reasons: string[];
}

const money = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
};

const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true" || v === "TRUE" || v === "yes") return true;
  if (v === 0 || v === "0" || v === "false" || v === "FALSE" || v === "no") return false;
  return null;
};

export function parseFees(fees: unknown): { total: number | null; items: FeeItem[]; shape: FeeShape } {
  if (fees === null || fees === undefined || fees === "") return { total: null, items: [], shape: "absent" };
  if (typeof fees === "number") {
    const n = money(fees);
    return { total: n, items: n != null ? [{ name: "fees", amount: n }] : [], shape: "number" };
  }
  if (typeof fees === "string") {
    const n = money(fees);
    return { total: n, items: n != null ? [{ name: "fees", amount: n }] : [], shape: n != null ? "string" : "unrecognised" };
  }
  if (Array.isArray(fees)) {
    const items: FeeItem[] = [];
    for (const raw of fees) {
      if (raw && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        const amount = money(r.amount ?? r.value ?? r.fee ?? r.price);
        const name = String(r.name ?? r.type ?? r.label ?? r.description ?? "fee").trim() || "fee";
        if (amount != null) items.push({ name, amount });
      } else {
        const amount = money(raw);
        if (amount != null) items.push({ name: "fee", amount });
      }
    }
    return { total: items.length ? items.reduce((s, i) => s + i.amount, 0) : null, items, shape: items.length ? "items" : "unrecognised" };
  }
  if (typeof fees === "object") {
    const items: FeeItem[] = [];
    for (const [k, v] of Object.entries(fees as Record<string, unknown>)) {
      const amount = money(v);
      if (amount != null) items.push({ name: k, amount });
    }
    return { total: items.length ? items.reduce((s, i) => s + i.amount, 0) : null, items, shape: items.length ? "map" : "unrecognised" };
  }
  return { total: null, items: [], shape: "unrecognised" };
}

export function resolveListingFeeBasis(input: ListingFeeInput): ListingFeeBasis {
  const reasons: string[] = [];
  const advertisedPrice = money(input.price);
  const fees = parseFees(input.fees);
  const includes = bool(input.price_includes_fees);
  const priceIncludesFees: FeeInclusion = includes === true ? "included" : includes === false ? "excluded" : "unknown";

  if (fees.shape === "unrecognised") reasons.push("fees_shape_unrecognised");
  if (advertisedPrice == null) reasons.push("advertised_price_missing");

  const base = {
    advertisedPrice,
    identifiedFees: fees.total,
    feeItems: fees.items,
    feeShape: fees.shape,
    priceIncludesFees,
  };

  if (advertisedPrice == null) {
    return { ...base, normalizedComparisonPrice: null, range: null, basisStatus: "unknown", reasons };
  }

  if (priceIncludesFees === "included") {
    reasons.push("fees_included_in_advertised_price");
    return { ...base, normalizedComparisonPrice: advertisedPrice, range: null, basisStatus: "verified", reasons };
  }

  if (priceIncludesFees === "excluded") {
    if (fees.total != null) {
      reasons.push("fees_excluded_and_identified");
      return {
        ...base, normalizedComparisonPrice: advertisedPrice + fees.total, range: null,
        basisStatus: "verified", reasons,
      };
    }
    // Excluded but unstated: the comparison price is strictly higher than the
    // advertised one by an amount we do not know. That is not a number.
    reasons.push("fees_excluded_amount_unknown");
    return { ...base, normalizedComparisonPrice: null, range: null, basisStatus: "ambiguous", reasons };
  }

  if (fees.total != null) {
    reasons.push("fee_inclusion_unknown_amount_identified");
    return {
      ...base, normalizedComparisonPrice: null,
      range: { low: advertisedPrice, high: advertisedPrice + fees.total },
      basisStatus: "ambiguous", reasons,
    };
  }

  reasons.push("no_fee_evidence");
  return { ...base, normalizedComparisonPrice: null, range: null, basisStatus: "unknown", reasons };
}

export type TenantFeeCorroboration = "agrees" | "conflicts" | "no_listing_evidence";

/**
 * Does the listing's own statement agree with the tenant-level setting the
 * price basis has used until now? A conflict is a finding for a person, not
 * an input to arithmetic: the tenant setting is not silently overruled here.
 */
export function corroborateTenantFeeSetting(
  basis: Pick<ListingFeeBasis, "priceIncludesFees">,
  tenantAdvertisedIncludesDocFee: boolean | null | undefined,
): TenantFeeCorroboration {
  if (basis.priceIncludesFees === "unknown" || typeof tenantAdvertisedIncludesDocFee !== "boolean") {
    return "no_listing_evidence";
  }
  const listingSays = basis.priceIncludesFees === "included";
  return listingSays === tenantAdvertisedIncludesDocFee ? "agrees" : "conflicts";
}
