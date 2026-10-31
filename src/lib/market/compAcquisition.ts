// ── How market comparables are requested and stored ────────────────────────
//
// The market value engine (marketView.ts) already tiers, scores, removes
// outliers and caps concentration. What it can never fix is a biased
// candidate set, and that is what the old request produced: price-ascending,
// limited to 0.65-1.35x the subject's OWN asking price, then sliced to 16 rows
// that put at-or-above-price cars first. The sample moved with the dealer's
// price and leaned toward the cheapest cars in the band.
//
// This module replaces that request with one that knows nothing about the
// subject's price:
//
//   * The request names the vehicle (year, make, model, trim when known),
//     new-versus-used, and geography. It never carries a price, a price range
//     or a price sort. Certification is not filtered at the provider (the
//     filter name is not confirmed in the free docs); each listing's own
//     is_certified flag is stored, and the value engine separates CPO from
//     non-certified comparables where it records why.
//   * Results are sorted by distance, the only ordering that does not depend
//     on price. Within what the provider returns, the stored sample is sorted
//     by (distance, VIN), so the same listings always store the same way
//     whatever order they arrived in.
//   * The relaxation ladder widens identity and geography in a fixed order and
//     stops at the first tier that returns enough external listings. Every
//     request records what it asked for and how much the provider held back
//     (num_found versus rows returned).
//
// Limits that remain and are reported, not hidden: the provider caps a page
// at 50 rows, so a dense market is truncated to its 50 nearest listings;
// asking prices are not transaction prices; fees are captured as the provider
// sent them and never assumed.

export const COMP_ACQUISITION_VERSION = "comp-acquisition-v1";

/** Rows per provider page; the documented maximum for active search. */
export const COMP_PAGE_ROWS = 50;
/** Minimum external listings for a tier to stop the ladder. */
export const COMP_MIN_EXTERNAL = 5;

export type AcquisitionCondition = "new" | "used" | "cpo";

export interface AcquisitionSubject {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: AcquisitionCondition;
  zip: string | null;
}

export interface AcquisitionTier {
  key: string;
  /** Year filter: the exact year, a +/-1 window, or none. */
  years: number[] | null;
  useTrim: boolean;
  radiusMiles: number | null;
}

/**
 * The ladder, tightest first. Identity relaxes before geography so a nearby
 * different trim never outranks a same-trim car further away without being
 * labelled as the weaker tier it is.
 */
export function acquisitionLadder(subject: AcquisitionSubject): AcquisitionTier[] {
  const y = subject.year;
  const tiers: AcquisitionTier[] = [];
  const hasTrim = !!(subject.trim && subject.trim.trim());
  if (hasTrim) tiers.push({ key: "trim_year_r100", years: y ? [y] : null, useTrim: true, radiusMiles: 100 });
  tiers.push({ key: "year_r100", years: y ? [y] : null, useTrim: false, radiusMiles: 100 });
  if (y) tiers.push({ key: "year_pm1_r100", years: [y - 1, y, y + 1], useTrim: false, radiusMiles: 100 });
  if (y) tiers.push({ key: "year_pm1_r250", years: [y - 1, y, y + 1], useTrim: false, radiusMiles: 250 });
  if (!subject.zip) return tiers.map((t) => ({ ...t, radiusMiles: null }));
  return tiers;
}

/** Search parameters for one tier. No price appears in any of them. */
export function acquisitionParams(subject: AcquisitionSubject, tier: AcquisitionTier): Record<string, string> {
  const p: Record<string, string> = {
    car_type: subject.condition === "new" ? "new" : "used",
    rows: String(COMP_PAGE_ROWS),
    start: "0",
    sort_by: "dist",
    sort_order: "asc",
  };
  if (tier.years?.length) p.year = tier.years.join(",");
  if (subject.make) p.make = subject.make;
  if (subject.model) p.model = subject.model;
  if (tier.useTrim && subject.trim) p.trim = subject.trim;
  if (subject.zip && tier.radiusMiles) { p.zip = subject.zip; p.radius = String(tier.radiusMiles); }
  return p;
}

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoFrom = (dateStr: unknown, epoch: unknown): string | null => {
  const d = text(dateStr);
  if (d && Number.isFinite(Date.parse(d))) return new Date(Date.parse(d)).toISOString();
  const e = num(epoch);
  return e != null && e > 0 ? new Date(e * 1000).toISOString() : null;
};

/** A provider certification flag with three states; absence is unknown, never false. */
const certifiedOf = (v: unknown): boolean | null =>
  v === true || v === "true" || v === 1 ? true : v === false || v === "false" || v === 0 ? false : null;

export interface StoredComparable {
  vin: string | null;
  listing_id: string | null;
  ymm: string | null;
  year: number | null;
  trim: string | null;
  drivetrain: string | null;
  miles: number | null;
  price: number | null;
  msrp: number | null;
  certified: boolean | null;
  inventory_type: string | null;
  dist: number | null;
  dealer: string | null;
  dealer_id: string | null;
  dealer_type: string | null;
  seller_type: string | null;
  source: string | null;
  dom: number | null;
  dom_active: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  /** Every fee-related key the provider sent, verbatim. Never interpreted here. */
  fee_evidence: Bag | null;
  image: string | null;
}

