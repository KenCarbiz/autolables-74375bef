// ── Title and odometer classification (master build section 16) ───────────
//
// Four states and nothing softer. A report that answered with no brands, no
// junk, salvage or total-loss record and an odometer chronology that holds
// together is VERIFIED_NO_ADVERSE_REPORTED. A brand, a JSTL record or a
// rollback indication is ADVERSE. A chronology that disagrees, a report past
// its TTL or a report missing its sections is REVIEW_REQUIRED. No report, an
// entitlement block or a provider failure is NOT_VERIFIED, which is what
// stops a failed call from ever reading as a clean title.
//
// Everything public is evidence-exact: what NMVTIS reported, as of when. No
// "clean", no "guaranteed", and no owner or accident claims, because the
// report does not carry them. Report bodies are never persisted; this module
// takes the session summary and other readings and returns a conclusion.

import {
  resolveFreshness, type AuthorityClass, type OdometerReading, type OdometerStatus, type TitleOdometerState,
  type TitleOdometerSummary,
} from "./contracts.ts";

export const TITLE_ODOMETER_VERSION = "title-odometer-v1.0.0";
/** The provider keeps a generated access report this long; a conclusion is current for the same window. */
export const DEFAULT_TITLE_REPORT_TTL_DAYS = 90;
/** Two dated readings that disagree by more than this, in the wrong direction, are a conflict. */
export const DEFAULT_CONFLICT_TOLERANCE_MILES = 500;
/** A later reading lower than an earlier one by more than this, both from strong authorities, indicates a rollback. */
export const DEFAULT_ROLLBACK_TOLERANCE_MILES = 1000;
export const NMVTIS_SOURCE = "vindata_nmvtis";

/** Authorities whose readings may, together, indicate a rollback rather than a data conflict. */
export const ROLLBACK_AUTHORITIES: readonly AuthorityClass[] = ["government_record", "verified_inspection", "dealer_system"];

export type TitleReportOutcome = "answered" | "entitlement_blocked" | "provider_failed" | "not_requested";

export interface TitleBrandRecord { brand: string; state?: string | null; date?: string | null }
export interface JunkSalvageRecord { disposition: string; entity?: string | null; date?: string | null }
export interface ReportOdometerRecord { value: number | string | null | undefined; date?: string | null; state?: string | null }

export interface TitleReportInput {
  outcome: TitleReportOutcome;
  /** When the provider generated the report. */
  reportDate?: string | null;
  /** When AutoLabels read it; defaults to the report date. */
  checkedAt?: string | null;
  brands?: TitleBrandRecord[];
  junkSalvageTotalLoss?: JunkSalvageRecord[];
  odometerReadings?: ReportOdometerRecord[];
  latestTitle?: { state?: string | null; date?: string | null; odometer?: number | string | null; type?: string | null } | null;
  /** False when the provider's report lacked one of its sections. */
  complete?: boolean;
  source?: string;
}

export interface TitleOdometerInput {
  report: TitleReportInput;
  /** Readings from other authorities: feed, listing history, inspection, DMS. */
  otherReadings?: OdometerReading[];
  nowMs: number;
}

export interface TitleOdometerOptions {
  reportTtlDays?: number;
  conflictToleranceMiles?: number;
  rollbackToleranceMiles?: number;
}

export interface OdometerAssessment {
  status: OdometerStatus;
  reasons: string[];
  /** The pair that decided a conflict or rollback, for the public wording. */
  decisive: { earlier: OdometerReading; later: OdometerReading } | null;
}

const toMiles = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

const stampMs = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

