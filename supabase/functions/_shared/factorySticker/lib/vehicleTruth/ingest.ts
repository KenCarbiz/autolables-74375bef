// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/../vehicleTruth/ingest.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Turning stored provider data into candidate facts.
//
// The truth layer resolves candidates; something has to produce them. This
// module is the only place that knows the shape of what we already store —
// `mc_attributes` (MarketCheck listing attributes, plus a NeoVIN
// `build_sheet` when one was purchased) and the dealer-owned columns on
// `vehicle_listings`.
//
// Every candidate carries WHO said it. A value that arrives inside the
// same jsonb blob is not automatically the same source: a NeoVIN build
// sheet and a MarketCheck listing attribute both live in `mc_attributes`,
// and conflating them would let a listing-level guess outrank manufacturer
// build data.

import { parseYmm } from "../ymm.ts";
import type { CandidateFact, Confidence, SourceKind } from "./precedence.ts";
import { capConfidence } from "./precedence.ts";

export interface TruthListingRow {
  id: string;
  vin: string;
  ymm?: string | null;
  trim?: string | null;
  condition?: string | null;
  mileage?: number | null;
  price?: number | string | null;
  stock_number?: string | null;
  features?: unknown;
  mc_attributes?: Record<string, unknown> | null;
}

export interface IngestCandidate extends CandidateFact {
  sourceRecordId?: string;
}

const str = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const posNum = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};

const nameList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x : str((x as Record<string, unknown>)?.name) ?? ""))
    .map((s) => s.trim())
    .filter(Boolean);

const CONDITIONS = new Set(["new", "used", "cpo"]);

/**
 * Is the build sheet real manufacturer build data, or a generic
 * configuration match?
 *
 * `normalizeNeovin` already draws this line to decide whether a sticker is
 * AUTO_VERIFIED; the truth layer has to draw it the same way, or a generic
 * match would be stored as a verified manufacturer fact.
 */
export function buildSheetSource(mc: Record<string, unknown>): SourceKind | null {
  const sheet = mc.build_sheet && typeof mc.build_sheet === "object"
    ? (mc.build_sheet as Record<string, unknown>)
    : null;
  if (!sheet) return null;
  const isNeovin = String(mc.specs_source ?? "") === "neovin" || String(sheet.source ?? "") === "neovin";
  if (isNeovin && sheet.generic !== true) return "neovin";
  return "other_structured";
}

function push(
  out: IngestCandidate[],
  factKey: string,
  value: unknown,
  source: SourceKind,
  confidence: Confidence,
  sourceTimestamp?: string | null,
  sourceRecordId?: string,
): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && !value.trim()) return;
  if (Array.isArray(value) && !value.length) return;
  out.push({
    factKey,
    value,
    source,
    confidence: capConfidence(source, confidence),
    sourceTimestamp: sourceTimestamp ?? undefined,
    ...(sourceRecordId ? { sourceRecordId } : {}),
  });
}

export interface IngestOptions {
  /** When the mc_attributes payload was retrieved. */
  retrievedAt?: string | null;
  /** Source record ids, so each fact keeps its lineage. */
  sourceRecordIds?: Partial<Record<SourceKind, string>>;
}

/**
 * Candidate facts from one stored listing row.
 *
 * Identity comes from `ymm`, which is free text — `vehicle_listings` has no
 * make or model column — so it is parsed with the shared parser rather than
 * split on whitespace. Splitting positionally is what made
 * "2024 Land Rover Defender 110" resolve to the make "Land".
 */
