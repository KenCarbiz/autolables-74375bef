// GENERATED — do not edit.
// Mirror of src/lib/market/statistics.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export interface WeightedPoint {
    value: number;
    weight: number;
}
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export function trueMedian(values: number[]): number | null {
    const sorted = values.filter(finite).sort((a, b) => a - b);
    if (!sorted.length)
        return null;
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[middle];
    }
    return (sorted[middle - 1] + sorted[middle]) / 2;
}
function usable(points: WeightedPoint[]): WeightedPoint[] {
    return points
        .filter((p) => finite(p.value) && finite(p.weight) && p.weight > 0)
        .sort((a, b) => a.value - b.value);
}
export function weightedQuantile(points: WeightedPoint[], q: number): number | null {
    const pts = usable(points);
    if (!pts.length)
        return null;
    if (pts.length === 1)
        return pts[0].value;
    const total = pts.reduce((a, p) => a + p.weight, 0);
    if (!(total > 0))
        return null;
    const positions: number[] = [];
    let cumulative = 0;
    for (const p of pts) {
        cumulative += p.weight;
        positions.push((cumulative - p.weight / 2) / total);
    }
    const target = Math.min(1, Math.max(0, q));
    if (target <= positions[0])
        return pts[0].value;
    if (target >= positions[positions.length - 1])
        return pts[pts.length - 1].value;
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
    if (!pts.length)
        return null;
    const total = pts.reduce((a, p) => a + p.weight, 0);
    if (!(total > 0))
        return null;
    return pts.reduce((a, p) => a + p.value * p.weight, 0) / total;
}
export function weightedStdDev(points: WeightedPoint[]): number | null {
    const pts = usable(points);
    if (pts.length < 2)
        return null;
    const mean = weightedMean(pts);
    if (mean == null)
        return null;
    const total = pts.reduce((a, p) => a + p.weight, 0);
    const variance = pts.reduce((a, p) => a + p.weight * (p.value - mean) ** 2, 0) / total;
    return Math.sqrt(variance);
}
export function weightedMad(points: WeightedPoint[]): number | null {
    const pts = usable(points);
    if (pts.length < 2)
        return null;
    const center = weightedMedian(pts);
    if (center == null)
        return null;
    const deviations = pts.map((p) => ({ value: Math.abs(p.value - center), weight: p.weight }));
    return weightedMedian(deviations);
}
export function effectiveSampleSize(weights: number[]): number {
    const w = weights.filter((n) => finite(n) && n > 0);
    if (!w.length)
        return 0;
    const sum = w.reduce((a, b) => a + b, 0);
    const sumSq = w.reduce((a, b) => a + b * b, 0);
    if (!(sumSq > 0))
        return 0;
    return Math.round(((sum * sum) / sumSq) * 1000000) / 1000000;
}
