import { parseYmm } from "@/lib/factorySticker/ymm";
import { stripListingConditionPrefix } from "@/lib/market/legacyAdapter";

// ── Passport retail payment estimator ───────────────────────────────────────
//
// One store's financing assumptions and the one calculation every surface uses:
// the Administration preview, the customer Passport's initial estimate and the
// interactive calculator. Retail finance only (no lease, no credit tiers, no
// underwriting). An estimate is produced only from a rule the store configured
// for the vehicle's explicit model year; anything unknown yields "unavailable",
// never a guessed constant.
//
// The server (apply_payment_estimator_settings) repeats the validation below;
// this copy exists for usability and for refusing an invalid published config
// on read.

export const SUGGESTED_TERMS = [36, 48, 60, 72, 84] as const;
export const MAX_TERM_MONTHS = 120;
export const MIN_MODEL_YEAR = 1900;
export const MAX_MODEL_YEAR = 2100;
export const ESTIMATOR_SCHEMA_VERSION = 1;

export type DownPaymentMode = "amount" | "percent";

export interface TermEntry {
  months: number;
  enabled: boolean;
  /** Percent, e.g. 7.25. Null is "not entered", which is different from 0. */
  aprPercent: number | null;
}

export interface YearRule {
  id: string;
  enabled: boolean;
  startYear: number | null;
  endYear: number | null;
  defaultTermMonths: number | null;
  terms: TermEntry[];
}

export interface ShopperControls {
  downPayment: boolean;
  term: boolean;
  /** Lets the shopper try their own APR, labelled as theirs. Never changes the store APR. */
  aprOverride: boolean;
}

export interface DownPaymentDefault {
  mode: DownPaymentMode;
  amount: number | null;
  percent: number | null;
}

export interface EstimatorConfig {
  enabled: boolean;
  downPayment: DownPaymentDefault;
  shopperControls: ShopperControls;
  rules: YearRule[];
}

export const EMPTY_ESTIMATOR_CONFIG: EstimatorConfig = {
  enabled: false,
  downPayment: { mode: "percent", amount: null, percent: null },
  // Shopper down/term/APR adjustments already exist on the Passport, so they
  // stay available by default; the store can turn any of them off.
  shopperControls: { downPayment: true, term: true, aprOverride: true },
  rules: [],
};

// ── Parsing ─────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A typed admin input to a number. Blank is null; anything unparsable is NaN so validation can name it. */
export function parseNumberInput(raw: string): number | null {
  const t = raw.replace(/[\s,$%]/g, "");
  if (t === "") return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

let ruleSeq = 0;
export const newRuleId = (): string => `rule_${Date.now().toString(36)}_${(ruleSeq++).toString(36)}`;

/** Tolerant read of a stored or published config. Unknown shapes become the empty config. */
export function normalizeEstimatorConfig(raw: unknown): EstimatorConfig {
  if (!isObj(raw)) return { ...EMPTY_ESTIMATOR_CONFIG, rules: [] };
  const dp = isObj(raw.downPayment) ? raw.downPayment : {};
  const sc = isObj(raw.shopperControls) ? raw.shopperControls : {};
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  return {
    enabled: raw.enabled === true,
    downPayment: {
      mode: dp.mode === "amount" ? "amount" : "percent",
      amount: numOrNull(dp.amount),
      percent: numOrNull(dp.percent),
    },
    shopperControls: {
      downPayment: sc.downPayment !== false,
      term: sc.term !== false,
      aprOverride: sc.aprOverride !== false,
    },
    rules: rules.filter(isObj).map((r, i) => ({
      id: typeof r.id === "string" && r.id ? r.id : `rule_${i}`,
      enabled: r.enabled !== false,
      startYear: numOrNull(r.startYear),
      endYear: numOrNull(r.endYear),
      defaultTermMonths: numOrNull(r.defaultTermMonths),
      terms: (Array.isArray(r.terms) ? r.terms : []).filter(isObj).map((t) => ({
        months: numOrNull(t.months) ?? NaN,
        enabled: t.enabled === true,
        aprPercent: numOrNull(t.aprPercent),
      })),
    })),
  };
}

/** The exact JSON written to the server. Both down-payment drafts are kept; only `mode` is effective. */
export function serializeEstimatorConfig(c: EstimatorConfig): Record<string, unknown> {
  const fin = (n: number | null) => (n != null && Number.isFinite(n) ? n : null);
  return {
    schemaVersion: ESTIMATOR_SCHEMA_VERSION,
    enabled: c.enabled,
    downPayment: { mode: c.downPayment.mode, amount: fin(c.downPayment.amount), percent: fin(c.downPayment.percent) },
    shopperControls: { ...c.shopperControls },
    rules: c.rules.map((r) => ({
      id: r.id,
      enabled: r.enabled,
      startYear: fin(r.startYear),
      endYear: fin(r.endYear),
      defaultTermMonths: fin(r.defaultTermMonths),
      terms: r.terms.map((t) => ({ months: fin(t.months), enabled: t.enabled, aprPercent: fin(t.aprPercent) })),
    })),
  };
}

export const sameEstimatorConfig = (a: EstimatorConfig, b: EstimatorConfig): boolean =>
  JSON.stringify(serializeEstimatorConfig(a)) === JSON.stringify(serializeEstimatorConfig(b));

// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidationIssue {
  /** Stable field id, used to link the message to its input. */
  path: string;
  message: string;
}