export function candidatesFromListing(
  listing: TruthListingRow,
  options: IngestOptions = {},
): IngestCandidate[] {
  const out: IngestCandidate[] = [];
  const mc = (listing.mc_attributes ?? {}) as Record<string, unknown>;
  const at = options.retrievedAt ?? null;
  const ids = options.sourceRecordIds ?? {};
  const sheetSource = buildSheetSource(mc);
  const sheet = sheetSource
    ? (mc.build_sheet as Record<string, unknown>)
    : null;

  // ── Dealer-owned columns ────────────────────────────────────────────
  // The dealership is authoritative about its own listing. These are the
  // only facts a dealer edit can win outright.
  const condition = str(listing.condition)?.toLowerCase();
  if (condition && CONDITIONS.has(condition)) {
    push(out, "condition", condition, "dealer_confirmed", "VERIFIED", at, ids.dealer_confirmed);
  }
  push(out, "mileage", num(listing.mileage), "dealer_confirmed", "VERIFIED", at, ids.dealer_confirmed);
  push(out, "advertised_price", posNum(listing.price), "dealer_confirmed", "VERIFIED", at, ids.dealer_confirmed);
  push(out, "stock_number", str(listing.stock_number) ?? str(mc.stock_no), "dealer_confirmed", "VERIFIED", at, ids.dealer_confirmed);

  // ── Identity from ymm ───────────────────────────────────────────────
  const parsed = parseYmm(listing.ymm);
  const year = Number(parsed.year);
  push(out, "make", parsed.make || undefined, "marketcheck", "HIGH", at, ids.marketcheck);
  push(out, "model", parsed.model || undefined, "marketcheck", "HIGH", at, ids.marketcheck);
  if (Number.isInteger(year) && year >= 1950 && year <= 2100) {
    push(out, "model_year", year, "marketcheck", "HIGH", at, ids.marketcheck);
  }
  push(out, "trim", str(listing.trim) ?? str(mc.trim), "marketcheck", "HIGH", at, ids.marketcheck);
  push(out, "body_configuration", str(mc.body_type) ?? str(mc.body_style), "marketcheck", "HIGH", at, ids.marketcheck);

  // ── MarketCheck listing attributes ──────────────────────────────────
  const mcAt = str(mc.retrieved_at) ?? at;
  push(out, "engine", str(mc.engine) ?? str(mc.engine_block), "marketcheck", "HIGH", mcAt, ids.marketcheck);
  push(out, "transmission", str(mc.transmission), "marketcheck", "HIGH", mcAt, ids.marketcheck);
  push(out, "drivetrain", str(mc.drivetrain) ?? str(mc.drive_type), "marketcheck", "HIGH", mcAt, ids.marketcheck);
  push(out, "fuel_type", str(mc.fuel_type), "marketcheck", "HIGH", mcAt, ids.marketcheck);
  push(out, "exterior_color", str(mc.exterior_color), "marketcheck", "HIGH", mcAt, ids.marketcheck);
  push(out, "interior_color", str(mc.interior_color), "marketcheck", "HIGH", mcAt, ids.marketcheck);

  // ── Manufacturer build data ─────────────────────────────────────────
  // Present only when a build sheet was actually purchased. Nothing here
  // is synthesized from the listing: a missing build sheet means no
  // manufacturer facts, not weaker ones.
  if (sheet && sheetSource) {
    const confidence: Confidence = sheetSource === "neovin" ? "VERIFIED" : "MEDIUM";
    const sheetAt = str(sheet.retrieved_at) ?? str(mc.specs_retrieved_at) ?? at;
    const recordId = ids[sheetSource];

    push(out, "manufacturer", str(sheet.manufacturer) ?? str(mc.manufacturer), sheetSource, confidence, sheetAt, recordId);
    push(out, "base_msrp", posNum(mc.base_msrp ?? mc.msrp), sheetSource, confidence, sheetAt, recordId);
    push(out, "destination_charge", posNum(mc.delivery_charges ?? mc.destination_charge), sheetSource, confidence, sheetAt, recordId);
    push(out, "total_msrp", posNum(mc.total_msrp ?? mc.sticker_total_msrp), sheetSource, confidence, sheetAt, recordId);

    const packages = (Array.isArray(sheet.packages) ? sheet.packages : []) as Array<Record<string, unknown>>;
    const opts = (Array.isArray(sheet.options) ? sheet.options : []) as Array<Record<string, unknown>>;
    push(out, "factory_packages", nameList(packages), sheetSource, confidence, sheetAt, recordId);
    push(out, "factory_options", nameList(opts), sheetSource, confidence, sheetAt, recordId);

    const optionsTotal = [...packages, ...opts]
      .map((item) => num(item.msrp ?? item.price) ?? 0)
      .reduce((sum, n) => sum + n, 0);
    if (optionsTotal > 0) {
      push(out, "factory_options_total", optionsTotal, sheetSource, confidence, sheetAt, recordId);
    }

    const standard: string[] = [];
    for (const src of [sheet.key_features, sheet.standard]) {
      if (src && typeof src === "object" && !Array.isArray(src)) {
        for (const items of Object.values(src as Record<string, unknown>)) standard.push(...nameList(items));
      }
    }
    push(out, "standard_equipment", standard, sheetSource, confidence, sheetAt, recordId);
  } else {
    // No build sheet. Listing-level feature text is a feed claim, never a
    // manufacturer statement, and must not be presented as one.
    const features = nameList(mc.features).length ? nameList(mc.features) : nameList(listing.features);
    push(out, "standard_equipment", features, "marketcheck", "HIGH", mcAt, ids.marketcheck);
  }

  return out;
}

/**
 * Facts a person entered or corrected.
 *
 * Kept separate from the provider path so a dealer correction is always
 * attributable, and so it can be ranked by `precedenceFor` — winning on the
 * dealer's own stock number, losing to the manufacturer on MSRP.
 */
export function candidatesFromDealerEdits(
  edits: Record<string, unknown>,
  editedAt: string,
): IngestCandidate[] {
  const out: IngestCandidate[] = [];
  for (const [factKey, value] of Object.entries(edits)) {
    if (value === undefined || value === null || value === "") continue;
    out.push({
      factKey: factKey.trim().toLowerCase(),
      value,
      source: "dealer_confirmed",
      confidence: "VERIFIED",
      sourceTimestamp: editedAt,
    });
  }
  return out;
}
