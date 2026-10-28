import { resolveDisplayPrice, type PriceDisplayMode } from "@/lib/priceModel";
import { planFeeChange, type FeeBasis } from "./feeBasis";

// The customer price the Passport would show for one listing once a fee is
// saved, with the document fee counted exactly once. The fee is applied
// through the shared fee basis contract (planFeeChange): on includes_fee the
// advertised total `price` is kept and the before-fee price is derived from
// it; on before_fee the before-fee price is kept and the total moves. The
// result is then read the way buildPassportSaleCard reads a listing: the
// displayed price comes from resolveDisplayPrice; on the fee-inclusive display
// it already holds the fee (selling = displayed - fee), otherwise the fee is
// added once (total = selling + fee).

export interface StoredListingPrice {
  price: number | null;
  advertisedBeforeDoc: number | null;
  websiteSalePrice: number | null;
  /** The fee stored on the row; kept when the change skips the row. */
  docFee?: number | null;
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

export const defaultFeeBasis = (mode: PriceDisplayMode): FeeBasis => (mode === "website_sale_price" ? "includes_fee" : "before_fee");

export function customerPrice(
  stored: StoredListingPrice,
  fee: number | null | undefined,
  mode: PriceDisplayMode,
  basis: FeeBasis = defaultFeeBasis(mode),
): CustomerPrice | null {
  if (basis === "conflict") return null;
  const draftFee = fee != null && Number.isFinite(fee) && fee > 0 ? fee : 0;
  const plan = planFeeChange(basis, { ...stored, advertisedBeforeDoc: stored.advertisedBeforeDoc ?? stored.price, docFee: stored.docFee ?? draftFee }, draftFee);
  if (plan.status === "invalid") return null;
  // A row the change skips keeps what it stores, so the customer keeps seeing it.
  const docFee = plan.status === "split_mismatch" ? (stored.docFee ?? draftFee) : draftFee;
  const saved = plan.after;
  const displayed = resolveDisplayPrice(
    {
      advertised_price_before_doc: saved.advertisedBeforeDoc,
      doc_fee: docFee,
      website_sale_price: saved.websiteSalePrice,
      price: stored.price,
      // public-listing-view sets this from the basis setting; a before_fee
      // basis on a website_sale_price display can only come from that setting.
      advertised_excludes_doc_fee: basis === "before_fee",
    },
    mode,
  );
  if (displayed == null || !Number.isFinite(displayed) || displayed <= 0) return null;
  const includesFee = mode === "website_sale_price";
  const sellingPrice = includesFee ? displayed - docFee : displayed;
  if (sellingPrice <= 0) return null;
  return { displayed, includesFee, sellingPrice, docFee, total: sellingPrice + docFee };
}