export const ruleLabel = (r: Pick<YearRule, "startYear" | "endYear">): string =>
  r.startYear != null && r.endYear != null && Number.isFinite(r.startYear) && Number.isFinite(r.endYear)
    ? r.startYear === r.endYear ? String(r.startYear) : `${r.startYear}–${r.endYear}`
    : "New year range";

const isYear = (n: number | null): n is number => n != null && Number.isInteger(n) && n >= MIN_MODEL_YEAR && n <= MAX_MODEL_YEAR;

export function validateRule(r: YearRule): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const at = (field: string) => `rules.${r.id}.${field}`;
  const name = ruleLabel(r);
  if (!isYear(r.startYear)) out.push({ path: at("startYear"), message: `${name}: enter a four-digit start model year.` });
  if (!isYear(r.endYear)) out.push({ path: at("endYear"), message: `${name}: enter a four-digit end model year.` });
  if (isYear(r.startYear) && isYear(r.endYear) && r.startYear > r.endYear) {
    out.push({ path: at("startYear"), message: `${name}: the start year cannot be after the end year.` });
  }
  const seen = new Set<number>();
  r.terms.forEach((t, i) => {
    if (!Number.isInteger(t.months) || t.months <= 0) {
      out.push({ path: at(`terms.${i}.months`), message: `${name}: term lengths must be positive whole months.` });
    } else if (t.months > MAX_TERM_MONTHS) {
      out.push({ path: at(`terms.${i}.months`), message: `${name}: ${t.months} months is longer than the ${MAX_TERM_MONTHS}-month maximum.` });
    } else if (seen.has(t.months)) {
      out.push({ path: at(`terms.${i}.months`), message: `${name}: ${t.months} months is listed twice.` });
    } else {
      seen.add(t.months);
    }
    if (t.enabled) {
      if (t.aprPercent == null) out.push({ path: at(`terms.${i}.apr`), message: `${name}: enter an APR for ${t.months} months, or turn that term off.` });
      else if (!Number.isFinite(t.aprPercent) || t.aprPercent < 0) out.push({ path: at(`terms.${i}.apr`), message: `${name}: the APR for ${t.months} months must be a number of 0 or more.` });
    }
  });
  if (r.enabled) {
    const enabled = r.terms.filter((t) => t.enabled);
    if (enabled.length === 0) out.push({ path: at("terms"), message: `${name}: turn on at least one term.` });
    else if (r.defaultTermMonths == null || !enabled.some((t) => t.months === r.defaultTermMonths)) {
      out.push({ path: at("defaultTermMonths"), message: `${name}: choose a default term that is turned on.` });
    }
  }
  return out;
}

