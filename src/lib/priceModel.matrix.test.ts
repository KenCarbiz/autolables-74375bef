import { describe, it, expect } from "vitest";
import { buildSalePriceCard, type PricingVehicleType } from "./priceModel";

// ── Objective pricing matrix across a broad set of real-world vehicles ────────
// Every row asserts the full backward-derived ladder against hand-computed
// expectations, proving the model holds beyond the two reference fixtures:
//   Vehicle Selling Price = Total Advertised Price − Doc Fee
//   NEW:  MSRP − rebates − Dealer Discount = Selling ;  USED/CPO: MV − Discount = Selling
// The scraped total ALWAYS includes the doc fee. Discount is derived + reconciling.

interface Row {
  name: string;
  type: PricingVehicleType;
  msrp?: number | null;
  marketValue?: number | null;
  selling: number;          // pre-fee vehicle selling price
  fee: number;              // configured doc fee (0 = none)
  rebates?: { label: string; amount: number }[];
  // expectations
  anchorLabel: "MSRP" | "Market Value";
  discount: number | null;  // expected Dealer Discount row amount, or null if no discount row
  showsAnchor: boolean;      // does the MSRP/Market Value row render?
  conflict?: boolean;
}

const M: Row[] = [
  // ── NEW: MSRP == total (discount == fee) across different fee amounts ──────
  { name: "New QX60, MSRP==total, $895 fee", type: "new", msrp: 58140, selling: 57245, fee: 895, anchorLabel: "MSRP", discount: 895, showsAnchor: true },
  { name: "New Civic, MSRP==total, $499 fee", type: "new", msrp: 32100, selling: 31601, fee: 499, anchorLabel: "MSRP", discount: 499, showsAnchor: true },
  { name: "New F-150, MSRP==total, $699 fee", type: "new", msrp: 61485, selling: 60786, fee: 699, anchorLabel: "MSRP", discount: 699, showsAnchor: true },
  { name: "New Corvette, MSRP==total, $999 fee", type: "new", msrp: 89995, selling: 88996, fee: 999, anchorLabel: "MSRP", discount: 999, showsAnchor: true },

  // ── NEW: total below MSRP, no rebate (dealer discount > fee) ───────────────
  { name: "New QX50, $2,895 below MSRP", type: "new", msrp: 61895, selling: 59000, fee: 895, anchorLabel: "MSRP", discount: 2895, showsAnchor: true },
  { name: "New Camry, $1,500 below MSRP", type: "new", msrp: 34990, selling: 33990, fee: 500, anchorLabel: "MSRP", discount: 1000, showsAnchor: true },

  // ── NEW: with factory rebate(s) ───────────────────────────────────────────
  { name: "New QX60, $5k retail cash + discount", type: "new", msrp: 61895, selling: 55598, fee: 895, rebates: [{ label: "Factory Retail Cash", amount: 5000 }], anchorLabel: "MSRP", discount: 1297, showsAnchor: true },
  { name: "New Ram, retail + bonus cash", type: "new", msrp: 64500, selling: 55000, fee: 500, rebates: [{ label: "Retail Cash", amount: 6000 }, { label: "Bonus Cash", amount: 3000 }], anchorLabel: "MSRP", discount: 500, showsAnchor: true },
  { name: "New EV, rebate consumes whole gap (no dealer discount)", type: "new", msrp: 55000, selling: 50000, fee: 0, rebates: [{ label: "EV Cash", amount: 5000 }], anchorLabel: "MSRP", discount: null, showsAnchor: true },

  // ── NEW: no doc fee ───────────────────────────────────────────────────────
  { name: "New, no fee, $3,500 below MSRP", type: "new", msrp: 61640, selling: 58140, fee: 0, anchorLabel: "MSRP", discount: 3500, showsAnchor: true },

  // ── NEW: edge — missing MSRP, negative discount, MSRP==selling+no fee ──────
  { name: "New, missing MSRP", type: "new", msrp: null, selling: 57245, fee: 895, anchorLabel: "MSRP", discount: null, showsAnchor: false },
  { name: "New, MSRP below selling (conflict)", type: "new", msrp: 55000, selling: 57245, fee: 895, anchorLabel: "MSRP", discount: null, showsAnchor: false, conflict: true },
  { name: "New, MSRP==selling, no fee (no rows)", type: "new", msrp: 58140, selling: 58140, fee: 0, anchorLabel: "MSRP", discount: null, showsAnchor: false },

  // ── USED: market value above selling (real discount) ──────────────────────
  { name: "Used QX50, $2,000 discount, $895 fee", type: "used", marketValue: 31981, selling: 29981, fee: 895, anchorLabel: "Market Value", discount: 2000, showsAnchor: true },
  { name: "Used Accord, $1,200 discount", type: "used", marketValue: 26500, selling: 25300, fee: 399, anchorLabel: "Market Value", discount: 1200, showsAnchor: true },
  { name: "Used Tahoe, $3,400 discount", type: "used", marketValue: 52900, selling: 49500, fee: 699, anchorLabel: "Market Value", discount: 3400, showsAnchor: true },
  { name: "Used sedan, small $250 discount", type: "used", marketValue: 18250, selling: 18000, fee: 200, anchorLabel: "Market Value", discount: 250, showsAnchor: true },

  // ── USED: no doc fee ──────────────────────────────────────────────────────
  { name: "Used, no fee, $3,160 discount", type: "used", marketValue: 61300, selling: 58140, fee: 0, anchorLabel: "Market Value", discount: 3160, showsAnchor: true },

  // ── USED/CPO: edge — market == selling, market below selling, no MV ────────
  { name: "Used, market == selling (no discount)", type: "used", marketValue: 29981, selling: 29981, fee: 895, anchorLabel: "Market Value", discount: null, showsAnchor: false },
  { name: "Used, market below selling (conflict)", type: "used", marketValue: 29000, selling: 29981, fee: 895, anchorLabel: "Market Value", discount: null, showsAnchor: false, conflict: true },
  { name: "Used, no market value (sparse)", type: "used", marketValue: null, selling: 24981, fee: 0, anchorLabel: "Market Value", discount: null, showsAnchor: false },
  { name: "Used, no market value but has fee", type: "used", marketValue: null, selling: 24981, fee: 895, anchorLabel: "Market Value", discount: null, showsAnchor: false },

  // ── CPO ───────────────────────────────────────────────────────────────────
  { name: "CPO QX60, $2,895 discount, $895 fee", type: "cpo", marketValue: 42000, selling: 39105, fee: 895, anchorLabel: "Market Value", discount: 2895, showsAnchor: true },
  { name: "CPO Lexus, $4,000 discount", type: "cpo", marketValue: 45900, selling: 41900, fee: 599, anchorLabel: "Market Value", discount: 4000, showsAnchor: true },

  // ── Cents / rounding robustness ───────────────────────────────────────────
  { name: "Used, fractional-dollar inputs", type: "used", marketValue: 31981.4, selling: 29981.4, fee: 895, anchorLabel: "Market Value", discount: 2000, showsAnchor: true },
  { name: "New, odd fee $649.50", type: "new", msrp: 40000, selling: 37850.5, fee: 649.5, anchorLabel: "MSRP", discount: 2149.5, showsAnchor: true },
];

