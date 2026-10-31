import { describe, expect, it } from "vitest";
import {
  EMPTY_ESTIMATOR_CONFIG, amortizedPayment, chargeTreatment, downPaymentExplanation, estimatorChanges, estimatorCoverage,
  formatPayment, listingModelYear, normalizeEstimatorConfig, parseNumberInput, resolveEstimate, sameEstimatorConfig,
  serializeEstimatorConfig, validateEstimatorConfig, type EstimatorConfig, type YearRule,
} from "./estimator";

// Synthetic rates only. None of these are store-approved values.
const rule = (over: Partial<YearRule> = {}): YearRule => ({
  id: "r1", enabled: true, startYear: 2022, endYear: 2025, defaultTermMonths: 60,
  terms: [
    { months: 36, enabled: true, aprPercent: 7.5 },
    { months: 48, enabled: true, aprPercent: 7.75 },
    { months: 60, enabled: true, aprPercent: 8 },
    { months: 72, enabled: false, aprPercent: null },
  ],
  ...over,
});
const cfg = (over: Partial<EstimatorConfig> = {}): EstimatorConfig => ({
  ...EMPTY_ESTIMATOR_CONFIG,
  enabled: true,
  downPayment: { mode: "percent", percent: 10, amount: null },
  rules: [rule()],
  ...over,
});
const car = (modelYear: number | null, sellingPrice: number | null = 30000) => ({ modelYear, sellingPrice });

describe("amortizedPayment", () => {
  it("matches the handoff arithmetic examples", () => {
    expect(formatPayment(amortizedPayment(27000, 8, 60))).toBe("$547.46");
    expect(formatPayment(amortizedPayment(30000, 0, 60))).toBe("$500.00");
    expect(formatPayment(amortizedPayment(0, 8, 60))).toBe("$0.00");
    expect(formatPayment(amortizedPayment(27000, 8, 48))).toBe("$659.15");
  });
  it("keeps full precision until display", () => {
    const p = amortizedPayment(27000, 8, 60);
    expect(p).not.toBe(Math.round(p * 100) / 100);
  });
});

