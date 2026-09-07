import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  withRequiredDisclosure, featureBudgetForLength, buildFactSnapshot, validateContent,
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
    expect(v3).toMatch(/write to about \$\{writeBand\.max\} characters/);
    expect(v3).toMatch(/\$\{writeBand\.min\} is the floor/);
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

  it("uses the owner's floor of 3,221 and goal of 3,879", () => {
    const mig = readFileSync(join(fnDir,
      "../migrations/20260907015500_master_floor_back_to_3221.sql"), "utf8");
    expect(mig).toMatch(/SET min_length = 3221/);
    expect(mig).toMatch(/AND max_length = 3879/);
    // Guarded on the previous values so a later deliberate change is not
    // silently reverted by re-running the migration.
    expect(mig).toMatch(/WHERE min_length = 3200/);
  });

  it("matches the vAuto channel policy it has to feed", () => {
    const policy = readFileSync(join(fnDir,
      "_shared/description-channel-policy.ts"), "utf8");
    expect(policy).toMatch(/recommendedMin: 3221, recommendedMax: 3879/);
    expect(policy).not.toMatch(/recommendedMin: 3200/);
  });

  it("treats the ceiling as the target and the floor as a floor", () => {
    // "aim for 3200-3879" invites stopping at the bottom of the range, which
    // is what produced copy landing a few characters past the floor.
    const v3 = core.slice(core.indexOf("export function buildMasterPromptV3("),
                          core.indexOf("* V3 channel prompt."));
    expect(v3).toMatch(/write to about \$\{writeBand\.max\} characters/);
    expect(v3).toMatch(/is the floor, not the target/);
    expect(v3).not.toMatch(/aim for \$\{writeBand\.min\}-/);
  });

  it("says how to reach the target, and how not to", () => {
    const v3 = core.slice(core.indexOf("export function buildMasterPromptV3("),
                          core.indexOf("* V3 channel prompt."));
    // A goal with no route to it is an invitation to pad.
    expect(v3).toMatch(/Reach the target by COVERING MORE of the verified material/);
    expect(v3).toMatch(/Never reach it by padding/);
    expect(v3).toMatch(/If the verified facts genuinely run out before the floor, stop writing/);
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

// ── 6. Facts the decode already had ──────────────────────────────────
//
// Every vehicle carried the same 18 facts and the same 29% confidence, and
// only 6 of the 18 were verified. Three of the nine "feed_provided" facts --
// fuel_type, body_style, seating -- came from the very same decoded
// mc_attributes as engine/transmission/drivetrain, which were correctly
// upgraded to verified two lines above. And fuel economy, doors, cylinders,
// engine size and country of manufacture reached NO fact at all, so the
// writer could not use them and the ABSOLUTE RULES forbid inventing them.

describe("the decode's own facts reach the writer", () => {
  const decodedListing = {
    vin: "1C6SRFFT2NN400176", ymm: "2022 RAM Ram 1500", trim: "Big Horn",
    condition: "used", mileage: 107506,
    mc_attributes: {
      specs_source: "neovin", options: ["Level 2 Equipment Group"],
      engine: "5.7L V8", transmission: "Automatic", drivetrain: "4WD",
      fuel_type: "Unleaded", body_type: "Pickup", std_seating: 6,
      doors: 4, cylinders: 8, engine_size: 5.7, made_in: "United States",
      city_mpg: 17, highway_mpg: 22,
    },
  };
  const facts = (l: Record<string, unknown>) =>
    buildFactSnapshot(l as never, {} as never, null).facts as Record<string, {
      value: unknown; status: string; source: string }>;

  it("credits the decode on facts that came from it", () => {
    const f = facts(decodedListing);
    for (const k of ["fuel_type", "body_style", "seating"]) {
      expect(f[k]?.status).toBe("verified");
      expect(f[k]?.source).toBe("vin_decode");
    }
  });

  it("still says feed_provided when the VIN was never decoded", () => {
    const f = facts({ ...decodedListing,
      mc_attributes: { fuel_type: "Unleaded", body_type: "Pickup" } });
    expect(f.fuel_type?.status).toBe("feed_provided");
    expect(f.body_style?.source).toBe("marketcheck_feed");
  });

  it("supplies fuel economy, which the writer may not invent", () => {
    const f = facts(decodedListing);
    // Worded as an estimate in the fact itself. Two bare numbers invite copy
    // that states mileage as a guarantee the dealer has to stand behind.
    expect(f.fuel_economy?.value).toBe("17 city / 22 highway MPG (EPA estimate)");
  });

  it("omits fuel economy rather than reporting half of it", () => {
    const half = { ...decodedListing,
      mc_attributes: { ...decodedListing.mc_attributes, highway_mpg: null } };
    expect(facts(half).fuel_economy).toBeUndefined();
    const zero = { ...decodedListing,
      mc_attributes: { ...decodedListing.mc_attributes, city_mpg: 0 } };
    expect(facts(zero).fuel_economy).toBeUndefined();
  });

  it("adds the rest of the decoded detail", () => {
    const f = facts(decodedListing);
    expect(f.doors?.value).toBe(4);
    expect(f.cylinders?.value).toBe(8);
    expect(f.engine_size?.value).toBe("5.7L");
    expect(f.made_in?.value).toBe("United States");
  });

  it("raises how much of the packet is verified", () => {
    // More verified facts is the only honest route to both a higher
    // confidence score and a longer description.
    const before = Object.values(facts({ ...decodedListing,
      mc_attributes: { engine: "5.7L V8", fuel_type: "Unleaded", body_type: "Pickup" } }))
      .filter((v) => v.status === "verified").length;
    const after = Object.values(facts(decodedListing))
      .filter((v) => v.status === "verified").length;
    expect(after).toBeGreaterThan(before + 5);
  });
});

// ── 7. The channel variants nothing ever produced ────────────────────
//
// Production holds ZERO description_channel_versions. All eight channels are
// enabled, including vAuto -- the destination the 3,221 floor exists for --
// and not one variant has ever been written. Channel generation went through
// callGenerator -> ai-description, which calls Anthropic and whose MODEL_IDS
// map holds only Claude ids. A tenant configured for openai/gpt-5.6-luna fell
// through that map to Claude Haiku, so a variant would have been written by a
// different vendor and model than the master it derives from -- silently. With
// no ANTHROPIC_API_KEY on an OpenAI tenant the call simply fails.

describe("channel variants use the configured provider", () => {
  const aiDesc = readFileSync(join(fnDir, "ai-description/index.ts"), "utf8");

  it("no longer routes channels through the Anthropic-only function", () => {
    expect(orch).toMatch(/const raw = await generateChannelText\(/);
    // callGenerator survives for tenants not on a provider profile, but the
    // channel loop must not be one of its callers.
    const loop = orch.slice(orch.indexOf("// 5 ── channel variants"),
                            orch.indexOf("// A condition that no longer reproduces"));
    expect(loop.length).toBeGreaterThan(500);
    expect(loop).not.toMatch(/callGenerator\(/);
  });

  it("writes variants with the same provider and model as the master", () => {
    const fn = orch.slice(orch.indexOf("async function generateChannelText("),
                          orch.indexOf("export interface MasterGeneration"));
    expect(fn).toMatch(/settings\.generation_provider === "openai" \? "openai" : "anthropic"/);
    expect(fn).toMatch(/model: settings\.generation_model/);
    expect(fn).toMatch(/outputTokenBudget\(maxChars/);
  });

  it("records channel calls in the spend ledger, tagged by channel", () => {
    const fn = orch.slice(orch.indexOf("async function generateChannelText("),
                          orch.indexOf("export interface MasterGeneration"));
    expect(fn.split("recordExecution(").length - 1).toBe(2); // failure and success
    expect(fn).toMatch(/channel: ctx\.channel/);
    expect(orch).toMatch(/execution_kind: args\.kind, channel: args\.channel \?\? null/);
  });

  it("makes ai-description refuse a model it cannot serve", () => {
    // The silent fall-through to Haiku is what hid this: the configuration
    // said one vendor, the call used another, and nothing reported it.
    expect(aiDesc).toMatch(/error: "unsupported_model"/);
    expect(aiDesc).toMatch(/if \(requestedModel && !MODEL_IDS\[requestedModel\]\)/);
  });

  it("reads the request body before inspecting it", () => {
    // The guard first landed above `const { vehicle } = await req.json()`,
    // a temporal dead zone that throws before any request is served.
    // TypeScript sees the binding in scope and says nothing.
    expect(aiDesc.indexOf("const { vehicle } = await req.json();"))
      .toBeLessThan(aiDesc.indexOf("const requestedModel ="));
    expect(aiDesc.indexOf("const requestedModel ="))
      .toBeLessThan(aiDesc.indexOf("model: resolvedModel,"));
  });
});

// ── 8. What we validate must be what we ship ─────────────────────────

describe("validation reads the stored row", () => {
  it("takes the content back from the inserted version", () => {
    // Twice the validator disagreed with the stored text about the required
    // disclosure: four vehicles blocked REQUIRED_DISCLOSURE_MISSING whose
    // stored copy ends with the exact 297-character disclosure, while the
    // gates -- reading the same variable one block later -- measured the full
    // appended length to the character on all six. Reading the content back
    // from the row removes the class of bug rather than explaining it.
    expect(orch).toMatch(/let masterFinal = typeof version\.content === "string"/);
    const at = orch.indexOf("let masterFinal =");
    const insert = orch.indexOf("content: masterText, word_count:");
    expect(insert).toBeLessThan(at);
  });

  it("falls back to the local text if the row came back without content", () => {
    expect(orch).toMatch(/\?\s*version\.content\s*\n?\s*: masterText;/);
  });
});

// ── 9. A true sentence must not be refused ───────────────────────────

describe("equipment claims are judged against the whole decode", () => {
  it("credits every decoded feature, not the display budget", () => {
    // A BMW X7 and a QX60 were blocked for saying "Navigation System" when
    // both decode a feature by that exact name. The packet surfaces ~35 of
    // 356-504 features, and the check only credited those: prioritization
    // decides what to emphasise, it does not decide what is true.
    const blk = core.slice(core.indexOf("const supported = new Set("),
                           core.indexOf("const factBlob ="));
    expect(blk).toMatch(/\.\.\.\(snap\.features \|\| \[\]\)/);
    expect(blk).toMatch(/packet\.factoryFeatures/);
  });

  it("still refuses a feature the decode marks as conflicted", () => {
    const blk = core.slice(core.indexOf("const supported = new Set("),
                           core.indexOf("const factBlob ="));
    expect(blk).toMatch(/f\.conflict !== true/);
  });
});

// ── 10. A line wrap is not a missing disclosure ──────────────────────

describe("the disclosure check compares words, not whitespace", () => {
  const LEGAL = "Prices do not include tax, title, registration, and Negotiable Dealer Conveyance Fee.";
  const settings = { required_legal_text: LEGAL };
  const snap = { facts: {}, conflicts: [], excluded_claims: [], fact_confidence: 100 } as never;
  const codes = (text: string) =>
    validateContent(text, snap, settings as never).map((f) => f.validator_code);

  it("accepts the disclosure however it is wrapped", () => {
    const wrapped = LEGAL.replace(/ /g, "\n");
    expect(codes(`Great truck.\n\n${wrapped}`)).not.toContain("REQUIRED_DISCLOSURE_MISSING");
    const doubled = LEGAL.replace(/ /g, "  ");
    expect(codes(`Great truck.\n\n${doubled}`)).not.toContain("REQUIRED_DISCLOSURE_MISSING");
  });

  it("accepts a non-breaking space", () => {
    //   collapses under \s in JS, which is the point.
    expect(codes(`Great truck.\n\n${LEGAL.replace(/ /g, " ")}`))
      .not.toContain("REQUIRED_DISCLOSURE_MISSING");
  });

  it("still blocks when the words are actually absent", () => {
    expect(codes("Great truck. No disclosure here."))
      .toContain("REQUIRED_DISCLOSURE_MISSING");
  });

  it("still blocks a paraphrase", () => {
    // Whitespace is cosmetic; wording is not. An $895 fee stated differently
    // is a different disclosure.
    expect(codes("Prices exclude tax, title and a negotiable conveyance fee."))
      .toContain("REQUIRED_DISCLOSURE_MISSING");
  });

  it("records what the validator held when it fires", () => {
    // Three separate runs blocked vehicles whose stored copy demonstrably ends
    // with the exact disclosure, verified in the database with position().
    // The next occurrence has to explain itself rather than need a fourth
    // investigation.
    const f = validateContent("no disclosure", snap, settings as never)
      .find((x) => x.validator_code === "REQUIRED_DISCLOSURE_MISSING");
    expect(f?.source_reference).toMatch(/text=\d+c\/\d+n legal=\d+c\/\d+n exact=(true|false)/);
  });
});

// ── 11. The budget has to stop something ─────────────────────────────

describe("the budget refuses the call instead of noting it", () => {
  it("returns before the provider is reached", () => {
    // The verdict was computed on every run and read only to log a warning.
    // In production that let 434 calls run in a day against a 250/day limit
    // and 453 in a month against a ceiling of 270 -- every check passed
    // silently because nothing acted on the answer.
    expect(orch).toMatch(/if \(!budgetDecision\.withinBudget\) \{/);
    expect(orch).toMatch(/skipped: "budget_exhausted"/);
    const gate = orch.indexOf('skipped: "budget_exhausted"');
    const call = orch.indexOf("const generation = await generateMaster(");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(call); // refused before anything is spent
  });

  it("says which limit stopped it", () => {
    // "over budget" leaves the dealer guessing which knob to turn.
    expect(orch).toMatch(/limits: budgetDecision\.triggeredLimits/);
    expect(orch).toMatch(/generation_budget_blocked/);
  });

  it("reports that nothing was spent", () => {
    const blk = orch.slice(orch.indexOf('if (!budgetDecision.withinBudget)'),
                           orch.indexOf('const masterPolicyVersion'));
    expect(blk).toMatch(/cost_incurred: false/);
  });

  it("is not overridden by force", () => {
    // A manual regenerate spends the same money as an automatic one, so the
    // refusal must not sit behind an opts.force check.
    const blk = orch.slice(orch.indexOf('if (budgetDecision.verdict === "warning")'),
                           orch.indexOf('const masterPolicyVersion'));
    expect(blk).not.toMatch(/opts\.force/);
  });
});
