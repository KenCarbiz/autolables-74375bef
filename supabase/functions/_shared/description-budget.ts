// ─────────────────────────────────────────────────────────────────────
// Tenant AI cost governance (Phase 7 §22).
//
// Every check here runs SERVER-SIDE and BEFORE the provider is called. A
// "blocked" verdict means no token was ever spent, which is the only point at
// which spend is still preventable — a budget consulted after the call is a
// report, not a control.
//
// The single most dangerous mistake in this file is treating a null budget as
// zero. Null means "not configured / unlimited". Read backwards, it would
// block every generation for every tenant that never opened the budget screen.
// ─────────────────────────────────────────────────────────────────────

export interface TenantBudgetConfig {
  monthlyGenerationBudget: number | null;
  monthlyPreviewBudget: number | null;
  maxCostPerGeneration: number | null;
  maxRepairAttempts: number;
  maxChannelsPerBatch: number;
  dailyGenerationLimit: number | null;
  perUserDailyLimit: number | null;
  warningThresholdPct: number;
  hardStopPct: number;
}

// Mirrors the column defaults in 20260906221500_tenant_budget_150.sql. This is
// the fallback for a tenant with no budget row, so a divergence here quietly
// gives that tenant a different budget from every tenant that has a row.
export const DEFAULT_BUDGET: TenantBudgetConfig = {
  monthlyGenerationBudget: 135,
  monthlyPreviewBudget: 15,
  maxCostPerGeneration: 0.5,
  maxRepairAttempts: 2,
  maxChannelsPerBatch: 8,
  dailyGenerationLimit: 250,
  perUserDailyLimit: 100,
  warningThresholdPct: 80,
  hardStopPct: 100,
};

export interface BudgetUsage {
  monthProductionSpend: number;
  monthPreviewSpend: number;
  todayGenerationCount: number;
  userTodayGenerationCount: number;
  /**
   * Calls this month whose cost is not known -- the model has no entry in the
   * pricing table, or the provider reported no usage. Their spend is missing
   * from monthProductionSpend, so a dollar budget read on its own would
   * report $0 forever and never bind. See unpricedCallCeiling.
   */
  unpricedExecutions?: number;
  /** Production calls this month, priced or not. */
  monthGenerationCount?: number;
}

export type BudgetVerdict = "allowed" | "warning" | "blocked";

export type BudgetLimitCode =
  | "max_cost_per_generation"
  | "daily_generation_limit"
  | "per_user_daily_limit"
  | "monthly_generation_budget"
  | "monthly_preview_budget"
  | "unpriced_call_ceiling";

export interface BudgetDecision {
  verdict: BudgetVerdict;
  withinBudget: boolean;
  reason?: string;
  consumedPct: number | null;
  remaining: number | null;
  triggeredLimits: string[];
}

export interface BudgetRequest {
  isPreview: boolean;
  estimatedCost: number | null;
}

const LIMIT_LABELS: Record<BudgetLimitCode, string> = {
  max_cost_per_generation: "This request exceeds the per-generation cost cap.",
  daily_generation_limit: "The dealership has reached its daily generation limit.",
  per_user_daily_limit: "This user has reached their daily generation limit.",
  monthly_generation_budget: "The monthly generation budget is exhausted.",
  monthly_preview_budget: "The monthly preview budget is exhausted.",
  unpriced_call_ceiling: "The configured model has no price on file, so spend cannot be measured. Generation is capped at the most calls the monthly budget could possibly afford.",
};

export const describeLimit = (code: string): string =>
  LIMIT_LABELS[code as BudgetLimitCode] ?? "A spending limit was reached.";

/** Null, negative and non-finite all mean "no limit configured". */
const configured = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * The most production calls the monthly budget could possibly afford, used
 * when spend cannot be measured because some calls this month are unpriced.
 *
 * A dollar budget summed over NULL costs reports $0 and never binds, so an
 * unpriced model silently disables the very control that exists to stop
 * runaway spend. Blocking outright would be the other failure -- it would stop
 * all work over a missing table row. Instead the budget is converted into the
 * only bound that holds without knowing the real price: budget divided by the
 * per-generation worst case the dealer has already configured. It cannot
 * overspend, because no single call may exceed that cap either.
 *
 * Returns null when it does not apply: nothing unpriced, or no budget / no
 * per-call cap configured, in which case there is nothing to derive from.
 */
export function unpricedCallCeiling(
  cfg: TenantBudgetConfig, usage: BudgetUsage, isPreview: boolean,
): number | null {
  if (!(Number(usage.unpricedExecutions) > 0)) return null;
  const budget = budgetFor(cfg, isPreview);
  if (!configured(budget) || budget === 0) return null;
  if (!configured(cfg.maxCostPerGeneration) || cfg.maxCostPerGeneration <= 0) return null;
  return Math.floor(budget / cfg.maxCostPerGeneration);
}

