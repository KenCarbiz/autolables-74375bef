import { describe, it, expect, beforeEach } from "vitest";
import { savePaymentPrefs, readPaymentPrefs, clearPaymentPrefs } from "./paymentPrefs";
import { normalizeEstimatorConfig, resolveEstimate } from "@/lib/payment/estimator";
import { PE_PUBLISHED } from "@/pages/admin/fixtures/paymentEstimator";

const V = { vin: "5N1AL1F83VC332076", slug: "sample", id: "abc" } as const;

describe("paymentPrefs", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips a saved scenario per vehicle", () => {
    savePaymentPrefs(V, { down: 5000, term: 60, apr: 7.25 });
    const p = readPaymentPrefs(V);
    expect(p).toMatchObject({ down: 5000, term: 60, apr: 7.25 });
    expect(typeof p?.savedAt).toBe("number");
  });

  it("is scoped per vehicle (a different VIN reads null)", () => {
    savePaymentPrefs(V, { down: 5000, term: 60, apr: 7.25 });
    expect(readPaymentPrefs({ vin: "OTHERVIN000000001", slug: null, id: null } as never)).toBeNull();
  });

  it("returns null before anything is saved", () => {
    expect(readPaymentPrefs(V)).toBeNull();
  });

  it("clear removes the scenario", () => {
    savePaymentPrefs(V, { down: 3000, term: 72, apr: 8 });
    clearPaymentPrefs(V);
    expect(readPaymentPrefs(V)).toBeNull();
  });

  it("ignores malformed / non-finite values", () => {
    savePaymentPrefs(V, { down: Number.NaN, term: 72, apr: 8 });
    expect(readPaymentPrefs(V)).toBeNull();
  });

  it("no-ops safely when the vehicle has no id/vin/slug", () => {
    expect(() => savePaymentPrefs(null, { down: 1, term: 1, apr: 1 })).not.toThrow();
    expect(readPaymentPrefs(null)).toBeNull();
  });

  it("a shopper's saved down payment survives a re-read and overrides only what they changed", () => {
    sessionStorage.setItem("al_pay_prefs:" + V.vin, JSON.stringify({ down: 1, term: 36, apr: 3, savedAt: 1 }));
    expect(readPaymentPrefs(V)).toBeNull();
    savePaymentPrefs(V, { down: 5000, term: null, apr: null });
    const prefs = readPaymentPrefs(V);
    const config = normalizeEstimatorConfig(PE_PUBLISHED);
    const est = resolveEstimate(config, { modelYear: 2023, sellingPrice: 27500 }, { downPayment: prefs?.down, termMonths: prefs?.term, aprPercent: prefs?.apr });
    expect(est.status).toBe("available");
    if (est.status !== "available") return;
    expect(est.downPayment).toBe(5000);
    expect(est.downSource).toBe("customer");
    expect(est.termMonths).toBe(60);
    expect(est.aprPercent).toBe(7.99);
    expect(est.aprOverridden).toBe(false);
  });
});
