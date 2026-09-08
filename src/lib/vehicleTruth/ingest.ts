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

import { parseYmm } from "../factorySticker/ymm.ts";
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
  certification?: Record<string, unknown> | null;
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

    // The decoder writes extracted Monroney pricing to `build_sheet.pricing`,
    // while the rest of the system reads it from the top level of
    // mc_attributes. Reading both recovers pricing already retrieved and
    // stored — without it a vehicle can hold a complete base/destination/
    // total set and still print no MSRP.
    const sheetPricing = (sheet.pricing && typeof sheet.pricing === "object"
      ? sheet.pricing
      : {}) as Record<string, unknown>;
    // Deliberately NOT falling back to `mc.msrp`. That field is the feed's
    // current asking/market figure, not a manufacturer price: on the real
    // 2019 Q50 (JN1FV7AR5KM800521) it reads 27,887 while the vehicle's
    // actual base MSRP was 53,350. Printing the former as "Base MSRP" would
    // put a fabricated manufacturer price on a compliance document, so an
    // unknown base MSRP stays unknown.
    push(out, "base_msrp",
      posNum(mc.base_msrp ?? sheetPricing.base_msrp), sheetSource, confidence, sheetAt, recordId);
    push(out, "destination_charge",
      posNum(mc.delivery_charges ?? mc.destination_charge ?? sheetPricing.destination_charge), sheetSource, confidence, sheetAt, recordId);
    push(out, "total_msrp",
      posNum(mc.total_msrp ?? mc.sticker_total_msrp ?? sheetPricing.total_msrp), sheetSource, confidence, sheetAt, recordId);

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

// ── Vehicle history ──────────────────────────────────────────────────
//
// One-owner, clean title and certification are the three claims a shopper
// weighs most and a seller has the least standing to make unaided, so they
// are resolved by provenance rather than read as bare booleans.
//
// The flags live in `mc_attributes` next to each other, but they do not all
// come from the same place: MarketCheck relays two of them, the crawler
// harvests the rest off the dealer's published page, and the writer records
// which by tagging the value. That tag is the whole mechanism -- without it
// a badge scraped from a page is indistinguishable from a provider's flag.

/**
 * A stored provenance tag mapped onto how far it may be trusted.
 *
 * An UNRECOGNISED tag falls to `ai_inference`, not to a structured default.
 * That is deliberate: a tag nobody has vouched for is exactly the case that
 * put a sentence from our own generated description into the clean-title
 * flag, and defaulting unknown provenance to "structured" is how that
 * happens again. Unknown means untrusted.
 */
const HISTORY_SOURCE_KINDS: Record<string, SourceKind> = {
  dealer_vdp: "dealer_vdp",
  marketcheck: "marketcheck",
  feed: "marketcheck",
  manual: "dealer_confirmed",
  dealer: "dealer_confirmed",
  dealer_confirmed: "dealer_confirmed",
  // Free text, whichever domain it was published on. AutoLabels writes the
  // descriptions that appear on dealer sites, so "it was on their page" says
  // nothing about who made the claim.
  description: "ai_inference",
  dealer_description: "ai_inference",
  autolabels_description: "ai_inference",
};

export function historySourceKind(tag: unknown, fallback: SourceKind): SourceKind {
  const t = typeof tag === "string" ? tag.trim().toLowerCase() : "";
  if (!t) return fallback;
  return HISTORY_SOURCE_KINDS[t] ?? "ai_inference";
}

/**
 * Candidate history facts from one stored listing row.
 *
 * Separate from `candidatesFromListing` because these facts have their own
 * authority — neither party to the sale owns them — and because the crawler
 * writes them on a different schedule from the feed sync.
 */
export function candidatesFromHistory(
  listing: TruthListingRow,
  options: IngestOptions = {},
): IngestCandidate[] {
  const out: IngestCandidate[] = [];
  const mc = (listing.mc_attributes ?? {}) as Record<string, unknown>;
  const at = options.retrievedAt ?? null;
  const ids = options.sourceRecordIds ?? {};

  // `false` is carried as well as `true`. A provider saying "not a one-owner"
  // is a statement, and it has to be rankable against a badge that says
  // otherwise — which is how a scraped `true` gets overruled rather than
  // silently winning because nothing contradicted it.
  if (typeof mc.carfax_1_owner === "boolean") {
    const src = historySourceKind(mc.one_owner_source, "marketcheck");
    push(out, "carfax_one_owner", mc.carfax_1_owner, src, "HIGH", at, ids[src]);
  }
  if (typeof mc.carfax_clean_title === "boolean") {
    const src = historySourceKind(mc.clean_title_source, "marketcheck");
    push(out, "carfax_clean_title", mc.carfax_clean_title, src, "HIGH", at, ids[src]);
  }

  const owners = posNum(mc.owner_count);
  if (owners !== undefined) {
    push(out, "owner_count", owners, "marketcheck", "HIGH", at, ids.marketcheck);
  }
  const brand = str(mc.title_brand) ?? str(mc.title_status);
  if (brand) push(out, "title_brand", brand, "marketcheck", "HIGH", at, ids.marketcheck);

  // Certification, from two independent angles. `condition === "cpo"` is
  // derived from MarketCheck's is_certified, so it cannot corroborate the
  // feed flag — it IS the feed flag. The dealer's published page is the
  // separate assertion, and it is tagged as such.
  const cert = (listing.certification ?? {}) as Record<string, unknown>;
  if (cert.certified === true) {
    const src = historySourceKind(cert.source, "dealer_confirmed");
    push(out, "certified_pre_owned", true, src, "HIGH", str(cert.verified_at) ?? at, ids[src]);
  }
  if (listing.condition === "cpo") {
    push(out, "certified_pre_owned", true, "marketcheck", "HIGH", at, ids.marketcheck);
  }

  return out;
}
