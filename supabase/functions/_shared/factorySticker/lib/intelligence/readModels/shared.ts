// GENERATED — do not edit.
// Mirror of src/lib/intelligence/readModels/shared.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { containsForbiddenKey, type Freshness, type FreshnessSummary, type PublicState } from "../contracts.ts";
export const PASSPORT_READ_MODELS_VERSION = "passport-read-models-1.0.0";
export type ReadModelErrorCode = "vehicle_type_mismatch" | "forbidden_key";
export class ReadModelInputError extends Error {
    readonly code: ReadModelErrorCode;
    constructor(code: ReadModelErrorCode, message: string) {
        super(message);
        this.name = "ReadModelInputError";
        this.code = code;
    }
}
export const isNewCondition = (condition: string | null | undefined): boolean => (condition ?? "").trim().toLowerCase() === "new";
const CARRIED_STATES: readonly PublicState[] = ["adverse", "warning", "unavailable"];
export function freshnessEntry(args: {
    key: string;
    label: string;
    freshness: Freshness;
    source: string | null;
    factState?: PublicState | null;
}): FreshnessSummary {
    const f = args.freshness;
    const carried = args.factState ?? null;
    const state: PublicState = f.state === "stale" ? "stale"
        : f.state === "unknown" ? (carried != null && CARRIED_STATES.includes(carried) ? carried : "unknown")
            : carried ?? "verified";
    return { key: args.key, label: args.label, checkedAt: f.checkedAt, state, ttlDays: f.ttlDays, source: args.source };
}
export function assertPublishableShape(model: unknown, modelName: string): void {
    const key = containsForbiddenKey(model);
    if (key)
        throw new ReadModelInputError("forbidden_key", `${modelName} carries the forbidden key "${key}"`);
}