describe("validateEstimatorConfig", () => {
  const paths = (c: EstimatorConfig) => validateEstimatorConfig(c).map((i) => i.path);
  it("accepts a complete config", () => expect(validateEstimatorConfig(cfg())).toEqual([]));
  it("rejects overlapping ranges, including a shared boundary year", () => {
    expect(paths(cfg({ rules: [rule(), rule({ id: "r2", startYear: 2025, endYear: 2026 })] }))).toContain("rules.r2.startYear");
  });
  it("allows adjacent ranges and gaps", () => {
    expect(validateEstimatorConfig(cfg({ rules: [rule(), rule({ id: "r2", startYear: 2018, endYear: 2021 })] }))).toEqual([]);
    expect(validateEstimatorConfig(cfg({ rules: [rule(), rule({ id: "r2", startYear: 2015, endYear: 2018 })] }))).toEqual([]);
  });
  it("rejects a start year after the end year", () => expect(paths(cfg({ rules: [rule({ startYear: 2026, endYear: 2022 })] }))).toContain("rules.r1.startYear"));
  it("rejects fractional, zero and duplicate terms", () => {
    const bad = rule({ terms: [{ months: 60, enabled: true, aprPercent: 8 }, { months: 60, enabled: true, aprPercent: 8 }, { months: 0, enabled: false, aprPercent: null }, { months: 61.5, enabled: false, aprPercent: null }] });
    const p = paths(cfg({ rules: [bad] }));
    expect(p).toEqual(expect.arrayContaining(["rules.r1.terms.1.months", "rules.r1.terms.2.months", "rules.r1.terms.3.months"]));
  });
  it("needs an enabled term and an enabled default term", () => {
    expect(paths(cfg({ rules: [rule({ terms: [{ months: 60, enabled: false, aprPercent: null }] })] }))).toContain("rules.r1.terms");
    expect(paths(cfg({ rules: [rule({ defaultTermMonths: 72 })] }))).toContain("rules.r1.defaultTermMonths");
  });
  it("requires an APR for every enabled term, distinguishes blank from 0 and rejects negatives and NaN", () => {
    expect(paths(cfg({ rules: [rule({ terms: [{ months: 60, enabled: true, aprPercent: null }] })] }))).toContain("rules.r1.terms.0.apr");
    expect(validateEstimatorConfig(cfg({ rules: [rule({ terms: [{ months: 60, enabled: true, aprPercent: 0 }] })] }))).toEqual([]);
    expect(paths(cfg({ rules: [rule({ terms: [{ months: 60, enabled: true, aprPercent: -1 }] })] }))).toContain("rules.r1.terms.0.apr");
    expect(paths(cfg({ rules: [rule({ terms: [{ months: 60, enabled: true, aprPercent: NaN }] })] }))).toContain("rules.r1.terms.0.apr");
    expect(paths(cfg({ rules: [rule({ terms: [{ months: 60, enabled: true, aprPercent: Infinity }] })] }))).toContain("rules.r1.terms.0.apr");
  });
  it("bounds the down payment", () => {
    expect(paths(cfg({ downPayment: { mode: "percent", percent: 101, amount: null } }))).toContain("downPayment.percent");
    expect(paths(cfg({ downPayment: { mode: "percent", percent: -1, amount: null } }))).toContain("downPayment.percent");
    expect(validateEstimatorConfig(cfg({ downPayment: { mode: "percent", percent: 100, amount: null } }))).toEqual([]);
    expect(validateEstimatorConfig(cfg({ downPayment: { mode: "percent", percent: 0, amount: null } }))).toEqual([]);
    expect(paths(cfg({ downPayment: { mode: "amount", percent: null, amount: -5 } }))).toContain("downPayment.amount");
    expect(paths(cfg({ downPayment: { mode: "amount", percent: null, amount: NaN } }))).toContain("downPayment.amount");
  });
  it("refuses to turn on with no ranges or no down payment, but allows saving it off", () => {
    expect(paths(cfg({ rules: [] }))).toContain("rules");
    expect(paths(cfg({ downPayment: { mode: "amount", amount: null, percent: null } }))).toContain("downPayment.amount");
    expect(validateEstimatorConfig({ ...EMPTY_ESTIMATOR_CONFIG, rules: [] })).toEqual([]);
  });
  it("still refuses an invalid range while off", () => {
    expect(validateEstimatorConfig(cfg({ enabled: false, rules: [rule({ startYear: null })] })).length).toBeGreaterThan(0);
  });
});

