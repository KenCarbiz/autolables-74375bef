import { resolveDisplayPrice, type PriceDisplayMode } from "@/lib/priceModel";

// The customer price the Passport would show for one listing, with the document
// fee counted exactly once. Mirrors buildPassportSaleCard: the displayed price
// comes from resolveDisplayPrice; on the fee-inclusive basis it already holds
// the fee (selling = displayed - fee), otherwise the fee is added once
// (total = selling + fee). A draft fee is applied the way recalc_tenant_doc_fee
// applies a saved one: website_sale_price = advertised_price_before_doc + fee,
// with the inventory `price` left untouched.

export interface StoredListingPrice {
  price: number | null;
  advertisedBeforeDoc: number | null;
  websiteSalePrice: number | null;
}

export interface CustomerPrice {
  /** The figure resolveDisplayPrice picks for this mode. */
  displayed: number;
  /** True when that figure already includes the document fee. */
  includesFee: boolean;
  sellingPrice: number;
  docFee: number;
  total: number;
}

export function customerPrice(stored: StoredListingPrice, fee: number | null | undefined, mode: PriceDisplayMode): CustomerPrice | null {
  const docFee = fee != null && Number.isFinite(fee) && fee > 0 ? fee : 0;
  const advBeforeDoc = stored.advertisedBeforeDoc ?? stored.price ?? null;
  const websiteSalePrice = stored.advertisedBeforeDoc != null ? stored.advertisedBeforeDoc + docFee : stored.websiteSalePrice;
  const displayed = resolveDisplayPrice(
    { advertised_price_before_doc: advBeforeDoc, doc_fee: docFee, website_sale_price: websiteSalePrice, price: stored.price },
    mode,
  );
  if (displayed == null || !Number.isFinite(displayed) || displayed <= 0) return null;
  const includesFee = mode === "website_sale_price";
  const sellingPrice = includesFee ? displayed - docFee : displayed;
  if (sellingPrice <= 0) return null;
  return { displayed, includesFee, sellingPrice, docFee, total: sellingPrice + docFee };
}
