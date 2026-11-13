// GENERATED — do not edit.
// Mirror of src/lib/documents/buyersGuideAutoPublish.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { classifyCondition } from "./families.ts";
export const BUYERS_GUIDE_POLICY_VERSION = "2026-09-08.1";
export type BuyersGuideBox = "as-is" | "implied" | "warranty";
export const isBuyersGuideBox = (v: unknown): v is BuyersGuideBox => v === "as-is" || v === "implied" || v === "warranty";
const CONFIGURED_DEFAULTS = new Set(["as-is", "as_is", "asis", "implied", "dealer", "warranty"]);
export interface BuyersGuideSnapshot {
    box?: unknown;
    forced?: unknown;
    citation?: unknown;
    default_ftc_warranty?: unknown;
    operating_state?: unknown;
    min_pct?: unknown;
    min_duration_days?: unknown;
    min_miles?: unknown;
}
export type BuyersGuideHoldCode = "NOT_A_USED_VEHICLE" | "UNKNOWN_BOX" | "BOX_NOT_DETERMINED" | "WARRANTY_TERMS_MISSING" | "HUMAN_REJECTED";
export interface BuyersGuidePublishDecision {
    publish: boolean;
    box: BuyersGuideBox | null;
    basis: "statute" | "dealer_default" | "undetermined";
    holds: BuyersGuideHoldCode[];
    reasons: string[];
}
const HOLD_REASONS: Record<BuyersGuideHoldCode, string> = {
    NOT_A_USED_VEHICLE: "The FTC Used Car Rule (16 CFR 455) governs used vehicles; a new vehicle has no Buyers Guide.",
    UNKNOWN_BOX: "The warranty box on the draft is not one of As-Is, Implied Warranties Only, or Dealer Warranty.",
    BOX_NOT_DETERMINED: "No state statute decides this vehicle's warranty box and the dealership has not set a default "
        + "warranty position in Admin. Set Default FTC Warranty, or choose the box on this vehicle; "
        + "publishing an unconfigured As-Is would assert a warranty position nobody chose.",
    WARRANTY_TERMS_MISSING: "The Dealer Warranty box is selected but the coverage percentage and term are not both on the "
        + "record, so the Guide would promise coverage without saying how much or for how long.",
    HUMAN_REJECTED: "A manager rejected this Buyers Guide. Automation does not re-publish a rejected document.",
};
const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
export function evaluateBuyersGuideAutoPublish(snapshot: BuyersGuideSnapshot | null | undefined, input: {
    condition?: string | null;
    humanRejected?: boolean;
}): BuyersGuidePublishDecision {
    const snap = snapshot ?? {};
    const holds: BuyersGuideHoldCode[] = [];
    const box = isBuyersGuideBox(snap.box) ? snap.box : null;
    const forced = snap.forced === true || str(snap.forced) === "true";
    const citation = str(snap.citation);
    const configured = CONFIGURED_DEFAULTS.has(str(snap.default_ftc_warranty));
    const basis: BuyersGuidePublishDecision["basis"] = forced || citation
        ? "statute"
        : configured
            ? "dealer_default"
            : "undetermined";
    if (input.humanRejected)
        holds.push("HUMAN_REJECTED");
    const cls = classifyCondition(input.condition);
    if (cls !== "used" && cls !== "cpo")
        holds.push("NOT_A_USED_VEHICLE");
    if (!box)
        holds.push("UNKNOWN_BOX");
    if (basis === "undetermined")
        holds.push("BOX_NOT_DETERMINED");
    if (box === "warranty" && (num(snap.min_pct) <= 0 || (num(snap.min_duration_days) <= 0 && num(snap.min_miles) <= 0))) {
        holds.push("WARRANTY_TERMS_MISSING");
    }
    return {
        publish: holds.length === 0,
        box,
        basis,
        holds,
        reasons: holds.map((h) => HOLD_REASONS[h]),
    };
}
