// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/oem/eligibility.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type VehicleConditionClass = "new" | "used" | "cpo" | "unknown";
export type EligibilityStatus = "eligible_new" | "eligible_used_reproduction" | "ineligible_used" | "ineligible_condition_conflict" | "ineligible_disabled" | "ineligible_insufficient_data";
export interface StickerEligibilityInput {
    condition?: string | null;
    corroboratingConditions?: Array<string | null | undefined>;
    settings?: {
        enabled?: boolean;
        used_reproduction?: boolean;
    } | null;
    hasVinSpecificBuildData: boolean;
    hasManufacturerPricing: boolean;
}
export interface StickerEligibilityResult {
    eligible: boolean;
    status: EligibilityStatus;
    conditionClass: VehicleConditionClass;
    requiresReproductionDisclosure: boolean;
    reasons: string[];
    blockerCode: string | null;
}
export function classifyCondition(raw: string | null | undefined): VehicleConditionClass {
    const v = String(raw ?? "").trim().toLowerCase();
    if (!v)
        return "unknown";
    if (v === "new")
        return "new";
    if (v === "cpo" || v.includes("certified"))
        return "cpo";
    if (v === "used" || v === "pre-owned" || v === "preowned")
        return "used";
    return "unknown";
}
export function evaluateStickerEligibility(input: StickerEligibilityInput): StickerEligibilityResult {
    const reasons: string[] = [];
    const conditionClass = classifyCondition(input.condition);
    const corroborating = (input.corroboratingConditions || [])
        .map(classifyCondition)
        .filter((c) => c !== "unknown");
    for (const other of corroborating) {
        if (conditionClass !== "unknown" && other !== conditionClass) {
            return {
                eligible: false,
                status: "ineligible_condition_conflict",
                conditionClass,
                requiresReproductionDisclosure: false,
                reasons: [`trusted sources disagree on condition: ${conditionClass} vs ${other}`],
                blockerCode: "VEHICLE_CONDITION_CONFLICT",
            };
        }
    }
    if (conditionClass === "unknown") {
        return {
            eligible: false,
            status: "ineligible_condition_conflict",
            conditionClass,
            requiresReproductionDisclosure: false,
            reasons: ["vehicle condition could not be resolved from the trusted record"],
            blockerCode: "VEHICLE_CONDITION_CONFLICT",
        };
    }
    if (input.settings?.enabled === false) {
        return {
            eligible: false,
            status: "ineligible_disabled",
            conditionClass,
            requiresReproductionDisclosure: false,
            reasons: ["factory sticker generation is turned off for this dealership"],
            blockerCode: "FACTORY_STICKER_DISABLED",
        };
    }
    if (!input.hasVinSpecificBuildData) {
        reasons.push("no VIN-specific manufacturer build data on the record");
    }
    if (!input.hasManufacturerPricing) {
        reasons.push("manufacturer base and total MSRP are not both present");
    }
    if (reasons.length) {
        return {
            eligible: false,
            status: "ineligible_insufficient_data",
            conditionClass,
            requiresReproductionDisclosure: conditionClass !== "new",
            reasons,
            blockerCode: "MISSING_VERIFIED_DATA",
        };
    }
    if (conditionClass === "new") {
        return {
            eligible: true,
            status: "eligible_new",
            conditionClass,
            requiresReproductionDisclosure: true,
            reasons: [],
            blockerCode: null,
        };
    }
    if (input.settings?.used_reproduction === false) {
        return {
            eligible: false,
            status: "ineligible_used",
            conditionClass,
            requiresReproductionDisclosure: true,
            reasons: [
                "this dealership has turned off manufacturer-style reproductions for used and CPO inventory",
            ],
            blockerCode: null,
        };
    }
    return {
        eligible: true,
        status: "eligible_used_reproduction",
        conditionClass,
        requiresReproductionDisclosure: true,
        reasons: [],
        blockerCode: null,
    };
}
