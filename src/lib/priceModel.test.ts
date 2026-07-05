import { describe, it, expect } from "vitest";
import {
  normalizeCurrency,
  computeWebsiteSalePrice,
  buildPriceBreakdown,
  resolveDisplayPrice,
  resolveComparePrice,
  getPriceDisplayMode,
  DEFAULT_PRICE_DISPLAY_MODE,
  resolvePriceLabel,
  getPriceLabelSetting,
} from "./priceModel";

describe("normalizeCurrency", () => {
  it("strips $, commas, whitespace, and +/- signs", () => {
    expect(normalizeCurrency("$58,140")).toBe(58140);
    expect(normalizeCurrency("$65,210")).toBe(65210);
    expect(normalizeCurrency("$895")).toBe(895);
    expect(normalizeCurrency("+ $895")).toBe(895);
    expect(normalizeCurrency("-$1,500")).toBe(1500); // Retail Cash carried as magnitude
    expect(normalizeCurrency("  $59,035 USD ")).toBe(59035);
  });
  it("returns null for non-numeric / empty input", () => {
    expect(normalizeCurrency("")).toBeNull();
    expect(normalizeCurrency("Call for price")).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency(undefined)).toBeNull();
  });
  it("passes through finite numbers", () => {
    expect(normalizeCurrency(58140)).toBe(58140);
    expect(normalizeCurrency(NaN)).toBeNull();
  });
});

describe("computeWebsiteSalePrice", () => {
  it("adds the doc fee exactly once", () => {
    expect(computeWebsiteSalePrice(58140, 895)).toBe(59035);
    expect(computeWebsiteSalePrice(65210, 895)).toBe(66105);
  });
  it("treats a missing doc fee as zero, never inventing a price", () => {
    expect(computeWebsiteSalePrice(58140, null)).toBe(58140);
    expect(computeWebsiteSalePrice(null, 895)).toBeNull();
  });
});

// ── Spec validation tests ─────────────────────────────────────────────
describe("Harte INFINITI price breakdown (spec VINs)", () => {
  it("VIN 5N1AL1F83VC332076 → 58140 + 895 = 59035", () => {
    const b = buildPriceBreakdown({
      advertisedBeforeDoc: 58140,
      docFee: 895,
      displayedSalePrice: 59035,
    });
    expect(b.advertised_price_before_doc).toBe(58140);
    expect(b.doc_fee).toBe(895);
    expect(b.website_sale_price).toBe(59035);
    expect(b.price_parse_status).toBe("ok");
  });

  it("VIN 5N1AC0JX8VC602735 → 65210 + 895 = 66105", () => {
    const b = buildPriceBreakdown({
      advertisedBeforeDoc: 65210,
      docFee: 895,
      displayedSalePrice: 66105,
    });
    expect(b.advertised_price_before_doc).toBe(65210);
    expect(b.doc_fee).toBe(895);
    expect(b.website_sale_price).toBe(66105);
    expect(b.price_parse_status).toBe("ok");
  });

  it("does not overwrite advertised with sale price and does not double-add the fee", () => {
    const b = buildPriceBreakdown({ advertisedBeforeDoc: 58140, docFee: 895, displayedSalePrice: 59035 });
    // advertised stays advertised; sale is exactly advertised + fee (not +2×fee)
    expect(b.advertised_price_before_doc).toBe(58140);
    expect(b.website_sale_price).toBe(58140 + 895);
    expect(b.website_sale_price).not.toBe(58140 + 895 * 2);
  });

  it("flags a mismatch when the displayed sale price disagrees with the calculation", () => {
    const b = buildPriceBreakdown({
      advertisedBeforeDoc: 58140,
      docFee: 895,
      displayedSalePrice: 59000, // wrong on the page
    });
    expect(b.price_parse_status).toBe("warning");
    expect(b.price_parse_notes).toMatch(/mismatch/i);
  });

  it("is 'ok' when no displayed sale price was parsed (computed from advertised + fee)", () => {
    const b = buildPriceBreakdown({ advertisedBeforeDoc: 65210, docFee: 895 });
    expect(b.price_parse_status).toBe("ok");
    expect(b.website_sale_price).toBe(66105);
  });

  it("is 'pending' when no advertised price was parsed", () => {
    const b = buildPriceBreakdown({ advertisedBeforeDoc: null, docFee: 895 });
    expect(b.price_parse_status).toBe("pending");
    expect(b.website_sale_price).toBeNull();
  });
});

