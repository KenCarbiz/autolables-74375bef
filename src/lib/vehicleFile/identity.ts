// Identity: who this vehicle is, and which record says so.
//
// Twelve of the read model's fields describe the car itself rather than the
// deal. They look like the easy ones, and they are the ones the maps found
// most quietly wrong:
//
//   - `vehicle_listings` has no year, make or model column. There is only
//     the free-text `ymm` string, which five different parsers split five
//     different ways (DUPLICATE_READ_PATHS.md §C2). This module reuses the
//     shared `parseYmm` and then emits the feed's own `make`/`model` keys as
//     separate candidates, so a mis-split shows up as a disagreement instead
//     of as a confident wrong answer.
//   - `mc_attributes.engine/transmission/drivetrain/fuel_type/body_type` are
//     written from the NeoVIN decode by `marketcheck-specs` and then rebuilt
//     from the syndication feed by the nightly `marketcheck-sync`, which does
//     not carry them in `DECODE_OWNED_KEYS`. The steady-state value in that
//     column is the feed's, so the manufacturer candidate is taken from
//     `neovin_snapshots.payload` and never from the column
//     (SOURCE_TO_FACT_MATRIX.md §3.2, §8 cross-cutting (i)).
//   - `vehicle_facts` is a derived ledger whose `observed_at` is the time the
//     orchestrator ran. A fact is emitted here only with the provider and the
//     retrieval stamp of the `vehicle_source_records` row it came from.

import { parseYmm } from "../factorySticker/ymm.ts";
import { precedenceFor, type Confidence, type SourceKind } from "../vehicleTruth/precedence.ts";
import type { FieldCandidate, IdentitySection, LicenseClass } from "./readModelTypes.ts";
import { resolveField, semanticallySame } from "./resolveField.ts";
import { dig, iso, num, obj, str, type Row, type VehicleFileSources } from "./sources.ts";

// ── Provider names (who said it) ────────────────────────────────────

const FEED = "MarketCheck syndication feed";
const FEED_BUILD = "MarketCheck syndication feed (verbatim build object)";
const FEED_COLUMN = "MarketCheck listing attributes column (feed-rebuilt nightly)";
const NEOVIN_SHEET = "NeoVIN build sheet";
const NEOVIN_DECODE = "NeoVIN decode snapshot";
const DEALER_ROW = "Dealer inventory row";
const DEALER_FILE = "Dealer vehicle file";

// CUSTOMER_DISPLAY_LICENSE_MATRIX.md rows 21 (NeoVIN build) and 22 (feed
// build object) are both UNKNOWN-REVIEW REQUIRED, and every identity value
// except the VIN itself is one or the other.
const PROVIDER_RECORD: LicenseClass = "UNKNOWN_REVIEW_REQUIRED";
// Row 31: the VIN is a dealer-owned identifier, cleared to display as the
// dealer's own claim. That clearance covers the claim, not the provider row
// the claim happens to be stored in; the notes below carry that split
// because `FieldCandidate` has one licence field, not two.
const DEALER_IDENTIFIER: LicenseClass = "CUSTOMER_DISPLAY_CLEARED";

const OVERWRITTEN_NIGHTLY =
  "marketcheck-specs writes the NeoVIN decode into this column and the nightly marketcheck-sync "
  + "rebuild overwrites it from the feed build object (DECODE_OWNED_KEYS does not carry it forward), "
  + "so the steady-state value is the feed's and this candidate can never be VERIFIED.";

const FEED_RECORD_NOTE =
  "Dealer-owned claim (CUSTOMER DISPLAY CLEARED); the stored record is the MarketCheck syndication "
  + "row, whose redistribution is UNKNOWN-REVIEW REQUIRED.";

const FILE_FROM_FEED_NOTE =
  "vehicle_files identity columns are written by marketcheck-sync from the feed build object, not by "
  + "a dealer confirmation, so this is not claimed as verified dealer knowledge.";

// ── Stamps ──────────────────────────────────────────────────────────

