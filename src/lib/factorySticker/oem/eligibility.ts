// Sticker eligibility: may this vehicle receive a manufacturer-style
// OEM window sticker at all?
//
// Separate from template selection on purpose. Selection answers "which
// design", eligibility answers "should any customer-facing manufacturer
// document exist for this record". A new vehicle with a registered
// template is eligible; a used or CPO vehicle gets a SUPPLEMENTAL
// reproduction when the record carries enough VIN-specific manufacturer
// data, always disclosed as a reproduction and never in place of the FTC
// Buyers Guide, the Used Car Sticker or any other required disclosure.

export type VehicleConditionClass = "new" | "used" | "cpo" | "unknown";

export type EligibilityStatus =
  | "eligible_new"
  | "eligible_used_reproduction"
  | "ineligible_used"
  | "ineligible_condition_conflict"
  | "ineligible_disabled"
  | "ineligible_insufficient_data";

export interface StickerEligibilityInput {
  /** Condition from the trusted structured record, not description text. */
  condition?: string | null;
  /** Independent condition signals; disagreement is a blocker, not a vote. */
  corroboratingConditions?: Array<string | null | undefined>;
  /** dealer_profiles.settings.factory_sticker */
  settings?: {
    enabled?: boolean;
    used_reproduction?: boolean;
  } | null;
  /** True when the record carries VIN-specific manufacturer build data. */
  hasVinSpecificBuildData: boolean;
  /** True when base MSRP and total MSRP are both present. */
  hasManufacturerPricing: boolean;
}

export interface StickerEligibilityResult {
  eligible: boolean;
  status: EligibilityStatus;
  conditionClass: VehicleConditionClass;
  /** Reproduction disclosure is mandatory whenever this is true. */
  requiresReproductionDisclosure: boolean;
  reasons: string[];
  blockerCode: string | null;
}

export function classifyCondition(raw: string | null | undefined): VehicleConditionClass {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "unknown";
  if (v === "new") return "new";
  if (v === "cpo" || v.includes("certified")) return "cpo";
  if (v === "used" || v === "pre-owned" || v === "preowned") return "used";
  return "unknown";
}

export function evaluateStickerEligibility(
  input: StickerEligibilityInput,
): StickerEligibilityResult {
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

  // A used or CPO reproduction is supplemental original-equipment history:
  // permitted by default when the data supports it, always carrying the
  // reproduction disclosure, and never replacing the FTC Buyers Guide, the
  // Used Car Sticker or any other required disclosure. A dealership can
  // switch it off, but the absence of an opt-in is not a reason to withhold
  // a document the vehicle qualifies for.
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