describe("resolveEstimate", () => {
  it("produces the handoff end-to-end figure", () => {
    const r = resolveEstimate(cfg(), car(2024));
    expect(r.status).toBe("available");
    if (r.status !== "available") return;
    expect(r.downPayment).toBe(3000);
    expect(r.amountFinanced).toBe(27000);
    expect(r.termMonths).toBe(60);
    expect(r.aprPercent).toBe(8);
    expect(formatPayment(r.monthlyPayment)).toBe("$547.46");
    expect(r.terms.map((t) => t.months)).toEqual([36, 48, 60]);
  });
  it("matches inclusive year boundaries and refuses gaps", () => {
    expect(resolveEstimate(cfg(), car(2022)).status).toBe("available");
    expect(resolveEstimate(cfg(), car(2025)).status).toBe("available");
    expect(resolveEstimate(cfg(), car(2021))).toEqual({ status: "unavailable", reason: "no_matching_rule" });
    expect(resolveEstimate(cfg(), car(2026))).toEqual({ status: "unavailable", reason: "no_matching_rule" });
  });
  it("never guesses an unknown year or price", () => {
    expect(resolveEstimate(cfg(), car(null))).toEqual({ status: "unavailable", reason: "unknown_year" });
    expect(resolveEstimate(cfg(), car(2024, null))).toEqual({ status: "unavailable", reason: "no_price" });
    expect(resolveEstimate(cfg(), car(2024, 0))).toEqual({ status: "unavailable", reason: "no_price" });
  });
  it("hides everything when off or unconfigured, and refuses an invalid published config", () => {
    expect(resolveEstimate(cfg({ enabled: false }), car(2024))).toEqual({ status: "unavailable", reason: "disabled" });
    expect(resolveEstimate(null, car(2024))).toEqual({ status: "unavailable", reason: "not_configured" });
    expect(resolveEstimate(cfg({ rules: [rule({ defaultTermMonths: 72 })] }), car(2024))).toEqual({ status: "unavailable", reason: "invalid_config" });
  });
  it("selects the configured APR when the term changes", () => {
    const r = resolveEstimate(cfg(), car(2024), { termMonths: 48 });
    expect(r.status === "available" && [r.termMonths, r.aprPercent]).toEqual([48, 7.75]);
    expect(r.status === "available" && formatPayment(r.monthlyPayment)).toBe("$655.99");
  });
  it("falls back to the default term, and says so, when the asked term is not offered", () => {
    const r = resolveEstimate(cfg(), car(2024), { termMonths: 72 });
    expect(r.status === "available" && [r.termMonths, r.termAdjusted]).toEqual([60, true]);
  });
  it("computes 0% APR as principal / months", () => {
    const r = resolveEstimate(cfg({ rules: [rule({ terms: [{ months: 60, enabled: true, aprPercent: 0 }] })] }), car(2024));
    expect(r.status === "available" && formatPayment(r.monthlyPayment)).toBe("$450.00");
  });
  it("uses a fixed dollar down and clamps one above the price", () => {
    const fixed = resolveEstimate(cfg({ downPayment: { mode: "amount", amount: 2500, percent: 10 } }), car(2024));
    expect(fixed.status === "available" && [fixed.downPayment, fixed.amountFinanced, fixed.downClamped]).toEqual([2500, 27500, false]);
    const over = resolveEstimate(cfg({ downPayment: { mode: "amount", amount: 40000, percent: null } }), car(2024));
    expect(over.status === "available" && [over.downPayment, over.amountFinanced, over.monthlyPayment, over.downClamped]).toEqual([30000, 0, 0, true]);
  });
  it("treats 100% down as nothing financed", () => {
    const r = resolveEstimate(cfg({ downPayment: { mode: "percent", percent: 100, amount: null } }), car(2024));
    expect(r.status === "available" && [r.amountFinanced, r.monthlyPayment]).toEqual([0, 0]);
  });
  it("applies shopper adjustments only where the store allows them", () => {
    const yes = resolveEstimate(cfg(), car(2024), { downPayment: 5000, aprPercent: 5 });
    expect(yes.status === "available" && [yes.downPayment, yes.downSource, yes.aprPercent, yes.storeAprPercent, yes.aprOverridden]).toEqual([5000, "customer", 5, 8, true]);
    const no = resolveEstimate(cfg({ shopperControls: { downPayment: false, term: false, aprOverride: false } }), car(2024), { downPayment: 5000, termMonths: 36, aprPercent: 5 });
    expect(no.status === "available" && [no.downPayment, no.termMonths, no.aprPercent]).toEqual([3000, 60, 8]);
  });
  it("percentage down follows the selling price it is given (fee-inclusive vs fee-exclusive)", () => {
    const exclusive = resolveEstimate(cfg(), car(2024, 30000));
    const inclusive = resolveEstimate(cfg(), car(2024, 30599));
    expect(exclusive.status === "available" && exclusive.downPayment).toBe(3000);
    expect(inclusive.status === "available" && inclusive.downPayment).toBeCloseTo(3059.9, 6);
    expect(inclusive.status === "available" && inclusive.amountFinanced).toBeCloseTo(27539.1, 6);
  });
  it("keeps two stores' rules apart", () => {
    const storeA = cfg();
    const storeB = cfg({ downPayment: { mode: "amount", amount: 1000, percent: null }, rules: [rule({ id: "b", startYear: 2018, endYear: 2021, defaultTermMonths: 48 })] });
    expect(resolveEstimate(storeA, car(2020)).status).toBe("unavailable");
    const b = resolveEstimate(storeB, car(2020));
    expect(b.status === "available" && [b.downPayment, b.termMonths, b.aprPercent]).toEqual([1000, 48, 7.75]);
    expect(resolveEstimate(storeB, car(2024)).status).toBe("unavailable");
  });
});

