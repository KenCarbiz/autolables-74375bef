// Price-independent comparable cohort helpers, shared by vehicle-enrich and
// marketcheck-comps. Nothing in this file reads the subject's asking price:
// the cohort is defined by year / make / model / trim / radius / mileage band,
// and outliers are trimmed by the cohort's own quartiles.

export const OUTLIER_MIN_ROWS = 8;
export const OUTLIER_IQR_MULTIPLIER = 1.5;

export const quantile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Mean of the two middle values for an even count. */
export const properMedian = (sorted: number[]): number | null => {
  const n = sorted.length;
  if (n === 0) return null;
  return n % 2 ? sorted[(n - 1) / 2] : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
};

export interface CohortRow { price?: unknown; vin?: unknown; [k: string]: unknown }

const toNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface TrimmedCohort<T extends CohortRow> {
  analysed: T[];
  unpriced: number;
  outliers: number;
  rule: string;
}

export function trimCohortOutliers<T extends CohortRow>(rows: T[]): TrimmedCohort<T> {
  const priced = rows.filter((r) => (toNum(r.price) ?? 0) > 0);
  const unpriced = rows.length - priced.length;
  if (priced.length < OUTLIER_MIN_ROWS) {
    return { analysed: priced, unpriced, outliers: 0, rule: `not applied (fewer than ${OUTLIER_MIN_ROWS} priced rows)` };
  }
  const sp = priced.map((r) => toNum(r.price) as number).sort((a, z) => a - z);
  const q1 = quantile(sp, 0.25);
  const q3 = quantile(sp, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - OUTLIER_IQR_MULTIPLIER * iqr;
  const hi = q3 + OUTLIER_IQR_MULTIPLIER * iqr;
  const analysed = priced.filter((r) => {
    const p = toNum(r.price) as number;
    return p >= lo && p <= hi;
  });
  return { analysed, unpriced, outliers: priced.length - analysed.length, rule: "1.5x IQR of the cohort's own prices" };
}

export const normalizeDealerName = (s: unknown): string => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export interface SplitResult<T> { rows: T[]; ownRows: T[]; subjectCount: number }

/** Separate the subject VIN and the dealer's own rooftop from independent market evidence. */
export function splitCohortRows<T extends CohortRow & { dist?: unknown; dealer?: { name?: unknown } | null; seller_name?: unknown }>(
  all: T[], subjectVin: string, dealerName: string | null,
): SplitResult<T> {
  const own = normalizeDealerName(dealerName);
  const subj = String(subjectVin || "").toUpperCase();
  const isSubject = (l: T) => String(l.vin || "").toUpperCase() === subj;
  const isOurs = (l: T): boolean => {
    const cn = normalizeDealerName(l.dealer?.name ?? l.seller_name);
    if (own && cn && (cn.includes(own) || own.includes(cn))) return true;
    return Number(l.dist) === 0;
  };
  const rows: T[] = [];
  const ownRows: T[] = [];
  let subjectCount = 0;
  for (const l of all) {
    if (isSubject(l)) { subjectCount++; continue; }
    (isOurs(l) ? ownRows : rows).push(l);
  }
  return { rows, ownRows, subjectCount };
}

export interface CohortDescriptor {
  selection: "price_independent_cohort";
  total_matches: number | null;
  returned_count: number;
  analyzed_count: number;
  sampled: boolean;
  sort_basis: string;
  radius_miles: number | null;
  year: string | null;
  trim: string | null;
  miles_band: { percent: number | null; range: string } | null;
  excluded: { subject_vin: number; dealer_own_listings: number; unpriced: number; trim_or_drivetrain_mismatch: number; outliers: number };
  outlier_rule: string;
  median_method: string;
}

export function describeCohort(i: {
  totalMatches: number | null; returned: number; analysed: number; sortBasis: string;
  radius: number | null; year: string | null; trim: string | null;
  milesBand: { percent: number | null; range: string } | null;
  subject: number; own: number; unpriced: number; mismatch?: number; outliers: number; outlierRule: string;
}): CohortDescriptor {
  return {
    selection: "price_independent_cohort",
    total_matches: i.totalMatches,
    returned_count: i.returned,
    analyzed_count: i.analysed,
    sampled: i.totalMatches != null && i.returned < i.totalMatches,
    sort_basis: i.sortBasis,
    radius_miles: i.radius,
    year: i.year,
    trim: i.trim,
    miles_band: i.milesBand,
    excluded: { subject_vin: i.subject, dealer_own_listings: i.own, unpriced: i.unpriced, trim_or_drivetrain_mismatch: i.mismatch ?? 0, outliers: i.outliers },
    outlier_rule: i.outlierRule,
    median_method: "mean of the two middle values when the count is even",
  };
}
