import { describe, it, expect } from "vitest";
import { buildSalePriceCard } from "./priceModel";

describe("buildSalePriceCard", () => {
  it("used vehicle: Market Value anchor with a real derived discount (reference QX50)", () => {
    const card = buildSalePriceCard({
      vehicleType: "used", marketValue: 31981, vehiclePrice: 29981, finalSalePrice: 30876,
      docFee: 895, feeIncluded: true,
    });
    expect(card.anchorLabel).toBe("Market Value");
    expect(card.lines).toEqual([
      { key: "anchor", label: "Market Value", amount: 31981, role: "anchor" },
      { key: "dealer_discount", label: "Dealer Discount", amount: 2000, role: "discount" },
    ]);
    expect(card.vehiclePrice).toBe(29981);
    expect(card.feeAmount).toBe(895);
    expect(card.feeLabel).toBe("Conveyance / Doc Fee");
    expect(card.finalSalePrice).toBe(30876);
    expect(card.reconciles).toBe(true);
    expect(card.headlineOnly).toBe(false);
  });

  it("cpo vehicle behaves like used (Market Value anchor)", () => {
    const card = buildSalePriceCard({ vehicleType: "cpo", marketValue: 40000, vehiclePrice: 38000, finalSalePrice: 38000, feeIncluded: false });
    expect(card.anchorLabel).toBe("Market Value");
    expect(card.lines.map((l) => l.label)).toEqual(["Market Value", "Dealer Discount"]);
    expect(card.feeAmount).toBeNull();
    expect(card.reconciles).toBe(true);
  });

  it("new vehicle: MSRP anchor with itemized discounts that reconcile to the gap", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61895, vehiclePrice: 55598, finalSalePrice: 56493,
      docFee: 895, feeIncluded: true,
      discountLines: [{ key: "dealer_discount", label: "Dealer Discount", amount: 1297 }, { key: "retail_cash", label: "Retail Cash", amount: 5000 }],
    });
    expect(card.anchorLabel).toBe("MSRP");
    expect(card.lines).toEqual([
      { key: "anchor", label: "MSRP", amount: 61895, role: "anchor" },
      { key: "dealer_discount", label: "Dealer Discount", amount: 1297, role: "discount" },
      { key: "retail_cash", label: "Retail Cash", amount: 5000, role: "discount" },
    ]);
    expect(card.feeAmount).toBe(895);
    expect(card.finalSalePrice).toBe(56493);
    expect(card.reconciles).toBe(true);
  });

  it("new vehicle: itemized discounts that do NOT reconcile collapse to one derived Dealer Discount", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61895, vehiclePrice: 55598, finalSalePrice: 55598, feeIncluded: false,
      discountLines: [{ label: "Dealer Discount", amount: 1000 }], // 1000 != 6297 gap
    });
    expect(card.lines).toEqual([
      { key: "anchor", label: "MSRP", amount: 61895, role: "anchor" },
      { key: "dealer_discount", label: "Dealer Discount", amount: 6297, role: "discount" },
    ]);
  });

  it("new vehicle with no discount (MSRP == vehicle price): no anchor ladder", () => {
    const card = buildSalePriceCard({ vehicleType: "new", msrp: 55598, vehiclePrice: 55598, finalSalePrice: 55598, feeIncluded: false });
    expect(card.lines).toEqual([]);
    expect(card.headlineOnly).toBe(true);
  });

  it("used vehicle without a valid Market Value: only Vehicle Price + fee (no anchor/discount)", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: null, vehiclePrice: 29981, finalSalePrice: 30876, docFee: 895, feeIncluded: true });
    expect(card.lines).toEqual([]);
    expect(card.feeAmount).toBe(895);
    expect(card.headlineOnly).toBe(false);
    expect(card.reconciles).toBe(true);
  });

  it("used vehicle where Market Value is at/below price: no invented discount", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 29000, vehiclePrice: 29981, finalSalePrice: 29981, feeIncluded: false });
    expect(card.lines).toEqual([]);
    expect(card.headlineOnly).toBe(true);
  });

  it("no dealer fee: fee row omitted, no $0 fee", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 32000, vehiclePrice: 30000, finalSalePrice: 30000, docFee: 0, feeIncluded: true });
    expect(card.feeAmount).toBeNull();
    expect(card.feeLabel).toBeNull();
  });

  it("respects a tenant's configured fee label", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 32000, vehiclePrice: 30000, finalSalePrice: 30895, docFee: 895, docFeeLabel: "Documentation Fee", feeIncluded: true });
    expect(card.feeLabel).toBe("Documentation Fee");
  });

  it("flags non-reconciling data instead of publishing a contradiction", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 32000, vehiclePrice: 30000, finalSalePrice: 99999, docFee: 895, feeIncluded: true });
    expect(card.reconciles).toBe(false);
  });

  it("malformed anchor (NaN) yields no anchor ladder", () => {
    const card = buildSalePriceCard({ vehicleType: "new", msrp: Number.NaN, vehiclePrice: 30000, finalSalePrice: 30000, feeIncluded: false });
    expect(card.lines).toEqual([]);
    expect(card.headlineOnly).toBe(true);
  });
});
