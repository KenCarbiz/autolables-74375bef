import { describe, it, expect } from "vitest";
import { buildSalePriceCard } from "./priceModel";

// The nightly-scraped Total Advertised Price ALWAYS includes the doc fee.
// Vehicle Selling Price = Total − Doc Fee; the dealer discount is derived so the
// ladder reconciles. All comparisons are exact (integer cents).

describe("buildSalePriceCard — backward derivation from the fee-inclusive total", () => {
  it("NEW #1 — MSRP equals total, no rebate → Dealer Discount equals the doc fee", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 58140,
      vehicleSellingPrice: 57245, totalAdvertisedPrice: 58140, docFee: 895,
    });
    expect(card.msrpEqualsTotal).toBe(true);
    expect(card.lines).toEqual([
      { key: "anchor", label: "MSRP", amount: 58140, role: "anchor" },
      { key: "dealer_discount", label: "Dealer Discount", amount: 895, role: "discount" },
    ]);
    expect(card.vehicleSellingPrice).toBe(57245);
    expect(card.feeAmount).toBe(895);
    expect(card.feeLabel).toBe("Dealer Doc Fee");
    expect(card.totalAdvertisedPrice).toBe(58140);
    expect(card.reconciles).toBe(true);
    expect(card.conflict).toBe(false);
  });

  it("NEW #2 — MSRP, factory rebate and dealer discount", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61895,
      vehicleSellingPrice: 55598, totalAdvertisedPrice: 56493, docFee: 895,
      factoryRebates: [{ key: "retail_cash", label: "Factory Retail Cash", amount: 5000 }],
    });
    expect(card.lines).toEqual([
      { key: "anchor", label: "MSRP", amount: 61895, role: "anchor" },
      { key: "retail_cash", label: "Factory Retail Cash", amount: 5000, role: "discount" },
      { key: "dealer_discount", label: "Dealer Discount", amount: 1297, role: "discount" },
    ]);
    expect(card.vehicleSellingPrice).toBe(55598);
    expect(card.feeAmount).toBe(895);
    expect(card.totalAdvertisedPrice).toBe(56493);
    expect(card.reconciles).toBe(true);
  });

  it("NEW #3 — no rebate, advertised total below MSRP", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61895,
      vehicleSellingPrice: 59000, totalAdvertisedPrice: 59895, docFee: 895,
    });
    expect(card.lines).toEqual([
      { key: "anchor", label: "MSRP", amount: 61895, role: "anchor" },
      { key: "dealer_discount", label: "Dealer Discount", amount: 2895, role: "discount" },
    ]);
    expect(card.totalAdvertisedPrice).toBe(59895);
    expect(card.reconciles).toBe(true);
  });

  it("NEW #4 — multiple included factory rebates", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61895,
      vehicleSellingPrice: 52598, totalAdvertisedPrice: 53493, docFee: 895,
      factoryRebates: [
        { key: "retail_cash", label: "Retail Cash", amount: 5000 },
        { key: "bonus_cash", label: "Bonus Cash", amount: 3000 },
      ],
    });
    expect(card.lines.map((l) => l.label)).toEqual(["MSRP", "Retail Cash", "Bonus Cash", "Dealer Discount"]);
    // 61895 − 5000 − 3000 − 1297 = 52598
    expect(card.lines.find((l) => l.label === "Dealer Discount")?.amount).toBe(1297);
    expect(card.reconciles).toBe(true);
  });

  it("NEW #8 — negative derived discount is a conflict, never shown as a positive discount", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 55000,
      vehicleSellingPrice: 57245, totalAdvertisedPrice: 58140, docFee: 895, // selling above MSRP
    });
    expect(card.conflict).toBe(true);
    expect(card.lines).toEqual([]); // no anchor ladder
    expect(card.vehicleSellingPrice).toBe(57245);
    expect(card.feeAmount).toBe(895);
    expect(card.reconciles).toBe(true); // selling + fee still equals total
  });

  it("NEW #9 — missing MSRP renders Vehicle Selling Price → fee → total, no anchor", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: null,
      vehicleSellingPrice: 57245, totalAdvertisedPrice: 58140, docFee: 895,
    });
    expect(card.lines).toEqual([]);
    expect(card.feeAmount).toBe(895);
    expect(card.totalAdvertisedPrice).toBe(58140);
    expect(card.reconciles).toBe(true);
  });

  it("NEW #10 — missing doc fee: no fee row, selling equals total", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61640,
      vehicleSellingPrice: 58140, totalAdvertisedPrice: 58140, docFee: 0,
    });
    expect(card.feeAmount).toBeNull();
    expect(card.feeLabel).toBeNull();
    expect(card.lines.find((l) => l.label === "Dealer Discount")?.amount).toBe(3500);
    expect(card.reconciles).toBe(true);
  });

  it("USED #11 — Market Value, derived discount, doc fee (reference QX50)", () => {
    const card = buildSalePriceCard({
      vehicleType: "used", marketValue: 31981,
      vehicleSellingPrice: 29981, totalAdvertisedPrice: 30876, docFee: 895,
    });
    expect(card.anchorLabel).toBe("Market Value");
    expect(card.lines).toEqual([
      { key: "anchor", label: "Market Value", amount: 31981, role: "anchor" },
      { key: "dealer_discount", label: "Dealer Discount", amount: 2000, role: "discount" },
    ]);
    expect(card.vehicleSellingPrice).toBe(29981);
    expect(card.feeAmount).toBe(895);
    expect(card.totalAdvertisedPrice).toBe(30876);
    expect(card.reconciles).toBe(true);
  });

  it("CPO #15 — follows Used/CPO logic (Market Value anchor)", () => {
    const card = buildSalePriceCard({
      vehicleType: "cpo", marketValue: 42000,
      vehicleSellingPrice: 39105, totalAdvertisedPrice: 40000, docFee: 895,
    });
    expect(card.anchorLabel).toBe("Market Value");
    expect(card.lines.find((l) => l.label === "Dealer Discount")?.amount).toBe(2895);
    expect(card.reconciles).toBe(true);
  });

  it("USED #14 — negative calculated discount (market below selling) is a conflict, no fabricated discount", () => {
    const card = buildSalePriceCard({
      vehicleType: "used", marketValue: 29000,
      vehicleSellingPrice: 29981, totalAdvertisedPrice: 30876, docFee: 895,
    });
    expect(card.conflict).toBe(true);
    expect(card.lines).toEqual([]);
    expect(card.reconciles).toBe(true);
  });

  it("#17 — scraped total already includes the doc fee; the fee is never double-counted", () => {
    const card = buildSalePriceCard({
      vehicleType: "used", marketValue: 31981,
      vehicleSellingPrice: 29981, totalAdvertisedPrice: 30876, docFee: 895,
    });
    // selling + fee === total, never total + fee
    expect(card.vehicleSellingPrice + (card.feeAmount ?? 0)).toBe(card.totalAdvertisedPrice);
    expect(card.totalAdvertisedPrice).toBe(30876);
  });

  it("#19 — integer-cent arithmetic (no floating-point drift)", () => {
    const card = buildSalePriceCard({
      vehicleType: "used", marketValue: 31981.1,
      vehicleSellingPrice: 29981.05, totalAdvertisedPrice: 30876.05, docFee: 895,
    });
    expect(card.reconciles).toBe(true);
  });

  it("#21 — headline (total) equals the bottom total exactly", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 58140,
      vehicleSellingPrice: 57245, totalAdvertisedPrice: 58140, docFee: 895,
    });
    // The component binds both the headline and the bottom row to totalAdvertisedPrice.
    expect(card.totalAdvertisedPrice).toBe(58140);
  });

  it("#23 — no $0 / null / negative rows are ever produced", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 58140,
      vehicleSellingPrice: 58140, totalAdvertisedPrice: 58140, docFee: 0, // no fee, MSRP == selling
    });
    expect(card.lines.every((l) => l.amount > 0)).toBe(true);
    expect(card.feeAmount).toBeNull();
    // MSRP == selling and no fee → no discount, no anchor ladder
    expect(card.lines).toEqual([]);
  });

  it("#24 — a new vehicle is never labeled Market Value", () => {
    const card = buildSalePriceCard({ vehicleType: "new", msrp: 60000, vehicleSellingPrice: 55000, totalAdvertisedPrice: 55895, docFee: 895 });
    expect(card.anchorLabel).toBe("MSRP");
  });

  it("#25 — a used/CPO vehicle is never labeled MSRP", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 30000, vehicleSellingPrice: 28000, totalAdvertisedPrice: 28895, docFee: 895 });
    expect(card.anchorLabel).toBe("Market Value");
  });

  it("NEW #5 — conditional rebates are excluded upstream (only included rebates are passed)", () => {
    // The caller passes ONLY included, unconditional rebates. A conditional
    // incentive is simply never in factoryRebates, so it never reduces the total.
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 58140,
      vehicleSellingPrice: 57245, totalAdvertisedPrice: 58140, docFee: 895,
      factoryRebates: [], // conditional incentives excluded by the caller
    });
    expect(card.lines.some((l) => l.role === "discount" && l.label !== "Dealer Discount")).toBe(false);
    // With no included rebate, MSRP==total ⇒ the whole gap is the dealer discount = fee.
    expect(card.lines.find((l) => l.label === "Dealer Discount")?.amount).toBe(895);
  });

  it("NEW #6 — a documented dealer discount that MATCHES the derived one: no mismatch flag", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61895,
      vehicleSellingPrice: 55598, totalAdvertisedPrice: 56493, docFee: 895,
      factoryRebates: [{ key: "retail_cash", label: "Retail Cash", amount: 5000 }],
      documentedDealerDiscount: 1297, // equals the derived discount
    });
    expect(card.documentedDiscountMismatch).toBe(false);
    expect(card.lines.find((l) => l.label === "Dealer Discount")?.amount).toBe(1297);
  });

  it("NEW #7 — a documented dealer discount that CONFLICTS with the derived one: flagged, display stays reconciling", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61895,
      vehicleSellingPrice: 55598, totalAdvertisedPrice: 56493, docFee: 895,
      factoryRebates: [{ key: "retail_cash", label: "Retail Cash", amount: 5000 }],
      documentedDealerDiscount: 999, // disagrees with the derived 1297
    });
    expect(card.documentedDiscountMismatch).toBe(true);
    // The DISPLAY still uses the reconciling derived value, never the conflicting one.
    expect(card.lines.find((l) => l.label === "Dealer Discount")?.amount).toBe(1297);
    expect(card.reconciles).toBe(true);
  });

  it("a rebate with an empty label is never rendered", () => {
    const card = buildSalePriceCard({
      vehicleType: "new", msrp: 61895,
      vehicleSellingPrice: 55598, totalAdvertisedPrice: 56493, docFee: 895,
      factoryRebates: [{ key: "x", label: "   ", amount: 5000 }],
    });
    expect(card.lines.some((l) => l.label.trim() === "")).toBe(false);
  });

  it("configured doc-fee label overrides the default", () => {
    const card = buildSalePriceCard({
      vehicleType: "used", marketValue: 32000, vehicleSellingPrice: 30000, totalAdvertisedPrice: 30895, docFee: 895, docFeeLabel: "Documentation Fee",
    });
    expect(card.feeLabel).toBe("Documentation Fee");
  });
});

