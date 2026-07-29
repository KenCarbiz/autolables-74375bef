import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUDGET,
  evaluateBudget,
  evaluateBudgetOverride,
  collectTriggeredLimits,
  type TenantBudgetConfig,
  type BudgetUsage,
} from "../../../supabase/functions/_shared/description-budget";

const cfg = (over: Partial<TenantBudgetConfig> = {}): TenantBudgetConfig => ({
  ...DEFAULT_BUDGET,
  ...over,
});

const usage = (over: Partial<BudgetUsage> = {}): BudgetUsage => ({
  monthProductionSpend: 0,
  monthPreviewSpend: 0,
  todayGenerationCount: 0,
  userTodayGenerationCount: 0,
  ...over,
});

const production = (estimatedCost: number | null = 0.05) => ({ isPreview: false, estimatedCost });
const preview = (estimatedCost: number | null = 0.01) => ({ isPreview: true, estimatedCost });

describe("budget evaluation", () => {
  it("treats a null budget as unlimited, never as zero", () => {
    const unlimited = cfg({
      monthlyGenerationBudget: null, monthlyPreviewBudget: null,
      maxCostPerGeneration: null, dailyGenerationLimit: null, perUserDailyLimit: null,
    });
    const d = evaluateBudget(unlimited, usage({ monthProductionSpend: 9_999, todayGenerationCount: 5_000 }), production(5));
    expect(d.verdict).toBe("allowed");
    expect(d.withinBudget).toBe(true);
    expect(d.consumedPct).toBeNull();
    expect(d.remaining).toBeNull();
    expect(d.triggeredLimits).toEqual([]);
  });

  it("warns without blocking once the warning threshold is crossed", () => {
    const d = evaluateBudget(cfg({ monthlyGenerationBudget: 100, warningThresholdPct: 80 }),
      usage({ monthProductionSpend: 85 }), production(0));
    expect(d.verdict).toBe("warning");
    expect(d.withinBudget).toBe(true);
    expect(d.triggeredLimits).toEqual([]);
    expect(d.remaining).toBe(15);
  });

  it("blocks at the hard stop", () => {
    const d = evaluateBudget(cfg({ monthlyGenerationBudget: 100, hardStopPct: 100 }),
      usage({ monthProductionSpend: 100 }), production(0.5));
    expect(d.verdict).toBe("blocked");
    expect(d.withinBudget).toBe(false);
    expect(d.triggeredLimits).toContain("monthly_generation_budget");
    expect(d.remaining).toBe(0);
  });

  it("blocks an oversized single request even when the month has room", () => {
    const c = cfg({ monthlyGenerationBudget: 500, maxCostPerGeneration: 0.5 });
    const d = evaluateBudget(c, usage({ monthProductionSpend: 1 }), production(4));
    expect(d.verdict).toBe("blocked");
    expect(d.triggeredLimits).toEqual(["max_cost_per_generation"]);
    expect(d.remaining).toBe(499);

    const ok = evaluateBudget(c, usage({ monthProductionSpend: 1 }), production(0.4));
    expect(ok.verdict).toBe("allowed");
  });

  it("keeps preview spend separate from production spend", () => {
    const c = cfg({ monthlyGenerationBudget: 100, monthlyPreviewBudget: 10, maxCostPerGeneration: null });
    const exhaustedPreview = usage({ monthPreviewSpend: 10, monthProductionSpend: 0 });

    expect(evaluateBudget(c, exhaustedPreview, preview(0)).verdict).toBe("blocked");
    expect(evaluateBudget(c, exhaustedPreview, preview(0)).triggeredLimits).toContain("monthly_preview_budget");
    expect(evaluateBudget(c, exhaustedPreview, production(0)).verdict).toBe("allowed");

    const exhaustedProduction = usage({ monthProductionSpend: 100, monthPreviewSpend: 0 });
    expect(evaluateBudget(c, exhaustedProduction, production(0)).verdict).toBe("blocked");
    expect(evaluateBudget(c, exhaustedProduction, preview(0)).verdict).toBe("allowed");
  });

  it("blocks on the daily generation count", () => {
    const c = cfg({ dailyGenerationLimit: 20, monthlyGenerationBudget: null });
    expect(evaluateBudget(c, usage({ todayGenerationCount: 19 }), production()).verdict).toBe("allowed");
    const d = evaluateBudget(c, usage({ todayGenerationCount: 20 }), production());
    expect(d.verdict).toBe("blocked");
    expect(d.triggeredLimits).toEqual(["daily_generation_limit"]);
  });

  it("blocks on the per-user daily limit while the dealership still has room", () => {
    const c = cfg({ dailyGenerationLimit: 500, perUserDailyLimit: 5, monthlyGenerationBudget: null });
    const d = evaluateBudget(c, usage({ todayGenerationCount: 40, userTodayGenerationCount: 5 }), production());
    expect(d.verdict).toBe("blocked");
    expect(d.triggeredLimits).toEqual(["per_user_daily_limit"]);
  });

  it("names every limit that triggered, not just the first", () => {
    const c = cfg({
      monthlyGenerationBudget: 10, maxCostPerGeneration: 0.25,
      dailyGenerationLimit: 3, perUserDailyLimit: 2,
    });
    const limits = collectTriggeredLimits(
      c,
      usage({ monthProductionSpend: 10, todayGenerationCount: 3, userTodayGenerationCount: 2 }),
      production(1),
    );
    expect(limits).toEqual([
      "max_cost_per_generation",
      "daily_generation_limit",
      "per_user_daily_limit",
      "monthly_generation_budget",
    ]);
  });

  it("reports a reason naming the limit that was hit", () => {
    const d = evaluateBudget(cfg({ maxCostPerGeneration: 0.1 }), usage(), production(9));
    expect(d.reason).toMatch(/per-generation/i);
  });
});

describe("budget override", () => {
  it("requires an explicit permission", () => {
    const r = evaluateBudgetOverride({ reason: "Month-end delivery push approved by the GM.", hasPermission: false });
    expect(r.allowed).toBe(false);
    expect(r.error).toBe("insufficient_permission");
  });

  it("requires a real stated reason", () => {
    expect(evaluateBudgetOverride({ reason: "", hasPermission: true })).toEqual({
      allowed: false, error: "reason_required",
    });
    expect(evaluateBudgetOverride({ reason: "   ok    ", hasPermission: true }).error).toBe("reason_required");
    expect(evaluateBudgetOverride({ reason: "too short", hasPermission: true }).error).toBe("reason_required");
  });

  it("allows a permitted override with an auditable reason", () => {
    const r = evaluateBudgetOverride({ reason: "Month-end delivery push approved by the GM.", hasPermission: true });
    expect(r.allowed).toBe(true);
    expect(r.error).toBeUndefined();
  });
});
