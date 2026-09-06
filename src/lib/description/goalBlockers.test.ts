import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  withRequiredDisclosure, featureBudgetForLength,
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

  it("uses the owner's $150 per-tenant budget", () => {
    const mig = readFileSync(join(fnDir,
      "../migrations/20260906221500_tenant_budget_150.sql"), "utf8");
    // 135 production + 15 preview = the $150 decision, keeping the 90/10 ratio
    // the previous $100 budget used.
    expect(mig).toMatch(/monthly_generation_budget SET DEFAULT 135\.00/);
    expect(mig).toMatch(/monthly_preview_budget    SET DEFAULT 15\.00/);
    // The code fallback must not diverge from the column default, or a tenant
    // with no row silently gets a different budget from every tenant with one.
    expect(DEFAULT_BUDGET.monthlyGenerationBudget).toBe(135);
    expect(DEFAULT_BUDGET.monthlyPreviewBudget).toBe(15);
  });

  it("leaves no tenant without a bound of any kind", () => {
    const mig = readFileSync(join(fnDir,
      "../migrations/20260906221500_tenant_budget_150.sql"), "utf8");
    // Seeding every tenant with a budget row exposed this: the second tenant
    // came out with a budget and a NULL max_cost_per_generation, which makes
    // the unpriced ceiling inapplicable -- an unpriced model with no cap and
    // no measurable spend is unbounded, the exact state the ceiling prevents.
    expect(mig).toMatch(/max_cost_per_generation  SET DEFAULT 0\.50/);
    expect(mig).toMatch(/WHERE max_cost_per_generation IS NULL/);
    expect(mig).toMatch(/INSERT INTO public\.description_generation_budgets \(tenant_id\)/);
    const noCap = { ...cfg, maxCostPerGeneration: null } as TenantBudgetConfig;
    expect(unpricedCallCeiling(noCap, usage({ unpricedExecutions: 50 }), false)).toBeNull();
  });

  it("has the count it divides against", () => {
    const mig = readFileSync(join(fnDir,
      "../migrations/20260906213000_description_spend_unpriced.sql"), "utf8");
    expect(mig).toMatch(/'month_generation_count'/);
    expect(mig).toMatch(/\(SELECT auth\.uid\(\)\)/);
  });
});

// ── 4. The master must be able to feed its longest channel ───────────

describe("the master band covers the vAuto floor", () => {
  it("reserves the appended disclosure out of the writer's target", () => {
    // The disclosure is appended after the writer finishes but counts toward
    // character_count and every channel floor. Asking for the full band and
    // then adding 297 characters overshoots the ceiling.
    const v3 = core.slice(core.indexOf("export function buildMasterPromptV3("),
                          core.indexOf("* V3 channel prompt."));
    expect(v3).toMatch(/const reserve = legalLen \? legalLen \+ 2 : 0;/);
    expect(v3).toMatch(/- Length: aim for \$\{writeBand\.min\}-\$\{writeBand\.max\} characters/);
    // The legacy builder keeps the plain band: it appends nothing.
    const legacy = core.slice(core.indexOf("export function buildMasterPrompt("),
                              core.indexOf("export function buildMasterPromptV3("));
    expect(legacy).toMatch(/preferredLengthBand\(settings\)\.min/);
  });

  it("never inverts the band on a very large disclosure", () => {
    // A disclosure longer than the floor would otherwise produce a negative
    // target, or a max below the min.
    const huge = { min_length: 1000, max_length: 1500, required_legal_text: "x".repeat(2000) };
    const v3 = core.slice(core.indexOf("export function buildMasterPromptV3("),
                          core.indexOf("* V3 channel prompt."));
    expect(v3).toMatch(/Math\.max\(400, band\.min - reserve\)/);
    expect(v3).toMatch(/Math\.max\(writeFloor \+ 200, band\.max - reserve\)/);
    expect(huge.max_length).toBeGreaterThan(0); // fixture is only illustrative
  });

  it("raises the master floor to the vAuto floor", () => {
    const mig = readFileSync(join(fnDir,
      "../migrations/20260906230000_master_band_covers_vauto.sql"), "utf8");
    expect(mig).toMatch(/SET min_length = 3221/);
    expect(mig).toMatch(/max_length = 3879/);
    // Guarded on the old values so a later deliberate change is not reverted.
    expect(mig).toMatch(/AND min_length = 1800/);
  });

  it("matches the vAuto channel policy it has to feed", () => {
    const policy = readFileSync(join(fnDir,
      "_shared/description-channel-policy.ts"), "utf8");
    expect(policy).toMatch(/recommendedMin: 3221, recommendedMax: 3879/);
  });
});

// ── 5. The writer has to be GIVEN enough to reach the floor ──────────
//
// The masters landed at ~2,600 characters against a 3,221 floor, which reads
// as a model ignoring its length instruction. It was not. The master took its
// feature budget from the vehicle_passport channel -- 10 features, sized for a
// 900-2000 character display -- so the writer named everything it had been
// given and stopped. Each of these vehicles carries 356-504 usable features;
// the material was always there, and 10 of it reached the prompt.

describe("the master is supplied enough material for its own band", () => {
  it("sizes the budget from the length, not from a channel", () => {
    expect(orch).toMatch(/featureBudget: featureBudgetForLength\(preferredLengthBand\(settings\)\.max\)/);
    expect(orch).not.toMatch(/featureBudget: resolveChannelPolicy\("vehicle_passport"\)/);
  });

  it("gives a 3,879-character target enough features to fill it", () => {
    expect(featureBudgetForLength(3879)).toBe(35);
    // and a short channel still gets a short budget
    expect(featureBudgetForLength(2000)).toBe(18);
  });

  it("clamps both ends", () => {
    // Never so few that the floor is unreachable, never so many that the
    // description becomes an enumeration.
    expect(featureBudgetForLength(0)).toBe(8);
    expect(featureBudgetForLength(50)).toBe(8);
    expect(featureBudgetForLength(99999)).toBe(40);
    expect(featureBudgetForLength(NaN)).toBe(8);
  });

  it("stops vAuto asking for a long variant with a short variant's material", () => {
    const policy = readFileSync(join(fnDir,
      "_shared/description-channel-policy.ts"), "utf8");
    const vauto = policy.slice(policy.indexOf('key: "vauto"'),
                               policy.indexOf('key: "vauto"') + 1400);
    expect(vauto).toMatch(/recommendedMin: 3221, recommendedMax: 3879/);
    expect(vauto).toMatch(/featureBudget: 35/);
    expect(vauto).not.toMatch(/featureBudget: 10/);
  });
});