export function formatAsOf(iso: string | null | undefined): string | null {
  const ms = stampMs(iso);
  if (ms == null) return iso?.trim() || null;
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const miles = (n: number): string => `${n.toLocaleString("en-US")} miles`;

/** The report's own readings plus every other authority's, oldest first; undated readings last. */
export function assembleReadings(report: TitleReportInput, other: OdometerReading[] = []): OdometerReading[] {
  const source = report.source || NMVTIS_SOURCE;
  const fromReport: OdometerReading[] = [];
  for (const r of report.odometerReadings ?? []) {
    const value = toMiles(r.value);
    if (value != null) fromReport.push({ value, observedAt: r.date ?? null, source, authority: "government_record" });
  }
  const titleOdo = toMiles(report.latestTitle?.odometer);
  if (titleOdo != null) {
    fromReport.push({ value: titleOdo, observedAt: report.latestTitle?.date ?? null, source, authority: "government_record" });
  }
  const others: OdometerReading[] = [];
  for (const r of other) {
    const value = toMiles(r.value);
    if (value != null) others.push({ ...r, value });
  }
  return [...fromReport, ...others].sort((a, b) => {
    const ta = stampMs(a.observedAt);
    const tb = stampMs(b.observedAt);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });
}

interface Decrease { earlier: OdometerReading; later: OdometerReading; drop: number; strong: boolean }

/**
 * Mileage only goes up. A later reading lower than an earlier one is either a
 * rollback indication, when both readings come from authorities that do not
 * mistype, or a conflict to review, when one of them could simply be wrong.
 * Undated readings cannot be placed in time and are not cross-checked. The
 * pair with the largest decrease is the one named in public.
 */
export function assessOdometer(readings: OdometerReading[], options: TitleOdometerOptions = {}): OdometerAssessment {
  const conflictTolerance = options.conflictToleranceMiles ?? DEFAULT_CONFLICT_TOLERANCE_MILES;
  const rollbackTolerance = options.rollbackToleranceMiles ?? DEFAULT_ROLLBACK_TOLERANCE_MILES;
  const reasons: string[] = [];
  if (readings.length === 0) return { status: "not_checked", reasons: ["no_odometer_readings"], decisive: null };
  const dated = readings.filter((r) => stampMs(r.observedAt) != null);
  if (readings.length > dated.length) reasons.push("undated_readings_not_cross_checked");
  let rollback: Decrease | null = null;
  let conflict: Decrease | null = null;
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const earlier = dated[i];
      const later = dated[j];
      const drop = earlier.value - later.value;
      if (drop <= conflictTolerance) continue;
      const strong = ROLLBACK_AUTHORITIES.includes(earlier.authority) && ROLLBACK_AUTHORITIES.includes(later.authority);
      const found: Decrease = { earlier, later, drop, strong };
      if (drop > rollbackTolerance && strong) {
        if (!rollback || drop > rollback.drop) rollback = found;
      } else if (!conflict || drop > conflict.drop) {
        conflict = found;
      }
    }
  }
  if (rollback) {
    return {
      status: "rollback_indicated",
      reasons: [...reasons, "later_reading_below_earlier_strong_authorities"],
      decisive: { earlier: rollback.earlier, later: rollback.later },
    };
  }
  if (conflict) {
    return {
      status: "conflict",
      reasons: [...reasons, conflict.strong ? "later_reading_below_earlier_within_rollback_tolerance" : "later_reading_below_earlier_weak_authority"],
      decisive: { earlier: conflict.earlier, later: conflict.later },
    };
  }
  if (dated.length < 2) reasons.push("single_dated_reading");
  return { status: "consistent", reasons, decisive: null };
}

const brandLabel = (b: TitleBrandRecord): string => {
  const where = [b.state, formatAsOf(b.date)].filter(Boolean).join(", ");
  return where ? `${b.brand} (${where})` : b.brand;
};

const jstlLabel = (j: JunkSalvageRecord): string => {
  const where = [j.entity, formatAsOf(j.date)].filter(Boolean).join(", ");
  return where ? `${j.disposition} (${where})` : j.disposition;
};

const pairText = (d: NonNullable<OdometerAssessment["decisive"]>): string =>
  `${miles(d.earlier.value)} on ${formatAsOf(d.earlier.observedAt)} and ${miles(d.later.value)} on ${formatAsOf(d.later.observedAt)}`;