// ── Inventory reconcile: prove we parse a dealer's pricing against the doc fee
// they configured in admin ────────────────────────────────────────────────
describe("doc-fee parse check (first inventory reconcile)", () => {
  it("verifies when the page conveyance fee matches the configured doc fee", () => {
    const b = buildPriceBreakdown({
      advertisedBeforeDoc: 58140,
      docFee: 895,          // configured in admin
      parsedDocFee: 895,    // found on the page
      displayedSalePrice: 59035,
    });
    expect(b.price_parse_status).toBe("ok");
    expect(b.price_parse_notes).toMatch(/doc fee 895 matches the page/i);
  });

  it("flags when the page conveyance fee differs from the configured doc fee", () => {
    const b = buildPriceBreakdown({
      advertisedBeforeDoc: 58140,
      docFee: 895,          // dealer says $895
      parsedDocFee: 699,    // page shows $699 — parsing or the setting is off
    });
    expect(b.price_parse_status).toBe("warning");
    expect(b.price_parse_notes).toMatch(/conveyance fee 699 != configured doc fee 895/i);
  });

  it("uses the configured doc fee for the calculation regardless of a differing parse", () => {
    const b = buildPriceBreakdown({ advertisedBeforeDoc: 58140, docFee: 895, parsedDocFee: 699 });
    expect(b.doc_fee).toBe(895);
    expect(b.website_sale_price).toBe(59035); // configured fee, not the parsed 699
  });

  it("stays 'ok' when no conveyance fee line is on the page (nothing to contradict)", () => {
    const b = buildPriceBreakdown({ advertisedBeforeDoc: 65210, docFee: 895, parsedDocFee: null });
    expect(b.price_parse_status).toBe("ok");
    expect(b.website_sale_price).toBe(66105);
  });

  it("flags a second tenant whose configured fee does not reconcile with the page", () => {
    // Tenant B configured $699 but the page (advertised + 699) doesn't match the
    // displayed sale of 59035 → reconcile catches it before we trust the number.
    const b = buildPriceBreakdown({
      advertisedBeforeDoc: 58140,
      docFee: 699,
      displayedSalePrice: 59035,
    });
    expect(b.price_parse_status).toBe("warning");
  });
});

describe("resolveDisplayPrice / resolveComparePrice", () => {
  const fields = { advertised_price_before_doc: 58140, doc_fee: 895, website_sale_price: 59035 };

  it("defaults to advertised price before doc", () => {
    expect(DEFAULT_PRICE_DISPLAY_MODE).toBe("advertised_before_doc");
    expect(resolveDisplayPrice(fields)).toBe(58140);
  });

  it("website_sale_price mode shows the listed price unchanged (it already includes the fee)", () => {
    // The mode means "my listed price is fee-inclusive" — the display never
    // adds the fee on top of a price that already contains it.
    expect(resolveDisplayPrice(fields, "website_sale_price")).toBe(58140);
    expect(resolveDisplayPrice({ website_sale_price: 59035 }, "website_sale_price")).toBe(59035);
  });

  it("compares on the displayed number in both modes", () => {
    expect(resolveComparePrice(fields)).toBe(58140);
    expect(resolveComparePrice(fields, "website_sale_price")).toBe(58140);
  });

  it("falls back to the legacy price column when breakdown fields are absent", () => {
    expect(resolveDisplayPrice({ price: 42000 })).toBe(42000);
    expect(resolveDisplayPrice({ price: 42000 }, "website_sale_price")).toBe(42000);
  });
});

describe("getPriceDisplayMode", () => {
  it("defaults to advertised_before_doc and Harte keeps the default", () => {
    expect(getPriceDisplayMode(null)).toBe("advertised_before_doc");
    expect(getPriceDisplayMode({})).toBe("advertised_before_doc");
    expect(getPriceDisplayMode({ price_display_mode: "bogus" })).toBe("advertised_before_doc");
  });
  it("honors a valid configured mode", () => {
    expect(getPriceDisplayMode({ price_display_mode: "website_sale_price" })).toBe("website_sale_price");
  });
});

describe("resolvePriceLabel", () => {
  it("maps each fixed preset to its display text", () => {
    expect(resolvePriceLabel({ preset: "our_price" })).toBe("Our Price");
    expect(resolvePriceLabel({ preset: "advertised" })).toBe("Advertised Price");
    expect(resolvePriceLabel({ preset: "best" })).toBe("Best Price");
    expect(resolvePriceLabel({ preset: "one_price" })).toBe("One Price");
    expect(resolvePriceLabel({ preset: "sale" })).toBe("Sale Price");
  });

  it("substitutes the dealership name for the 'dealer' preset", () => {
    expect(resolvePriceLabel({ preset: "dealer" }, "Harte")).toBe("Harte Price");
    expect(resolvePriceLabel({ preset: "dealer" }, "  Harte INFINITI  ")).toBe("Harte INFINITI Price");
    // No dealership name available → safe fallback, never "undefined Price".
    expect(resolvePriceLabel({ preset: "dealer" }, "")).toBe("Our Price");
    expect(resolvePriceLabel({ preset: "dealer" }, null)).toBe("Our Price");
  });

  it("uses the custom text, falling back to 'Our Price' when empty", () => {
    expect(resolvePriceLabel({ preset: "custom", custom: "Today's Deal" })).toBe("Today's Deal");
    expect(resolvePriceLabel({ preset: "custom", custom: "  Deal  " })).toBe("Deal");
    expect(resolvePriceLabel({ preset: "custom", custom: "" })).toBe("Our Price");
    expect(resolvePriceLabel({ preset: "custom" })).toBe("Our Price");
  });

  it("defaults to 'Our Price' when unset or malformed", () => {
    expect(resolvePriceLabel(null)).toBe("Our Price");
    expect(resolvePriceLabel(undefined)).toBe("Our Price");
    // A dealer-name argument never leaks into a non-dealer preset.
    expect(resolvePriceLabel({ preset: "our_price" }, "Harte")).toBe("Our Price");
  });
});

describe("getPriceLabelSetting", () => {
  it("reads the setting off dealer_profiles.settings, defaulting when absent", () => {
    expect(getPriceLabelSetting(null)).toEqual({ preset: "our_price" });
    expect(getPriceLabelSetting({})).toEqual({ preset: "our_price" });
    expect(getPriceLabelSetting({ price_label: { preset: "best" } })).toEqual({ preset: "best", custom: undefined });
    expect(getPriceLabelSetting({ price_label: { preset: "custom", custom: "Deal" } })).toEqual({ preset: "custom", custom: "Deal" });
  });
});
