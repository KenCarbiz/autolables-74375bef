import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// ── The ledger has to be reachable ───────────────────────────────────
//
// computeCost was written, tested, and imported by nothing. So was the table
// it was designed for: description_model_executions has existed since
// 20260727225826, its cost_state CHECK matches this module's CostState union
// exactly, and it held zero rows. The provider adapter has always returned
// exact usage -- input, output, cached and reasoning tokens -- and the
// orchestrator dropped every one of them. A lot of 271 vehicles could be
// regenerated over and over with no record of what it cost, how often the
// cached prefix hit, or how much of the output budget went to reasoning
// instead of copy.

const orchestrator = readFileSync(join(__dirname,
  "../../../supabase/functions/description-orchestrate/index.ts"), "utf8");
const schemaMigration = readFileSync(join(__dirname,
  "../../../supabase/migrations/20260727225826_45d55384-f3ae-4467-8408-98de83e49b38.sql"), "utf8");

describe("generation spend is actually recorded", () => {
  it("is imported and called by the orchestrator", () => {
    expect(orchestrator).toMatch(
      /import \{ computeCost, type CostRecord \} from "\.\.\/_shared\/description-cost\.ts"/);
    expect(orchestrator).toMatch(/computeCost\(args\.model/);
  });

  it("records the call that truncated, which is the expensive one", () => {
    // A structured response that runs out of budget has already spent the
    // whole allowance -- mostly on reasoning tokens, billed as output -- and
    // then throws. Recording only successes would hide exactly those.
    const fn = orchestrator.slice(
      orchestrator.indexOf("async function generateMaster("),
      orchestrator.indexOf("// ── The pipeline for a single vehicle"));
    expect(fn.length).toBeGreaterThan(400);
    expect(fn.split("recordExecution(").length - 1).toBe(3); // transport, truncation, success
    // The record is written BEFORE the throw, or it is not written at all.
    expect(fn.indexOf('errorCode: "structured_output_missing"'))
      .toBeLessThan(fn.indexOf('throw Object.assign(new Error("structured_output_missing")'));
  });

  it("writes the columns the table actually has", () => {
    // The table predates this wiring. Writing the shape I would have designed
    // -- purpose, succeeded, cost_currency -- would have failed on every
    // insert, and the helper swallows its own errors, so nothing would have
    // surfaced: the ledger would simply have stayed empty a second time.
    const helper = orchestrator.slice(
      orchestrator.indexOf("async function recordExecution("),
      orchestrator.indexOf("/**\n * The DriveSignal path."));
    for (const col of ["execution_kind", "outcome", "currency", "cost_state",
                       "cost_may_have_occurred", "error_category", "completed_at",
                       "cached_input_tokens", "reasoning_tokens"]) {
      expect(helper).toContain(`${col}:`);
    }
    expect(helper).not.toContain("purpose:");
    expect(helper).not.toContain("succeeded:");
    expect(helper).not.toContain("cost_currency:");
  });

  it("uses only values the CHECK constraints allow", () => {
    const helper = orchestrator.slice(
      orchestrator.indexOf("async function recordExecution("),
      orchestrator.indexOf("/**\n * The DriveSignal path."));
    expect(helper).toMatch(/kind: "generation" \| "repair" \| "fallback" \| "preview" \| "evaluation"/);
    expect(helper).toMatch(/outcome: "succeeded" \| "failed" \| "timeout"/);
    // Every CostState this module can emit is accepted by the column.
    expect(schemaMigration).toContain("'provider_reported'");
    expect(schemaMigration).toContain("'calculated_estimate'");
    expect(schemaMigration).toContain("'unavailable'");
    expect(schemaMigration).toContain("'reconciled'");
  });

  it("ties the version and the call together in both directions", () => {
    // description_versions.model_execution_id and
    // description_model_executions.version_id both existed and both pointed
    // at nothing.
    expect(orchestrator).toMatch(/model_execution_id: generation\.executionId/);
    expect(orchestrator).toMatch(/\.update\(\{ version_id: version\.id \}\)\.eq\("id", generation\.executionId\)/);
  });

  it("never lets accounting break a generation", () => {
    const helper = orchestrator.slice(
      orchestrator.indexOf("async function recordExecution("),
      orchestrator.indexOf("/**\n * The DriveSignal path."));
    expect(helper).toMatch(/catch \{\s*\n?\s*return null;/);
  });

  it("marks a failed call as possibly billed anyway", () => {
    const helper = orchestrator.slice(
      orchestrator.indexOf("async function recordExecution("),
      orchestrator.indexOf("/**\n * The DriveSignal path."));
    expect(helper).toMatch(/cost_may_have_occurred: true/);
  });

  it("reports the configured model honestly when it has no price", () => {
    // Production runs gpt-5.6-luna, which is not in the table. The tokens are
    // still exact; the dollars are unknown, and unknown is not zero.
    const r = computeCost("gpt-5.6-luna", { inputTokens: 12_000, outputTokens: 4_000 });
    expect(r.state).toBe("unavailable");
    expect(r.amount).toBeNull();
    expect(r.note).toContain("gpt-5.6-luna");
  });
});
