import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeCost, parsePricingOverrides, registerPricing, clearPricingOverrides,
  pricingFor, isPriced, PRICING_TABLE, PRICING_TABLE_VERSION, PRICING_OVERRIDE_VERSION,
} from "./description-cost";
import {
  coerceBudgetConfig, parseSpendUsage, withUsageFloor, budgetUnavailable,
  evaluateBudget, DEFAULT_BUDGET, collectTriggeredLimits,
} from "./description-budget";

// The two halves of one defect: 506 calls made against a 500/day hard stop
// that never refused, on a ledger where every row recorded an unknown cost
// that summed to zero. These pin the fixes for both.

afterEach(() => clearPricingOverrides());

const orchestrator = readFileSync(
  join(__dirname, "../description-orchestrate/index.ts"), "utf8");

describe("operator-supplied pricing", () => {
  it("prices a model the built-in table has never heard of", () => {
    expect(computeCost("gpt-5.6-luna", { inputTokens: 1_000_000, outputTokens: 1_000_000 }).amount)
      .toBeNull();

    registerPricing(parsePricingOverrides(JSON.stringify([{
      model: "gpt-5.6-luna", provider: "openai",
      inputPerMillion: 2, outputPerMillion: 8, effectiveFrom: "2026-09-01",
    }])).entries);

    const record = computeCost("gpt-5.6-luna", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(record.state).toBe("calculated_estimate");
    expect(record.amount).toBeCloseTo(10, 6);
    expect(record.provider).toBe("openai");
    expect(isPriced("gpt-5.6-luna")).toBe(true);
  });

  it("stamps an overridden record with the override's own pricing version", () => {
    registerPricing(parsePricingOverrides(JSON.stringify([{
      model: "gpt-5.6-luna", inputPerMillion: 1, outputPerMillion: 1,
    }])).entries);
    expect(computeCost("gpt-5.6-luna", { inputTokens: 10, outputTokens: 10 }).pricingVersion)
      .toBe(PRICING_OVERRIDE_VERSION);
    // An untouched model still reports the table it was priced from.
    expect(computeCost("claude-opus-5", { inputTokens: 10, outputTokens: 10 }).pricingVersion)
      .toBe(PRICING_TABLE_VERSION);
  });

  it("refuses a zero rate, because a zero is a claim the call was free", () => {
    const parsed = parsePricingOverrides(JSON.stringify([
      { model: "free-lunch", inputPerMillion: 0, outputPerMillion: 0 },
      { model: "negative", inputPerMillion: -1, outputPerMillion: 2 },
      { model: "", inputPerMillion: 1, outputPerMillion: 1 },
      { model: "euros", inputPerMillion: 1, outputPerMillion: 1, currency: "EUR" },
    ]));
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.errors).toHaveLength(4);
    registerPricing(parsed.entries);
    expect(computeCost("free-lunch", { inputTokens: 10, outputTokens: 10 }).amount).toBeNull();
  });

  it("survives a malformed configuration without throwing or pricing anything", () => {
    const parsed = parsePricingOverrides("{not json");
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.errors[0]).toContain("not valid JSON");
    expect(parsePricingOverrides("").errors).toHaveLength(0);
    expect(parsePricingOverrides(null).entries).toHaveLength(0);
  });

  it("leaves the built-in table alone so a bad override cannot rewrite it", () => {
    const before = PRICING_TABLE.length;
    registerPricing(parsePricingOverrides(JSON.stringify([
      { model: "claude-opus-5", inputPerMillion: 999, outputPerMillion: 999 },
    ])).entries);
    expect(PRICING_TABLE).toHaveLength(before);
    expect(PRICING_TABLE.find((p) => p.model === "claude-opus-5")!.inputPerMillion).toBe(5);
    // The override still wins for what is charged now — a published price that
    // has moved is the reason this exists.
    expect(pricingFor("claude-opus-5")!.inputPerMillion).toBe(999);
    clearPricingOverrides();
    expect(pricingFor("claude-opus-5")!.inputPerMillion).toBe(5);
  });
});

describe("budget config read from a database row", () => {
  it("binds when Postgres numerics arrive as strings", () => {
    // numeric(12,2) can reach the edge function as "135.00". A typeof check
    // against that string reports "not configured", which silently switches
    // off the dollar budget and the per-generation cap together.
    const cfg = coerceBudgetConfig({
      monthly_generation_budget: "135.00", monthly_preview_budget: "15.00",
      max_cost_per_generation: "0.1000", daily_generation_limit: 500,
      per_user_daily_limit: null, warning_threshold_pct: 80, hard_stop_pct: 100,
    });
    expect(cfg.monthlyGenerationBudget).toBe(135);
    expect(cfg.maxCostPerGeneration).toBe(0.1);
    expect(cfg.perUserDailyLimit).toBeNull();

    const decision = evaluateBudget(cfg, {
      monthProductionSpend: 140, monthPreviewSpend: 0,
      todayGenerationCount: 1, userTodayGenerationCount: 0,
    }, { isPreview: false, estimatedCost: 0.01 });
    expect(decision.verdict).toBe("blocked");
    expect(decision.triggeredLimits).toContain("monthly_generation_budget");
  });

  it("gives a tenant with no budget row the defaults, not unlimited spend", () => {
    expect(coerceBudgetConfig(null)).toEqual(DEFAULT_BUDGET);
    expect(coerceBudgetConfig(undefined).dailyGenerationLimit).toBe(500);
  });

  it("still treats an explicit null as unlimited", () => {
    const cfg = coerceBudgetConfig({ monthly_generation_budget: null, daily_generation_limit: null });
    expect(cfg.monthlyGenerationBudget).toBeNull();
    expect(collectTriggeredLimits(cfg, {
      monthProductionSpend: 0, monthPreviewSpend: 0,
      todayGenerationCount: 10_000, userTodayGenerationCount: 0,
    }, { isPreview: false, estimatedCost: 0 })).toHaveLength(0);
  });
});

