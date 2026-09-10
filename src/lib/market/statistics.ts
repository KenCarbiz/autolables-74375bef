// ── Weighted statistics ────────────────────────────────────────────────────
//
// The existing helper picks `sorted[floor(n/2)]`, which is the upper-middle
// element of an even-length list, not the median. On the QX50's two
// mileage-qualified prices, [38,431, 43,876], that returns 43,876 — the
// subject's own asking price — and the car is then measured against itself.
// The true median is 41,153.50.
//
// Every quantile here uses ONE definition so an unweighted call and an
// equal-weight weighted call agree: value k sits at cumulative position
// (S_k − w_k/2) / S_n, and a requested quantile is linearly interpolated
// between the two values that bracket it. With equal weights that reduces
// exactly to the classical interpolated quantile, so `weightedQuantile(v, 1s,
// 0.5) === trueMedian(v)` — a property the tests pin.

export interface WeightedPoint {
  value: number;
  weight: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * The median, correct for even-length input.
 *
 * trueMedian([38431, 43876]) === 41153.5
 */
export function trueMedian(values: number[]): number | null {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Points with a usable value and a strictly positive weight, sorted by value. */
function usable(points: WeightedPoint[]): WeightedPoint[] {
  return points
    .filter((p) => finite(p.value) && finite(p.weight) && p.weight > 0)
    .sort((a, b) => a.value - b.value);
}

/**
 * Weighted quantile, q in [0, 1].
 *
 * Returns null rather than guessing when there is nothing to measure. A single
 * point is its own every quantile — honest, and the caller's sample-size rules
 * decide whether one point may be shown at all.
 */
export function weightedQuantile(points: WeightedPoint[], q: number): number | null {
  const pts = usable(points);
  if (!pts.length) return null;
  if (pts.length === 1) return pts[0].value;
  const total = pts.reduce((a, p) => a + p.weight, 0);
  if (!(total > 0)) return null;

  const positions: number[] = [];
  let cumulative = 0;
  for (const p of pts) {
    cumulative += p.weight;
    positions.push((cumulative - p.weight / 2) / total);
  }

  const target = Math.min(1, Math.max(0, q));
  if (target <= positions[0]) return pts[0].value;
  if (target >= positions[positions.length - 1]) return pts[pts.length - 1].value;

  for (let i = 1; i < positions.length; i++) {
    if (target <= positions[i]) {
      const span = positions[i] - positions[i - 1];
      const t = span === 0 ? 0 : (target - positions[i - 1]) / span;
      return pts[i - 1].value + t * (pts[i].value - pts[i - 1].value);
    }
  }
  return pts[pts.length - 1].value;
}

export function weightedMedian(points: WeightedPoint[]): number | null {
  return weightedQuantile(points, 0.5);
}

export function weightedMean(points: WeightedPoint[]): number | null {
  const pts = usable(points);
  if (!pts.length) return null;
  const total = pts.reduce((a, p) => a + p.weight, 0);
  if (!(total > 0)) return null;
  return pts.reduce((a, p) => a + p.value * p.weight, 0) / total;
}

export function weightedStdDev(points: WeightedPoint[]): number | null {
  const pts = usable(points);
  if (pts.length < 2) return null;
  const mean = weightedMean(pts);
  if (mean == null) return null;
  const total = pts.reduce((a, p) => a + p.weight, 0);
  const variance = pts.reduce((a, p) => a + p.weight * (p.value - mean) ** 2, 0) / total;
  return Math.sqrt(variance);
}

/**
 * Median absolute deviation about the weighted median, itself weighted.
 *
 * MAD is the robust spread used for outlier screening precisely because one
 * absurd listing cannot move it, which a standard deviation cannot promise.
 */
export function weightedMad(points: WeightedPoint[]): number | null {
  const pts = usable(points);
  if (pts.length < 2) return null;
  const center = weightedMedian(pts);
  if (center == null) return null;
  const deviations = pts.map((p) => ({ value: Math.abs(p.value - center), weight: p.weight }));
  return weightedMedian(deviations);
}

/**
 * Kish effective sample size: (Σw)² / Σw².
 *
 * Twelve listings from one rooftop are not twelve independent observations.
 * This is the count every confidence rule reads — never the provider's
 * `num_found`, which counts rows a query matched, not evidence we hold.
 */
export function effectiveSampleSize(weights: number[]): number {
  const w = weights.filter((n) => finite(n) && n > 0);
  if (!w.length) return 0;
  const sum = w.reduce((a, b) => a + b, 0);
  const sumSq = w.reduce((a, b) => a + b * b, 0);
  if (!(sumSq > 0)) return 0;
  // Rounded because the concentration caps converge iteratively, so three
  // genuinely equal sources arrive as 2.999999999999999 and a `>= 3` threshold
  // would silently downgrade a market that met the rule.
  return Math.round(((sum * sum) / sumSq) * 1e6) / 1e6;
}
