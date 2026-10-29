import { describe, it, expect } from "vitest";
import { describeUnknown, evaluateProduct, evaluateRule, readCondition, readMileage, type EligibilityRule } from "./productEligibility";

const rule = (patch: Partial<EligibilityRule> = {}): EligibilityRule => ({ year_min: "", year_max: "", makes: [], models: [], trims: [], body_styles: [], condition: "all", mileage_max: 0, ...patch });
const car = { year: 2023, make: "Example", model: "S30", trim: "", bodyStyle: "" };

describe("readCondition and readMileage", () => {
  it("reads recorded conditions through the shared canonical labels and never guesses", () => {
    expect(readCondition("new")).toEqual({ kind: "known", value: "new" });
    expect(readCondition("Demo")).toEqual({ kind: "known", value: "new" });
    expect(readCondition("Pre-Owned")).toEqual({ kind: "known", value: "used" });
    expect(readCondition("Certified Pre-Owned")).toEqual({ kind: "known", value: "cpo" });
    expect(readCondition("cpo")).toEqual({ kind: "known", value: "cpo" });
    expect(readCondition(null)).toEqual({ kind: "missing" });
    expect(readCondition("  ")).toEqual({ kind: "missing" });
    expect(readCondition("Fleet return")).toEqual({ kind: "unrecognized", raw: "Fleet return" });
  });

  it("reads mileage as a number, never treating missing or unreadable as zero", () => {
    expect(readMileage(28115)).toEqual({ kind: "known", value: 28115 });
    expect(readMileage(0)).toEqual({ kind: "known", value: 0 });
    expect(readMileage("28,115")).toEqual({ kind: "known", value: 28115 });
    expect(readMileage("28,115 mi")).toEqual({ kind: "known", value: 28115 });
    expect(readMileage(null)).toEqual({ kind: "missing" });
    expect(readMileage(undefined)).toEqual({ kind: "missing" });
    expect(readMileage("")).toEqual({ kind: "missing" });
    expect(readMileage("TMU")).toEqual({ kind: "unrecognized", raw: "TMU" });
    expect(readMileage(-5)).toEqual({ kind: "unrecognized", raw: "-5" });
    expect(readMileage(Number.NaN)).toEqual({ kind: "unrecognized", raw: "NaN" });
  });
});

describe("evaluateRule", () => {
  it("New only, Used only and All, with CPO counted as Used", () => {
    const status = (condition: string, vehicle: string) => evaluateRule(rule({ condition }), { ...car, condition: vehicle }).status;
    expect(status("new", "new")).toBe("eligible");
    expect(status("new", "used")).toBe("excluded");
    expect(status("new", "cpo")).toBe("excluded");
    expect(status("used", "used")).toBe("eligible");
    expect(status("used", "cpo")).toBe("eligible");
    expect(status("used", "new")).toBe("excluded");
    for (const c of ["new", "used", "cpo"]) expect(status("all", c)).toBe("eligible");
  });

  it("mileage below, exactly at and above the limit", () => {
    const status = (mileage: number) => evaluateRule(rule({ mileage_max: 30000 }), { ...car, condition: "used", mileage }).status;
    expect(status(29999)).toBe("eligible");
    expect(status(30000)).toBe("eligible");
    expect(status(30001)).toBe("excluded");
    expect(evaluateRule(rule({ mileage_max: 30000 }), { ...car, mileage: 30001 }).reasons).toEqual(["Mileage 30,001 is over the 30,000 mi limit."]);
  });

  it("a missing or unrecognized condition is undetermined only when the rule depends on it", () => {
    expect(evaluateRule(rule({ condition: "used" }), { ...car, condition: null })).toEqual({ status: "undetermined", reasons: [], unknown: ["condition"] });
    expect(evaluateRule(rule({ condition: "used" }), { ...car, condition: "Fleet return" }).status).toBe("undetermined");
    expect(evaluateRule(rule({ condition: "all" }), { ...car, condition: null }).status).toBe("eligible");
  });

  it("missing or unreadable mileage is undetermined only when the rule has a limit", () => {
    expect(evaluateRule(rule({ mileage_max: 30000 }), { ...car, mileage: null })).toEqual({ status: "undetermined", reasons: [], unknown: ["mileage"] });
    expect(evaluateRule(rule({ mileage_max: 30000 }), { ...car, mileage: "TMU" }).status).toBe("undetermined");
    expect(evaluateRule(rule({ mileage_max: 0 }), { ...car, mileage: null }).status).toBe("eligible");
  });

  it("combined limits: any definite failure excludes, even when another fact is unknown", () => {
    const r = rule({ condition: "used", mileage_max: 30000, year_min: "2020" });
    expect(evaluateRule(r, { ...car, condition: "cpo", mileage: 12000 }).status).toBe("eligible");
    expect(evaluateRule(r, { ...car, condition: "new", mileage: 12000 }).status).toBe("excluded");
    expect(evaluateRule(r, { ...car, condition: "used", mileage: 45000 }).status).toBe("excluded");
    expect(evaluateRule(r, { ...car, year: 2018, condition: "used", mileage: 12000 }).status).toBe("excluded");
    expect(evaluateRule(r, { ...car, condition: "new", mileage: null }).status).toBe("excluded");
    expect(evaluateRule(r, { ...car, condition: null, mileage: 45000 }).status).toBe("excluded");
    expect(evaluateRule(r, { ...car, condition: null, mileage: null })).toEqual({ status: "undetermined", reasons: [], unknown: ["condition", "mileage"] });
  });

  it("keeps the existing year, make, model, trim and body style behaviour", () => {
    expect(evaluateRule(rule({ makes: ["Example"] }), { ...car, make: "example" }).status).toBe("eligible");
    expect(evaluateRule(rule({ makes: ["Other"] }), car).status).toBe("excluded");
    expect(evaluateRule(rule({ makes: ["Other"] }), { ...car, make: "" }).status).toBe("eligible");
    expect(evaluateRule(rule({ year_min: "2020", year_max: "2022" }), car).status).toBe("excluded");
    expect(evaluateRule(rule({ year_min: "2020", year_max: "2022" }), { ...car, year: "" }).status).toBe("eligible");
  });
});

describe("evaluateProduct", () => {
  it("applies with no rule, with any applying rule, and is undetermined only when nothing applies and something is unknown", () => {
    expect(evaluateProduct([], { ...car }).unrestricted).toBe(true);
    expect(evaluateProduct([rule({ condition: "new" }), rule({ condition: "used" })], { ...car, condition: "cpo" }).status).toBe("eligible");
    expect(evaluateProduct([rule({ condition: "new" }), rule({ mileage_max: 10 })], { ...car, condition: "used", mileage: null })).toEqual({ status: "undetermined", reasons: [], unknown: ["mileage"], unrestricted: false });
    expect(evaluateProduct([rule({ condition: "new" })], { ...car, condition: "used" }).status).toBe("excluded");
  });

  it("names what is missing or not recognized", () => {
    expect(describeUnknown("condition", { condition: null })).toBe("condition not recorded");
    expect(describeUnknown("condition", { condition: "Fleet" })).toBe('condition "Fleet" not recognized');
    expect(describeUnknown("mileage", { mileage: "TMU" })).toBe('mileage "TMU" not recognized');
  });
});