/**
 * MarketCheck stamps `last_seen_at` / `scraped_at` as epoch seconds, which
 * `Date.parse` rejects. Without this every feed-written value would report
 * an unknown observation time and no feed field could ever be aged.
 */
const stamp = (value: unknown): string | null => {
  const s = str(value);
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) {
    const n = Number(s);
    return new Date(s.length > 10 ? n : n * 1000).toISOString();
  }
  return iso(s);
};

// ── VIN ─────────────────────────────────────────────────────────────

const VIN_SHAPE = /^[A-HJ-NPR-Z0-9]{17}$/;
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_LETTER_VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

/**
 * A VIN that fails ISO 3779 is not a weak candidate, it is a different car
 * or a typo, and the whole file is joined on `upper(vin)`. Returned
 * upper-cased so a lower-case row cannot present as a disagreement.
 * All 285 live `vehicle_listings` rows pass, so this rejects nothing real.
 */
export const validVin = (value: unknown): string | null => {
  const raw = str(value);
  if (!raw) return null;
  const vin = raw.toUpperCase();
  if (!VIN_SHAPE.test(vin)) return null;
  let total = 0;
  for (let i = 0; i < 17; i += 1) {
    const ch = vin[i];
    const digit = ch >= "0" && ch <= "9" ? Number(ch) : VIN_LETTER_VALUES[ch];
    if (digit === undefined) return null;
    total += digit * VIN_WEIGHTS[i];
  }
  const remainder = total % 11;
  return vin[8] === (remainder === 10 ? "X" : String(remainder)) ? vin : null;
};

// ── Candidate assembly ──────────────────────────────────────────────

interface Spec<T> {
  value: T | null | undefined;
  source: SourceKind;
  origin: string;
  provider: string;
  observedAt: string | null;
  confidence: Confidence;
  license: LicenseClass;
  note?: string;
}

const add = <T>(into: Array<FieldCandidate<T>>, spec: Spec<T>): void => {
  if (spec.value === null || spec.value === undefined || spec.value === "") return;
  const candidate: FieldCandidate<T> = {
    value: spec.value,
    source: spec.source,
    origin: spec.origin,
    provider: spec.provider,
    observedAt: spec.observedAt,
    confidence: spec.confidence,
    license: spec.license,
  };
  if (spec.note) candidate.note = spec.note;
  into.push(candidate);
};

// ── vehicle_facts, re-provenanced ───────────────────────────────────

/** Truth-engine fact key -> read-model field key. */
const FACT_KEY_TO_FIELD: Record<string, string> = {
  make: "make",
  model: "model",
  model_year: "year",
  trim: "trim",
  body_configuration: "body_style",
  engine: "engine",
  drivetrain: "drivetrain",
  transmission: "transmission",
  fuel_type: "fuel_type",
  exterior_color: "exterior_color",
  interior_color: "interior_color",
};

const SOURCE_NAME_TO_PROVIDER: Record<string, string> = {
  marketcheck_listing: FEED,
  neovin_build_sheet: NEOVIN_SHEET,
};

const KIND_TO_PROVIDER: Record<string, string> = {
  marketcheck: FEED,
  neovin: NEOVIN_SHEET,
  dealer_confirmed: DEALER_ROW,
  dealer_vdp: "Dealer VDP observation",
  vin_decode: "VIN decode",
  oem_authorized: "OEM authorized data",
  other_structured: "Other structured provider",
  ai_inference: "AI inference",
};

const CONFIDENCES: Confidence[] = ["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"];
const asConfidence = (value: unknown): Confidence => {
  const s = str(value)?.toUpperCase();
  return CONFIDENCES.find((c) => c === s) ?? "UNVERIFIED";
};

const SOURCE_KINDS_SET = new Set<string>([
  "oem_authorized", "neovin", "marketcheck", "dealer_confirmed",
  "vin_decode", "dealer_vdp", "other_structured", "ai_inference",
]);

