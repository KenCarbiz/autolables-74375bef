// GENERATED — do not edit.
// Mirror of src/lib/market/cohortLadder.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const COHORT_MATCH_LEVELS = ["VIN_EXACT", "YMMT", "YMM", "MODEL", "NATIONAL"] as const;
export type CohortMatchLevel = (typeof COHORT_MATCH_LEVELS)[number];
export interface CohortSubjectInput {
    vin?: string | null;
    year?: number | string | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    zip?: string | null;
    state?: string | null;
    radiusMiles?: number | null;
    carType?: "new" | "used" | "certified" | null;
}
export interface LadderRung {
    level: CohortMatchLevel;
    params: Record<string, string>;
    geography: {
        scope: "local" | "state" | "national";
        zip?: string;
        state?: string;
        radius?: number;
    };
}
const clean = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    return s || null;
};
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;
export function buildCohortLadder(subject: CohortSubjectInput, product: "mds" | "sales_stats"): LadderRung[] {
    const vin = clean(subject.vin)?.toUpperCase() ?? null;
    const year = clean(subject.year);
    const make = clean(subject.make);
    const model = clean(subject.model);
    const trim = clean(subject.trim);
    const zip = clean(subject.zip);
    const state = clean(subject.state)?.toUpperCase() ?? null;
    const radius = subject.radiusMiles && subject.radiusMiles > 0 ? Math.round(subject.radiusMiles) : 100;
    const carType = subject.carType ?? null;
    const base: Record<string, string> = carType ? { car_type: carType } : {};
    const local = zip ? { zip, radius: String(radius) } : null;
    const rungs: LadderRung[] = [];
    if (vin && VIN_RE.test(vin)) {
        if (product === "mds") {
            if (local)
                rungs.push({ level: "VIN_EXACT", params: { ...base, vin, exact: "true", ...local }, geography: { scope: "local", zip: zip!, radius } });
            else if (state)
                rungs.push({ level: "VIN_EXACT", params: { ...base, vin, exact: "true", state }, geography: { scope: "state", state } });
            else
                rungs.push({ level: "VIN_EXACT", params: { ...base, vin, exact: "true" }, geography: { scope: "national" } });
        }
        else {
            if (local)
                rungs.push({ level: "VIN_EXACT", params: { ...base, vin, ...local }, geography: { scope: "local", zip: zip!, radius } });
            if (state)
                rungs.push({ level: "VIN_EXACT", params: { ...base, vin, state }, geography: { scope: "state", state } });
        }
    }
    if (year && make && model && trim) {
        const ymmt = `${year}|${make}|${model}|${trim}`;
        if (local)
            rungs.push({ level: "YMMT", params: { ...base, ymmt, ...local }, geography: { scope: "local", zip: zip!, radius } });
        if (state)
            rungs.push({ level: "YMMT", params: { ...base, ymmt, state }, geography: { scope: "state", state } });
    }
    if (year && make && model) {
        if (local)
            rungs.push({ level: "YMM", params: { ...base, year, make, model, ...local }, geography: { scope: "local", zip: zip!, radius } });
        if (state)
            rungs.push({ level: "YMM", params: { ...base, year, make, model, state }, geography: { scope: "state", state } });
    }
    if (make && model) {
        if (local)
            rungs.push({ level: "MODEL", params: { ...base, make, model, ...local }, geography: { scope: "local", zip: zip!, radius } });
        rungs.push({ level: "NATIONAL", params: { ...base, make, model }, geography: { scope: "national" } });
    }
    return rungs;
}
export interface RecordedCohortAnswer {
    match_level: CohortMatchLevel;
    geography: LadderRung["geography"];
    sample_size: number | null;
    value: number | null;
    period: {
        start: string | null;
        end: string | null;
    } | null;
    checked_at: string;
    rungs_tried: CohortMatchLevel[];
}
export function recordCohortAnswer(args: {
    rung: LadderRung;
    value: number | null;
    sampleSize?: unknown;
    period?: {
        start?: unknown;
        end?: unknown;
    } | null;
    checkedAt: string;
    triedBefore: CohortMatchLevel[];
}): RecordedCohortAnswer {
    const n = typeof args.sampleSize === "string" ? Number(args.sampleSize) : typeof args.sampleSize === "number" ? args.sampleSize : NaN;
    const iso = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
        match_level: args.rung.level,
        geography: args.rung.geography,
        sample_size: Number.isFinite(n) ? n : null,
        value: args.value,
        period: args.period ? { start: iso(args.period.start), end: iso(args.period.end) } : null,
        checked_at: args.checkedAt,
        rungs_tried: args.triedBefore,
    };
}
export const COHORT_REFRESH_DAYS: Record<"mds" | "sales_stats", number> = { mds: 7, sales_stats: 30 };
export function cohortAnswerDue(product: "mds" | "sales_stats", checkedAt: string | null, nowMs: number, materialEvent = false): boolean {
    if (materialEvent)
        return true;
    if (!checkedAt)
        return true;
    const at = Date.parse(checkedAt);
    if (!Number.isFinite(at))
        return true;
    return nowMs - at >= COHORT_REFRESH_DAYS[product] * 86400000;
}