export function validateEstimatorConfig(c: EstimatorConfig): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const dp = c.downPayment;
  if (dp.mode === "percent") {
    if (dp.percent == null) { if (c.enabled) out.push({ path: "downPayment.percent", message: "Enter the default down payment percentage." }); }
    else if (!Number.isFinite(dp.percent) || dp.percent < 0 || dp.percent > 100) out.push({ path: "downPayment.percent", message: "The down payment percentage must be between 0% and 100%." });
  } else {
    if (dp.amount == null) { if (c.enabled) out.push({ path: "downPayment.amount", message: "Enter the default down payment amount." }); }
    else if (!Number.isFinite(dp.amount) || dp.amount < 0) out.push({ path: "downPayment.amount", message: "The down payment amount must be $0 or more." });
  }
  for (const r of c.rules) out.push(...validateRule(r));
  const ranged = c.rules.filter((r) => isYear(r.startYear) && isYear(r.endYear) && (r.startYear as number) <= (r.endYear as number));
  for (let i = 0; i < ranged.length; i++) {
    for (let j = i + 1; j < ranged.length; j++) {
      const a = ranged[i], b = ranged[j];
      if ((a.startYear as number) <= (b.endYear as number) && (b.startYear as number) <= (a.endYear as number)) {
        out.push({ path: `rules.${b.id}.startYear`, message: `${ruleLabel(b)} overlaps ${ruleLabel(a)}. Model-year ranges cannot overlap.` });
      }
    }
  }
  if (c.enabled && !c.rules.some((r) => r.enabled)) {
    out.push({ path: "rules", message: "Add at least one model-year range before turning the estimator on." });
  }
  return out;
}

// ── Calculation ─────────────────────────────────────────────────────────────

/**
 * Standard amortization at full precision. monthly rate = APR / 100 / 12;
 * payment = P * r / (1 - (1 + r)^-n), or P / n at 0% APR. Round only for display.
 */
