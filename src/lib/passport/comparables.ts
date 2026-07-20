// ── Similar Vehicles (Phase E) governed normalization ───────────────────────
// Ranks/filters d.comparables against the subject using ONLY governed fields.
// Governance:
//   • Subject VIN and duplicate VINs are excluded; invalid prices and
//     identity-less records are dropped.
//   • The comparable feed carries NO condition field, so condition is reported
//     "unavailable" — never inferred from mileage.
//   • The displayed price difference is the RAW advertised delta only. We do NOT
//     apply soldPriceMedian / soldMilesMedian adjustments (those are delisted-
//     median fields, not a governed, documented sold-based adjustment model).
//   • No numeric similarity score is invented — matches are explained in words.

export interface RawComparable {
  vin?: string | null;
  ymm?: string | null;
  trim?: string | null;
  miles?: number | null;
  price?: number | null;
  dist?: number | null;
  dealer?: string | null;
  dom?: number | null;
  image?: string | null;
}

export interface NormalizedComparable {
  id: string;              // hashed vin or synthetic — safe for analytics
  vin: string | null;
  year: number | null;
  ymm: string | null;
  trim: string | null;
  condition: "unavailable";
  miles: number | null;
  price: number;
  dist: number | null;
  dealer: string | null;
  image: string | null;
  priceDelta: number;      // comparable.price − subject.advertisedPrice (raw)
  priceDeltaLabel: string; // plain language, never "adjusted"/"savings"
  matchLabel: string;
  rank: number;            // lower = closer match (for ordering only, not shown)
}

export interface ComparableSubject {
  vin: string | null;
  year: number | null;
  trim: string | null;
  advertisedPrice: number | null;
}

const yearOf = (ymm?: string | null): number | null => {
  const m = (ymm || "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
};

// Stable, dependency-free short hash (FNV-1a) — a safe analytics id, not PII.
function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return "c_" + (h >>> 0).toString(36);
}

function money(n: number): string {
  return "$" + Math.abs(Math.round(n)).toLocaleString();
}

function deltaLabel(delta: number): string {
  if (delta === 0) return "Same advertised price";
  return delta > 0 ? `${money(delta)} more than this vehicle` : `${money(delta)} less than this vehicle`;
}

function matchLabel(sub: ComparableSubject, year: number | null, trim: string | null, miles: number | null): string {
  const sameYear = sub.year != null && year != null && year === sub.year;
  const adjYear = sub.year != null && year != null && Math.abs(year - sub.year) === 1;
  const sameTrim = !!sub.trim && !!trim && sub.trim.trim().toLowerCase() === trim.trim().toLowerCase();
  if (sameYear && sameTrim) return "Closest match — same year and trim";
  if (sameYear && trim) return "Same year, different trim";
  if (adjYear && year != null && sub.year != null) return year < sub.year ? "Previous model year" : "Newer model year";
  if (sameTrim) return "Same trim";
  return "Comparable listing";
}

export interface NormalizeOptions {
  /** Drop comparables more than this many years from the subject. Default 1. */
  maxYearGap?: number;
  /** Max cards to return in the concise row. Default 6. */
  limit?: number;
}

/**
 * Normalize + filter + rank comparables. Pure + deterministic. Weak matches
 * (beyond the year gap, or without enough identity) are excluded — the row is
 * never padded to hide an empty state.
 */
export function normalizeComparables(subject: ComparableSubject, raw: RawComparable[], opts: NormalizeOptions = {}): NormalizedComparable[] {
  const maxYearGap = opts.maxYearGap ?? 1;
  const limit = opts.limit ?? 6;
  const seen = new Set<string>();
  const subjectVin = (subject.vin || "").trim().toUpperCase();

  const out: NormalizedComparable[] = [];
  for (const c of raw) {
    const vin = (c.vin || "").trim().toUpperCase() || null;
    const price = c.price;
    if (price == null || !Number.isFinite(price) || price <= 0) continue;          // invalid price
    if (vin && vin === subjectVin) continue;                                       // subject VIN
    if (vin && seen.has(vin)) continue;                                            // duplicate VIN
    if (!vin && !c.ymm) continue;                                                  // no identity
    if (vin) seen.add(vin);

    const year = yearOf(c.ymm);
    if (subject.year != null && year != null && Math.abs(year - subject.year) > maxYearGap) continue; // too far off

    const priceDelta = subject.advertisedPrice != null ? price - subject.advertisedPrice : 0;
    const rank =
      (subject.year != null && year === subject.year ? 0 : 2) +
      (subject.trim && c.trim && subject.trim.toLowerCase() === c.trim.toLowerCase() ? 0 : 1) +
      Math.min(2, (c.dist ?? 50) / 50);

    out.push({
      id: vin ? hashId(vin) : hashId(`${c.ymm}|${c.dealer}|${price}`),
      vin,
      year,
      ymm: c.ymm ?? null,
      trim: c.trim ?? null,
      condition: "unavailable",
      miles: c.miles ?? null,
      price,
      dist: c.dist ?? null,
      dealer: c.dealer ?? null,
      image: c.image ?? null,
      priceDelta,
      priceDeltaLabel: subject.advertisedPrice != null ? deltaLabel(priceDelta) : "Price comparison unavailable",
      matchLabel: matchLabel(subject, year, c.trim ?? null, c.miles ?? null),
      rank,
    });
  }

  out.sort((a, b) => a.rank - b.rank || Math.abs(a.priceDelta) - Math.abs(b.priceDelta));
  return out.slice(0, limit);
}
