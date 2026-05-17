import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isSb766Applicable,
  computeFinancingDisclosure,
  computeRestockingFee,
  computeMileageCharge,
  assessReturn,
  allAddOnsAcknowledged,
  SB766_PRICE_THRESHOLD,
  SB766_RESTOCKING_FLOOR,
  SB766_RESTOCKING_CEILING,
  SB766_MILEAGE_CAP,
  SB766_MILEAGE_GRACE,
  SB766_PER_MILE_FEE_CAP,
  SB766_THREE_DAY_RETURN_TEXT,
  CA_DOC_FEE_CAP,
} from "./sb766";

// ──────────────────────────────────────────────────────────────
// SB 766: California 3-day right-to-cancel for used vehicles
// under $50k, effective 10/1/2026. These tests pin the financial
// math and eligibility rules so the return flow can't drift.
// ──────────────────────────────────────────────────────────────

describe("isSb766Applicable", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns false for non-CA states", () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    expect(isSb766Applicable("NY", 30000)).toBe(false);
    expect(isSb766Applicable("TX", 30000)).toBe(false);
  });

  it("returns false before the effective date", () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    expect(isSb766Applicable("CA", 30000)).toBe(false);
  });

  it("returns false at or above the $50k threshold", () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    expect(isSb766Applicable("CA", 50000)).toBe(false);
    expect(isSb766Applicable("CA", 65000)).toBe(false);
  });

  it("returns true for CA, under threshold, post-effective", () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    expect(isSb766Applicable("CA", 49999)).toBe(true);
    expect(isSb766Applicable("ca", 15000)).toBe(true);
  });

  it("returns false when state or price is missing", () => {
    expect(isSb766Applicable(undefined, 10000)).toBe(false);
    expect(isSb766Applicable("CA", undefined)).toBe(false);
  });
});

describe("computeRestockingFee", () => {
  it("clamps to the $200 floor on small prices", () => {
    const fee = computeRestockingFee(5000);
    expect(fee.applicable).toBe(true);
    expect(fee.amount).toBe(SB766_RESTOCKING_FLOOR);
  });

  it("clamps to the $600 ceiling on big prices", () => {
    const fee = computeRestockingFee(80000);
    expect(fee.amount).toBe(SB766_RESTOCKING_CEILING);
  });

  it("computes 1.5% in the middle band", () => {
    const fee = computeRestockingFee(20000);
    expect(fee.amount).toBe(300); // 1.5% of 20000
  });

  it("returns applicable=false when price is zero", () => {
    const fee = computeRestockingFee(0);
    expect(fee.applicable).toBe(false);
  });
});

