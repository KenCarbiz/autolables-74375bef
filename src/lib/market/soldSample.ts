// Inferred-sold (recents) sample summary.
//
// The recents search returns num_found for the whole cohort but at most one
// page of listings, in an order we do not control. Before this, the stored
// medians came from that page while the stored count was num_found, and the
// Passport printed "median of <num_found> listings" over a median that was
// computed from at most 50. Here the sample the medians come from is counted
// on its own, deduplicated by VIN, with the subject removed, and a truncated
// page is marked so no dollar claim is drawn from a sample the provider chose.

export const SOLD_SAMPLE_VERSION = "sold-sample-v1";
export const SOLD_MIN_SAMPLE = 5;

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, z) => a - z);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export interface SoldSample {
  /** Whole-cohort size the provider reported; the velocity figure. */
  count: number;
  /** Listings the medians were computed from. */
  sample_size: number;
  truncated: boolean;
  price_median: number | null;
  dom_median: number | null;
  miles_median: number | null;
  sample_version: string;
}

export function summarizeSoldPage(rows: unknown[], numFound: number | null, subjectVin: string): SoldSample {
  const subject = subjectVin.trim().toUpperCase();
  const byVin = new Map<string, Bag>();
  for (const raw of rows) {
    const l = bag(raw);
    const vin = String(l.vin ?? "").trim().toUpperCase();
    if (!vin || vin === subject) continue;
    const prev = byVin.get(vin);
    const seen = (x: Bag) => Date.parse(String(x.last_seen_at_date ?? "")) || Number(x.last_seen_at ?? 0) * 1000 || 0;
    if (!prev || seen(l) > seen(prev) || (seen(l) === seen(prev) && String(l.id ?? "") < String(prev.id ?? ""))) byVin.set(vin, l);
  }
  const kept = [...byVin.values()];
  const vals = (k: string) => kept.map((l) => num(l[k])).filter((n): n is number => n != null);
  const enough = kept.length >= SOLD_MIN_SAMPLE;
  return {
    count: numFound ?? kept.length,
    sample_size: kept.length,
    truncated: numFound != null && numFound > rows.length,
    price_median: enough ? median(vals("price")) : null,
    dom_median: enough ? median(vals("dom")) : null,
    miles_median: enough ? median(vals("miles")) : null,
    sample_version: SOLD_SAMPLE_VERSION,
  };
}
