import { describe, it, expect } from "vitest";
import {
  PASSPORT_CARD_ARSENAL,
  passportCard,
  scorePassportCard,
  selectCards,
  type CardCandidate,
  type CardSignals,
} from "./passportCards";

describe("passport card arsenal — catalog integrity", () => {
  it("has unique keys and a valid packetId or null on every card", () => {
    const keys = PASSPORT_CARD_ARSENAL.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of PASSPORT_CARD_ARSENAL) {
      expect(typeof c.label).toBe("string");
      expect(["value", "trust", "vehicle", "ownership", "dealer"]).toContain(c.category);
      expect(c.packetId === null || typeof c.packetId === "string").toBe(true);
    }
  });

  it("looks a card up by key", () => {
    expect(passportCard("market-price")?.label).toBe("Market Price");
    expect(passportCard("nope")).toBeUndefined();
  });
});

describe("scorePassportCard — data-quality gating", () => {
  it("scores a below-market discount highest, larger discount scores higher", () => {
    const small = scorePassportCard("market-price", { belowMarket: 500, marketAvg: 50000 });
    const big = scorePassportCard("market-price", { belowMarket: 5000, marketAvg: 50000 });
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(100);
  });

  it("shows a fairly-priced vehicle at a lower score, and suppresses when above market with no data", () => {
    const fair = scorePassportCard("market-price", { marketAvg: 50000, price: 49000 });
    expect(fair).toBeGreaterThan(0);
    expect(fair).toBeLessThan(70);
    expect(scorePassportCard("market-price", { marketAvg: 50000, price: 52000 })).toBe(0);
    expect(scorePassportCard("market-price", {})).toBe(0);
  });

  it("suppresses a comparable-vehicles card that is too thin to be credible", () => {
    expect(scorePassportCard("comparable-vehicles", { similarCount: 2, soldCount: 0 })).toBe(0);
    expect(scorePassportCard("comparable-vehicles", { similarCount: 12 })).toBeGreaterThan(0);
  });

  it("only shows price history on an actual drop", () => {
    expect(scorePassportCard("price-history", { priceDrop: 0 })).toBe(0);
    expect(scorePassportCard("price-history", { priceDrop: 800 })).toBeGreaterThan(0);
  });

  it("ranks warranty strength included > cpo > factory > available > none", () => {
    const s = (w: CardSignals["warrantyStrength"]) => scorePassportCard("factory-warranty", { warrantyStrength: w });
    expect(s(4)).toBeGreaterThan(s(3));
    expect(s(3)).toBeGreaterThan(s(2));
    expect(s(2)).toBeGreaterThan(s(1));
    expect(s(1)).toBeGreaterThan(s(0));
    expect(s(0)).toBe(0);
  });

  it("suppresses price confidence and demand when their backing data is absent", () => {
    expect(scorePassportCard("price-confidence", {})).toBe(0);
    expect(scorePassportCard("price-confidence", { ratingOverall: 90 })).toBeGreaterThan(0);
    expect(scorePassportCard("market-demand", { demandPartsCount: 0 })).toBe(0);
    expect(scorePassportCard("market-demand", { demandPartsCount: 3 })).toBeGreaterThan(0);
  });
});

describe("selectCards — rank, cap, and dealer override", () => {
  const cands = (): CardCandidate[] => [
    { key: "market-price", score: 90 },
    { key: "factory-warranty", score: 66 },
    { key: "comparable-vehicles", score: 55 },
    { key: "price-confidence", score: 76 },
    { key: "market-demand", score: 40 },
    { key: "price-history", score: 70 },
  ];

  it("ranks by score descending and returns display order", () => {
    const out = selectCards(cands(), { max: 7 }).map((c) => c.key);
    expect(out[0]).toBe("market-price");
    expect(out).toEqual(["market-price", "price-confidence", "price-history", "factory-warranty", "comparable-vehicles", "market-demand"]);
  });

  it("caps at max, keeping the strongest", () => {
    const out = selectCards(cands(), { max: 3 }).map((c) => c.key);
    expect(out).toHaveLength(3);
    expect(out).toEqual(["market-price", "price-confidence", "price-history"]);
  });

  it("drops cards the dealer explicitly hid", () => {
    const out = selectCards(cands(), { max: 7, override: (k) => (k === "market-price" ? false : undefined) }).map((c) => c.key);
    expect(out).not.toContain("market-price");
  });

  it("force-includes a dealer-pinned card even when it scores below the cutline", () => {
    const out = selectCards(cands(), {
      max: 2,
      override: (k) => (k === "market-demand" ? true : undefined),
    }).map((c) => c.key);
    // market-demand (score 40) is pinned, so it takes a slot ahead of higher-scored auto cards.
    expect(out).toContain("market-demand");
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("market-demand");
  });

  it("suppresses zero/low-score auto cards below the floor", () => {
    const out = selectCards([{ key: "market-price", score: 0 }, { key: "price-history", score: 70 }], { max: 7 }).map((c) => c.key);
    expect(out).toEqual(["price-history"]);
  });

  it("dedupes if a key appears twice", () => {
    const out = selectCards([{ key: "market-price", score: 90 }, { key: "market-price", score: 50 }], { max: 7 });
    expect(out).toHaveLength(1);
  });
});