describe("pricing matrix — objective check across many vehicles", () => {
  M.forEach((row) => {
    it(row.name, () => {
      const total = row.selling + row.fee; // scraped total ALWAYS includes the fee
      const card = buildSalePriceCard({
        vehicleType: row.type,
        msrp: row.msrp, marketValue: row.marketValue,
        vehicleSellingPrice: row.selling, totalAdvertisedPrice: total,
        docFee: row.fee,
        factoryRebates: row.rebates,
      });

      // Universal invariants (true for EVERY vehicle):
      expect(card.anchorLabel).toBe(row.anchorLabel);
      expect(card.reconciles).toBe(true);                       // ladder reconciles exactly
      expect(card.vehicleSellingPrice + (card.feeAmount ?? 0)).toBe(card.totalAdvertisedPrice); // no double count
      expect(card.totalAdvertisedPrice).toBeCloseTo(total, 2);  // headline == bottom total
      expect(card.lines.every((l) => l.amount > 0)).toBe(true); // never a $0/negative row
      expect(card.lines.every((l) => l.label.trim().length > 0)).toBe(true); // never an empty label
      if (row.type === "new") expect(card.anchorLabel).not.toBe("Market Value");
      else expect(card.anchorLabel).not.toBe("MSRP");

      // Fee row present iff a positive fee was configured.
      expect(card.feeAmount).toBe(row.fee > 0 ? row.fee : null);

      // Anchor + discount expectations.
      const anchorRow = card.lines.find((l) => l.role === "anchor");
      expect(!!anchorRow).toBe(row.showsAnchor);
      const discountRow = card.lines.find((l) => l.key === "dealer_discount");
      if (row.discount == null) expect(discountRow).toBeUndefined();
      else expect(discountRow?.amount).toBeCloseTo(row.discount, 2);

      // Rebate rows exactly match the included rebates.
      const rebateRows = card.lines.filter((l) => l.role === "discount" && l.key !== "dealer_discount");
      expect(rebateRows.length).toBe(row.rebates?.length ?? 0);

      expect(card.conflict).toBe(!!row.conflict);
    });
  });

  it("covers a broad set of vehicles", () => {
    expect(M.length).toBeGreaterThanOrEqual(26);
  });
});