/** Map one provider listing to the stored comparable, keeping what the value engine needs. */
export function toStoredComparable(raw: unknown): StoredComparable {
  const l = bag(raw);
  const build = bag(l.build);
  const dealer = bag(l.dealer);
  const fees: Bag = {};
  for (const [k, v] of Object.entries(l)) if (/fee/i.test(k) && v != null) fees[k] = v;
  const year = num(build.year);
  return {
    vin: text(l.vin)?.toUpperCase() ?? null,
    listing_id: text(l.id),
    ymm: text(l.heading) ?? ([build.year, build.make, build.model].filter(Boolean).join(" ") || null),
    year,
    trim: text(build.trim),
    drivetrain: text(build.drivetrain),
    miles: num(l.miles),
    price: num(l.price),
    msrp: num(l.msrp),
    certified: certifiedOf(l.is_certified),
    inventory_type: text(l.inventory_type),
    dist: num(l.dist),
    dealer: text(dealer.name) ?? text(l.seller_name),
    dealer_id: dealer.id != null ? String(dealer.id) : null,
    dealer_type: text(dealer.dealer_type),
    seller_type: text(l.seller_type),
    source: text(l.source),
    dom: num(l.dom),
    dom_active: num(l.dom_active),
    first_seen_at: isoFrom(l.first_seen_at_date, l.first_seen_at),
    last_seen_at: isoFrom(l.last_seen_at_date, l.last_seen_at),
    fee_evidence: Object.keys(fees).length ? fees : null,
    image: text(bag(l.media).photo_links && Array.isArray(bag(l.media).photo_links) ? (bag(l.media).photo_links as unknown[])[0] : null),
  };
}

const byDistanceThenVin = (a: StoredComparable, b: StoredComparable): number => {
  const da = a.dist ?? Number.POSITIVE_INFINITY, db = b.dist ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return (a.vin ?? "").localeCompare(b.vin ?? "") || (a.listing_id ?? "").localeCompare(b.listing_id ?? "");
};

/** Prefer the most recently seen copy of a VIN; ties fall to (distance, listing id), never to arrival order. */
function dedupe(rows: StoredComparable[]): { kept: StoredComparable[]; duplicates: number } {
  const best = new Map<string, StoredComparable>();
  let duplicates = 0;
  for (const r of rows) {
    if (!r.vin) continue;
    const cur = best.get(r.vin);
    if (!cur) { best.set(r.vin, r); continue; }
    duplicates++;
    const ta = Date.parse(r.last_seen_at ?? "") || 0, tb = Date.parse(cur.last_seen_at ?? "") || 0;
    if (ta > tb || (ta === tb && byDistanceThenVin(r, cur) < 0)) best.set(r.vin, r);
  }
  return { kept: [...best.values()], duplicates };
}

export interface StoredSample {
  /** External listings, the market evidence. */
  market: StoredComparable[];
  /** The selling dealer's own listings, kept apart: never market evidence. */
  own: StoredComparable[];
  diagnostics: {
    version: string;
    returned: number;
    missingVinOrPrice: number;
    duplicates: number;
    subjectExcluded: number;
  };
}

/**
 * The stored sample from one provider page. Depends only on the SET of rows,
 * not on the order they arrived in, and never on the subject's price.
 */
export function buildStoredSample(
  rows: unknown[],
  subject: { vin: string; isOwn: (raw: StoredComparable) => boolean },
): StoredSample {
  const subjectVin = subject.vin.trim().toUpperCase();
  const mapped = rows.map(toStoredComparable);
  const usable = mapped.filter((r) => r.vin && r.price != null && r.price > 0);
  const notSubject = usable.filter((r) => r.vin !== subjectVin);
  const { kept, duplicates } = dedupe(notSubject);
  const sorted = kept.sort(byDistanceThenVin);
  return {
    market: sorted.filter((r) => !subject.isOwn(r)),
    own: sorted.filter((r) => subject.isOwn(r)),
    diagnostics: {
      version: COMP_ACQUISITION_VERSION,
      returned: rows.length,
      missingVinOrPrice: mapped.length - usable.length,
      duplicates,
      subjectExcluded: usable.length - notSubject.length,
    },
  };
}

export interface AcquisitionMeta {
  version: string;
  tier: string;
  requested: Record<string, string>;
  numFound: number | null;
  returned: number;
  /** The provider held more matching listings than one page returns. */
  truncated: boolean;
  limitations: string[];
}

export function acquisitionMeta(tier: AcquisitionTier, params: Record<string, string>, numFound: number | null, returned: number): AcquisitionMeta {
  const requested = Object.fromEntries(Object.entries(params).filter(([k]) => !/key|token|secret/i.test(k)));
  const truncated = numFound != null && numFound > returned;
  const limitations = [
    "asking_prices_not_transactions",
    ...(truncated ? [`truncated_to_nearest:${returned}_of_${numFound}`] : []),
    ...(tier.radiusMiles == null ? ["no_geography"] : []),
  ];
  return { version: COMP_ACQUISITION_VERSION, tier: tier.key, requested, numFound, returned, truncated, limitations };
}