// Net customer savings ("You Save") = anchor − Total Advertised Price, AFTER the
// doc fee. Never the dealer discount, never negative, hidden at $0.
describe("net customer savings — You Save", () => {
  it("USED — positive net savings after the doc fee (reference QX50: 34,500 − 30,876 = 3,624)", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 34500, vehicleSellingPrice: 29981, totalAdvertisedPrice: 30876, docFee: 895 });
    expect(card.customerSavings).toBe(3624);
    expect(card.showSavings).toBe(true);
  });

  it("USED — discount ($2,000) exceeds the doc fee; net savings = Market Value − Total (1,105), not the discount", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 31981, vehicleSellingPrice: 29981, totalAdvertisedPrice: 30876, docFee: 895 });
    expect(card.lines.find((l) => l.key === "dealer_discount")?.amount).toBe(2000);
    expect(card.customerSavings).toBe(1105);
    expect(card.showSavings).toBe(true);
  });

  it("USED — discount equals the doc fee → $0 net savings, hidden", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 30000, vehicleSellingPrice: 29105, totalAdvertisedPrice: 30000, docFee: 895 });
    expect(card.customerSavings).toBe(0);
    expect(card.showSavings).toBe(false);
  });

  it("USED — Total above Market Value → negative, hidden (never a negative You Save)", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 29000, vehicleSellingPrice: 29981, totalAdvertisedPrice: 30876, docFee: 895 });
    expect(card.customerSavings).toBeLessThan(0);
    expect(card.showSavings).toBe(false);
  });

  it("USED — missing Market Value → no savings", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: null, vehicleSellingPrice: 24981, totalAdvertisedPrice: 25876, docFee: 895 });
    expect(card.customerSavings).toBeNull();
    expect(card.showSavings).toBe(false);
  });

  it("NEW — rebates + discount + fee → net savings vs MSRP (50,000 − 47,395 = 2,605)", () => {
    const card = buildSalePriceCard({ vehicleType: "new", msrp: 50000, vehicleSellingPrice: 46500, totalAdvertisedPrice: 47395, docFee: 895, factoryRebates: [{ key: "retail_cash", label: "Retail Cash", amount: 2000 }] });
    expect(card.customerSavings).toBe(2605);
    expect(card.showSavings).toBe(true);
  });

  it("NEW — dealer discount only, positive net savings (50,000 − 49,395 = 605)", () => {
    const card = buildSalePriceCard({ vehicleType: "new", msrp: 50000, vehicleSellingPrice: 48500, totalAdvertisedPrice: 49395, docFee: 895 });
    expect(card.customerSavings).toBe(605);
    expect(card.showSavings).toBe(true);
  });

  it("NEW — discount offsets the doc fee, Total equals MSRP → $0, hidden (never 'You Save $895')", () => {
    const card = buildSalePriceCard({ vehicleType: "new", msrp: 50000, vehicleSellingPrice: 49105, totalAdvertisedPrice: 50000, docFee: 895 });
    expect(card.msrpEqualsTotal).toBe(true);
    expect(card.customerSavings).toBe(0);
    expect(card.showSavings).toBe(false);
  });

  it("NEW — Total above MSRP → hidden", () => {
    const card = buildSalePriceCard({ vehicleType: "new", msrp: 47000, vehicleSellingPrice: 48000, totalAdvertisedPrice: 48895, docFee: 895 });
    expect(card.showSavings).toBe(false);
  });

  it("savings uses integer cents, not formatted strings", () => {
    const card = buildSalePriceCard({ vehicleType: "used", marketValue: 31981.4, vehicleSellingPrice: 29981.4, totalAdvertisedPrice: 30876.4, docFee: 895 });
    expect(card.customerSavings).toBeCloseTo(1105, 2);
    expect(card.showSavings).toBe(true);
  });
});