export function amortizedPayment(principal: number, aprPercent: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = aprPercent / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export type EstimateUnavailableReason =
  | "disabled"
  | "not_configured"
  | "invalid_config"
  | "no_price"
  | "unknown_year"
  | "no_matching_rule"
  | "no_eligible_term";

export interface EstimateVehicle {
  modelYear: number | null;
  /** The canonical Passport selling price (resolvePassportSellingPrice). */
  sellingPrice: number | null;
}

export interface CustomerAdjustments {
  downPayment?: number | null;
  termMonths?: number | null;
  aprPercent?: number | null;
}

export interface AvailableEstimate {
  status: "available";
  rule: YearRule;
  ruleLabel: string;
  terms: Array<{ months: number; aprPercent: number }>;
  defaultTermMonths: number;
  termMonths: number;
  /** The shopper asked for a term this rule does not offer; the default is shown instead. */
  termAdjusted: boolean;
  storeAprPercent: number;
  aprPercent: number;
  aprOverridden: boolean;
  sellingPrice: number;
  downPayment: number;
  downSource: "store" | "customer";
  downMode: DownPaymentMode;
  downPercent: number | null;
  /** Requested down (store default or shopper entry) was above the price and was capped to it. */
  downClamped: boolean;
  requestedDownPayment: number;
  amountFinanced: number;
  monthlyPayment: number;
}

export interface UnavailableEstimate {
  status: "unavailable";
  reason: EstimateUnavailableReason;
}

export type EstimateResult = AvailableEstimate | UnavailableEstimate;

const unavailable = (reason: EstimateUnavailableReason): UnavailableEstimate => ({ status: "unavailable", reason });

export function findYearRule(config: EstimatorConfig, modelYear: number): YearRule | null {
  const hits = config.rules.filter((r) => r.enabled && r.startYear != null && r.endYear != null && modelYear >= r.startYear && modelYear <= r.endYear);
  return hits.length === 1 ? hits[0] : null;
}

export interface ResolveOptions {
  /**
   * "all" (customer surfaces): any problem anywhere in the config suppresses
   * every estimate. "matched" (the editor's draft preview): only the down
   * payment and the rule that matched this vehicle must be valid, so an
   * unfinished second range does not blank the preview of the first.
   */
  validate?: "all" | "matched";
}

const downPaymentIssues = (c: EstimatorConfig) => validateEstimatorConfig({ ...c, enabled: true, rules: [] }).filter((i) => i.path.startsWith("downPayment"));

export function resolveEstimate(
  config: EstimatorConfig | null,
  vehicle: EstimateVehicle,
  customer: CustomerAdjustments = {},
  opts: ResolveOptions = {},
): EstimateResult {
  if (!config) return unavailable("not_configured");
  if (!config.enabled) return unavailable("disabled");
  const matchedOnly = opts.validate === "matched";
  if (matchedOnly ? downPaymentIssues(config).length > 0 : validateEstimatorConfig(config).length > 0) return unavailable("invalid_config");
  const price = vehicle.sellingPrice;
  if (price == null || !Number.isFinite(price) || price <= 0) return unavailable("no_price");
  const year = vehicle.modelYear;
  if (!isYear(year)) return unavailable("unknown_year");
  const rule = findYearRule(config, year);
  if (!rule) return unavailable("no_matching_rule");
  if (matchedOnly && validateRule(rule).length > 0) return unavailable("invalid_config");
  const terms = rule.terms
    .filter((t) => t.enabled && t.aprPercent != null)
    .map((t) => ({ months: t.months, aprPercent: t.aprPercent as number }))
    .sort((a, b) => a.months - b.months);
  const fallback = terms.find((t) => t.months === rule.defaultTermMonths);
  if (!fallback) return unavailable("no_eligible_term");

  const sc = config.shopperControls;
  const askedTerm = sc.term && customer.termMonths != null ? customer.termMonths : null;
  const picked = askedTerm != null ? terms.find((t) => t.months === askedTerm) : undefined;
  const term = picked ?? fallback;

  const dp = config.downPayment;
  const storeDown = dp.mode === "percent" ? (price * (dp.percent ?? 0)) / 100 : dp.amount ?? 0;
  const customerDown = sc.downPayment && customer.downPayment != null && Number.isFinite(customer.downPayment) ? Math.max(0, customer.downPayment) : null;
  const requestedDown = customerDown ?? storeDown;
  const downPayment = Math.min(Math.max(0, requestedDown), price);
  const amountFinanced = Math.max(0, price - downPayment);

  const customerApr = sc.aprOverride && customer.aprPercent != null && Number.isFinite(customer.aprPercent) && customer.aprPercent >= 0 ? customer.aprPercent : null;
  const aprPercent = customerApr ?? term.aprPercent;

  return {
    status: "available",
    rule,
    ruleLabel: ruleLabel(rule),
    terms,
    defaultTermMonths: fallback.months,
    termMonths: term.months,
    termAdjusted: askedTerm != null && !picked,
    storeAprPercent: term.aprPercent,
    aprPercent,
    aprOverridden: customerApr != null && customerApr !== term.aprPercent,
    sellingPrice: price,
    downPayment,
    downSource: customerDown != null ? "customer" : "store",
    downMode: dp.mode,
    downPercent: customerDown == null && dp.mode === "percent" ? dp.percent : null,
    downClamped: requestedDown > price,
    requestedDownPayment: requestedDown,
    amountFinanced,
    monthlyPayment: amortizedPayment(amountFinanced, aprPercent, term.months),
  };
}

// ── Vehicle inputs ──────────────────────────────────────────────────────────

/** An explicit model year from the listing, or null. Never inferred from age or the calendar. */
export function listingModelYear(listing: { year?: unknown; model_year?: unknown; ymm?: string | null } | null | undefined): number | null {
  if (!listing) return null;
  for (const v of [listing.year, listing.model_year]) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
    if (isYear(n)) return n;
  }
  const parsed = parseYmm(stripListingConditionPrefix(listing.ymm));
  const n = /^\d{4}$/.test(parsed.year) ? Number(parsed.year) : NaN;
  return isYear(n) ? n : null;
}

