import { describe, it, expect } from "vitest";
import { buildPremiumRequest } from "./premiumRequest";
import { capability } from "./providerRegistry";

const VIN = "1HGCM82633A004352";
const full = { vin: VIN, miles: 31250, zip: "60601", dealerType: "franchise" as const, isCertified: false };

describe("Premium / Premium Plus request", () => {
  it("sends vin, miles, zip, dealer_type and is_certified explicitly on both tiers", () => {
    for (const tier of ["premium", "premium_plus"] as const) {
      const r = buildPremiumRequest({ tier, ...full });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.params).toEqual({ vin: VIN, miles: "31250", zip: "60601", dealer_type: "franchise", is_certified: "false" });
      expect(r.path).toBe(capability(r.capabilityKey)!.path);
    }
  });

  it("covers every parameter the registry says must always be sent", () => {
    const r = buildPremiumRequest({ tier: "premium", ...full });
    if (!r.ok) throw new Error("expected a request");
    for (const k of capability("price_premium")!.requestContract!.alwaysSend) expect(Object.keys(r.params)).toContain(k);
  });

  it("refuses rather than let the provider default to 50,000 miles, ZIP 50501, franchise or non-certified", () => {
    const cases: [Partial<typeof full>, string][] = [
      [{ miles: undefined as unknown as number }, "miles"],
      [{ zip: "" }, "zip"],
      [{ dealerType: undefined as unknown as "franchise" }, "dealer_type"],
      [{ isCertified: null as unknown as boolean }, "is_certified"],
      [{ vin: "NOTAVIN" }, "vin"],
    ];
    for (const [patch, field] of cases) {
      const r = buildPremiumRequest({ tier: "premium", ...full, ...patch });
      expect(r.ok, field).toBe(false);
      if (!r.ok) expect(r.missing).toContain(field);
    }
  });
});