/**
 * Which specific limits a request trips, so the UI can name the limit instead
 * of saying "over budget" and leaving the dealer to guess which knob to turn.
 */
export function collectTriggeredLimits(
  cfg: TenantBudgetConfig, usage: BudgetUsage, req: BudgetRequest,
): BudgetLimitCode[] {
  const out: BudgetLimitCode[] = [];
  const estimate = configured(req.estimatedCost) ? req.estimatedCost : 0;

  // Independent of the monthly pool: one pathological request must not be
  // waved through just because the month happens to have room left.
  if (configured(cfg.maxCostPerGeneration) && estimate > cfg.maxCostPerGeneration) {
    out.push("max_cost_per_generation");
  }
  // A preview still consumes a provider call, so the count caps apply to both
  // modes even though the two spend pools are kept apart.
  if (configured(cfg.dailyGenerationLimit) && usage.todayGenerationCount >= cfg.dailyGenerationLimit) {
    out.push("daily_generation_limit");
  }
  if (configured(cfg.perUserDailyLimit) && usage.userTodayGenerationCount >= cfg.perUserDailyLimit) {
    out.push("per_user_daily_limit");
  }

  const pct = consumedPctFor(cfg, usage, req);
  if (pct !== null && pct >= cfg.hardStopPct) {
    out.push(req.isPreview ? "monthly_preview_budget" : "monthly_generation_budget");
  }

  const ceiling = unpricedCallCeiling(cfg, usage, req.isPreview);
  if (ceiling !== null && Number(usage.monthGenerationCount ?? 0) >= ceiling) {
    out.push("unpriced_call_ceiling");
  }
  return out;
}

// Preview and production are separate pools. Preview traffic is exploratory and
// high-volume; letting it drain the budget that publishes real copy would stop
// the work that actually earns money.
const budgetFor = (cfg: TenantBudgetConfig, isPreview: boolean) =>
  isPreview ? cfg.monthlyPreviewBudget : cfg.monthlyGenerationBudget;

const spendFor = (usage: BudgetUsage, isPreview: boolean) =>
  isPreview ? usage.monthPreviewSpend : usage.monthProductionSpend;

function consumedPctFor(
  cfg: TenantBudgetConfig, usage: BudgetUsage, req: BudgetRequest,
): number | null {
  const budget = budgetFor(cfg, req.isPreview);
  if (!configured(budget)) return null;
  const projected = spendFor(usage, req.isPreview) + (configured(req.estimatedCost) ? req.estimatedCost : 0);
  if (budget === 0) return 100;
  return (projected / budget) * 100;
}

export function evaluateBudget(
  cfg: TenantBudgetConfig, usage: BudgetUsage, req: BudgetRequest,
): BudgetDecision {
  const budget = budgetFor(cfg, req.isPreview);
  const consumedPct = consumedPctFor(cfg, usage, req);
  const remaining = configured(budget)
    ? Math.max(0, budget - spendFor(usage, req.isPreview))
    : null;

  const triggeredLimits = collectTriggeredLimits(cfg, usage, req);
  if (triggeredLimits.length) {
    return {
      verdict: "blocked", withinBudget: false, reason: describeLimit(triggeredLimits[0]),
      consumedPct, remaining, triggeredLimits,
    };
  }

  // A warning is advisory only. Flipping withinBudget here would stop a
  // dealership from merchandising cars while it still has budget left.
  if (consumedPct !== null && consumedPct >= cfg.warningThresholdPct) {
    return {
      verdict: "warning", withinBudget: true,
      reason: `${Math.round(consumedPct)}% of the monthly budget is consumed.`,
      consumedPct, remaining, triggeredLimits: [],
    };
  }

  return { verdict: "allowed", withinBudget: true, consumedPct, remaining, triggeredLimits: [] };
}

export interface BudgetOverride {
  permitted: boolean;
  reason: string;
  actorRole: string;
}

/**
 * Spending past a hard stop is a money decision, so it needs a named human and
 * a stated reason. An override with no reason is unauditable, which is the same
 * as no control at all when the invoice is questioned later.
 */
export function evaluateBudgetOverride(
  req: { reason: string; hasPermission: boolean },
): { allowed: boolean; error?: string } {
  if (!req.hasPermission) return { allowed: false, error: "insufficient_permission" };
  if (!req.reason || req.reason.trim().length < 10) {
    return { allowed: false, error: "reason_required" };
  }
  return { allowed: true };
}