// ── Presentation ────────────────────────────────────────────────────────────

const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (n: number): string => (Math.abs(n - Math.round(n)) < 0.005 ? money0.format(Math.round(n)) : money2.format(n));
export const formatPayment = (n: number): string => money2.format(Math.round(n * 100) / 100);
export const formatApr = (n: number): string => `${Number(n.toFixed(3)).toString()}%`;
export const formatPercent = (n: number): string => `${Number(n.toFixed(2)).toString()}%`;

/** "60 mo · $3,000 down · 8% assumed APR". Every assumption is always shown with the number. */
export function estimateAssumptionLine(e: AvailableEstimate): string {
  return `${e.termMonths} mo · ${formatMoney(e.downPayment)} down · ${formatApr(e.aprPercent)} ${e.aprOverridden ? "your assumed APR" : "assumed APR"}`;
}

/** "10% of $30,000 = $3,000 down." Illustrative copy for the editor and preview. */
export function downPaymentExplanation(d: DownPaymentDefault, price: number): string | null {
  if (d.mode === "percent") {
    if (d.percent == null || !Number.isFinite(d.percent)) return null;
    return `${formatPercent(d.percent)} of ${formatMoney(price)} = ${formatMoney((price * d.percent) / 100)} down.`;
  }
  if (d.amount == null || !Number.isFinite(d.amount)) return null;
  if (d.amount > price) return `${formatMoney(d.amount)} is more than the ${formatMoney(price)} selling price, so the down payment is capped at ${formatMoney(price)} and nothing is financed.`;
  return `${formatMoney(d.amount)} down on a ${formatMoney(price)} selling price.`;
}

/**
 * What the selling price contains and what the estimate leaves out. A price
 * that already includes the documentation fee must not list that fee as
 * excluded, and one that does not must not imply it is financed.
 */
export function chargeTreatment(priceIncludesDocFee: boolean): { basis: string; excluded: string[]; summary: string } {
  const excluded = ["Sales tax", "Title & registration", ...(priceIncludesDocFee ? [] : ["Dealer documentation fee"]), "Optional add-ons & protection products", "Trade-in equity or payoff"];
  return {
    basis: priceIncludesDocFee ? "Selling price, including the dealer documentation fee" : "Selling price, before the dealer documentation fee",
    excluded,
    summary: `Not included: ${excluded.join(", ").toLowerCase()}. This is not an all-in payment.`,
  };
}

export const CUSTOMER_UNAVAILABLE_MESSAGE = "A payment estimate isn't available for this vehicle. Contact the dealership for financing details.";

export const ADMIN_UNAVAILABLE_COPY: Record<EstimateUnavailableReason, string> = {
  disabled: "The estimator is off for this store, so customers see no payment estimate.",
  not_configured: "This store has no payment settings yet.",
  invalid_config: "The settings have errors, so no estimate is shown until they are fixed.",
  no_price: "This vehicle has no published selling price, so no estimate is shown.",
  unknown_year: "This vehicle's model year is unknown, so no estimate is shown.",
  no_matching_rule: "No model-year range covers this vehicle, so customers see no estimate.",
  no_eligible_term: "The matching range has no usable default term, so no estimate is shown.",
};

// ── Review ──────────────────────────────────────────────────────────────────

export interface EstimatorChange {
  field: string;
  before: string;
  after: string;
}

export function describeDownPayment(d: DownPaymentDefault): string {
  if (d.mode === "percent") return d.percent != null && Number.isFinite(d.percent) ? `${formatPercent(d.percent)} of selling price` : "Not set";
  return d.amount != null && Number.isFinite(d.amount) ? `${formatMoney(d.amount)} fixed` : "Not set";
}

