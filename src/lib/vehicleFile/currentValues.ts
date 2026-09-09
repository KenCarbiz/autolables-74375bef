// What the Vehicle File shows a person TODAY, for the twelve critical fields.
//
// This is the control arm of the shadow comparison (directive §50). The
// resolved read model is the other arm; a parity report that compared the
// read model against anything but the code paths actually on screen would be
// measuring itself. So this module is a MIRROR, not an improvement: where the
// served page reads the wrong column, splits a make in half, or renders a
// two-month-old fact with no freshness marker, the value returned here is the
// wrong one, and `origin` names the place it came from.
//
// Field by field, the read this reproduces (all repo-relative):
//
//   vin               `vehicle_listings.vin` — VehicleFile.tsx:301, OverviewTab.tsx:68
//   year/make/model   `vehicle_listings.ymm`, ONE unsplit string — VehicleFile.tsx:282,
//                     OverviewTab.tsx:69. The only splitter the Vehicle File owns is
//                     `ymmParts` in OemDocFinders.tsx:33-40, and it is whitespace-
//                     positional, so a two-word make lands half in `make` and half in
//                     `model` (live: ZASPAKBN5L7C99407, ymm "2020 Alfa Romeo Stelvio").
//   trim              `vehicle_listings.trim` — VehicleFile.tsx:284, OverviewTab.tsx:70
//   stock             seven-candidate client precedence, vehicleStockNumber.ts:38-47,
//                     called at VehicleFile.tsx:161 and printed at :291-298 /
//                     OverviewTab.tsx:71. `vehicle_files.stock_number` is only the THIRD
//                     candidate and reaches the row solely through the patch at
//                     VehicleFile.tsx:105-112 (`vehicle_listings` has no stock_number
//                     column). In the pilot tenant it is the only populated candidate.
//   mileage           `vehicle_listings.mileage` — VehicleFile.tsx:308, OverviewTab.tsx:73
//   advertised_retail `vehicle_listings.price` — VehicleFile.tsx:311, OverviewTab.tsx:74,
//                     labelled "Advertised price" without stating fee-inclusive or not.
//   msrp              NOT in the header or Overview. Rendered only inside VehicleTruthCard
//                     as "Total MSRP", from `vehicle_facts` fact_key `total_msrp`
//                     (VehicleTruthCard.tsx:49,59,199), and only when a `vehicle_snapshots`
//                     row exists (:182). 5 of 130 pilot active listings have none.
//   engine            same card, fact_key `engine` — VehicleTruthCard.tsx:47
//   drivetrain        same card, fact_key `drivetrain` — VehicleTruthCard.tsx:47
//   condition         `vehicle_listings.condition` — VehicleFile.tsx:279, OverviewTab.tsx:72
//
// Two conventions, both chosen so the parity verdict measures data rather than
// formatting:
//
//   1. Values are returned raw (58382, not "$58,382"). The page formats with
//      `toLocaleString`; comparing a formatted string to a resolved number would
//      report UNEXPLAINED on every row.
//   2. A placeholder is an absence, not a value. "Not priced", "Not recorded",
//      "Stock # not on the feed", "Needs VIN decode" and the literal "unknown"
//      that VehicleFile.tsx:279 prints for a null condition all come back as
//      `value: null` with an `origin` that says the field was not filled.

import type { CriticalField } from "./readModelTypes.ts";
import { dig, num, obj, str, type Row, type VehicleFileSources } from "./sources.ts";

export interface CurrentValue {
  /** Exactly what the current code path resolves, wrong values included. */
  value: unknown;
  /** Where that value physically came from, or why nothing is on screen. */
  origin: string;
}

const NO_LISTING =
  "not rendered by the Vehicle File: no vehicle_listings row for this id, so the page renders "
  + "\"Vehicle not found\" (VehicleFile.tsx:139-155)";

const entry = (value: unknown, origin: string): CurrentValue => ({ value, origin });

/**
 * `vehicleStockNumber`'s own coercion (vehicleStockNumber.ts:23), duplicated
 * rather than imported because the mirror needs to know WHICH of the seven
 * candidates produced the value, and the exported function returns only the
 * value. currentValues.test.ts pins the two against each other so they cannot
 * drift apart.
 */
