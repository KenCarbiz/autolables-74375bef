import { describe, it, expect } from "vitest";
import {
  estimateAffordability,
  formatCurrency,
  formatCurrencyCents,
  DEFAULT_APR_PERCENT,
  DEFAULT_TERMS_MONTHS,
} from "./affordability";

describe("estimateAffordability", () => {
  it("returns one row per default term", () => {
    const rows = estimateAffordability({ price: 30000 });
    expect(rows.map((r) => r.term_months)).toEqual([...DEFAULT_TERMS_MONTHS]);
  });

  it("defaults the APR and echoes it on each row", () => {
    const rows = estimateAffordability({ price: 30000 });
    expect(rows.every((r) => r.apr_percent === DEFAULT_APR_PERCENT)).toBe(true);
  });

  it("computes a standard amortized payment with interest", () => {
    const [row] = estimateAffordability({ price: 30000, aprPercent: 7.25 }, [60]);
    expect(row.monthly_payment).toBeGreaterThan(0);
    expect(row.total_interest).toBeGreaterThan(0);
    // total of payments ~= monthly * term (within rounding)
    expect(Math.abs(row.total_of_payments - row.monthly_payment * 60)).toBeLessThan(1);
  });

  it("handles a 0% APR as simple division with zero interest", () => {
    const [row] = estimateAffordability({ price: 30000, aprPercent: 0 }, [60]);
    expect(row.monthly_payment).toBe(500);
    expect(row.total_interest).toBe(0);
    expect(row.lifetime_cost).toBe(30000);
  });

  it("applies sales tax to principal and lifetime cost", () => {
    const [taxed] = estimateAffordability({ price: 30000, aprPercent: 0, salesTaxPercent: 10 }, [60]);
    // principal becomes 33000 -> 33000/60 = 550
    expect(taxed.monthly_payment).toBe(550);
    expect(taxed.lifetime_cost).toBe(33000);
  });

  it("reduces principal by down payment and trade credit", () => {
    const [row] = estimateAffordability({ price: 30000, aprPercent: 0, downPayment: 5000, tradeInCredit: 1000 }, [60]);
    // principal = 24000 -> 24000/60 = 400
    expect(row.monthly_payment).toBe(400);
  });

  it("zeroes the loan when down + trade cover the price", () => {
    const [row] = estimateAffordability({ price: 20000, downPayment: 25000 }, [60]);
    expect(row.monthly_payment).toBe(0);
    expect(row.total_interest).toBe(0);
    expect(row.lifetime_cost).toBe(20000);
  });

  it("subtracts trade credit from lifetime cost", () => {
    const [row] = estimateAffordability({ price: 30000, aprPercent: 0, tradeInCredit: 4000 }, [60]);
    // lifetime = price + tax(0) + interest(0) - trade = 26000
    expect(row.lifetime_cost).toBe(26000);
  });

  it("accepts a custom term list", () => {
    expect(estimateAffordability({ price: 30000 }, [36, 48]).map((r) => r.term_months)).toEqual([36, 48]);
  });
});

describe("currency formatters", () => {
  it("formats whole-dollar currency", () => {
    expect(formatCurrency(1000)).toContain("1,000");
    expect(formatCurrency(1000)).toContain("$");
  });

  it("formats currency with cents", () => {
    expect(formatCurrencyCents(1000)).toContain("1,000.00");
  });
});
