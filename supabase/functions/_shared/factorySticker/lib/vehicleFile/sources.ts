// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/sources.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type Row = Record<string, unknown>;
export interface VehicleFileSources {
    tenantId: string;
    listing: Row | null;
    file: Row | null;
    facts: Row[];
    snapshot: Row | null;
    sourceRecords: Row[];
    factConflicts: Row[];
    neovin: Row | null;
    advertisedPrices: Row[];
    crawlAttempt: Row | null;
    crawlRefusals: Row[];
    factorySticker: Row | null;
    getReady: Row | null;
    workItems: Row[];
    reconEstimates: Row[];
    safetyInspections: Row[];
    prepSignOffs: Row[];
    deliveryClearance: Row | null;
    lifecycle: Row | null;
    generatedDocuments: Row[];
    signedDocuments: Row[];
    staleFlags: Row[];
    recallTasks: Row[];
    descriptionVersion: Row | null;
    descriptionChannels: Row[];
    descriptionExceptions: Row[];
    engagement: Row[];
    leads: Row[];
    changeHistory: Row[];
    valueHistory: Row[];
    dealerProfile: Row | null;
    authorityRules: Row[];
    syncRuns: Row[];
    syncConfig: Row | null;
    providerShapes: Row[];
    missing: string[];
}
export function emptySources(tenantId = "00000000-0000-0000-0000-000000000000"): VehicleFileSources {
    return {
        tenantId,
        listing: null,
        file: null,
        facts: [],
        snapshot: null,
        sourceRecords: [],
        factConflicts: [],
        neovin: null,
        advertisedPrices: [],
        crawlAttempt: null,
        crawlRefusals: [],
        factorySticker: null,
        getReady: null,
        workItems: [],
        reconEstimates: [],
        safetyInspections: [],
        prepSignOffs: [],
        deliveryClearance: null,
        lifecycle: null,
        generatedDocuments: [],
        signedDocuments: [],
        staleFlags: [],
        recallTasks: [],
        descriptionVersion: null,
        descriptionChannels: [],
        descriptionExceptions: [],
        engagement: [],
        leads: [],
        changeHistory: [],
        valueHistory: [],
        dealerProfile: null,
        authorityRules: [],
        syncRuns: [],
        syncConfig: null,
        providerShapes: [],
        missing: [],
    };
}
export const str = (v: unknown): string | null => {
    if (typeof v === "string")
        return v.trim() || null;
    if (typeof v === "number" && Number.isFinite(v))
        return String(v);
    return null;
};
export const num = (v: unknown): number | null => {
    if (typeof v === "number")
        return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
        const n = Number(v.replace(/[$,\s]/g, ""));
        return Number.isFinite(n) && v.trim() !== "" ? n : null;
    }
    return null;
};
export const bool = (v: unknown): boolean | null => {
    if (typeof v === "boolean")
        return v;
    if (v === "true")
        return true;
    if (v === "false")
        return false;
    return null;
};
export const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const dig = (root: unknown, ...path: string[]): unknown => {
    let cur: unknown = root;
    for (const key of path) {
        if (!cur || typeof cur !== "object" || Array.isArray(cur))
            return undefined;
        cur = (cur as Row)[key];
    }
    return cur;
};
export const iso = (v: unknown): string | null => {
    const s = str(v);
    if (!s)
        return null;
    if (/^\d{9,13}$/.test(s)) {
        const n = Number(s);
        const ms = s.length > 10 ? n : n * 1000;
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
};
export const latestStamp = (...values: unknown[]): string | null => {
    let best: string | null = null;
    for (const v of values) {
        const s = iso(v);
        if (s && (!best || s > best))
            best = s;
    }
    return best;
};
