import { getPriceDisplayMode, resolveDisplayPrice, type PriceDisplayMode } from "@/lib/priceModel";

// The customer Passport's selling price, resolved once. passportV2Data used to
// inline this; the payment estimator (admin preview and customer Passport)
// reads the same function so a payment is never computed from a different
// price than the one the shopper sees. No new fee convention lives here: the
// display mode and the doc-fee flag are the tenant's existing settings.

export interface SellingPriceFields {
  price?: number | null;
  advertised_price_before_doc?: number | null;
  doc_fee?: number | null;
  website_sale_price?: number | null;
}

export interface SellingPriceContext {
  price_display_mode?: unknown;
  advertised_excludes_doc_fee?: boolean | null;
}

export interface PassportSellingPrice {
  price: number | null;
  mode: PriceDisplayMode;
  /** True when the displayed price already contains the documentation fee. */
  includesDocFee: boolean;
  docFee: number | null;
  advertisedBeforeDoc: number | null;
  websiteSalePrice: number | null;
}

export function resolvePassportSellingPrice(listing: SellingPriceFields, ctx: SellingPriceContext): PassportSellingPrice {
  const mode = getPriceDisplayMode({ price_display_mode: ctx.price_display_mode });
  const advertisedBeforeDoc = listing.advertised_price_before_doc ?? listing.price ?? null;
  const docFee = listing.doc_fee ?? null;
  const websiteSalePrice = listing.website_sale_price ?? (advertisedBeforeDoc != null ? advertisedBeforeDoc + (docFee ?? 0) : null);
  const price = resolveDisplayPrice(
    {
      advertised_price_before_doc: advertisedBeforeDoc,
      doc_fee: docFee,
      website_sale_price: websiteSalePrice,
      price: listing.price ?? null,
      advertised_excludes_doc_fee: ctx.advertised_excludes_doc_fee ?? null,
    },
    mode,
  );
  return { price, mode, includesDocFee: mode === "website_sale_price", docFee, advertisedBeforeDoc, websiteSalePrice };
}

/**
 * The same context public-listing-view attaches to the anonymous listing row,
 * derived from dealer_profiles.settings for an authenticated admin preview.
 */
export function sellingPriceContextFromSettings(settings: unknown): SellingPriceContext {
  const s = (settings ?? {}) as Record<string, unknown>;
  return {
    price_display_mode: s.price_display_mode,
    advertised_excludes_doc_fee: s.advertised_includes_doc_fee != null ? String(s.advertised_includes_doc_fee) !== "true" : null,
  };
}
