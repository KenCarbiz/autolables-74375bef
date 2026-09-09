// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/vehicleIdentity.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Who this vehicle is, taken from the record that states it — not from a
// display string that was concatenated out of that record.
//
// `vehicle_listings` has no year/make/model columns, so every reader used to
// split the free-text `ymm`. That split is a round trip through a lossy
// format: `marketcheck-sync/index.ts:986` BUILDS `ymm` as
// `[build.year, build.make, build.model].join(" ")`, and 282 of 282 live rows
// that carry `mc_attributes.make` have exactly that string. Splitting it back
// on whitespace cannot recover a two-token make, which is how
// `ZASPAKBN5L7C99407` ("2020 Alfa Romeo Stelvio") became make "Alfa" and model
// "Romeo Stelvio" on the Vehicle File and in every sticker builder.
//
// The structured keys the split was reconstructing are on the same row. Live
// coverage across all 285 listings: 282 answer from `mc_attributes`, 3 from
// `neovin_snapshots.payload`, 0 need a parse at all. So the parse is the last
// resort for a row no provider has decoded, never the first choice.
//
// The shared `parseYmm` in ./ymm.ts is that last resort. This module does not
// re-implement it and no caller should: a second parser is how five of them
// appeared.

import { parseYmm } from "./ymm.ts";

export type IdentityOrigin =
  | "mc_attributes"
  | "mc_raw_build"
  | "mc_raw"
  | "neovin_payload"
  | "vehicle_files"
  | "ymm_parsed"
  | "none";

export interface VehicleIdentity {
  year: string;
  make: string;
  model: string;
  origin: IdentityOrigin;
  /**
   * Whether make and model came from a provider's own keys. A provider call
   * that requires structured identity checks this rather than the origin, so
   * a new source can be added without every caller learning its name.
   */
  structured: boolean;
}

/**
 * Every place a structured identity can be stored, all optional. Callers pass
 * whatever the query they already run happens to select; a missing bag is
 * simply a tier that cannot answer.
 */
export interface VehicleIdentitySource {
  /** `vehicle_listings.ymm` — the concatenated display string. */
  ymm?: unknown;
  /** `vehicle_listings.mc_attributes`. */
  mcAttributes?: unknown;
  /** `vehicle_listings.mc_raw` (its `build` object is preferred). */
  mcRaw?: unknown;
  /** `neovin_snapshots.payload`. */
  neovinPayload?: unknown;
  /** A `vehicle_files` row, or anything else carrying year/make/model keys. */
  file?: unknown;
}

const bag = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string => {
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

interface Tier {
  origin: Exclude<IdentityOrigin, "ymm_parsed" | "none">;
  from: Record<string, unknown>;
}

const EMPTY: VehicleIdentity = { year: "", make: "", model: "", origin: "none", structured: false };

/**
 * Resolve year/make/model for display and for provider calls.
 *
 * Tiers, strongest first. A tier answers only when it holds BOTH make and
 * model — a half-populated bag is a partial write, not an identity, and
 * letting it win would reintroduce the split it exists to prevent. The year is
 * taken from the winning tier when it has one and otherwise from any later
 * tier, because a missing year never makes the make wrong.
 */
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

/** The model year as a number, or null — `vehicle_files.year` is an integer column. */
export const identityYear = (identity: VehicleIdentity): number | null => {
  const n = Number.parseInt(identity.year, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Whether this identity is complete enough to spend a metered provider call.
 * A request with a blank make or model is rejected and billed anyway.
 */
export const canQueryIdentity = (identity: VehicleIdentity): boolean =>
  identity.make.length > 0 && identity.model.length > 0;

/**
 * What is left of the display string once the resolved year, make and model
 * are removed — the trim, on rows that carry no `trim` column in their query.
 * Positional slicing was doing this by token index, which charged a two-token
 * make to the trim.
 */
export const identityTrim = (ymm: unknown, identity: VehicleIdentity): string => {
  const display = text(ymm);
  if (!display) return "";
  let rest = display;
  for (const part of [identity.year, identity.make, identity.model]) {
    if (!part) continue;
    if (rest.slice(0, part.length).toLowerCase() === part.toLowerCase()) {
      rest = rest.slice(part.length).trimStart();
    }
  }
  return rest === display ? "" : rest;
};

/**
 * Convenience for the many rows read straight out of `vehicle_listings`,
 * whose column names are fixed.
 */
export const identityFromListing = (
  listing: { ymm?: unknown; mc_attributes?: unknown; mc_raw?: unknown } | null | undefined,
  extra: Pick<VehicleIdentitySource, "neovinPayload" | "file"> = {},
): VehicleIdentity =>
  resolveVehicleIdentity({
    ymm: listing?.ymm,
    mcAttributes: listing?.mc_attributes,
    mcRaw: listing?.mc_raw,
    ...extra,
  });
