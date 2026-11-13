// GENERATED — do not edit.
// Mirror of src/lib/market/legacyAdapter.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { parseYmm } from "../ymm.ts";
import type { ComparableCandidate, SubjectCondition } from "./types.ts";
const CONDITION_PREFIX = /^(?:used|new|pre[\s-]?owned|certified(?:\s+pre[\s-]?owned)?|cpo)\s+/i;
export function stripListingConditionPrefix(heading: string | null | undefined): string {
    let text = String(heading ?? "").trim().replace(/\s+/g, " ");
    for (let i = 0; i < 3 && CONDITION_PREFIX.test(text); i++)
        text = text.replace(CONDITION_PREFIX, "");
    return text;
}
const TRAILING_MARKETING = /\s+(?:with|w\/)\s+.*$/i;
export interface LegacyComparableRow {
    vin?: unknown;
    ymm?: unknown;
    trim?: unknown;
    miles?: unknown;
    price?: unknown;
    dist?: unknown;
    dealer?: unknown;
    dom?: unknown;
}
export function legacyComparableToCandidate(row: LegacyComparableRow, opts?: {
    observedAt?: string | null;
}): ComparableCandidate {
    const heading = stripListingConditionPrefix(String(row.ymm ?? "")).replace(TRAILING_MARKETING, "");
    const parsed = parseYmm(heading);
    const year = /^\d{4}$/.test(parsed.year) ? Number(parsed.year) : null;
    const trim = String(row.trim ?? "").trim() || null;
    let model = parsed.model.trim();
    if (trim && model.toLowerCase().endsWith(trim.toLowerCase())) {
        model = model.slice(0, model.length - trim.length).trim();
    }
    return {
        vin: row.vin,
        year,
        make: parsed.make || null,
        model: model || null,
        trim,
        mileage: row.miles,
        price: row.price,
        distanceMiles: row.dist,
        daysOnMarket: row.dom,
        dealerName: row.dealer,
        observedAt: opts?.observedAt ?? null,
        listingId: null,
        drivetrain: null,
        powertrain: null,
        transmission: null,
        certified: null,
        certificationProgram: null,
        dealerId: null,
        rooftopId: null,
        dealerGroupId: null,
        dealerGroupName: null,
        dealerDomain: null,
        dealerType: null,
        equipmentCodes: [],
        historyStatus: "unknown",
        conditionStatus: "unknown",
        docFeeIncluded: null,
        docFee: null,
    };
}
export function legacyComparableGaps(rows: LegacyComparableRow[]): Record<string, number> {
    const gaps: Record<string, number> = {
        missing_certification: 0,
        missing_dealer_identity: 0,
        missing_observed_at: rows.length,
        missing_history: rows.length,
        missing_equipment: rows.length,
        missing_drivetrain: rows.length,
        missing_price_basis: rows.length,
    };
    for (const _row of rows) {
        gaps.missing_certification++;
        gaps.missing_dealer_identity++;
    }
    return gaps;
}
export const conditionToCertified = (condition: SubjectCondition | null): boolean | null => condition == null ? null : condition === "cpo";
