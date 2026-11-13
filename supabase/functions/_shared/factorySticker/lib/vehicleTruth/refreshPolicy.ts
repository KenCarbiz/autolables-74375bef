// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/refreshPolicy.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type TruthRefreshMode = "only_missing" | "due" | "all";
export const TRUTH_REFRESH_MODES: TruthRefreshMode[] = ["only_missing", "due", "all"];
export const TRUTH_REFRESH_MIN_AGE_MS = 20 * 60 * 60 * 1000;
export interface TruthRefreshCandidate {
    vehicleId: string;
    tenantId: string | null;
    listingStatus?: string | null;
    stickerStatus?: string | null;
    lastResolvedAt?: string | null;
    hasSnapshot?: boolean;
}
export interface TruthRefreshOptions {
    mode?: TruthRefreshMode;
    now?: number;
    minAgeMs?: number;
    limit?: number;
}
export function parseTruthRefreshMode(value: unknown, fallback: TruthRefreshMode = "due"): TruthRefreshMode {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    return (TRUTH_REFRESH_MODES as string[]).includes(raw) ? (raw as TruthRefreshMode) : fallback;
}
export function hasResolvedTruth(candidate: TruthRefreshCandidate): boolean {
    return !!candidate.lastResolvedAt || candidate.hasSnapshot === true;
}
export function isRefreshableVehicle(candidate: TruthRefreshCandidate): boolean {
    if (!candidate.vehicleId || !candidate.tenantId)
        return false;
    return String(candidate.listingStatus ?? "").toLowerCase() !== "archived";
}
export function truthAgeMs(candidate: TruthRefreshCandidate, now: number): number | null {
    if (!candidate.lastResolvedAt)
        return null;
    const at = Date.parse(candidate.lastResolvedAt);
    return Number.isFinite(at) ? now - at : null;
}
export function isDueForTruthRefresh(candidate: TruthRefreshCandidate, options: TruthRefreshOptions = {}): boolean {
    if (!isRefreshableVehicle(candidate))
        return false;
    const mode = options.mode ?? "due";
    if (mode === "all")
        return true;
    if (!hasResolvedTruth(candidate))
        return true;
    if (mode === "only_missing")
        return false;
    const minAgeMs = options.minAgeMs ?? TRUTH_REFRESH_MIN_AGE_MS;
    const age = truthAgeMs(candidate, options.now ?? Date.now());
    return age === null || age >= minAgeMs;
}
export function selectTruthRefreshWorklist(candidates: TruthRefreshCandidate[], options: TruthRefreshOptions = {}): TruthRefreshCandidate[] {
    const now = options.now ?? Date.now();
    const due = candidates.filter((c) => isDueForTruthRefresh(c, { ...options, now }));
    const ordered = due.slice().sort((a, b) => {
        const at = a.lastResolvedAt ? Date.parse(a.lastResolvedAt) : Number.NEGATIVE_INFINITY;
        const bt = b.lastResolvedAt ? Date.parse(b.lastResolvedAt) : Number.NEGATIVE_INFINITY;
        const an = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
        const bn = Number.isFinite(bt) ? bt : Number.NEGATIVE_INFINITY;
        if (an !== bn)
            return an - bn;
        return a.vehicleId < b.vehicleId ? -1 : a.vehicleId > b.vehicleId ? 1 : 0;
    });
    const limit = options.limit;
    return typeof limit === "number" && limit > 0 ? ordered.slice(0, limit) : ordered;
}
export function countByStickerStatus(candidates: TruthRefreshCandidate[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const candidate of candidates) {
        const key = String(candidate.stickerStatus || "NO_RECORD");
        out[key] = (out[key] || 0) + 1;
    }
    return out;
}
