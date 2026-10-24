import { describe, it, expect } from "vitest";
import { isPriceAuditMismatch } from "./priceAudit";

const base = { advertised_price_before_doc: 60665, doc_fee: 895, website_sale_price: 61560, price_parse_status: "ok" };

describe("isPriceAuditMismatch", () => {
  it("matches when sale = advertised + configured doc fee", () => {
    expect(isPriceAuditMismatch(base, 895)).toBe(false);
  });
  it("flags a crawl warning even when the math adds up", () => {
    expect(isPriceAuditMismatch({ ...base, price_parse_status: "warning" }, 895)).toBe(true);
  });
  it("flags a sale price that differs from advertised + doc fee", () => {
    expect(isPriceAuditMismatch({ ...base, website_sale_price: 58560 }, 895)).toBe(true);
  });
  it("flags a row doc fee that differs from the configured fee", () => {
    expect(isPriceAuditMismatch(base, 695)).toBe(true);
  });
  it("flags a missing sale price", () => {
    expect(isPriceAuditMismatch({ ...base, website_sale_price: null }, 895)).toBe(true);
  });
});
