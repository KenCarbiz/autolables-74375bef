export interface CoverProduct { productKey: string; label: string; bundledFields: string[]; rateUsd: number | null; quotaUnits: number }

export const DERIVED_FIELDS: Record<string, string[]> = { warranty_remaining: ["factory_warranty_spec"] };

// Copied from supabase/functions/_shared/marketcheck/planner.ts; the browser cannot import from supabase/.
export function cheapestCover(fields: string[], candidates: CoverProduct[]): CoverProduct[] | null {
  if (fields.length === 0) return [];
  const useful = candidates.filter((p) => p.bundledFields.some((f) => fields.includes(f)));
  if (useful.length > 16) throw new Error("too_many_candidate_products");
  let best: { set: CoverProduct[]; units: number; usd: number; unpriced: number } | null = null;
  for (let mask = 1; mask < 1 << useful.length; mask++) {
    const set = useful.filter((_, i) => mask & (1 << i));
    const covered = new Set(set.flatMap((p) => p.bundledFields));
    if (!fields.every((f) => covered.has(f))) continue;
    const units = set.reduce((n, p) => n + p.quotaUnits, 0);
    const unpriced = set.filter((p) => p.rateUsd == null).length;
    const usd = set.reduce((n, p) => n + (p.rateUsd ?? 0), 0);
    const better = !best || units < best.units || (units === best.units && (unpriced < best.unpriced || (unpriced === best.unpriced && usd < best.usd - 1e-9)));
    if (better) best = { set, units, usd, unpriced };
  }
  return best?.set ?? null;
}

export interface CoverageReport {
  derived: string[];
  uncoverable: string[];
  products: CoverProduct[];
  quotaUnits: number;
  usd: number | null;
  notes: string[];
}

const sumUsd = (set: CoverProduct[]) => (set.some((p) => p.rateUsd == null) ? null : Math.round(set.reduce((n, p) => n + (p.rateUsd ?? 0), 0) * 10000) / 10000);

export function coverageFor(required: string[], products: CoverProduct[]): CoverageReport {
  const derived = required.filter((f) => DERIVED_FIELDS[f]);
  const wanted = [...new Set(required.flatMap((f) => DERIVED_FIELDS[f] ?? [f]))];
  const uncoverable = wanted.filter((f) => !products.some((p) => p.bundledFields.includes(f)));
  const coverable = wanted.filter((f) => !uncoverable.includes(f));
  const cover = cheapestCover(coverable, products) ?? [];
  const units = (s: CoverProduct[]) => s.reduce((n, p) => n + p.quotaUnits, 0);
  const notes: string[] = [];
  for (const p of cover) {
    const extra = p.bundledFields.filter((f) => !coverable.includes(f));
    if (extra.length) notes.push(`${p.label} also returns ${extra.join(", ")} in the same request, so those add no cost.`);
  }
  for (const f of required) {
    if (DERIVED_FIELDS[f]) { notes.push(`${f} is calculated from ${DERIVED_FIELDS[f].join(", ")} and never requested.`); continue; }
    if (uncoverable.includes(f)) continue;
    const without = cheapestCover(coverable.filter((x) => x !== f), products) ?? [];
    if (units(without) === units(cover) && sumUsd(without) === sumUsd(cover)) {
      const still = cover.filter((p) => p.bundledFields.includes(f)).map((p) => p.label).join(", ");
      notes.push(`Unticking ${f} would not change the price: ${still} is still needed for other fields.`);
    }
  }
  return { derived, uncoverable, products: cover, quotaUnits: units(cover), usd: sumUsd(cover), notes };
}
