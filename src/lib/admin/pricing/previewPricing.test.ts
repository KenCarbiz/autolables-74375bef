import { describe, it, expect } from "vitest";
import { customerPrice } from "./previewPricing";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { resolveDisplayPrice, type PriceDisplayMode } from "@/lib/priceModel";
import type { PassportData } from "@/lib/passportV2Data";

const passportCard = (stored: { price: number | null; advertisedBeforeDoc: number | null; websiteSalePrice: number | null }, fee: number | null, mode: PriceDisplayMode) => {
  const advBeforeDoc = stored.advertisedBeforeDoc ?? stored.price;
  const price = resolveDisplayPrice({ advertised_price_before_doc: advBeforeDoc, doc_fee: fee, website_sale_price: stored.websiteSalePrice, price: stored.price }, mode);
  const d = { price, priceIncludesDoc: mode === "website_sale_price", docFee: fee, msrp: null, marketAvg: null, retailCash: null, dealerDiscount: null } as unknown as PassportData;
  return buildPassportSaleCard(d, "used");
};

describe("customer price for the Admin preview (fee counted once)", () => {
  it("does not add the fee again to a fee-inclusive stored advertised price", () => {
    const p = customerPrice({ price: 40_420, advertisedBeforeDoc: 39_525, websiteSalePrice: 40_420 }, 895, "website_sale_price");
    expect(p).toEqual({ displayed: 40_420, includesFee: true, sellingPrice: 39_525, docFee: 895, total: 40_420 });
  });

  it("adds the fee once to a fee-exclusive selling price", () => {
    const p = customerPrice({ price: 39_525, advertisedBeforeDoc: 39_525, websiteSalePrice: 40_420 }, 895, "advertised_before_doc");
    expect(p).toEqual({ displayed: 39_525, includesFee: false, sellingPrice: 39_525, docFee: 895, total: 40_420 });
  });

  it("anchors on the inventory price on the fee-inclusive basis even when the stored breakdown disagrees", () => {
    // Screen 05 fixture row: price 39,525 on a fee-inclusive tenant, before-fee 39,525. The customer
    // sees 39,525; the breakdown inconsistency is reported by the consistency check, not hidden here.
    const p = customerPrice({ price: 39_525, advertisedBeforeDoc: 39_525, websiteSalePrice: 40_420 }, 895, "website_sale_price");
    expect(p?.total).toBe(39_525);
    expect(p?.sellingPrice).toBe(38_630);
  });

  it.each([0, null, undefined])("treats a %s fee as no fee on either basis", (fee) => {
    expect(customerPrice({ price: 30_000, advertisedBeforeDoc: 30_000, websiteSalePrice: 30_000 }, fee, "website_sale_price")).toMatchObject({ docFee: 0, sellingPrice: 30_000, total: 30_000 });
    expect(customerPrice({ price: 30_000, advertisedBeforeDoc: 30_000, websiteSalePrice: 30_000 }, fee, "advertised_before_doc")).toMatchObject({ docFee: 0, sellingPrice: 30_000, total: 30_000 });
  });

  it("applies a draft fee the way the saved recalculation would", () => {
    // Fee-exclusive: the total moves with the fee. Fee-inclusive: the inventory total is kept and the split moves.
    expect(customerPrice({ price: 39_525, advertisedBeforeDoc: 39_525, websiteSalePrice: 40_420 }, 925, "advertised_before_doc")?.total).toBe(40_450);
    expect(customerPrice({ price: 40_420, advertisedBeforeDoc: 39_525, websiteSalePrice: 40_420 }, 925, "website_sale_price")).toMatchObject({ total: 40_420, sellingPrice: 39_495 });
  });

  it("returns nothing without a usable price", () => {
    expect(customerPrice({ price: null, advertisedBeforeDoc: null, websiteSalePrice: null }, 895, "website_sale_price")).toBeNull();
    expect(customerPrice({ price: 500, advertisedBeforeDoc: null, websiteSalePrice: null }, 895, "website_sale_price")).toBeNull();
  });

  it.each<[PriceDisplayMode, number | null]>([["website_sale_price", 895], ["advertised_before_doc", 895], ["website_sale_price", 0], ["advertised_before_doc", null]])(
    "matches the Passport sale card (%s, fee %s)",
    (mode, fee) => {
      const stored = { price: 40_420, advertisedBeforeDoc: 39_525, websiteSalePrice: 39_525 + (fee ?? 0) };
      const admin = customerPrice(stored, fee, mode);
      const card = passportCard(stored, fee, mode);
      expect(card).not.toBeNull();
      expect(admin?.total).toBe(card?.totalAdvertisedPrice);
      expect(admin?.sellingPrice).toBe(card?.vehicleSellingPrice);
    },
  );
});
