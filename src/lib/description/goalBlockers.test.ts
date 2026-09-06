import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  withRequiredDisclosure,
} from "../../../supabase/functions/_shared/description-core.ts";
import {
  evaluateBudget, collectTriggeredLimits, unpricedCallCeiling,
  DEFAULT_BUDGET, type TenantBudgetConfig, type BudgetUsage,
} from "../../../supabase/functions/_shared/description-budget.ts";

// The batch of six generated cleanly and published nothing. These are the
// three blockers it exposed, plus the budget control that could not have
// stopped a runaway even if one had happened.

const fnDir = join(__dirname, "../../../supabase/functions");
const core = readFileSync(join(fnDir, "_shared/description-core.ts"), "utf8");
const orch = readFileSync(join(fnDir, "description-orchestrate/index.ts"), "utf8");

// ── 1. The disclosure the writer was never given ─────────────────────

describe("the required legal disclosure reaches the copy", () => {
  const LEGAL = "Prices do not include tax, title, registration, and Negotiable Dealer Conveyance Fee. Dealer Conveyance Fee is equal to $895.";
  const settings = { required_legal_text: LEGAL };

  it("appends it verbatim", () => {
    // buildMasterPromptV3 never carried required_legal_text -- only the legacy
    // buildMasterPrompt did -- while the validator blocks on its absence with a
    // literal includes(). Every vehicle on the lot failed
    // REQUIRED_DISCLOSURE_MISSING on copy that had no way to include it.
    const out = withRequiredDisclosure("Great truck.", settings);
    expect(out).toContain(LEGAL);
    expect(out.endsWith(LEGAL)).toBe(true);
  });

  it("is not asked of the model", () => {
    // The text names an $895 fee and is matched literally. A model that
    // paraphrases one character both fails the check and misstates a fee in
    // published copy, so it is appended rather than written.
    expect(core).toMatch(/A required legal disclosure is appended verbatim after your text/);
    expect(core).toMatch(/do not close with your own note about taxes, fees, financing terms or price exclusions/);
  });

  it("never stacks on a regeneration or a repair", () => {
    const once = withRequiredDisclosure("Great truck.", settings);
    expect(withRequiredDisclosure(once, settings)).toBe(once);
    expect(once.split("$895").length - 1).toBe(1);
  });

  it("leaves copy alone when no disclosure is configured", () => {
    expect(withRequiredDisclosure("Great truck.", {})).toBe("Great truck.");
    expect(withRequiredDisclosure("Great truck.", { required_legal_text: "  " })).toBe("Great truck.");
  });

  it("is applied before the version row is written, not at render time", () => {
    // Appending after the insert would store copy that differs from the copy
    // that was validated -- the worse of the two failures.
    const decl = orch.indexOf("const masterText = withRequiredDisclosure(generation.text, settings)");
    const insert = orch.indexOf("content: masterText, word_count:");
    expect(decl).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(decl);
    // And every channel variant carries it too.
    expect(orch).toMatch(/content = withRequiredDisclosure\(content, settings\)/);
  });
});

// ── 2. A conflict the copy cannot express ────────────────────────────

describe("a source conflict blocks only what the copy can assert", () => {
  it("warns, not blocks, when the fact was withheld", () => {
    // Every CPO vehicle on this lot has one: the feed says "CPO", the CPO
    // program source says "unconfirmed". The snapshot already resolves that
    // conservatively -- cpo_status is withheld from the writer, and the
    // CPO_CLAIM check independently blocks any copy that says "certified".
    // Blocking again on the same disagreement refused descriptions that say
    // nothing about certification at all.
    const rule = core.slice(core.indexOf("// 10. Unresolved material conflicts"),
                            core.indexOf("* Deterministic claim validation for V3"));
    expect(rule.length).toBeGreaterThan(200);
    expect(rule).toMatch(/const reached = snap\.facts\[c\.field\] !== undefined/);
    expect(rule).toMatch(/severity: reached \? "blocking" : "warning"/);
    expect(rule).toMatch(/blocking: reached/);
  });

  it("still blocks when the writer did receive the conflicted value", () => {
    // The copy may be built on the wrong one of two values.
    const rule = core.slice(core.indexOf("// 10. Unresolved material conflicts"),
                            core.indexOf("* Deterministic claim validation for V3"));
    expect(rule).not.toMatch(/severity: "blocking", blocking: true/);
  });

  it("keeps routing it to a human, since the source data is still wrong", () => {
    // SOURCE_CONFLICT_UNRESOLVED is in decideEligibility's MATERIAL set, so a
    // warning still pulls the vehicle into review under EXCEPTION_REVIEW.
    expect(core).toMatch(/"LOW_FACT_CONFIDENCE", "IDENTITY_YEAR_MISSING", "SOURCE_CONFLICT_UNRESOLVED"/);
  });
});

// ── 3. A budget that could not bind ──────────────────────────────────

describe("the monthly budget binds even with no price on file", () => {
  const cfg: TenantBudgetConfig = {
    ...DEFAULT_BUDGET,
    monthlyGenerationBudget: 90, monthlyPreviewBudget: 10,
    maxCostPerGeneration: 0.5,
  };
  const usage = (over: Partial<BudgetUsage> = {}): BudgetUsage => ({
    monthProductionSpend: 0, monthPreviewSpend: 0,
    todayGenerationCount: 0, userTodayGenerationCount: 0, ...over,
  });

  it("derives the ceiling from the budget and the per-call cap", () => {
    // $90 at a $0.50 worst case per call is 180 calls the budget can afford.
    expect(unpricedCallCeiling(cfg, usage({ unpricedExecutions: 6 }), false)).toBe(180);
  });

  it("does not apply when every call this month is priced", () => {
    expect(unpricedCallCeiling(cfg, usage({ unpricedExecutions: 0 }), false)).toBeNull();
  });

  it("blocks once the derived ceiling is reached", () => {
    const d = evaluateBudget(cfg, usage({ unpricedExecutions: 180, monthGenerationCount: 180 }),
      { isPreview: false, estimatedCost: null });
    expect(d.triggeredLimits).toContain("unpriced_call_ceiling");
    expect(d.withinBudget).toBe(false);
  });

  it("allows the work below it", () => {
    // The failure to avoid is blocking a whole lot over a missing table row.
    const d = evaluateBudget(cfg, usage({ unpricedExecutions: 6, monthGenerationCount: 6 }),
      { isPreview: false, estimatedCost: null });
    expect(d.triggeredLimits).not.toContain("unpriced_call_ceiling");
    expect(d.withinBudget).toBe(true);
  });

  it("reported zero spend forever before this", () => {
    // SUM over NULL cost_amount is 0, so the $90 budget read 0% consumed no
    // matter how many vehicles ran. The dollar arm was silently disabled.
    const d = evaluateBudget(cfg, usage({ monthProductionSpend: 0 }),
      { isPreview: false, estimatedCost: null });
    expect(d.consumedPct).toBe(0);
  });

  it("is actually consulted by the orchestrator", () => {
    expect(orch).toMatch(/unpricedExecutions: Number\(\(spend as any\)\?\.pending_cost_executions/);
    expect(orch).toMatch(/monthGenerationCount: Number\(\(spend as any\)\?\.month_generation_count/);
  });

  it("has the count it divides against", () => {
    const mig = readFileSync(join(fnDir,
      "../migrations/20260906213000_description_spend_unpriced.sql"), "utf8");
    expect(mig).toMatch(/'month_generation_count'/);
    expect(mig).toMatch(/\(SELECT auth\.uid\(\)\)/);
  });
});
