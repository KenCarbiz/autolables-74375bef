export interface PriceAuditInput {
  advertised_price_before_doc: number | null;
  doc_fee: number | null;
  website_sale_price: number | null;
  price_parse_status: string | null;
}

export function isPriceAuditMismatch(r: PriceAuditInput, configuredDocFee: number): boolean {
  if (r.price_parse_status === "warning") return true;
  if (r.advertised_price_before_doc == null) return false;
  const fee = Number(r.doc_fee || 0);
  if (Math.abs(fee - configuredDocFee) >= 0.01) return true;
  if (r.website_sale_price == null) return true;
  const calc = Number(r.advertised_price_before_doc) + fee;
  return Math.abs(Number(r.website_sale_price) - calc) >= 0.01;
}