const stockStr = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

interface StockCandidate {
  value: string;
  origin: string;
}

const stockCandidates = (listing: Row, file: Row | null): StockCandidate[] => {
  const mc = obj(listing.mc_attributes);
  const snap = obj(listing.sticker_snapshot);
  const decoded = obj(snap.decoded);
  const dealer = obj(mc.dealer);
  // VehicleFile.tsx:111-112 patches the vehicle_files value onto the listing
  // object under `stock_number`, and only when it is non-empty; the column
  // itself does not exist live, so the patch is the only way slot 3 is ever
  // filled — but the origin is reported from whichever of the two supplied it.
  const filed = str(file?.stock_number);
  return [
    { value: stockStr(mc.stock_no), origin: "vehicle_listings.mc_attributes->stock_no" },
    { value: stockStr(dealer.stock_no), origin: "vehicle_listings.mc_attributes->dealer->stock_no" },
    {
      value: stockStr(filed ?? listing.stock_number),
      origin: filed
        ? "vehicle_files.stock_number (patched onto the listing row, VehicleFile.tsx:105-112)"
        : "vehicle_listings.stock_number (no such column live; only the VehicleFile.tsx:105-112 patch fills it)",
    },
    { value: stockStr(snap.stock_number), origin: "vehicle_listings.sticker_snapshot->stock_number" },
    { value: stockStr(snap.stock), origin: "vehicle_listings.sticker_snapshot->stock" },
    { value: stockStr(decoded.stock_number), origin: "vehicle_listings.sticker_snapshot->decoded->stock_number" },
    { value: stockStr(decoded.stock), origin: "vehicle_listings.sticker_snapshot->decoded->stock" },
  ];
};

/**
 * `ymmParts` from OemDocFinders.tsx:33-40, unchanged including its defect: the
 * make is whatever single token sits at index 1, so "2020 Alfa Romeo Stelvio"
 * yields make "Alfa" and model "Romeo Stelvio".
 */
const ymmParts = (ymm: string | null): { year: number | null; make: string; model: string } => {
  const parts = (ymm || "").trim().split(/\s+/);
  return {
    year: Number.parseInt(parts[0] || "", 10) || null,
    make: parts[1] || "",
    model: parts.slice(2).join(" "),
  };
};

/**
 * VehicleTruthCard.tsx:98-109 keyed by fact_key: the first row for a key wins,
 * and is displaced only by a later VERIFIED row when the held one is not
 * VERIFIED. The edge function returns `vehicle_facts` unordered
 * (factory-sticker-orchestrate/index.ts:1360-1362), so "first" is whatever
 * Postgres yielded — reproduced here as the array order in the bundle.
 */
const truthFact = (facts: Row[], factKey: string): Row | null => {
  let held: Row | null = null;
  for (const fact of facts) {
    if (str(fact.fact_key) !== factKey) continue;
    if (!held || (str(held.confidence) !== "VERIFIED" && str(fact.confidence) === "VERIFIED")) {
      held = fact;
    }
  }
  return held;
};

const truthValue = (
  sources: VehicleFileSources,
  listing: Row,
  factKey: string,
  label: string,
): CurrentValue => {
  if (!str(listing.tenant_id)) {
    return entry(null, `not rendered: the listing has no tenant_id, so useVehicleTruth returns EMPTY `
      + `and the Vehicle Truth card shows nothing (useVehicleTruth.ts:66, OverviewTab.tsx:201)`);
  }
  if (!sources.snapshot) {
    return entry(null, `not rendered: no vehicle_snapshots row, and the Vehicle Truth card renders its `
      + `fact groups only when a snapshot exists (VehicleTruthCard.tsx:182)`);
  }
  const fact = truthFact(sources.facts, factKey);
  if (!fact) {
    return entry(null, `not rendered: no vehicle_facts row with fact_key '${factKey}', so the card's `
      + `"${label}" line is not drawn (VehicleTruthCard.tsx:186)`);
  }
  const value = dig(fact.fact_value, "v");
  if (value === null || value === undefined || value === "") {
    return entry(null, `vehicle_facts.fact_value->v where fact_key='${factKey}' is empty; the card `
      + `prints an em dash (VehicleTruthCard.tsx:76)`);
  }
  return entry(value, `vehicle_facts.fact_value->v where fact_key='${factKey}' `
    + `(Vehicle Truth card "${label}", VehicleTruthCard.tsx:199)`);
};