export function describeRule(r: YearRule): string {
  const terms = [...r.terms]
    .sort((a, b) => a.months - b.months)
    .map((t) => `${t.months} mo ${t.enabled && t.aprPercent != null && Number.isFinite(t.aprPercent) ? formatApr(t.aprPercent) : "off"}`)
    .join(", ");
  return `${r.enabled ? "" : "Off · "}${terms || "No terms"}${r.defaultTermMonths != null ? ` · default ${r.defaultTermMonths} mo` : ""}`;
}

const onOff = (b: boolean) => (b ? "On" : "Off");

export function estimatorChanges(before: EstimatorConfig, after: EstimatorConfig): EstimatorChange[] {
  const out: EstimatorChange[] = [];
  if (before.enabled !== after.enabled) out.push({ field: "Estimator on Passport", before: onOff(before.enabled), after: onOff(after.enabled) });
  const bd = describeDownPayment(before.downPayment), ad = describeDownPayment(after.downPayment);
  if (bd !== ad) out.push({ field: "Default down payment", before: bd, after: ad });
  const controls: Array<[keyof ShopperControls, string]> = [["downPayment", "Shopper can change down payment"], ["term", "Shopper can choose a term"], ["aprOverride", "Shopper can try their own APR"]];
  for (const [k, label] of controls) if (before.shopperControls[k] !== after.shopperControls[k]) out.push({ field: label, before: onOff(before.shopperControls[k]), after: onOff(after.shopperControls[k]) });
  const prior = new Map(before.rules.map((r) => [r.id, r]));
  const next = new Map(after.rules.map((r) => [r.id, r]));
  for (const r of after.rules) {
    const b = prior.get(r.id);
    if (!b) out.push({ field: `Model years ${ruleLabel(r)}`, before: "Not covered", after: describeRule(r) });
    else {
      const bl = ruleLabel(b), al = ruleLabel(r), bs = describeRule(b), as = describeRule(r);
      if (bl !== al || bs !== as) out.push({ field: `Model years ${bl === al ? al : `${bl} → ${al}`}`, before: bs, after: as });
    }
  }
  for (const b of before.rules) if (!next.has(b.id)) out.push({ field: `Model years ${ruleLabel(b)}`, before: describeRule(b), after: "Removed" });
  return out;
}

// ── Coverage ────────────────────────────────────────────────────────────────

export interface CoverageVehicle extends EstimateVehicle {
  id: string;
  label: string;
}

export interface CoverageReport<V extends CoverageVehicle = CoverageVehicle> {
  total: number;
  covered: number;
  missingYear: V[];
  noRule: V[];
  noPrice: V[];
  /** Model years present in inventory that no enabled range covers. */
  uncoveredYears: number[];
}

/** Which of the store's vehicles the draft's ranges cover, whether or not the estimator is on. Read-only. */
export function estimatorCoverage<V extends CoverageVehicle>(config: EstimatorConfig, vehicles: V[]): CoverageReport<V> {
  const report: CoverageReport<V> = { total: vehicles.length, covered: 0, missingYear: [], noRule: [], noPrice: [], uncoveredYears: [] };
  const years = new Set<number>();
  for (const v of vehicles) {
    if (v.sellingPrice == null || !Number.isFinite(v.sellingPrice) || v.sellingPrice <= 0) { report.noPrice.push(v); continue; }
    if (!isYear(v.modelYear)) { report.missingYear.push(v); continue; }
    const rule = findYearRule(config, v.modelYear);
    const usable = rule?.terms.some((t) => t.enabled && t.months === rule.defaultTermMonths && t.aprPercent != null && Number.isFinite(t.aprPercent));
    if (usable) report.covered++;
    else { report.noRule.push(v); years.add(v.modelYear); }
  }
  report.uncoveredYears = [...years].sort((a, b) => b - a);
  return report;
}