/**
 * Emit the derived ledger as candidates without laundering it into a source.
 *
 * `vehicle_facts.observed_at` is the orchestration time — it is stamped when
 * `refreshVehicleTruth` runs and never refreshed for a published vehicle — so
 * it is deliberately not read. The stamp comes from the
 * `vehicle_source_records` row named in `evidence.sourceRecordId`; when there
 * is no such row the candidate is unstamped, and the resolver reports UNKNOWN
 * rather than inventing an age.
 */
const factCandidates = (sources: VehicleFileSources): Map<string, Array<FieldCandidate<unknown>>> => {
  const records = new Map<string, Row>();
  for (const record of sources.sourceRecords) {
    const id = str(record.id);
    if (id) records.set(id, record);
  }

  const byField = new Map<string, Array<FieldCandidate<unknown>>>();
  for (const fact of sources.facts) {
    const factKey = str(fact.fact_key);
    const field = factKey ? FACT_KEY_TO_FIELD[factKey] : undefined;
    if (!factKey || !field) continue;

    const value = obj(fact.fact_value).v;
    if (value === null || value === undefined || value === "") continue;

    const kind = str(fact.source_kind) ?? "";
    if (!SOURCE_KINDS_SET.has(kind)) continue;

    const recordId = str(dig(fact.evidence, "sourceRecordId"));
    const record = recordId ? records.get(recordId) ?? null : null;
    const sourceName = record ? str(record.source_name) : null;
    const provider = (sourceName ? SOURCE_NAME_TO_PROVIDER[sourceName] : undefined)
      ?? KIND_TO_PROVIDER[kind]
      ?? kind;

    const list = byField.get(field) ?? [];
    add<unknown>(list, {
      value,
      source: kind as SourceKind,
      origin: `vehicle_facts.fact_value->>'v' (fact_key=${factKey})`
        + (sourceName ? ` <- vehicle_source_records.${sourceName}` : ""),
      provider,
      observedAt: record ? iso(record.retrieved_at) : null,
      confidence: asConfidence(fact.confidence),
      license: PROVIDER_RECORD,
      note: record
        ? "Derived truth-ledger row; aged by vehicle_source_records.retrieved_at, never by "
          + "vehicle_facts.observed_at (orchestration time)."
        : "Derived truth-ledger row with no linked source record, so nothing stamps when the "
          + "source observed it; vehicle_facts.observed_at is orchestration time and is not used.",
    });
    byField.set(field, list);
  }
  return byField;
};

const stringFacts = (
  byField: Map<string, Array<FieldCandidate<unknown>>>,
  field: string,
): Array<FieldCandidate<string>> =>
  (byField.get(field) ?? [])
    .map((c) => {
      const value = str(c.value);
      return value ? { ...c, value } : null;
    })
    .filter((c): c is FieldCandidate<string> => c !== null);

const numberFacts = (
  byField: Map<string, Array<FieldCandidate<unknown>>>,
  field: string,
): Array<FieldCandidate<number>> =>
  (byField.get(field) ?? [])
    .map((c) => {
      const value = num(c.value);
      return value === null ? null : { ...c, value };
    })
    .filter((c): c is FieldCandidate<number> => c !== null);

const modelYear = (value: unknown): number | null => {
  const n = num(value);
  if (n === null || !Number.isInteger(n) || n < 1950 || n > 2100) return null;
  return n;
};

export interface BuildIdentityOptions {
  now?: number;
  configuredOrder?: SourceKind[] | null;
}

/**
 * `vin` is not in the truth engine's DEALER_CONTROLLED set, so the default
 * ordering would let a NeoVIN snapshot — whose VIN is an echo of the VIN we
 * asked it about, not an independent observation — outrank the dealer row the
 * whole file is keyed on. Borrowing the engine's own dealer-controlled order
 * (rather than writing a sixth ranking here) keeps the record of identity on
 * top without duplicating precedence.
 */
const VIN_ORDER: SourceKind[] = precedenceFor("stock_number");

