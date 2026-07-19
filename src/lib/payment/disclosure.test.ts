import { describe, it, expect } from "vitest";
import { presentApr, creditImpactCopy, estimateDueAtSigning, smsConsentCopy, EXCLUDED_CHARGES } from "./disclosure";

describe("payment disclosure governance", () => {
  it("presentApr default is Example APR, never authoritative, null asOf", () => {
    const a = presentApr(6.99);
    expect(a.label).toBe("Example APR");
    expect(a.value).toBe("6.99%");
    expect(a.disclosure).toMatch(/not a personalized offer/i);
    expect(a.asOf).toBeNull();
  });
  it("verified dealer offer => Dealer-offered APR with timestamp", () => {
    const a = presentApr(5, { verifiedDealerOffer: true, asOf: "2026-07-19T00:00:00Z" });
    expect(a.label).toBe("Dealer-offered APR");
    expect(a.asOf).toBe("2026-07-19T00:00:00Z");
    expect(a.disclosure).toMatch(/confirmed by the dealership/i);
  });
  it("creditImpactCopy(false) says does not affect", () => {
    expect(creditImpactCopy(false)).toBe("This does not affect your credit score.");
  });
  it("creditImpactCopy(true) does not claim no-impact", () => {
    expect(creditImpactCopy(true)).not.toMatch(/does not affect/i);
  });
  it("estimateDueAtSigning sums known components; excludes tax/title/registration", () => {
    const d = estimateDueAtSigning({ downPayment: 2000, firstMonthPayment: 500, dealerDocFee: 499 });
    expect(d.known).toBe(2999);
    expect(d.components.map(c => c.label)).toEqual(["Down payment", "First month (est.)", "Dealer doc fee"]);
    expect(d.excludes.join(" ").toLowerCase()).toMatch(/tax/);
    expect(d.excludes.join(" ").toLowerCase()).toMatch(/title|registration/);
  });
  it("estimateDueAtSigning omits missing optional components", () => {
    const d = estimateDueAtSigning({ downPayment: 1000 });
    expect(d.known).toBe(1000);
    expect(d.components).toHaveLength(1);
  });
  it("smsConsentCopy names dealer, STOP, rates, not-condition-of-purchase", () => {
    const c = smsConsentCopy("Harte INFINITI");
    expect(c).toMatch(/Harte INFINITI/);
    expect(c).toMatch(/Reply STOP/);
    expect(c).toMatch(/Message and data rates may apply/);
    expect(c).toMatch(/not a condition of purchase/);
  });
  it("EXCLUDED_CHARGES mentions tax/title/registration/fee/add-on/trade", () => {
    const j = EXCLUDED_CHARGES.join(" ").toLowerCase();
    expect(j).toMatch(/tax/);
    expect(j).toMatch(/title/);
    expect(j).toMatch(/registration/);
    expect(j).toMatch(/fee/);
    expect(j).toMatch(/add-on/);
    expect(j).toMatch(/trade/);
  });
});
