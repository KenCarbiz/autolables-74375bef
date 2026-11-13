// GENERATED — do not edit.
// Mirror of src/lib/passport/marketComparison.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { PricePoint } from "../passportV2Data.ts";
export const NORMALIZED_MARKET_VALUE_LABEL = "Normalized market value";
export interface MarketSeriesPoint {
    at: string;
    value: number;
}
export interface MarketComparisonView {
    mode: "trend" | "static" | "unavailable";
    marketValueLabel: string;
    advertisedPrice: number | null;
    normalizedMarketValue: number | null;
    diff: number | null;
    diffPct: number | null;
    listingSeries: MarketSeriesPoint[];
    marketSeries: MarketSeriesPoint[];
    hasMarketSeries: boolean;
    periodLabel: string | null;
    sampleSize: number | null;
    radiusMiles: number | null;
    checkedAt: string | null;
    stale: boolean;
    limitations: string[];
}
export interface MarketComparisonInput {
    valueHistory: PricePoint[];
    advertisedPrice: number | null;
    normalizedMarketValue: number | null;
    sampleSize?: number | null;
    radiusMiles?: number | null;
    checkedAt?: string | null;
    nowMs?: number | null;
    staleAfterDays?: number;
}
const dayMs = 86400000;
function series(points: PricePoint[], pick: (p: PricePoint) => number | null): MarketSeriesPoint[] {
    const byDate = new Map<string, number>();
    for (const p of points) {
        const v = pick(p);
        if (v == null || !Number.isFinite(v) || !p.captured_at)
            continue;
        byDate.set(p.captured_at.slice(0, 10), v);
    }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([at, value]) => ({ at, value }));
}
function fmtDate(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return m >= 1 && m <= 12 ? `${MON[m - 1]} ${d}, ${y}` : iso.slice(0, 10);
}
export function resolveMarketComparison(input: MarketComparisonInput): MarketComparisonView {
    const listingSeries = series(input.valueHistory, (p) => p.listing_price);
    const marketSeries = series(input.valueHistory, (p) => p.market_value);
    const advertisedPrice = input.advertisedPrice ?? null;
    const normalizedMarketValue = input.normalizedMarketValue ?? null;
    const diff = advertisedPrice != null && normalizedMarketValue != null ? advertisedPrice - normalizedMarketValue : null;
    const diffPct = diff != null && normalizedMarketValue ? Math.round((diff / normalizedMarketValue) * 1000) / 10 : null;
    const limitations: string[] = [];
    let mode: MarketComparisonView["mode"];
    if (listingSeries.length >= 2) {
        mode = "trend";
        if (listingSeries.length === 2)
            limitations.push("Based on 2 recorded snapshots.");
    }
    else if (advertisedPrice != null || normalizedMarketValue != null) {
        mode = "static";
        if (listingSeries.length === 1)
            limitations.push("Only one recorded snapshot \u2014 showing the current comparison, not a trend.");
    }
    else {
        mode = "unavailable";
    }
    const dates = listingSeries.length ? listingSeries : marketSeries;
    const periodLabel = dates.length >= 2 ? `Price history since ${fmtDate(dates[0].at)}` : null;
    if (mode === "trend" && marketSeries.length < 2)
        limitations.push("Market-value history is limited for this vehicle.");
    if ((input.sampleSize ?? 0) > 0 && (input.sampleSize as number) < 5)
        limitations.push("Small comparable sample \u2014 treat the market position as directional.");
    let stale = false;
    if (input.nowMs != null && input.checkedAt) {
        const t = Date.parse(input.checkedAt);
        if (Number.isFinite(t))
            stale = input.nowMs - t > (input.staleAfterDays ?? 30) * dayMs;
    }
    if (stale)
        limitations.push("Market data may be out of date.");
    return {
        mode,
        marketValueLabel: NORMALIZED_MARKET_VALUE_LABEL,
        advertisedPrice,
        normalizedMarketValue,
        diff,
        diffPct,
        listingSeries,
        marketSeries,
        hasMarketSeries: marketSeries.length >= 2,
        periodLabel,
        sampleSize: input.sampleSize ?? null,
        radiusMiles: input.radiusMiles ?? null,
        checkedAt: input.checkedAt ?? null,
        stale,
        limitations,
    };
}
