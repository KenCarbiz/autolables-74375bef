// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/currentValues.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { identityFromListing, identityYear, type VehicleIdentity } from "../vehicleIdentity.ts";
import type { CriticalField } from "./readModelTypes.ts";
import { dig, num, obj, str, type Row, type VehicleFileSources } from "./sources.ts";
export interface CurrentValue {
    value: unknown;
    origin: string;
}
const NO_LISTING = "not rendered by the Vehicle File: no vehicle_listings row for this id, so the page renders "
    + "\"Vehicle not found\" (VehicleFile.tsx:139-155)";
const entry = (value: unknown, origin: string): CurrentValue => ({ value, origin });
const stockStr = (v: unknown): string => typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
interface StockCandidate {
    value: string;
    origin: string;
}
const stockCandidates = (listing: Row, file: Row | null): StockCandidate[] => {
    const mc = obj(listing.mc_attributes);
    const snap = obj(listing.sticker_snapshot);
    const decoded = obj(snap.decoded);
    const dealer = obj(mc.dealer);
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
const ymmParts = (listing: Row): VehicleIdentity => identityFromListing(listing);
const truthFact = (facts: Row[], factKey: string): Row | null => {
    let held: Row | null = null;
    for (const fact of facts) {
        if (str(fact.fact_key) !== factKey)
            continue;
        if (!held || (str(held.confidence) !== "VERIFIED" && str(fact.confidence) === "VERIFIED")) {
            held = fact;
        }
    }
    return held;
};
const truthValue = (sources: VehicleFileSources, listing: Row, factKey: string, label: string): CurrentValue => {
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
export function currentDisplayedValues(sources: VehicleFileSources): Record<CriticalField, CurrentValue> {
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
    const parts = ymmParts(listing);
    const identityOrigin = parts.origin === "ymm_parsed"
        ? "vehicle_listings.ymm -> shared parseYmm (no structured make/model on the row)"
        : `vehicle_listings.${parts.origin === "mc_raw_build" ? "mc_raw.build" : parts.origin}`;
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
        year: entry(identityYear(parts), parts.year ? identityOrigin : ymmOrigin),
        make: entry(parts.make || null, parts.make ? identityOrigin : ymmOrigin),
        model: entry(parts.model || null, parts.model ? identityOrigin : ymmOrigin),
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
