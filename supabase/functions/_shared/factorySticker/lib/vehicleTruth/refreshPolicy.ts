// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/refreshPolicy.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// When a vehicle is due for a truth refresh.
//
// Vehicle Truth is a property of the VEHICLE. A window sticker is one
// downstream consumer of it, and its lifecycle -- generated, reviewed,
// published, archived -- is a decision about a DOCUMENT. The nightly sticker
// sweep is right to leave a settled document alone, because regenerating one
// behind the dealership's back replaces what a customer is already looking
// at. But facts and snapshots were only ever written inside that same
// pipeline, so the document's terminal state also froze the vehicle's truth:
// publishing a sticker stopped the vehicle re-resolving, and a vehicle whose
// sticker was archived before any fact was written never got one at all.
//
// This module is the other half of that separation. Refresh eligibility is
// decided from the age of the resolved truth alone, and a refresh writes only
// truth -- a new snapshot version when something material moved, and a stale
// flag on the documents built from the old one. Deciding what to do about a
// stale document stays where it already lives: with the human reading that
// queue. Nothing here regenerates or republishes anything.
//
// `stickerStatus` rides along on the candidate because the caller already has
// it and reports it back, and is deliberately never read by any rule below.
// No sticker state may decide whether a vehicle's truth is allowed to
// re-resolve.

export type TruthRefreshMode = "only_missing" | "due" | "all";

export const TRUTH_REFRESH_MODES: TruthRefreshMode[] = ["only_missing", "due", "all"];

// A nightly cadence must not skip a vehicle because the previous pass ran 23
// hours ago rather than 24, and the several passes of one night must not
// re-resolve what the first pass of that night already did.
export const TRUTH_REFRESH_MIN_AGE_MS = 20 * 60 * 60 * 1000;

export interface TruthRefreshCandidate {
  vehicleId: string;
  tenantId: string | null;
  /** `vehicle_listings.status`. An archived listing is out of inventory. */
  listingStatus?: string | null;
  /** `factory_sticker_records.generation_status`. Reported, never applied. */
  stickerStatus?: string | null;
  /** Latest `vehicle_facts.updated_at` for the vehicle; null when truth has never been written. */
  lastResolvedAt?: string | null;
  hasSnapshot?: boolean;
}

export interface TruthRefreshOptions {
  mode?: TruthRefreshMode;
  now?: number;
  minAgeMs?: number;
  limit?: number;
}

export function parseTruthRefreshMode(
  value: unknown,
  fallback: TruthRefreshMode = "due",
): TruthRefreshMode {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (TRUTH_REFRESH_MODES as string[]).includes(raw) ? (raw as TruthRefreshMode) : fallback;
}

/** Has this vehicle ever resolved? Facts prove it directly; a snapshot proves it happened. */
export function hasResolvedTruth(candidate: TruthRefreshCandidate): boolean {
  return !!candidate.lastResolvedAt || candidate.hasSnapshot === true;
}

export function isRefreshableVehicle(candidate: TruthRefreshCandidate): boolean {
  if (!candidate.vehicleId || !candidate.tenantId) return false;
  return String(candidate.listingStatus ?? "").toLowerCase() !== "archived";
}

export function truthAgeMs(candidate: TruthRefreshCandidate, now: number): number | null {
  if (!candidate.lastResolvedAt) return null;
  const at = Date.parse(candidate.lastResolvedAt);
  return Number.isFinite(at) ? now - at : null;
}

export function isDueForTruthRefresh(
  candidate: TruthRefreshCandidate,
  options: TruthRefreshOptions = {},
): boolean {
  if (!isRefreshableVehicle(candidate)) return false;
  const mode = options.mode ?? "due";
  if (mode === "all") return true;
  if (!hasResolvedTruth(candidate)) return true;
  if (mode === "only_missing") return false;
  const minAgeMs = options.minAgeMs ?? TRUTH_REFRESH_MIN_AGE_MS;
  const age = truthAgeMs(candidate, options.now ?? Date.now());
  // An unparseable timestamp is not evidence of a recent refresh.
  return age === null || age >= minAgeMs;
}

/**
 * The worklist, oldest truth first.
 *
 * Ordering by resolution age is what makes the sweep resumable: a pass that
 * runs out of wall clock leaves the vehicles it did not reach at the head of
 * the next pass's list, instead of every pass re-resolving the same head of
 * an `updated_at` ordering and never reaching the tail.
 */
export function selectTruthRefreshWorklist(
  candidates: TruthRefreshCandidate[],
  options: TruthRefreshOptions = {},
): TruthRefreshCandidate[] {
  const now = options.now ?? Date.now();
  const due = candidates.filter((c) => isDueForTruthRefresh(c, { ...options, now }));
  const ordered = due.slice().sort((a, b) => {
    const at = a.lastResolvedAt ? Date.parse(a.lastResolvedAt) : Number.NEGATIVE_INFINITY;
    const bt = b.lastResolvedAt ? Date.parse(b.lastResolvedAt) : Number.NEGATIVE_INFINITY;
    const an = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
    const bn = Number.isFinite(bt) ? bt : Number.NEGATIVE_INFINITY;
    if (an !== bn) return an - bn;
    return a.vehicleId < b.vehicleId ? -1 : a.vehicleId > b.vehicleId ? 1 : 0;
  });
  const limit = options.limit;
  return typeof limit === "number" && limit > 0 ? ordered.slice(0, limit) : ordered;
}

/**
 * How many of the refreshed vehicles carry each sticker state.
 *
 * Reported, not applied: it is the evidence that a settled document no longer
 * excludes its vehicle from re-resolving.
 */
export function countByStickerStatus(
  candidates: TruthRefreshCandidate[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const candidate of candidates) {
    const key = String(candidate.stickerStatus || "NO_RECORD");
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}
