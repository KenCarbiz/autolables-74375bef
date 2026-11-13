// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/autoPublish.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { SelectionDowngrade, SelectionStatus } from "./oem/selection.ts";
export const AUTO_PUBLISH_POLICY_VERSION = "2026-11-07.1";
export const toCents = (dollars: number | null | undefined): number | null => {
    if (dollars === null || dollars === undefined)
        return null;
    const n = Number(dollars);
    if (!Number.isFinite(n))
        return null;
    return Math.round(n * 100);
};
export const fromCents = (cents: number | null): number | null => cents === null ? null : Math.round(cents) / 100;
export const RECONCILIATION_MATCH_TOLERANCE_CENTS = 500;
export const RECONCILIATION_MINOR_TOLERANCE_CENTS = 10000;
export type ReconciliationStatus = "MATCHED" | "MINOR_VARIANCE" | "REVIEW_REQUIRED" | "INSUFFICIENT_DATA";
export interface MsrpReconciliation {
    status: ReconciliationStatus;
    differenceCents: number | null;
    difference: number | null;
    computedCents: number | null;
    statedCents: number | null;
}
export interface MsrpInputs {
    baseMsrp: number | null;
    optionsTotal: number | null;
    destinationCharge: number | null;
    statedTotalMsrp: number | null;
}
export function reconcileMsrp(input: MsrpInputs): MsrpReconciliation {
    const base = toCents(input.baseMsrp);
    const stated = toCents(input.statedTotalMsrp);
    if (base === null || stated === null) {
        return {
            status: "INSUFFICIENT_DATA",
            differenceCents: null,
            difference: null,
            computedCents: null,
            statedCents: stated,
        };
    }
    const computed = base + (toCents(input.optionsTotal) ?? 0) + (toCents(input.destinationCharge) ?? 0);
    const differenceCents = Math.abs(computed - stated);
    const status: ReconciliationStatus = differenceCents <= RECONCILIATION_MATCH_TOLERANCE_CENTS ? "MATCHED"
        : differenceCents <= RECONCILIATION_MINOR_TOLERANCE_CENTS ? "MINOR_VARIANCE"
            : "REVIEW_REQUIRED";
    return {
        status,
        differenceCents,
        difference: fromCents(differenceCents),
        computedCents: computed,
        statedCents: stated,
    };
}
const AUTO_PUBLISHABLE_DOWNGRADES: ReadonlySet<SelectionDowngrade> = new Set<SelectionDowngrade>([
    "make_alias",
    "generated_fallback_profile",
]);
export interface SelectionFacts {
    selectionStatus: SelectionStatus;
    downgrades: SelectionDowngrade[];
    conflictingFields: string[];
    hasTemplateDefinition: boolean;
}
export function selectionAllowsAutoPublish(selection: SelectionFacts): boolean {
    if (!selection.hasTemplateDefinition)
        return false;
    if (selection.conflictingFields.length > 0)
        return false;
    if (selection.selectionStatus === "selected")
        return true;
    if (selection.selectionStatus !== "manual_review")
        return false;
    return selection.downgrades.every((d) => AUTO_PUBLISHABLE_DOWNGRADES.has(d));
}
export type AutoPublishBlockerCode = "build_sheet_absent" | "not_eligible" | "template_unresolved" | "template_override_active" | "msrp_incomplete" | "msrp_does_not_reconcile" | "passport_url_missing" | "layout_incomplete" | "page_geometry_failed" | "one_page_review_required" | "qa_failed" | "low_confidence" | "option_install_unverified" | "epa_record_missing" | "epa_match_conflict";
export interface AutoPublishBlocker {
    code: AutoPublishBlockerCode;
    detail: string;
}
export interface AutoPublishInput {
    hasBuildSheet: boolean;
    eligibility: {
        eligible: boolean;
        status: string;
        reasons: string[];
    };
    selection: SelectionFacts;
    templateOverrideActive: boolean;
    reconciliation: MsrpReconciliation;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    canonicalPassportUrl: string | null;
    qaChecks: Record<string, boolean>;
    completeness: {
        pass: boolean;
        code: string;
        missing: Array<{
            label: string;
        }>;
        miscounted: Array<{
            label: string;
            actualCount: number;
        }>;
    };
    geometry: {
        pass: boolean;
        code: string;
        reasons: string[];
    };
    onePageFit?: {
        ok: boolean;
        detail: string;
    };
    unverifiedOptions?: string[];
    epaAvailable?: boolean;
    epaConflict?: string | null;
}
export interface AutoPublishDecision {
    autoPublish: boolean;
    blockers: AutoPublishBlocker[];
    reviewReason: string | null;
}
const money = (cents: number | null): string => cents === null ? "unknown" : (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
const list = (items: string[], max = 4): string => {
    const shown = items.slice(0, max).join("; ");
    return items.length > max ? `${shown}; and ${items.length - max} more` : shown;
};
export function evaluateAutoPublish(input: AutoPublishInput): AutoPublishDecision {
    const blockers: AutoPublishBlocker[] = [];
    const block = (code: AutoPublishBlockerCode, detail: string) => blockers.push({ code, detail });
    if (!input.hasBuildSheet) {
        block("build_sheet_absent", "no VIN-specific manufacturer build sheet is saved for this vehicle yet");
    }
    if (!input.eligibility.eligible) {
        block("not_eligible", input.eligibility.reasons.length
            ? list(input.eligibility.reasons)
            : `this vehicle does not qualify for a manufacturer-style sticker (${input.eligibility.status})`);
    }
    if (!selectionAllowsAutoPublish(input.selection)) {
        const why = input.selection.hasTemplateDefinition
            ? (input.selection.conflictingFields.length
                ? `trusted sources disagree on ${input.selection.conflictingFields.join(", ")}`
                : list(input.selection.downgrades.filter((d) => !AUTO_PUBLISHABLE_DOWNGRADES.has(d))
                    .map(describeDowngrade)))
            : "this brand has no registered OEM template that the engine can render";
        block("template_unresolved", why || "the OEM template could not be assigned automatically");
    }
    if (input.templateOverrideActive) {
        block("template_override_active", "a manager pinned this template by hand, so the document they steered is theirs to approve");
    }
    if (input.reconciliation.status === "INSUFFICIENT_DATA") {
        block("msrp_incomplete", "the manufacturer base MSRP and total MSRP are not both on the record, so the price table cannot be checked");
    }
    else if (input.reconciliation.status !== "MATCHED") {
        block("msrp_does_not_reconcile", `base plus options plus destination comes to $${money(input.reconciliation.computedCents)} `
            + `but the manufacturer record states $${money(input.reconciliation.statedCents)} `
            + `(off by $${money(input.reconciliation.differenceCents)})`);
    }
    if (!input.canonicalPassportUrl) {
        block("passport_url_missing", "this vehicle has no public passport address, so the QR code on the sticker would resolve to nothing");
    }
    if (input.confidence !== "HIGH") {
        block("low_confidence", `the decoded record is graded ${input.confidence}, not HIGH`);
    }
    if (input.unverifiedOptions?.length) {
        block("option_install_unverified", `the decode lists ${list(input.unverifiedOptions)} as available but not verified on this VIN, `
            + "so they are left off the installed options and the price table needs a manager's check");
    }
    if (input.epaAvailable === false) {
        block("epa_record_missing", "no verified EPA fuel economy record is saved for this VIN, so the fuel economy panel is left blank; "
            + "a manager must confirm the vehicle is exempt (for example a heavy-duty truck over 8,500 lb) or add the EPA match");
    }
    if (input.epaConflict) {
        block("epa_match_conflict", `the saved EPA fuel economy match disagrees with this VIN's decoded ${input.epaConflict}, `
            + "so the figures cannot be shown as verified until a manager confirms the right EPA configuration");
    }
    if (!input.completeness.pass) {
        const missing = input.completeness.missing.map((m) => `missing ${m.label}`);
        const dupes = input.completeness.miscounted.map((m) => `${m.label} appeared ${m.actualCount}x`);
        block("layout_incomplete", `${input.completeness.code.toLowerCase()}: ${list([...missing, ...dupes])}`);
    }
    if (!input.geometry.pass) {
        block("page_geometry_failed", `${input.geometry.code.toLowerCase()}: ${list(input.geometry.reasons)}`);
    }
    if (input.onePageFit && !input.onePageFit.ok) {
        block("one_page_review_required", `${input.onePageFit.detail || "verified content does not fit one readable page"}. `
            + "An approved one-page layout adjustment is needed before this sticker can publish; "
            + "the remaining detail stays in the Vehicle Passport");
    }
    const failedQa = Object.entries(input.qaChecks).filter(([, ok]) => !ok).map(([name]) => name);
    const otherQa = failedQa.filter((n) => n !== "content_complete" && n !== "page_count_ok" && n !== "one_page_fit_ok");
    if (otherQa.length) {
        block("qa_failed", `identity check failed: ${list(otherQa)}`);
    }
    return {
        autoPublish: blockers.length === 0,
        blockers,
        reviewReason: blockers.length
            ? blockers.map((b) => `${b.code}: ${b.detail}`).join(" | ")
            : null,
    };
}
function describeDowngrade(code: SelectionDowngrade): string {
    switch (code) {
        case "make_fuzzy":
            return "the make matched only after normalization, so the brand needs confirming before it prints";
        case "model_year_missing":
            return "the model year is missing, so the template year-range cannot be pinned";
        case "make_alias":
            return "the make matched through the alias table";
        case "generated_fallback_profile":
            return "no authored theme profile covers this model year";
        default:
            return code;
    }
}