export function buildIdentity(
  sources: VehicleFileSources,
  opts: BuildIdentityOptions = {},
): IdentitySection {
  const now = opts.now ?? Date.now();
  const order = opts.configuredOrder ?? null;
  const listing = sources.listing ?? {};
  const file = sources.file ?? {};
  const mc = obj(listing.mc_attributes);
  const mcRaw = obj(listing.mc_raw);
  const feedBuild = obj(mcRaw.build);
  const sheet = obj(mc.build_sheet);
  const sheetIsNeovin = str(sheet.source)?.toLowerCase() === "neovin";
  const neovinRow = sources.neovin ?? {};
  const neo = obj(neovinRow.payload);

  // The feed's own "when did we last see this listing" stamp, preferred over
  // our write times: `updated_at` records when the sync ran, not when
  // MarketCheck observed the car.
  const feedAt = stamp(mcRaw.last_seen_at_date)
    ?? stamp(mc.last_seen_at)
    ?? stamp(mcRaw.last_seen_at)
    ?? stamp(mc.scraped_at);
  const sheetAt = stamp(sheet.decoded_at) ?? stamp(mc.specs_decoded_at);
  const neoAt = iso(neovinRow.fetched_at);
  const fileAt = iso(file.updated_at);

  const facts = factCandidates(sources);
  const resolve = <T>(key: string, candidates: Array<FieldCandidate<T>>) =>
    resolveField<T>(key, candidates, { now, configuredOrder: order });

  // ── VIN ───────────────────────────────────────────────────────────
  const vins: Array<FieldCandidate<string>> = [];
  const listingVinRaw = str(listing.vin);
  const listingVin = validVin(listingVinRaw);
  const caseNote = listingVinRaw && listingVin && listingVinRaw !== listingVin
    ? ` Stored as "${listingVinRaw}"; every join in this file uses upper(vin).`
    : "";
  add(vins, {
    value: listingVin,
    source: "dealer_confirmed",
    origin: "vehicle_listings.vin",
    provider: mc.mc_listing_id ? `${DEALER_ROW} (record written by ${FEED})` : DEALER_ROW,
    observedAt: mc.mc_listing_id ? feedAt : null,
    confidence: "VERIFIED",
    license: DEALER_IDENTIFIER,
    note: `Key of record for this vehicle. ${mc.mc_listing_id ? FEED_RECORD_NOTE : "No MarketCheck listing id on this row, so the writer of the record is UNKNOWN."}${caseNote}`,
  });
  add(vins, {
    value: validVin(file.vin),
    source: "dealer_confirmed",
    origin: "vehicle_files.vin",
    provider: DEALER_FILE,
    observedAt: fileAt,
    confidence: "HIGH",
    license: DEALER_IDENTIFIER,
  });
  add(vins, {
    value: validVin(mcRaw.vin),
    source: "marketcheck",
    origin: "vehicle_listings.mc_raw->>'vin'",
    provider: FEED,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(vins, {
    value: validVin(neovinRow.vin),
    source: "neovin",
    origin: "neovin_snapshots.vin",
    provider: NEOVIN_DECODE,
    observedAt: neoAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: "The VIN the decode was requested for, echoed back; not independent corroboration.",
  });

  // ── Year / make / model, from the unsplit ymm plus the feed's own keys ──
  const parsed = parseYmm(str(listing.ymm));
  const feedMake = str(mc.make);
  const neoMake = str(neo.make);
  const reference = feedMake ?? neoMake;
  const splitDisagrees = Boolean(
    parsed.make && reference && !semanticallySame(parsed.make, reference),
  );
  const splitNote = splitDisagrees
    ? `parseYmm split "${str(listing.ymm)}" to make "${parsed.make}" while ${feedMake ? FEED : NEOVIN_DECODE} `
      + `says "${reference}". Both candidates are emitted so the split is visible rather than assumed.`
    : undefined;

  // The feed's own year/make/model keys are emitted BEFORE the parse of the
  // concatenated `ymm` string. Both are MarketCheck at HIGH with the same
  // stamp, so nothing in the ranking separates them and insertion order
  // decides: the unsplit key that the provider wrote is better evidence than
  // any split of a string it was concatenated into. On "2024 Range Rover
  // Sport" the parse yields the model "Sport" and the feed key "Range Rover
  // Sport"; letting the parse win there is exactly the defect §C2 names.
  const years: Array<FieldCandidate<number>> = [];
  add(years, {
    value: modelYear(mc.year),
    source: "marketcheck",
    origin: "vehicle_listings.mc_attributes.year",
    provider: FEED,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(years, {
    value: modelYear(parsed.year),
    source: "marketcheck",
    origin: "vehicle_listings.ymm -> parseYmm().year",
    provider: `${FEED} (parsed from the unsplit ymm string)`,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(years, {
    value: modelYear(file.year),
    source: "dealer_confirmed",
    origin: "vehicle_files.year",
    provider: DEALER_FILE,
    observedAt: fileAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: FILE_FROM_FEED_NOTE,
  });
  add(years, {
    value: modelYear(neo.year),
    source: "neovin",
    origin: "neovin_snapshots.payload.year",
    provider: NEOVIN_DECODE,
    observedAt: neoAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  years.push(...numberFacts(facts, "year"));

  const makes: Array<FieldCandidate<string>> = [];
  add(makes, {
    value: feedMake,
    source: "marketcheck",
    origin: "vehicle_listings.mc_attributes.make",
    provider: FEED,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(makes, {
    value: parsed.make || null,
    source: "marketcheck",
    origin: "vehicle_listings.ymm -> parseYmm().make",
    provider: `${FEED} (parsed from the unsplit ymm string)`,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: splitNote,
  });
  add(makes, {
    value: str(file.make),
    source: "dealer_confirmed",
    origin: "vehicle_files.make",
    provider: DEALER_FILE,
    observedAt: fileAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: FILE_FROM_FEED_NOTE,
  });
  add(makes, {
    value: neoMake,
    source: "neovin",
    origin: "neovin_snapshots.payload.make",
    provider: NEOVIN_DECODE,
    observedAt: neoAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  makes.push(...stringFacts(facts, "make"));

  const models: Array<FieldCandidate<string>> = [];
  add(models, {
    value: str(mc.model),
    source: "marketcheck",
    origin: "vehicle_listings.mc_attributes.model",
    provider: FEED,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(models, {
    value: parsed.model || null,
    source: "marketcheck",
    origin: "vehicle_listings.ymm -> parseYmm().model",
    provider: `${FEED} (parsed from the unsplit ymm string)`,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: splitNote,
  });
  add(models, {
    value: str(file.model),
    source: "dealer_confirmed",
    origin: "vehicle_files.model",
    provider: DEALER_FILE,
    observedAt: fileAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: FILE_FROM_FEED_NOTE,
  });
  add(models, {
    value: str(neo.model),
    source: "neovin",
    origin: "neovin_snapshots.payload.model",
    provider: NEOVIN_DECODE,
    observedAt: neoAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  models.push(...stringFacts(facts, "model"));

  // ── Trim ──────────────────────────────────────────────────────────
  const trims: Array<FieldCandidate<string>> = [];
  add(trims, {
    value: str(listing.trim),
    source: "marketcheck",
    origin: "vehicle_listings.trim",
    provider: FEED,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(trims, {
    value: str(mc.trim),
    source: "marketcheck",
    origin: "vehicle_listings.mc_attributes.trim",
    provider: FEED,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(trims, {
    value: str(file.trim),
    source: "dealer_confirmed",
    origin: "vehicle_files.trim",
    provider: DEALER_FILE,
    observedAt: fileAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: FILE_FROM_FEED_NOTE,
  });
  add(trims, {
    value: str(neo.trim),
    source: "neovin",
    origin: "neovin_snapshots.payload.trim",
    provider: NEOVIN_DECODE,
    observedAt: neoAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  trims.push(...stringFacts(facts, "trim"));

  // ── Body style ────────────────────────────────────────────────────
  const bodies: Array<FieldCandidate<string>> = [];
  add(bodies, {
    value: str(mc.body_type) ?? str(mc.body_style),
    source: "marketcheck",
    origin: str(mc.body_type)
      ? "vehicle_listings.mc_attributes.body_type"
      : "vehicle_listings.mc_attributes.body_style",
    provider: FEED_COLUMN,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: OVERWRITTEN_NIGHTLY,
  });
  add(bodies, {
    value: str(feedBuild.body_type),
    source: "marketcheck",
    origin: "vehicle_listings.mc_raw->'build'->>'body_type'",
    provider: FEED_BUILD,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(bodies, {
    value: str(neo.body_type),
    source: "neovin",
    origin: "neovin_snapshots.payload.body_type",
    provider: NEOVIN_DECODE,
    observedAt: neoAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  bodies.push(...stringFacts(facts, "body_style"));

  // ── Colours ───────────────────────────────────────────────────────
  // `mc_attributes.exterior_color` is written from the feed LISTING field,
  // not the build object, and marketcheck-specs never touches it, so it
  // carries no overwrite caveat. `base_ext_color` is the colour family
  // ("Black"), a different question, and is deliberately not a candidate.
  const exteriors: Array<FieldCandidate<string>> = [];
  add(exteriors, {
    value: str(mc.exterior_color),
    source: "marketcheck",
    origin: "vehicle_listings.mc_attributes.exterior_color",
    provider: FEED,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(exteriors, {
    value: str(mcRaw.exterior_color),
    source: "marketcheck",
    origin: "vehicle_listings.mc_raw->>'exterior_color'",
    provider: FEED_BUILD,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(exteriors, {
    value: sheetIsNeovin ? str(dig(sheet, "colors", "exterior", "name")) : null,
    source: "neovin",
    origin: "vehicle_listings.mc_attributes.build_sheet.colors.exterior.name",
    provider: NEOVIN_SHEET,
    observedAt: sheetAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  add(exteriors, {
    value: str(dig(neo, "exterior_color", "name")),
    source: "neovin",
    origin: "neovin_snapshots.payload.exterior_color.name",
    provider: NEOVIN_DECODE,
    observedAt: neoAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  exteriors.push(...stringFacts(facts, "exterior_color"));

  const interiors: Array<FieldCandidate<string>> = [];
  add(interiors, {
    value: str(mc.interior_color),
    source: "marketcheck",
    origin: "vehicle_listings.mc_attributes.interior_color",
    provider: FEED,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(interiors, {
    value: str(mcRaw.interior_color),
    source: "marketcheck",
    origin: "vehicle_listings.mc_raw->>'interior_color'",
    provider: FEED_BUILD,
    observedAt: feedAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
  });
  add(interiors, {
    value: sheetIsNeovin ? str(dig(sheet, "colors", "interior", "name")) : null,
    source: "neovin",
    origin: "vehicle_listings.mc_attributes.build_sheet.colors.interior.name",
    provider: NEOVIN_SHEET,
    observedAt: sheetAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  add(interiors, {
    value: str(dig(neo, "interior_color", "name")),
    source: "neovin",
    origin: "neovin_snapshots.payload.interior_color.name",
    provider: NEOVIN_DECODE,
    observedAt: neoAt,
    confidence: "VERIFIED",
    license: PROVIDER_RECORD,
  });
  interiors.push(...stringFacts(facts, "interior_color"));

  // ── Mechanical: the four keys the nightly sync overwrites ──────────
  const mechanical = (
    field: string,
    columnValue: string | null,
    columnOrigin: string,
    buildValue: string | null,
    buildOrigin: string,
    neoValue: string | null,
    neoOrigin: string,
  ): Array<FieldCandidate<string>> => {
    const out: Array<FieldCandidate<string>> = [];
    // When the column and the verbatim feed build object disagree, the column
    // is still holding the NeoVIN write from the last decode and the next sync
    // will erase it. Naming the provider "the feed" in that state would be the
    // hard-coded label the directive forbids.
    const diverged = Boolean(columnValue && buildValue && columnValue !== buildValue);
    add(out, {
      value: columnValue,
      source: "marketcheck",
      origin: columnOrigin,
      provider: diverged ? `${FEED_COLUMN}, writer unresolved` : FEED_COLUMN,
      observedAt: feedAt,
      confidence: "HIGH",
      license: PROVIDER_RECORD,
      note: diverged
        ? `${OVERWRITTEN_NIGHTLY} This column currently differs from the verbatim feed build object, `
          + "so it may still hold the NeoVIN write; the next sync will replace it."
        : OVERWRITTEN_NIGHTLY,
    });
    add(out, {
      value: buildValue,
      source: "marketcheck",
      origin: buildOrigin,
      provider: FEED_BUILD,
      observedAt: feedAt,
      confidence: "HIGH",
      license: PROVIDER_RECORD,
    });
    add(out, {
      value: neoValue,
      source: "neovin",
      origin: neoOrigin,
      provider: NEOVIN_DECODE,
      observedAt: neoAt,
      confidence: "VERIFIED",
      license: PROVIDER_RECORD,
      note: "The manufacturer answer, read from the decode snapshot because mc_attributes.build_sheet "
        + "carries no mechanical keys and the mc_attributes column is feed-rebuilt nightly.",
    });
    out.push(...stringFacts(facts, field));
    return out;
  };

  const engines = mechanical(
    "engine",
    str(mc.engine),
    "vehicle_listings.mc_attributes.engine",
    str(feedBuild.engine),
    "vehicle_listings.mc_raw->'build'->>'engine'",
    str(neo.engine),
    "neovin_snapshots.payload.engine",
  );
  const drivetrains = mechanical(
    "drivetrain",
    str(mc.drivetrain) ?? str(mc.drive_type),
    str(mc.drivetrain)
      ? "vehicle_listings.mc_attributes.drivetrain"
      : "vehicle_listings.mc_attributes.drive_type",
    str(feedBuild.drivetrain),
    "vehicle_listings.mc_raw->'build'->>'drivetrain'",
    str(neo.drivetrain),
    "neovin_snapshots.payload.drivetrain",
  );
  // marketcheck-specs writes `transmission_description ?? transmission` from
  // NeoVIN, so the same key is read back here; emitting both would stage two
  // VERIFIED NeoVIN candidates against each other and report a dispute that
  // does not exist.
  const neoTransmission = str(neo.transmission_description) ?? str(neo.transmission);
  const transmissions = mechanical(
    "transmission",
    str(mc.transmission),
    "vehicle_listings.mc_attributes.transmission",
    str(feedBuild.transmission),
    "vehicle_listings.mc_raw->'build'->>'transmission'",
    neoTransmission,
    str(neo.transmission_description)
      ? "neovin_snapshots.payload.transmission_description"
      : "neovin_snapshots.payload.transmission",
  );
  const fuels = mechanical(
    "fuel_type",
    str(mc.fuel_type),
    "vehicle_listings.mc_attributes.fuel_type",
    str(feedBuild.fuel_type),
    "vehicle_listings.mc_raw->'build'->>'fuel_type'",
    str(neo.fuel_type),
    "neovin_snapshots.payload.fuel_type",
  );

  return {
    vin: resolveField<string>("vin", vins, {
      now,
      configuredOrder: opts.configuredOrder ?? VIN_ORDER,
    }),
    year: resolve("year", years),
    make: resolve("make", makes),
    model: resolve("model", models),
    trim: resolve("trim", trims),
    bodyStyle: resolve("body_style", bodies),
    exteriorColor: resolve("exterior_color", exteriors),
    interiorColor: resolve("interior_color", interiors),
    engine: resolve("engine", engines),
    drivetrain: resolve("drivetrain", drivetrains),
    transmission: resolve("transmission", transmissions),
    fuelType: resolve("fuel_type", fuels),
  };
}