describe("spend snapshot", () => {
  it("reads the RPC payload the orchestrator receives", () => {
    const usage = parseSpendUsage({
      ok: true, month_production_spend: 0, month_preview_spend: 0,
      today_generation_count: 506, month_generation_count: 1087,
      pending_cost_executions: 1087,
    })!;
    expect(usage.todayGenerationCount).toBe(506);
    expect(usage.unpricedExecutions).toBe(1087);
    expect(collectTriggeredLimits(DEFAULT_BUDGET, usage, { isPreview: false, estimatedCost: null }))
      .toContain("daily_generation_limit");
  });

  it("returns null rather than zeros when the answer cannot be trusted", () => {
    expect(parseSpendUsage({ ok: false, error: "forbidden" })).toBeNull();
    expect(parseSpendUsage(null)).toBeNull();
    expect(parseSpendUsage("nope")).toBeNull();
    expect(parseSpendUsage({ ok: true })).toBeNull();
  });

  it("counts the calls this run already authorized but has not yet recorded", () => {
    // Execution rows are written after the provider answers, so a run in
    // flight has always spent more than the table can show. Without the floor
    // a vehicle's ten calls are all judged against the count as it stood
    // before the first of them.
    const stale = parseSpendUsage({
      ok: true, today_generation_count: 496, month_generation_count: 1000,
    })!;
    const raised = withUsageFloor(stale, { todayGenerationCount: 500, monthGenerationCount: 1004 });
    expect(raised.todayGenerationCount).toBe(500);
    expect(evaluateBudget(DEFAULT_BUDGET, stale, { isPreview: false, estimatedCost: null }).withinBudget)
      .toBe(true);
    expect(evaluateBudget(DEFAULT_BUDGET, raised, { isPreview: false, estimatedCost: null }).withinBudget)
      .toBe(false);
  });

  it("never lowers a count the caller already knows is higher", () => {
    const usage = parseSpendUsage({ ok: true, today_generation_count: 700, month_generation_count: 900 })!;
    expect(withUsageFloor(usage, { todayGenerationCount: 2, monthGenerationCount: 2 })
      .todayGenerationCount).toBe(700);
  });
});

describe("failing closed", () => {
  it("blocks when the budget cannot be evaluated at all", () => {
    const decision = budgetUnavailable("the spend function returned no usable counts");
    expect(decision.verdict).toBe("blocked");
    expect(decision.withinBudget).toBe(false);
    expect(decision.triggeredLimits).toContain("budget_unavailable");
    expect(decision.reason).toContain("refused");
  });
});

// The orchestrator is outside tsconfig's include and cannot run in a test, so
// these read the wiring the way the repo's other edge guards do.
describe("the orchestrator consults the guard before every paid call", () => {
  it("authorizes the master, the length correction and each channel", () => {
    expect(orchestrator).toContain(`guard.authorize("master_generation"`);
    expect(orchestrator).toContain(`ctx.guard.authorize("master_length_correction"`);
    expect(orchestrator).toContain("guard.authorize(`channel_generation:${key}`");
  });

  it("re-reads tenant-wide spend inside the guard rather than caching one verdict", () => {
    const guard = orchestrator.slice(
      orchestrator.indexOf("function createSpendGuard("),
      orchestrator.indexOf("const DEFAULT_SETTINGS"));
    expect(guard).toContain(`rpc(admin, "description_generation_spend"`);
    expect(guard).toContain("withUsageFloor");
    // Fail closed on every unreadable input.
    expect(guard.match(/budgetUnavailable\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("records a refusal as an exception and an audit row, never a silent skip", () => {
    const refusal = orchestrator.slice(
      orchestrator.indexOf("async function recordBudgetRefusal("),
      orchestrator.indexOf("async function setCase("));
    expect(refusal).toContain(`"generation_budget_blocked"`);
    expect(refusal).toContain(`"GENERATION_BUDGET_EXHAUSTED"`);
  });

  it("raises an exception when a call's cost cannot be measured", () => {
    expect(orchestrator).toContain(`"COST_UNMEASURED"`);
    expect(orchestrator).toContain("signalUnmeasuredCost");
    // A null amount stays null. Writing 0 is what made a month of spend
    // invisible in the first place.
    expect(orchestrator).not.toContain("cost_amount: 0");
  });

  it("passes a real per-call estimate to the cap instead of null", () => {
    expect(orchestrator).toContain("estimatedCost: masterCostEstimate.amount");
    expect(orchestrator).not.toContain("estimatedCost: null }");
  });
});
