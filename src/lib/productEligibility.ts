import { canonicalCondition, type CanonicalCondition } from "@/lib/vehicleCondition";

// Product rule eligibility: the one predicate behind both the addendum builder
// and the Administration applicability samples, so the two cannot drift.
//
// Rules keep the existing stored shape (condition new | used | all, a mileage
// limit where 0 means none, model years, makes, models, trims, body styles).
// CPO counts as Used; there is no separate CPO eligibility.
//
// Condition and mileage are read as facts. A missing or unrecognized
// condition, and a missing or unreadable mileage, are unknown: never Used,
// never zero. When a rule depends on an unknown fact the result is
// "undetermined" with the fact named, unless another limit already excludes
// the vehicle. Year, make, model, trim and body style keep their existing
// behaviour: a limit is skipped when the vehicle does not state that field.

export interface EligibilityRule {
  year_min: string;
  year_max: string;
  makes: string[];
  models: string[];
  trims: string[];
  body_styles: string[];
  condition: string;
  mileage_max: number;
}

export interface EligibilityVehicle {
  year?: string | number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  bodyStyle?: string | null;
  /** The vehicle's condition label as recorded (inventory, listing import or entry). */
  condition?: string | null;
  /** Odometer as recorded: a number, or text such as "28,115" or "28,115 mi". */
  mileage?: string | number | null;
}

export type Fact<T> = { kind: "known"; value: T } | { kind: "missing" } | { kind: "unrecognized"; raw: string };

export type UnknownFact = "condition" | "mileage";

export type EligibilityStatus = "eligible" | "excluded" | "undetermined";

export interface RuleEvaluation {
  status: EligibilityStatus;
  /** Why the vehicle is excluded, in plain words; empty unless excluded. */
  reasons: string[];
  /** Facts the rule needed but the vehicle does not state. */
  unknown: UnknownFact[];
}

export const CONDITION_LABEL: Record<CanonicalCondition, string> = { new: "New", used: "Used", cpo: "CPO" };

export function readCondition(raw: string | null | undefined): Fact<CanonicalCondition> {
  const text = (raw ?? "").toString().trim();
  if (!text) return { kind: "missing" };
  const c = canonicalCondition(text);
  return c ? { kind: "known", value: c } : { kind: "unrecognized", raw: text };
}

export function readMileage(raw: string | number | null | undefined): Fact<number> {
  if (raw == null) return { kind: "missing" };
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? { kind: "known", value: raw } : { kind: "unrecognized", raw: String(raw) };
  const text = raw.trim();
  if (!text) return { kind: "missing" };
  const digits = text.replace(/,/g, "").replace(/\s*(mi|miles)\.?$/i, "").trim();
  if (!/^\d+(\.\d+)?$/.test(digits)) return { kind: "unrecognized", raw: text };
  return { kind: "known", value: Number(digits) };
}

const lower = (s: string | null | undefined) => (s ?? "").toString().trim().toLowerCase();

export function evaluateRule(rule: EligibilityRule, vehicle: EligibilityVehicle): RuleEvaluation {
  const reasons: string[] = [];
  const unknown: UnknownFact[] = [];

  const vYear = parseInt(String(vehicle.year ?? ""), 10) || 0;
  const rMin = parseInt(rule.year_min, 10) || 0;
  const rMax = parseInt(rule.year_max, 10) || 9999;
  if (vYear && (vYear < rMin || vYear > rMax)) reasons.push(`Model year ${vYear} is outside ${rule.year_min || "any"} to ${rule.year_max || "any"}.`);

  const listed = (values: string[], field: string | null | undefined, label: string) => {
    const v = lower(field);
    if (values.length > 0 && v && !values.some((x) => x.toLowerCase() === v)) reasons.push(`${label} ${field} is not in the rule.`);
  };
  listed(rule.makes, vehicle.make, "Make");
  listed(rule.models, vehicle.model, "Model");
  listed(rule.trims, vehicle.trim, "Trim");
  listed(rule.body_styles, vehicle.bodyStyle, "Body style");

  if (rule.condition === "new" || rule.condition === "used") {
    const c = readCondition(vehicle.condition);
    if (c.kind === "known") {
      // CPO counts as Used under the stored new / used / all model.
      const asRule = c.value === "new" ? "new" : "used";
      if (asRule !== rule.condition) reasons.push(`Rule applies to ${rule.condition === "new" ? "New" : "Used and CPO"} vehicles; this vehicle is ${CONDITION_LABEL[c.value]}.`);
    } else unknown.push("condition");
  } else if (rule.condition !== "all") {
    unknown.push("condition");
  }

  const limit = Number(rule.mileage_max) || 0;
  if (limit > 0) {
    const m = readMileage(vehicle.mileage);
    if (m.kind === "known") {
      if (m.value > limit) reasons.push(`Mileage ${m.value.toLocaleString("en-US")} is over the ${limit.toLocaleString("en-US")} mi limit.`);
    } else unknown.push("mileage");
  }

  if (reasons.length) return { status: "excluded", reasons, unknown };
  if (unknown.length) return { status: "undetermined", reasons, unknown };
  return { status: "eligible", reasons, unknown };
}

export interface ProductEvaluation extends RuleEvaluation {
  /** True when the product has no rule, so it applies to every vehicle. */
  unrestricted: boolean;
}

/**
 * A product applies when any of its rules applies (rules are include filters).
 * With no rule it applies to every vehicle. Otherwise it is undetermined when
 * no rule applies and at least one rule could not be decided, else excluded.
 */
export function evaluateProduct(rules: EligibilityRule[], vehicle: EligibilityVehicle): ProductEvaluation {
  if (rules.length === 0) return { status: "eligible", reasons: [], unknown: [], unrestricted: true };
  const results = rules.map((r) => evaluateRule(r, vehicle));
  if (results.some((r) => r.status === "eligible")) return { status: "eligible", reasons: [], unknown: [], unrestricted: false };
  const undetermined = results.filter((r) => r.status === "undetermined");
  if (undetermined.length) {
    const unknown = Array.from(new Set(undetermined.flatMap((r) => r.unknown)));
    return { status: "undetermined", reasons: [], unknown, unrestricted: false };
  }
  return { status: "excluded", reasons: Array.from(new Set(results.flatMap((r) => r.reasons))), unknown: [], unrestricted: false };
}

/** "condition not recorded", or `condition "Fleet" not recognized`; the same for mileage. */
export function describeUnknown(fact: UnknownFact, vehicle: EligibilityVehicle): string {
  const read = fact === "condition" ? readCondition(vehicle.condition) : readMileage(vehicle.mileage);
  return read.kind === "unrecognized" ? `${fact} "${read.raw}" not recognized` : `${fact} not recorded`;
}
