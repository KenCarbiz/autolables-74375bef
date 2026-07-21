import { describe, it, expect, beforeEach } from "vitest";
import { savePaymentPrefs, readPaymentPrefs, clearPaymentPrefs } from "./paymentPrefs";

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
});
