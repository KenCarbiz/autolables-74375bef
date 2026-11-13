// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/ingest.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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
    certification?: Record<string, unknown> | null;
}
export interface IngestCandidate extends CandidateFact {
    sourceRecordId?: string;
}
const str = (v: unknown): string | undefined => {
    if (typeof v !== "string")
        return undefined;
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
const nameList = (v: unknown): string[] => (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x : str((x as Record<string, unknown>)?.name) ?? ""))
    .map((s) => s.trim())
    .filter(Boolean);
const CONDITIONS = new Set(["new", "used", "cpo"]);
export function buildSheetSource(mc: Record<string, unknown>): SourceKind | null {
    const sheet = mc.build_sheet && typeof mc.build_sheet === "object"
        ? (mc.build_sheet as Record<string, unknown>)
        : null;
    if (!sheet)
        return null;
    const isNeovin = String(mc.specs_source ?? "") === "neovin" || String(sheet.source ?? "") === "neovin";
    if (isNeovin && sheet.generic !== true)
        return "neovin";
    return "other_structured";
}
function push(out: IngestCandidate[], factKey: string, value: unknown, source: SourceKind, confidence: Confidence, sourceTimestamp?: string | null, sourceRecordId?: string): void {
    if (value === undefined || value === null)
        return;
    if (typeof value === "string" && !value.trim())
        return;
    if (Array.isArray(value) && !value.length)
        return;
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
    retrievedAt?: string | null;
    sourceRecordIds?: Partial<Record<SourceKind, string>>;
}
export function candidatesFromListing(listing: TruthListingRow, options: IngestOptions = {}): IngestCandidate[] {
    const out: IngestCandidate[] = [];
    const mc = (listing.mc_attributes ?? {}) as Record<string, unknown>;
    const at = options.retrievedAt ?? null;
    const ids = options.sourceRecordIds ?? {};
    const sheetSource = buildSheetSource(mc);
    const sheet = sheetSource
        ? (mc.build_sheet as Record<string, unknown>)
        : null;
    const condition = str(listing.condition)?.toLowerCase();
    if (condition && CONDITIONS.has(condition)) {
        push(out, "condition", condition, "dealer_confirmed", "VERIFIED", at, ids.dealer_confirmed);
    }
    push(out, "mileage", num(listing.mileage), "dealer_confirmed", "VERIFIED", at, ids.dealer_confirmed);
    push(out, "advertised_price", posNum(listing.price), "dealer_confirmed", "VERIFIED", at, ids.dealer_confirmed);
    push(out, "stock_number", str(listing.stock_number) ?? str(mc.stock_no), "dealer_confirmed", "VERIFIED", at, ids.dealer_confirmed);
    const parsed = parseYmm(listing.ymm);
    const year = Number(parsed.year);
    push(out, "make", parsed.make || undefined, "marketcheck", "HIGH", at, ids.marketcheck);
    push(out, "model", parsed.model || undefined, "marketcheck", "HIGH", at, ids.marketcheck);
    if (Number.isInteger(year) && year >= 1950 && year <= 2100) {
        push(out, "model_year", year, "marketcheck", "HIGH", at, ids.marketcheck);
    }
    push(out, "trim", str(listing.trim) ?? str(mc.trim), "marketcheck", "HIGH", at, ids.marketcheck);
    push(out, "body_configuration", str(mc.body_type) ?? str(mc.body_style), "marketcheck", "HIGH", at, ids.marketcheck);
    const mcAt = str(mc.retrieved_at) ?? at;
    push(out, "engine", str(mc.engine) ?? str(mc.engine_block), "marketcheck", "HIGH", mcAt, ids.marketcheck);
    push(out, "transmission", str(mc.transmission), "marketcheck", "HIGH", mcAt, ids.marketcheck);
    push(out, "drivetrain", str(mc.drivetrain) ?? str(mc.drive_type), "marketcheck", "HIGH", mcAt, ids.marketcheck);
    push(out, "fuel_type", str(mc.fuel_type), "marketcheck", "HIGH", mcAt, ids.marketcheck);
    push(out, "exterior_color", str(mc.exterior_color), "marketcheck", "HIGH", mcAt, ids.marketcheck);
    push(out, "interior_color", str(mc.interior_color), "marketcheck", "HIGH", mcAt, ids.marketcheck);
    if (sheet && sheetSource) {
        const confidence: Confidence = sheetSource === "neovin" ? "VERIFIED" : "MEDIUM";
        const sheetAt = str(sheet.retrieved_at) ?? str(mc.specs_retrieved_at) ?? at;
        const recordId = ids[sheetSource];
        push(out, "manufacturer", str(sheet.manufacturer) ?? str(mc.manufacturer), sheetSource, confidence, sheetAt, recordId);
        const sheetPricing = (sheet.pricing && typeof sheet.pricing === "object"
            ? sheet.pricing
            : {}) as Record<string, unknown>;
        push(out, "base_msrp", posNum(mc.base_msrp ?? sheetPricing.base_msrp), sheetSource, confidence, sheetAt, recordId);
        push(out, "destination_charge", posNum(mc.delivery_charges ?? mc.destination_charge ?? sheetPricing.destination_charge), sheetSource, confidence, sheetAt, recordId);
        push(out, "total_msrp", posNum(mc.total_msrp ?? mc.sticker_total_msrp ?? sheetPricing.total_msrp), sheetSource, confidence, sheetAt, recordId);
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
                for (const items of Object.values(src as Record<string, unknown>))
                    standard.push(...nameList(items));
            }
        }
        push(out, "standard_equipment", standard, sheetSource, confidence, sheetAt, recordId);
    }
    else {
        const features = nameList(mc.features).length ? nameList(mc.features) : nameList(listing.features);
        push(out, "standard_equipment", features, "marketcheck", "HIGH", mcAt, ids.marketcheck);
    }
    return out;
}
export function candidatesFromDealerEdits(edits: Record<string, unknown>, editedAt: string): IngestCandidate[] {
    const out: IngestCandidate[] = [];
    for (const [factKey, value] of Object.entries(edits)) {
        if (value === undefined || value === null || value === "")
            continue;
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
const HISTORY_SOURCE_KINDS: Record<string, SourceKind> = {
    dealer_vdp: "dealer_vdp",
    marketcheck: "marketcheck",
    feed: "marketcheck",
    manual: "dealer_confirmed",
    dealer: "dealer_confirmed",
    dealer_confirmed: "dealer_confirmed",
    description: "ai_inference",
    dealer_description: "ai_inference",
    autolabels_description: "ai_inference",
};
export function historySourceKind(tag: unknown, fallback: SourceKind): SourceKind {
    const t = typeof tag === "string" ? tag.trim().toLowerCase() : "";
    if (!t)
        return fallback;
    return HISTORY_SOURCE_KINDS[t] ?? "ai_inference";
}
export function candidatesFromHistory(listing: TruthListingRow, options: IngestOptions = {}): IngestCandidate[] {
    const out: IngestCandidate[] = [];
    const mc = (listing.mc_attributes ?? {}) as Record<string, unknown>;
    const at = options.retrievedAt ?? null;
    const ids = options.sourceRecordIds ?? {};
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
    if (brand)
        push(out, "title_brand", brand, "marketcheck", "HIGH", at, ids.marketcheck);
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
