// Zero-call NeoVIN re-promotion.
//
// Decodes bought before promoteNeovinExtras existed stored their full response
// in neovin_snapshots, but the listing never received the lifted fields
// (taxonomy.record_source, provider confidence, factory warranty terms, MSRP
// variants). This rebuilds them from the saved response only. It never calls
// a provider.
//
// Rules, each enforced below and tested:
//   * Only a 2xx snapshot whose payload VIN equals the listing VIN is used.
//   * A payload the parser cannot read is a failure, never an empty decode.
//   * Additive only: a key the listing already holds is never overwritten,
//     and nothing is ever set to null.
//   * The build sheet's provenance is attached only when the sheet rebuilt
//     from the snapshot carries the same equipment as the stored sheet;
//     otherwise the stored sheet came from some other decode and nothing is
//     written. The same holds when a record_source already on the listing
//     disagrees with the snapshot's.
//   * decoded_at is the snapshot's fetched_at, not the time of the backfill,
//     and repromoted_from names the snapshot, its hash and this parser.
//   * Nothing here marks a vehicle factory verified. Whether a record counts
//     as factory build data is decided downstream from record_source and the
//     request tier, which are copied as the provider sent them.

import { structuredSheet } from "./neovinSheet.ts";

export const NEOVIN_REPROMOTION_VERSION = "neovin-repromotion-v1";

export interface SnapshotRow {
  id: string;
  vin: string;
  endpoint: string | null;
  payload: unknown;
  payload_hash: string | null;
  http_status: number | null;
  fetched_at: string;
}

export interface ListingRow {
  id: string;
  vin: string;
  mc_attributes: Record<string, unknown> | null;
}

export type RepromotionOutcome =
  | "no_snapshot"
  | "rejected_http"
  | "rejected_vin_mismatch"
  | "unparseable"
  | "sheet_conflict"
  | "provenance_conflict"
  | "already_current"
  | "would_update";

export interface RepromotionPlan {
  listingId: string;
  outcome: RepromotionOutcome;
  snapshotId: string | null;
  addedKeys: string[];
  /** The complete next mc_attributes, present only for would_update. */
  next: Record<string, unknown> | null;
}

/** The lifted top-level keys, matching marketcheck-specs and DECODE_OWNED_KEYS. */
const LIFTS: [sheetKey: string, topKey: string][] = [
  ["installed_options_msrp", "installed_options_msrp"],
  ["warranty", "factory_warranty"],
  ["msrp_variants", "msrp_variants"],
  ["msrp_label", "msrp_label"],
  ["confidence", "neovin_confidence"],
  ["dimensions_raw", "dimensions_raw"],
  ["country", "country"],
  ["electric_range", "electric_range"],
  ["taxonomy", "taxonomy"],
];

const EQUIPMENT_KEYS = ["packages", "options", "key_features", "standard", "generic"] as const;

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const present = (v: unknown) => v !== undefined && v !== null;

const requestTierOf = (endpoint: string | null): string =>
  !endpoint || !endpoint.includes("/neovin/") ? "basic_decoder"
    : endpoint.includes("include_generic=true") ? "neovin_include_generic" : "neovin_strict";

/** Canonical JSON so key order in jsonb never decides equality. */
const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v as Bag).sort().filter((k) => (v as Bag)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon((v as Bag)[k])}`).join(",")}}`
      : JSON.stringify(v ?? null);

const sameEquipment = (a: Bag, b: Bag): boolean =>
  EQUIPMENT_KEYS.every((k) => canon(a[k] ?? null) === canon(b[k] ?? null));