export function classifyTitleOdometer(input: TitleOdometerInput, options: TitleOdometerOptions = {}): TitleOdometerSummary {
  const ttlDays = options.reportTtlDays ?? DEFAULT_TITLE_REPORT_TTL_DAYS;
  const { report } = input;
  const readings = assembleReadings(report, input.otherReadings ?? []);

  if (report.outcome !== "answered") {
    return {
      state: "NOT_VERIFIED",
      titleBrandsReported: [],
      junkSalvageTotalLossReported: [],
      odometerStatus: "not_checked",
      readings,
      reportDate: null,
      checkedAt: null,
      publicStatement: "Title history not verified.",
      entitlementBlocked: report.outcome === "entitlement_blocked",
      providerFailed: report.outcome === "provider_failed",
      reasons: [`report_${report.outcome}`],
      freshness: resolveFreshness({ checkedAt: null, ttlDays, nowMs: input.nowMs }),
    };
  }

  const checkedAt = report.checkedAt ?? report.reportDate ?? null;
  const freshness = resolveFreshness({ checkedAt, observedAt: report.reportDate ?? null, ttlDays, nowMs: input.nowMs });
  const brands = (report.brands ?? []).filter((b) => b && b.brand);
  const jstl = (report.junkSalvageTotalLoss ?? []).filter((j) => j && j.disposition);
  const odometer = assessOdometer(readings, options);
  const reportReadings = readings.filter((r) => r.authority === "government_record");
  const complete = report.complete !== false;
  const asOf = formatAsOf(report.reportDate ?? checkedAt);

  const adverse: string[] = [];
  if (brands.length) adverse.push("title_brand_reported");
  if (jstl.length) adverse.push("junk_salvage_total_loss_reported");
  if (odometer.status === "rollback_indicated") adverse.push("odometer_rollback_indicated");

  const review: string[] = [];
  if (odometer.status === "conflict") review.push("odometer_conflict");
  if (freshness.state === "stale") review.push("report_older_than_ttl");
  if (!complete) review.push("report_incomplete");
  if (reportReadings.length === 0) review.push("report_missing_odometer");

  const state: TitleOdometerState = adverse.length
    ? "ADVERSE"
    : review.length ? "REVIEW_REQUIRED" : "VERIFIED_NO_ADVERSE_REPORTED";

  let publicStatement: string;
  if (state === "VERIFIED_NO_ADVERSE_REPORTED") {
    publicStatement = `No NMVTIS title brands reported as of ${asOf}. No junk, salvage or total-loss records reported. Odometer readings on record are consistent.`;
  } else if (state === "ADVERSE") {
    const parts: string[] = [];
    if (brands.length) parts.push(`NMVTIS reports as of ${asOf}: ${brands.map(brandLabel).join("; ")}.`);
    if (jstl.length) parts.push(`Junk, salvage or total-loss record reported: ${jstl.map(jstlLabel).join("; ")}.`);
    if (odometer.status === "rollback_indicated" && odometer.decisive) {
      parts.push(`Odometer readings on record decrease over time: ${pairText(odometer.decisive)}.`);
    }
    publicStatement = parts.join(" ");
  } else {
    const clauses: string[] = [];
    if (odometer.status === "conflict" && odometer.decisive) clauses.push(`odometer readings on record disagree (${pairText(odometer.decisive)})`);
    if (freshness.state === "stale") clauses.push(`the NMVTIS report on file is older than ${ttlDays} days`);
    if (!complete) clauses.push("the NMVTIS report on file is incomplete");
    if (reportReadings.length === 0) clauses.push("the NMVTIS report on file carries no odometer reading");
    publicStatement = `Title history needs review: ${clauses.join("; ")}.`;
  }

  return {
    state,
    titleBrandsReported: brands.map(brandLabel),
    junkSalvageTotalLossReported: jstl.map(jstlLabel),
    odometerStatus: odometer.status,
    readings,
    reportDate: report.reportDate ?? null,
    checkedAt,
    publicStatement,
    entitlementBlocked: false,
    providerFailed: false,
    reasons: [...odometer.reasons.map((r) => `odometer_${r}`), ...adverse, ...review],
    freshness,
  };
}

/** Words a public title statement may never contain (section 16). */
export const FORBIDDEN_TITLE_WORDS = /\b(clean|guarantee[ds]?|owners?|accidents?)\b/i;
