// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/vehicleIdentity.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { parseYmm } from "./ymm.ts";
export type IdentityOrigin = "mc_attributes" | "mc_raw_build" | "mc_raw" | "neovin_payload" | "vehicle_files" | "ymm_parsed" | "none";
export interface VehicleIdentity {
    year: string;
    make: string;
    model: string;
    origin: IdentityOrigin;
    structured: boolean;
}
export interface VehicleIdentitySource {
    ymm?: unknown;
    mcAttributes?: unknown;
    mcRaw?: unknown;
    neovinPayload?: unknown;
    file?: unknown;
}
const bag = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => {
    if (typeof value === "string")
        return value.trim().replace(/\s+/g, " ");
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    return "";
};
interface Tier {
    origin: Exclude<IdentityOrigin, "ymm_parsed" | "none">;
    from: Record<string, unknown>;
}
const EMPTY: VehicleIdentity = { year: "", make: "", model: "", origin: "none", structured: false };
export function resolveVehicleIdentity(source: VehicleIdentitySource): VehicleIdentity {
    const tiers: Tier[] = [
        { origin: "mc_attributes", from: bag(source.mcAttributes) },
        { origin: "mc_raw_build", from: bag(bag(source.mcRaw).build) },
        { origin: "mc_raw", from: bag(source.mcRaw) },
        { origin: "neovin_payload", from: bag(source.neovinPayload) },
        { origin: "vehicle_files", from: bag(source.file) },
    ];
    const parsed = parseYmm(typeof source.ymm === "string" ? source.ymm : null);
    const years = [...tiers.map((t) => text(t.from.year)), parsed.year].filter(Boolean);
    const year = years[0] ?? "";
    for (const tier of tiers) {
        const make = text(tier.from.make);
        const model = text(tier.from.model);
        if (make && model) {
            return { year: text(tier.from.year) || year, make, model, origin: tier.origin, structured: true };
        }
    }
    if (parsed.make && parsed.model) {
        return { year: parsed.year || year, make: parsed.make, model: parsed.model, origin: "ymm_parsed", structured: false };
    }
    if (parsed.make || parsed.year || year) {
        return { ...EMPTY, year: parsed.year || year, make: parsed.make, origin: parsed.make ? "ymm_parsed" : "none" };
    }
    return EMPTY;
}
export const identityYear = (identity: VehicleIdentity): number | null => {
    const n = Number.parseInt(identity.year, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
};
export const canQueryIdentity = (identity: VehicleIdentity): boolean => identity.make.length > 0 && identity.model.length > 0;
export const identityTrim = (ymm: unknown, identity: VehicleIdentity): string => {
    const display = text(ymm);
    if (!display)
        return "";
    let rest = display;
    for (const part of [identity.year, identity.make, identity.model]) {
        if (!part)
            continue;
        if (rest.slice(0, part.length).toLowerCase() === part.toLowerCase()) {
            rest = rest.slice(part.length).trimStart();
        }
    }
    return rest === display ? "" : rest;
};
export const identityFromListing = (listing: {
    ymm?: unknown;
    mc_attributes?: unknown;
    mc_raw?: unknown;
} | null | undefined, extra: Pick<VehicleIdentitySource, "neovinPayload" | "file"> = {}): VehicleIdentity => resolveVehicleIdentity({
    ymm: listing?.ymm,
    mcAttributes: listing?.mc_attributes,
    mcRaw: listing?.mc_raw,
    ...extra,
});