describe("computeFinancingDisclosure", () => {
  it("computes monthly payment with standard amortization", () => {
    const disclosure = computeFinancingDisclosure(
      { amount_financed: 20000, apr_percent: 6.0, term_months: 60 },
      "CA"
    );
    // PMT on $20k, 0.5% monthly, 60 months = ~$386.66
    expect(disclosure.monthly_payment).toBeCloseTo(386.66, 1);
    expect(disclosure.term_months).toBe(60);
    expect(disclosure.apr_percent).toBe(6.0);
    expect(disclosure.total_of_payments).toBeCloseTo(23199.36, 0);
    expect(disclosure.total_interest).toBeCloseTo(3199.36, 0);
  });

  it("handles 0% APR as straight-line amortization", () => {
    const disclosure = computeFinancingDisclosure(
      { amount_financed: 12000, apr_percent: 0, term_months: 48 },
      "CA"
    );
    expect(disclosure.monthly_payment).toBe(250);
    expect(disclosure.total_interest).toBe(0);
  });

  it("lifetime cost includes add-ons, nets out trade credit", () => {
    const disclosure = computeFinancingDisclosure(
      {
        amount_financed: 18000,
        apr_percent: 5,
        term_months: 60,
        add_ons_total: 2000,
        trade_in_credit: 3000,
      },
      "CA"
    );
    // 18000 + interest + 2000 add-ons - 3000 trade
    expect(disclosure.lifetime_cost).toBeCloseTo(18000 + disclosure.total_interest + 2000 - 3000, 1);
  });

  it("stamps presented_at and vehicle_state", () => {
    const disclosure = computeFinancingDisclosure(
      { amount_financed: 10000, apr_percent: 4, term_months: 36 },
      "ca"
    );
    expect(disclosure.vehicle_state).toBe("CA");
    expect(disclosure.presented_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("allAddOnsAcknowledged", () => {
  it("returns true when every add-on is acknowledged or declined", () => {
    expect(
      allAddOnsAcknowledged({
        add_ons: [
          { id: "a", name: "GAP", price: 499, precontract_ack_at: "2026-10-01T00:00:00Z", declined: false },
          { id: "b", name: "Paint", price: 999, precontract_ack_at: null, declined: true },
        ],
      })
    ).toBe(true);
  });

  it("returns false when any add-on is neither acknowledged nor declined", () => {
    expect(
      allAddOnsAcknowledged({
        add_ons: [
          { id: "a", name: "GAP", price: 499, precontract_ack_at: null, declined: false },
        ],
      })
    ).toBe(false);
  });

  it("returns true for empty or null records", () => {
    expect(allAddOnsAcknowledged(null)).toBe(true);
    expect(allAddOnsAcknowledged({ add_ons: [] })).toBe(true);
  });
});

describe("SB 766 constants", () => {
  it("threshold is $50,000", () => {
    expect(SB766_PRICE_THRESHOLD).toBe(50000);
  });
  it("CA doc-fee cap stays at $85 (SB 791 vetoed)", () => {
    expect(CA_DOC_FEE_CAP).toBe(85);
  });
});

// ──────────────────────────────────────────────────────────────
// Mileage charge math — pins §11713.21 numbers verbatim.
// ──────────────────────────────────────────────────────────────

describe("computeMileageCharge", () => {
  it("charges nothing within the 250-mile grace", () => {
    const c = computeMileageCharge(0);
    expect(c.over_grace).toBe(0);
    expect(c.charge).toBe(0);
    expect(c.charge_capped).toBe(false);
    expect(c.over_cap).toBe(false);
  });

  it("still charges nothing at exactly 250 miles", () => {
    const c = computeMileageCharge(SB766_MILEAGE_GRACE);
    expect(c.charge).toBe(0);
  });

  it("charges $1/mile after the grace", () => {
    const c = computeMileageCharge(SB766_MILEAGE_GRACE + 50);
    expect(c.over_grace).toBe(50);
    expect(c.charge).toBe(50);
    expect(c.charge_capped).toBe(false);
  });

  it("caps the charge at $150 even before mileage hits the cap", () => {
    // 250 + 200 mi over grace = $200 raw → capped at $150
    const c = computeMileageCharge(SB766_MILEAGE_GRACE + 200);
    expect(c.charge).toBe(SB766_PER_MILE_FEE_CAP);
    expect(c.charge_capped).toBe(true);
    expect(c.over_cap).toBe(true); // 450 > 400-mi cap, ineligible
  });

  it("flags over_cap once miles exceed 400 exactly", () => {
    expect(computeMileageCharge(SB766_MILEAGE_CAP).over_cap).toBe(false);
    expect(computeMileageCharge(SB766_MILEAGE_CAP + 1).over_cap).toBe(true);
  });

  it("treats negative or NaN miles as zero", () => {
    expect(computeMileageCharge(-50).charge).toBe(0);
    expect(computeMileageCharge(Number.NaN).charge).toBe(0);
  });

  it("floors fractional miles", () => {
    const c = computeMileageCharge(SB766_MILEAGE_GRACE + 10.9);
    // 10.9 floored to 10
    expect(c.over_grace).toBe(10);
    expect(c.charge).toBe(10);
  });
});

// ──────────────────────────────────────────────────────────────
// Full assessReturn — the eligibility decision the UI renders.
// ──────────────────────────────────────────────────────────────

describe("assessReturn", () => {
  it("approves a clean return: CA, under $50k, day 1, 100 mi", () => {
    const a = assessReturn({ state: "CA", price: 22000, miles_at_return: 100, days_since_purchase: 1 });
    expect(a.eligible).toBe(true);
    expect(a.reason).toBeNull();
    expect(a.mileage_charge.charge).toBe(0);
    expect(a.restocking_fee.amount).toBe(330); // 1.5% of 22000
    expect(a.total_dealer_retention).toBe(330);
    expect(a.refund_to_buyer).toBe(22000 - 330);
  });

  it("rejects a sale outside California with a clear reason", () => {
    const a = assessReturn({ state: "TX", price: 22000, miles_at_return: 50, days_since_purchase: 1 });
    expect(a.eligible).toBe(false);
    expect(a.applicable).toBe(false);
    expect(a.reason).toMatch(/not applicable/i);
    expect(a.refund_to_buyer).toBe(0);
  });

  it("rejects price >= $50,000", () => {
    const a = assessReturn({ state: "CA", price: 50000, miles_at_return: 0, days_since_purchase: 1 });
    expect(a.eligible).toBe(false);
    expect(a.applicable).toBe(false);
  });

  it("rejects day 4 with a window-closed reason citing the day count", () => {
    const a = assessReturn({ state: "CA", price: 22000, miles_at_return: 100, days_since_purchase: 4 });
    expect(a.eligible).toBe(false);
    expect(a.within_window).toBe(false);
    expect(a.reason).toMatch(/window closed/i);
    expect(a.reason).toMatch(/4 calendar days/);
  });

  it("accepts exactly day 3 (the last eligible day)", () => {
    const a = assessReturn({ state: "CA", price: 22000, miles_at_return: 100, days_since_purchase: 3 });
    expect(a.eligible).toBe(true);
  });

  it("rejects miles > 400 with a mileage-cap reason", () => {
    const a = assessReturn({ state: "CA", price: 22000, miles_at_return: 401, days_since_purchase: 1 });
    expect(a.eligible).toBe(false);
    expect(a.within_mileage_cap).toBe(false);
    expect(a.reason).toMatch(/mileage exceeds 400-mile cap/i);
  });

  it("retains restocking + capped mileage charge on a barely-eligible 400-mile return", () => {
    const a = assessReturn({ state: "CA", price: 22000, miles_at_return: 400, days_since_purchase: 3 });
    expect(a.eligible).toBe(true);
    expect(a.mileage_charge.charge).toBe(SB766_PER_MILE_FEE_CAP); // 150
    expect(a.restocking_fee.amount).toBe(330);
    expect(a.total_dealer_retention).toBe(330 + 150);
    expect(a.refund_to_buyer).toBe(22000 - 330 - 150);
  });

  it("returns zero retention when ineligible (refund stays a single source of truth)", () => {
    const a = assessReturn({ state: "CA", price: 22000, miles_at_return: 500, days_since_purchase: 1 });
    expect(a.eligible).toBe(false);
    expect(a.total_dealer_retention).toBe(0);
    expect(a.refund_to_buyer).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
// The verbatim notice that has to appear at point of sale.
// ──────────────────────────────────────────────────────────────

describe("SB766_THREE_DAY_RETURN_TEXT", () => {
  it("names California Vehicle Code §11713.21", () => {
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/§11713\.21/);
  });
  it("names the effective date 10/1/2026", () => {
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/10\/1\/2026/);
  });
  it("quotes the 3-day calendar window", () => {
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/three \(3\) calendar days/i);
  });
  it("quotes the 400-mile cap + 250 grace + $1/mi + $150 fee cap", () => {
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/400 miles/);
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/250/);
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/\$1\.00/);
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/\$150/);
  });
  it("quotes the 1.5% restocking fee + $200 floor + $600 ceiling", () => {
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/1\.5%/);
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/\$200/);
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/\$600/);
  });
  it("states the right cannot be waived", () => {
    expect(SB766_THREE_DAY_RETURN_TEXT).toMatch(/cannot be waived/i);
  });
});
