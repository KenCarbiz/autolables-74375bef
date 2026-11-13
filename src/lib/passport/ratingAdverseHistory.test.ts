import { describe, expect, it } from "vitest";
import { derivePassport, deriveRating } from "@/lib/passportV2Data";
import { buildNextPassportData } from "@/lib/passport/nextPassportData";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { deriveVerificationReport } from "@/lib/passport/verificationSummary";
import { MOCK_USED_FEE } from "@/pages/VehiclePassportV3";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const base = MOCK_USED_FEE as unknown as VehicleListing;
const withMc = (extra: Record<string, unknown>) =>
  ({ ...base, mc_attributes: { ...((base as { mc_attributes?: Record<string, unknown> }).mc_attributes || {}), ...extra } }) as unknown as VehicleListing;
const rate = (l: VehicleListing) => deriveRating(l, derivePassport(l));

describe("overall rating with adverse history", () => {
  it("rates the clean fixture at the hand-computed weighted mean", () => {
    const r = rate(base);
    const s = Object.fromEntries(r.factors.map((f) => [f.key, f.score]));
    // Page views are not market demand, so the fixture has no demand evidence and
    // that factor is unmeasured. Overall is the weighted mean of the measured
    // factors: (87*30 + 97*25 + 94*15 + 86*15) / 85 = 7735 / 85 = 91.
    expect(s.demand).toBeNull();
    const expected = Math.round(
      ((s.price as number) * 30 + (s.history as number) * 25
        + (s.equipment as number) * 15 + (s.coverage as number) * 15) / 85,
    );
    expect(r.overall).toBe(expected);
    expect(r.overall).toBe(91);
  });

  it("gives no overall rating to a branded title, even with a strong price", () => {
    const r = rate(withMc({ carfax_clean_title: false, title_status: "salvage" }));
    expect(r.factors.find((f) => f.key === "price")?.score).toBeGreaterThanOrEqual(80);
    expect(r.overall).toBeNull();
    const history = r.factors.find((f) => f.key === "history");
    expect(history?.evidence).toContain("Title not confirmed clean (−14 pts)");
  });

  it("gives no overall rating when an accident is reported", () => {
    expect(rate(withMc({ accident_count: 2 })).overall).toBeNull();
  });
});

describe("market position scale", () => {
  const build = (l: VehicleListing) => {
    const d = derivePassport(l);
    return buildNextPassportData({
      d, listing: l as never, report: deriveVerificationReport(d, l),
      saleCard: buildPassportSaleCard(d, String(l.condition || "")),
      gallery: [], windowSticker: null, isVisible: () => true,
    }).market;
  };

  it("places the car only on a provider-supplied range", () => {
    const l = { ...base, price: 31_000, market_value: 32_000, market_payload: { low: 30_000, high: 34_000 } } as unknown as VehicleListing;
    const m = build(l);
    // (31,000 - 30,000) / (34,000 - 30,000) = 0.25
    expect(m.state).toBe("success");
    expect(m.position).toBeCloseTo(0.25, 6);
  });

  it("shows no position when the provider gave no range", () => {
    const l = { ...base, price: 31_000, market_value: 32_000, market_payload: {} } as unknown as VehicleListing;
    const m = build(l);
    expect(m.position).toBeNull();
  });
});