/**
 * The twelve critical fields as the Vehicle File renders them right now.
 *
 * Every entry is what a person would read off the screen for this vehicle, so
 * a MATCH verdict against the read model means the projection changes nothing
 * a user sees, and any other verdict names a real difference.
 */
export function currentDisplayedValues(
  sources: VehicleFileSources,
): Record<CriticalField, CurrentValue> {
  const listing = sources.listing;

  if (!listing) {
    return {
      vin: entry(null, NO_LISTING),
      year: entry(null, NO_LISTING),
      make: entry(null, NO_LISTING),
      model: entry(null, NO_LISTING),
      trim: entry(null, NO_LISTING),
      stock: entry(null, NO_LISTING),
      mileage: entry(null, NO_LISTING),
      advertised_retail: entry(null, NO_LISTING),
      msrp: entry(null, NO_LISTING),
      engine: entry(null, NO_LISTING),
      drivetrain: entry(null, NO_LISTING),
      condition: entry(null, NO_LISTING),
    };
  }

  const ymm = str(listing.ymm);
  const parts = ymmParts(ymm);
  const ymmOrigin = ymm
    ? "vehicle_listings.ymm"
    : "not rendered: vehicle_listings.ymm is empty, so the header prints "
      + "\"Vehicle needs a VIN decode\" (VehicleFile.tsx:282)";

  const stock = stockCandidates(listing, sources.file).find((c) => c.value !== "");

  const mileage = num(listing.mileage);
  const price = num(listing.price);
  const condition = str(listing.condition);
  const trim = str(listing.trim);
  const vin = str(listing.vin);

  return {
    vin: entry(vin, vin
      ? "vehicle_listings.vin"
      : "not rendered: vehicle_listings.vin is empty (VehicleFile.tsx:301 prints nothing)"),

    year: entry(parts.year, ymm
      ? "vehicle_listings.ymm, whitespace token 0 (the header shows the unsplit string; "
        + "OemDocFinders.tsx:33-40 is the only splitter)"
      : ymmOrigin),

    make: entry(parts.make || null, ymm
      ? "vehicle_listings.ymm, whitespace token 1 (OemDocFinders.tsx:33-40; a two-word make "
        + "loses its second word to the model)"
      : ymmOrigin),

    model: entry(parts.model || null, ymm
      ? "vehicle_listings.ymm, whitespace tokens 2.. (OemDocFinders.tsx:33-40)"
      : ymmOrigin),

    trim: entry(trim, trim
      ? "vehicle_listings.trim"
      : "not rendered: vehicle_listings.trim is empty, so the header omits the line "
        + "(VehicleFile.tsx:284) and Overview prints \"Not decoded\" (OverviewTab.tsx:70)"),

    stock: entry(stock?.value ?? null, stock
      ? stock.origin
      : "not rendered: no stock candidate on the row, so the header prints "
        + "\"Stock # not on the feed\" (vehicleStockNumber.ts:38-47, VehicleFile.tsx:296-298)"),

    mileage: entry(mileage, mileage != null
      ? "vehicle_listings.mileage"
      : "not rendered: vehicle_listings.mileage is null, so the header prints "
        + "\"Mileage not recorded\" (VehicleFile.tsx:308)"),

    advertised_retail: entry(price, price != null
      ? "vehicle_listings.price (header, VehicleFile.tsx:311; Overview label \"Advertised price\", "
        + "OverviewTab.tsx:74)"
      : "not rendered: vehicle_listings.price is null, so the header prints \"Not priced\" "
        + "(VehicleFile.tsx:311)"),

    msrp: truthValue(sources, listing, "total_msrp", "Total MSRP"),
    engine: truthValue(sources, listing, "engine", "Engine"),
    drivetrain: truthValue(sources, listing, "drivetrain", "Drivetrain"),

    condition: entry(condition, condition
      ? "vehicle_listings.condition"
      : "not rendered: vehicle_listings.condition is null, so the header prints the literal "
        + "\"unknown\" (VehicleFile.tsx:279)"),
  };
}
