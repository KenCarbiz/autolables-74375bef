// ──────────────────────────────────────────────────────────────────────
// The identity an OEM brochure / owner's-manual link is stored and looked up
// under.
//
// Both link tables are GLOBAL caches keyed on (lower(make), lower(model),
// year) — not per VIN, not per tenant — and the customer passport reads them
// through public-listing-view with `ilike(make)` + `ilike(model)`, an exact
// case-insensitive match on values it splits out of the listing's `ymm`
// string as [year, make, ...model].
//
// So the harvest MUST store the key the passport queries, or it pays a metered
// provider to cache a row nothing will ever find. That is the whole reason
// this module exists: one derivation, shared by the ingest wiring and unit
// tested against the passport's split, instead of three hand-rolled copies
// drifting apart.
// ──────────────────────────────────────────────────────────────────────

export interface OemDocKey {
  make: string;
  model: string;
  year: number | null;
}

/**
 * The (make, model, year) the passport will look this vehicle's OEM links up
 * by, or null when the ymm cannot produce one.
 *
 * Reproduces public-listing-view's split verbatim — second word is the make,
 * everything after it is the model — rather than trying to be cleverer than
 * it. Being cleverer here (stripping a trim, rejoining a two-word make) would
 * store a key the passport never queries, which is strictly worse than storing
 * a coarse one.
 *
 * A ymm without a leading four-digit model year is refused outright: the
 * passport would then read the make out of the model position, so every key
 * derived from it is wrong and paying to harvest one is pure waste.
 */
export function oemDocKeyFromYmm(ymm: string | null | undefined): OemDocKey | null {
  const parts = String(ymm || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (!/^(19|20)\d{2}$/.test(parts[0])) return null;
  const make = parts[1];
  const model = parts.slice(2).join(" ");
  if (!make || !model) return null;
  return { make, model, year: Number.parseInt(parts[0], 10) };
}

/** Cache/lock identity. Mirrors the tables' (lower(make), lower(model), year) index. */
export const oemDocKeyString = (k: OemDocKey): string =>
  `${k.make.toLowerCase()}|${k.model.toLowerCase()}|${k.year ?? ""}`;

export interface ResolvedOemMake {
  /** Manufacturer domains a result must be hosted on. */
  domains: string[];
  /** The make to SEARCH with — may differ from the stored key. */
  make: string;
  /** The model to SEARCH with — may differ from the stored key. */
  model: string;
}

/**
 * Resolve a make to its official domains, tolerating two-word makes.
 *
 * Everything that parses `ymm` takes the second word as the make, so
 * "2024 Land Rover Range Rover Sport" arrives as make "Land" / model
 * "Rover Range Rover Sport" and matched no manufacturer at all — the harvest
 * answered make_not_supported for every Land Rover, Alfa Romeo and Aston
 * Martin on the lot. Rejoining the first model word fixes the SEARCH.
 *
 * It deliberately does not fix the stored key: the passport queries make
 * "Land", so that is what the row has to be filed under.
 */
export function resolveOemMake(
  make: string,
  model: string,
  domainsFor: Record<string, string[]>,
): ResolvedOemMake | null {
  const direct = domainsFor[make.trim().toLowerCase()];
  if (direct) return { domains: direct, make: make.trim(), model: model.trim() };
  const words = model.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const joined = `${make.trim()} ${words[0]}`;
    const two = domainsFor[joined.toLowerCase()];
    if (two) return { domains: two, make: joined, model: words.slice(1).join(" ") };
  }
  return null;
}