describe("helpers", () => {
  it("reads explicit model years only", () => {
    expect(listingModelYear({ ymm: "2024 Honda Accord EX" })).toBe(2024);
    expect(listingModelYear({ ymm: "Used 2019 Land Rover Range Rover" })).toBe(2019);
    expect(listingModelYear({ year: 2021, ymm: "2024 Honda" })).toBe(2021);
    expect(listingModelYear({ ymm: "Honda Accord" })).toBeNull();
    expect(listingModelYear(null)).toBeNull();
  });
  it("parses typed numbers without turning blanks into zero", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("0")).toBe(0);
    expect(parseNumberInput("7.25%")).toBe(7.25);
    expect(parseNumberInput("$3,000")).toBe(3000);
    expect(parseNumberInput("abc")).toBeNaN();
  });
  it("explains the down payment", () => {
    expect(downPaymentExplanation({ mode: "percent", percent: 10, amount: null }, 30000)).toBe("10% of $30,000 = $3,000 down.");
    expect(downPaymentExplanation({ mode: "amount", percent: null, amount: 40000 }, 30000)).toContain("capped at $30,000");
  });
  it("lists the doc fee as excluded only when the price leaves it out", () => {
    expect(chargeTreatment(false).excluded).toContain("Dealer documentation fee");
    expect(chargeTreatment(true).excluded).not.toContain("Dealer documentation fee");
  });
  it("round-trips through the stored shape and preserves both down drafts", () => {
    const c = cfg({ downPayment: { mode: "amount", amount: 2000, percent: 10 } });
    const back = normalizeEstimatorConfig(JSON.parse(JSON.stringify(serializeEstimatorConfig(c))));
    expect(sameEstimatorConfig(c, back)).toBe(true);
    expect(back.downPayment).toEqual({ mode: "amount", amount: 2000, percent: 10 });
    expect(normalizeEstimatorConfig("nope")).toEqual(EMPTY_ESTIMATOR_CONFIG);
  });
  it("describes before and after for review", () => {
    const after = cfg({ enabled: false, rules: [rule({ terms: [...rule().terms.slice(0, 2), { months: 60, enabled: true, aprPercent: 8.5 }] })] });
    const rows = estimatorChanges(cfg(), after);
    expect(rows).toEqual(expect.arrayContaining([
      { field: "Estimator on Passport", before: "On", after: "Off" },
      expect.objectContaining({ field: "Model years 2022–2025", before: expect.stringContaining("60 mo 8%"), after: expect.stringContaining("60 mo 8.5%") }),
    ]));
    expect(estimatorChanges(cfg(), cfg())).toEqual([]);
  });
  it("reports coverage gaps", () => {
    const rep = estimatorCoverage(cfg(), [
      { id: "a", label: "A", ...car(2024) }, { id: "b", label: "B", ...car(2019) },
      { id: "c", label: "C", ...car(null) }, { id: "d", label: "D", ...car(2023, null) },
    ]);
    expect([rep.total, rep.covered, rep.noRule.length, rep.missingYear.length, rep.noPrice.length, rep.uncoveredYears]).toEqual([4, 1, 1, 1, 1, [2019]]);
  });
});

describe("draft preview validation", () => {
  it("previews a valid matched range while another range is unfinished", () => {
    const c = cfg({ rules: [rule(), rule({ id: "r2", startYear: 2018, endYear: null })] });
    expect(resolveEstimate(c, car(2024)).status).toBe("unavailable");
    expect(resolveEstimate(c, car(2024), {}, { validate: "matched" }).status).toBe("available");
  });
  it("still refuses an invalid matched range or down payment", () => {
    expect(resolveEstimate(cfg({ rules: [rule({ defaultTermMonths: 72 })] }), car(2024), {}, { validate: "matched" })).toEqual({ status: "unavailable", reason: "invalid_config" });
    expect(resolveEstimate(cfg({ downPayment: { mode: "percent", percent: null, amount: null } }), car(2024), {}, { validate: "matched" })).toEqual({ status: "unavailable", reason: "invalid_config" });
  });
});