/** Latest usable snapshot first; ties fall to id so the choice is reproducible. */
export function pickSnapshot(listingVin: string, snapshots: SnapshotRow[]): { snapshot: SnapshotRow | null; rejected: RepromotionOutcome | null } {
  const vin = listingVin.trim().toUpperCase();
  const ordered = [...snapshots].sort((a, b) =>
    Date.parse(b.fetched_at) - Date.parse(a.fetched_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!ordered.length) return { snapshot: null, rejected: "no_snapshot" };
  let firstRejection: RepromotionOutcome | null = null;
  for (const s of ordered) {
    const okHttp = s.http_status != null && s.http_status >= 200 && s.http_status < 300;
    if (!okHttp) { firstRejection ??= "rejected_http"; continue; }
    const payload = bag(s.payload);
    const build = bag(payload.build);
    const payloadVin = String(payload.vin ?? build.vin ?? "").trim().toUpperCase();
    if (String(s.vin).trim().toUpperCase() !== vin || (payloadVin && payloadVin !== vin)) {
      firstRejection ??= "rejected_vin_mismatch";
      continue;
    }
    return { snapshot: s, rejected: null };
  }
  return { snapshot: null, rejected: firstRejection };
}

export function planRepromotion(listing: ListingRow, snapshots: SnapshotRow[]): RepromotionPlan {
  const base = { listingId: listing.id, addedKeys: [] as string[], next: null };
  const { snapshot, rejected } = pickSnapshot(listing.vin, snapshots);
  if (!snapshot) return { ...base, outcome: rejected ?? "no_snapshot", snapshotId: null };

  const payload = bag(snapshot.payload);
  const build = Object.keys(bag(payload.build)).length ? bag(payload.build) : payload;
  const rebuilt = structuredSheet(build) ?? structuredSheet(payload);
  if (!rebuilt) return { ...base, outcome: "unparseable", snapshotId: snapshot.id };

  const tier = requestTierOf(snapshot.endpoint);
  const provenance = {
    request_tier: tier,
    ...(tier === "basic_decoder" ? { source: "basic_decode" } : {}),
    decoded_at: snapshot.fetched_at,
    repromoted_from: {
      snapshot_id: snapshot.id,
      payload_hash: snapshot.payload_hash,
      parser_version: NEOVIN_REPROMOTION_VERSION,
    },
  };

  const mc = { ...bag(listing.mc_attributes) };
  const storedSheet = bag(mc.build_sheet);
  const hasStoredSheet = Object.keys(storedSheet).length > 0;
  if (hasStoredSheet && !sameEquipment(storedSheet, bag(rebuilt))) {
    return { ...base, outcome: "sheet_conflict", snapshotId: snapshot.id };
  }

  // A record_source the listing already holds that disagrees with this
  // snapshot means two decodes are in play; promoting either is a guess.
  const heldSource = bag(mc.taxonomy).record_source ?? bag(storedSheet.taxonomy).record_source;
  const snapSource = bag(bag(rebuilt).taxonomy).record_source;
  if (present(heldSource) && present(snapSource) && heldSource !== snapSource) {
    return { ...base, outcome: "provenance_conflict", snapshotId: snapshot.id };
  }

  const added: string[] = [];
  let nextSheet: Bag;
  if (!hasStoredSheet) {
    nextSheet = { ...bag(rebuilt), ...provenance };
    added.push("build_sheet");
  } else {
    nextSheet = { ...storedSheet };
    const candidate: Bag = { ...bag(rebuilt), ...provenance };
    // decoded_at on a stored sheet already records a decode time; keep it.
    for (const [k, v] of Object.entries(candidate)) {
      if (!present(nextSheet[k]) && present(v)) { nextSheet[k] = v; added.push(`build_sheet.${k}`); }
    }
  }

  const next: Bag = { ...mc, build_sheet: nextSheet };
  for (const [sheetKey, topKey] of LIFTS) {
    const v = bag(rebuilt)[sheetKey];
    if (!present(mc[topKey]) && present(v)) { next[topKey] = v; added.push(topKey); }
  }
  if (!present(mc.specs_source) && tier !== "basic_decoder") { next.specs_source = "neovin"; added.push("specs_source"); }

  if (!added.length) return { ...base, outcome: "already_current", snapshotId: snapshot.id };
  return { listingId: listing.id, outcome: "would_update", snapshotId: snapshot.id, addedKeys: added, next };
}

export function summarize(plans: RepromotionPlan[]): Record<string, unknown> {
  const outcomes: Record<string, number> = {};
  const keys: Record<string, number> = {};
  for (const p of plans) {
    outcomes[p.outcome] = (outcomes[p.outcome] ?? 0) + 1;
    for (const k of p.addedKeys) keys[k] = (keys[k] ?? 0) + 1;
  }
  return { version: NEOVIN_REPROMOTION_VERSION, listings: plans.length, outcomes, addedKeys: keys };
}
