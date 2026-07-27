import { describe, it, expect } from "vitest";
import {
  PRICING_TABLE_VERSION, PRICING_TABLE, pricingFor, computeCost, estimateTokens,
  estimateRequestCost, sumCost, type CostRecord,
} from "../../../supabase/functions/_shared/description-cost";

// These tests pin the money-safety rules: what may be called a charge, what
// must stay null, and what a total is allowed to hide.

const usage = (inputTokens: number | null, outputTokens: number | null) =>
  ({ inputTokens, outputTokens });

describe("pricing table", () => {
  it("covers every model key the edge function can send", () => {
    for (const key of ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5"]) {
      expect(pricingFor(key)).toBeDefined();
    }
  });

  it("prices every entry in USD with a non-zero rate", () => {
    for (const p of PRICING_TABLE) {
      expect(p.currency).toBe("USD");
      expect(p.inputPerMillion).toBeGreaterThan(0);
      expect(p.outputPerMillion).toBeGreaterThan(0);
    }
  });
});

describe("cost math for a known model", () => {
  it("prices input and output at the table rate", () => {
    const record = computeCost("claude-opus-5", usage(200_000, 40_000));
    expect(record.state).toBe("calculated_estimate");
    expect(record.amount).toBeCloseTo(2, 6);
    expect(record.currency).toBe("USD");
    expect(record.provider).toBe("anthropic");
  });

  it("prices cached input as an addition, not a discount", () => {
    const plain = computeCost("claude-haiku-4-5", usage(100_000, 0));
    const cached = computeCost("claude-haiku-4-5", {
      inputTokens: 100_000, outputTokens: 0, cachedInputTokens: 1_000_000,
    });
    expect(plain.amount).toBeCloseTo(0.1, 6);
    expect(cached.amount).toBeCloseTo(0.2, 6);
  });

  it("scales with the model tier", () => {
    const haiku = computeCost("claude-haiku-4-5", usage(1_000_000, 1_000_000)).amount!;
    const sonnet = computeCost("claude-sonnet-5", usage(1_000_000, 1_000_000)).amount!;
    const opus = computeCost("claude-opus-5", usage(1_000_000, 1_000_000)).amount!;
    expect(haiku).toBeCloseTo(6, 6);
    expect(sonnet).toBeCloseTo(18, 6);
    expect(opus).toBeCloseTo(30, 6);
  });
});

describe("unknown model", () => {
  it("is unavailable with a null amount rather than a guessed price", () => {
    const record = computeCost("some-model-we-never-shipped", usage(1000, 1000));
    expect(record.state).toBe("unavailable");
    expect(record.amount).toBeNull();
    expect(record.note).toContain(PRICING_TABLE_VERSION);
  });
});

describe("missing token counts", () => {
  it("is pending, not zero cost", () => {
    const record = computeCost("claude-opus-5", usage(null, null));
    expect(record.state).toBe("pending");
    expect(record.amount).toBeNull();
    expect(record.amount).not.toBe(0);
  });

  it("is pending when only the output count is missing", () => {
    expect(computeCost("claude-opus-5", usage(1000, null)).state).toBe("pending");
  });
});

describe("provider-reported cost", () => {
  it("beats the calculated estimate for the same usage", () => {
    const estimated = computeCost("claude-opus-5", usage(200_000, 40_000));
    const reported = computeCost("claude-opus-5", usage(200_000, 40_000), 1.7345);
    expect(estimated.state).toBe("calculated_estimate");
    expect(reported.state).toBe("provider_reported");
    expect(reported.amount).toBe(1.7345);
    expect(reported.amount).not.toBe(estimated.amount);
  });

  it("stands even when the model is missing from the table", () => {
    const record = computeCost("some-model-we-never-shipped", usage(null, null), 0.9);
    expect(record.state).toBe("provider_reported");
    expect(record.amount).toBe(0.9);
  });

  it("does not treat a null report as a charge", () => {
    expect(computeCost("claude-opus-5", usage(1000, 1000), null).state).toBe("calculated_estimate");
  });
});

describe("pre-request estimate", () => {
  it("is labeled an estimate", () => {
    const record = estimateRequestCost("claude-haiku-4-5", "a".repeat(4000), 600);
    expect(record.state).toBe("calculated_estimate");
    expect(record.note).toMatch(/estimat/i);
    expect(record.amount).toBeGreaterThan(0);
  });

  it("stays unavailable for a model with no published price", () => {
    const record = estimateRequestCost("mystery-model", "hello", 100);
    expect(record.state).toBe("unavailable");
    expect(record.amount).toBeNull();
  });
});

describe("token estimate", () => {
  it("is monotonic in length", () => {
    let previous = -1;
    for (const length of [0, 1, 3, 4, 5, 40, 400, 4000]) {
      const n = estimateTokens("x".repeat(length));
      expect(n).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
  });

  it("tracks roughly four characters per token", () => {
    expect(estimateTokens("x".repeat(4000))).toBe(1000);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("pricing version", () => {
  it("is stored on every record so a later price change cannot rewrite history", () => {
    const records = [
      computeCost("claude-opus-5", usage(10, 10)),
      computeCost("claude-opus-5", usage(null, null)),
      computeCost("mystery-model", usage(10, 10)),
      computeCost("claude-opus-5", usage(10, 10), 0.5),
      estimateRequestCost("claude-opus-5", "hello", 10),
    ];
    for (const record of records) {
      expect(record.pricingVersion).toBe(PRICING_TABLE_VERSION);
    }
  });
});

describe("sumCost", () => {
  it("totals only the amounts it actually has", () => {
    const total = sumCost([
      computeCost("claude-opus-5", usage(200_000, 40_000), 1.5),
      computeCost("claude-opus-5", usage(200_000, 40_000), 0.5),
    ]);
    expect(total.total).toBeCloseTo(2, 6);
    expect(total.currency).toBe("USD");
    expect(total.anyEstimated).toBe(false);
    expect(total.anyUnavailable).toBe(false);
  });

  it("flags that an estimate is inside the total", () => {
    const total = sumCost([
      computeCost("claude-opus-5", usage(200_000, 40_000), 1.5),
      computeCost("claude-haiku-4-5", usage(1_000_000, 0)),
    ]);
    expect(total.anyEstimated).toBe(true);
    expect(total.total).toBeCloseTo(2.5, 6);
  });

  it("flags unavailable and pending records that are missing from the total", () => {
    const unavailable = sumCost([
      computeCost("claude-opus-5", usage(200_000, 40_000), 1.5),
      computeCost("mystery-model", usage(10, 10)),
    ]);
    expect(unavailable.anyUnavailable).toBe(true);
    expect(unavailable.total).toBeCloseTo(1.5, 6);

    const pending = sumCost([
      computeCost("claude-opus-5", usage(200_000, 40_000), 1.5),
      computeCost("claude-opus-5", usage(null, null)),
    ]);
    expect(pending.anyUnavailable).toBe(true);
    expect(pending.total).toBeCloseTo(1.5, 6);
  });

  it("returns a zero USD total for an empty ledger without claiming anything", () => {
    expect(sumCost([])).toEqual({
      total: 0, currency: "USD", anyEstimated: false, anyUnavailable: false,
    });
  });

  it("refuses to add two currencies together", () => {
    const usd = computeCost("claude-opus-5", usage(200_000, 40_000), 1.5);
    const eur: CostRecord = { ...usd, currency: "EUR" };
    expect(() => sumCost([usd, eur])).toThrow(/currenc/i);
  });
});
