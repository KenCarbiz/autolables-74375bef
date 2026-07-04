import { describe, expect, it } from "vitest";
import { scoreTier } from "./VehiclePassportGreatBuy";
import { derivePassport, deriveRating, ratingTier, type VehicleRating } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const listing = (overrides: Record<string, unknown> = {}): VehicleListing =>
  ({ vin: "1C4RJKBG5M8123456", ymm: "2021 Jeep Grand Cherokee", slug: "test", ...overrides } as unknown as VehicleListing);

const rate = (overrides: Record<string, unknown> = {}): VehicleRating => {
  const l = listing(overrides);
  return deriveRating(l, derivePassport(l));
};

const RICH = {
  price: 34000,
  market_value: 40000,
  mileage: 12000,
  view_count: 120,
  recall_status: "clear",
  market_meta: { price_stats: { median: 40000 }, similar_count: 42, search_radius: 100, avg_dom: 40, market_days_supply: 25 },
  mc_attributes: { carfax_clean_title: true, accident_count: 0, owner_count: 1, dom: 12 },
  service_records: [{ date: "2025-01-01", type: "Oil change" }, { date: "2025-06-01", type: "Brakes" }, { date: "2026-01-01", type: "Tires" }],
  warranty_info: { factory_months: 60, factory_miles: 60000, in_service_date: "2024-06-01" },
  features: [{ title: "Panoramic Sunroof" }, { title: "Heated Steering Wheel" }, { title: "Adaptive Cruise Control" }, { title: "Premium Audio System" }],
  prep_status: { foreman_signed_at: "2026-06-01T12:00:00Z" },
};

describe("deriveRating null gating", () => {
  it("scores nothing and produces no overall when the listing carries no real inputs", () => {
    const r = rate();
    expect(r.factors.every((f) => f.score == null)).toBe(true);
    expect(r.factors.every((f) => f.evidence.length === 0)).toBe(true);
    expect(r.overall).toBeNull();
    expect(r.tier.id).toBe("pending");
    expect(r.coverage.measured).toBe(0);
  });

  it("withholds the overall until two factors are measured, one of them Price or History", () => {
    // Demand + equipment alone: no spine, no overall.
    const r = rate({
      view_count: 200,
      market_meta: { avg_dom: 40, market_days_supply: 20 },
      mc_attributes: { dom: 10 },
      features: [{ title: "Panoramic Sunroof" }, { title: "Heated Seats" }],
    });
    expect(r.factors.find((f) => f.key === "demand")?.score).not.toBeNull();
    expect(r.factors.find((f) => f.key === "equipment")?.score).not.toBeNull();
    expect(r.overall).toBeNull();
  });

  it("gives no condition/coverage credit without service records or a dated sign-off", () => {
    const r = rate({ mileage: 45000 });
    expect(r.factors.find((f) => f.key === "coverage")?.score).toBeNull();
  });

  it("excludes the History & Title factor for new cars", () => {
    const r = rate({ ...RICH, condition: "new" });
    expect(r.factors.some((f) => f.key === "history")).toBe(false);
    expect(r.coverage.total).toBe(4);
  });
});

describe("deriveRating caps", () => {
  it("never scores a factor above 98 or an overall above 97", () => {
    const extreme = rate({ ...RICH, price: 15000 });
    for (const f of extreme.factors) if (f.score != null) expect(f.score).toBeLessThanOrEqual(98);
    expect(extreme.overall).not.toBeNull();
    expect(extreme.overall as number).toBeLessThanOrEqual(97);
    const rich = rate(RICH);
    for (const f of rich.factors) if (f.score != null) expect(f.score).toBeLessThanOrEqual(98);
    expect(rich.overall as number).toBeLessThanOrEqual(97);
  });
});

describe("price factor", () => {
  const priceScore = (price: number) =>
    rate({ price, market_meta: { price_stats: { median: 40000 }, similar_count: 30 } }).factors.find((f) => f.key === "price")!.score as number;

  it("is monotone in the price delta against the anchor", () => {
    const ladder = [30000, 34000, 38000, 40000, 42000, 46000, 52000].map(priceScore);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThanOrEqual(ladder[i - 1]);
    expect(priceScore(40000)).toBe(80);
    expect(priceScore(10000)).toBe(98);
    expect(priceScore(90000)).toBe(55);
  });

  it("never prints a dollar figure in evidence when priced above the anchor", () => {
    const r = rate({ price: 46000, market_meta: { price_stats: { median: 40000 }, similar_count: 30 } });
    const price = r.factors.find((f) => f.key === "price")!;
    expect(price.score).not.toBeNull();
    expect(price.evidence.join(" ")).not.toMatch(/\$\d/);
  });

  it("stays unmeasured with no anchor at all", () => {
    expect(rate({ price: 46000 }).factors.find((f) => f.key === "price")!.score).toBeNull();
  });
});

describe("evidence", () => {
  it("accompanies every measured factor", () => {
    for (const shape of [RICH, { ...RICH, condition: "new" }, { price: 38000, market_value: 40000 }]) {
      for (const f of rate(shape).factors) {
        if (f.score != null) expect(f.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the deduction receipt as the History & Title evidence", () => {
    const l = listing({ ...RICH, mc_attributes: { ...RICH.mc_attributes, accident_count: 1 } });
    const d = derivePassport(l);
    const hist = deriveRating(l, d).factors.find((f) => f.key === "history")!;
    expect(hist.score).toBe(d.confScore);
    expect(hist.evidence.some((e) => /accident/i.test(e))).toBe(true);
  });
});

describe("single tier table", () => {
  it("maps the unified bands", () => {
    expect(ratingTier(97).label).toBe("Exceptional");
    expect(ratingTier(90).label).toBe("Exceptional");
    expect(ratingTier(85).label).toBe("Strong");
    expect(ratingTier(75).label).toBe("Solid");
    expect(ratingTier(65).label).toBe("Fair");
    expect(ratingTier(42).label).toBe("Worth a Closer Look");
    expect(ratingTier(null).id).toBe("pending");
  });

  it("keeps GreatBuy's buy framing on identical bands", () => {
    for (const s of [97, 90, 85, 80, 75, 70, 65, 60, 42, 10]) {
      expect(scoreTier(s).label).toBe(ratingTier(s).buyLabel);
    }
    expect(scoreTier(85).label).toBe("Strong Buy");
    expect(scoreTier(null).label).toBe("Pending Verification");
  });

  it("never renders red for any tier", () => {
    for (const s of [95, 85, 75, 65, 55, 42, 10]) expect(scoreTier(s).color).not.toBe("#DC2626");
  });

  it("frames a 60-69 score as a candidate with details to confirm — never excellent, never a warning", () => {
    const t = scoreTier(65);
    expect(t.label).not.toMatch(/excellent|exceptional/i);
    expect(t.verdict).not.toMatch(/carefully|caution/i);
  });
});
