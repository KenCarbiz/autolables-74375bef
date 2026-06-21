// Used vehicle warranty compliance model and backlog.
// This file is intentionally metadata-first. Before rendering/signing legal forms in production,
// every state rule and form mapping must be verified by counsel and/or official state sources.
// Federal baseline: FTC Used Car Rule Buyers Guide applies to most used vehicles.

export type UsedWarrantyDisposition =
  | "as_is_no_dealer_warranty"
  | "implied_warranties_only"
  | "limited_warranty"
  | "full_warranty"
  | "state_required_warranty"
  | "manufacturer_warranty_remaining";

export type UsedWarrantyFormId =
  | "ftc_buyers_guide_as_is"
  | "ftc_buyers_guide_implied_warranties"
  | "ftc_buyers_guide_warranty"
  | "ct_k208_used_vehicle_warranty"
  | "state_specific_used_warranty_form";

export type StateWarrantyRuleSourceStatus =
  | "verified_official"
  | "customer_provided_pending_verification"
  | "needs_research"
  | "counsel_review_required";

export type UsedVehicleWarrantyRuleInput = {
  saleState: string;
  modelYear: number;
  currentYear?: number;
  mileage?: number;
  saleLanguage?: "english" | "spanish";
  dealerOffersWrittenWarranty?: boolean;
  dealerWarrantyType?: "limited" | "full";
  manufacturerWarrantyStillApplies?: boolean;
  dealerCPOProgramId?: string;
  oemCPOProgramId?: string;
};

export type UsedVehicleWarrantyRuleResult = {
  disposition: UsedWarrantyDisposition;
  requiredForms: UsedWarrantyFormId[];
  warrantyTermLabel?: string;
  partsAndLaborCoveragePercent?: number;
  sourceStatus: StateWarrantyRuleSourceStatus;
  notes: string[];
};

export type StateUsedWarrantyRule = {
  state: string;
  stateName: string;
  sourceStatus: StateWarrantyRuleSourceStatus;
  summary: string;
  evaluate: (input: UsedVehicleWarrantyRuleInput) => UsedVehicleWarrantyRuleResult;
};

const vehicleAge = (modelYear: number, currentYear = new Date().getFullYear()) => currentYear - modelYear;

export const FEDERAL_FTC_USED_CAR_RULE_BACKLOG = {
  name: "FTC Used Car Buyers Guide",
  appliesTo: "Most dealers who offer more than five used vehicles for sale in a 12-month period, subject to federal exceptions.",
  platformRequirement: "Every used vehicle workflow must generate/select the correct Buyers Guide version before lot display and before sale packet completion.",
  formsNeeded: [
    "FTC Buyers Guide - As Is / No Dealer Warranty",
    "FTC Buyers Guide - Implied Warranties Only",
    "FTC Buyers Guide - Warranty",
    "FTC Spanish Buyers Guide when transaction is conducted in Spanish",
  ],
  productionNotes: [
    "Buyers Guide should be vehicle-aware: year, make, model, VIN, stock number, dealer info, warranty election, covered systems, duration, and cost share.",
    "The platform should preserve a printable/signed copy in the deal audit trail.",
    "State law may require different warranty language or may restrict As-Is usage.",
  ],
};

export const CONNECTICUT_USED_WARRANTY_RULE_DRAFT: StateUsedWarrantyRule = {
  state: "CT",
  stateName: "Connecticut",
  sourceStatus: "customer_provided_pending_verification",
  summary: "Customer-provided working rule: vehicles seven years old or older may be sold as-is; vehicles within seven years require 60 days or 3,000 miles full warranty. Also track Connecticut K-208 used vehicle warranty form requirement.",
  evaluate: (input) => {
    const age = vehicleAge(input.modelYear, input.currentYear);
    const baseForms: UsedWarrantyFormId[] = ["ftc_buyers_guide_warranty", "ct_k208_used_vehicle_warranty"];

    if (age >= 7) {
      return {
        disposition: "as_is_no_dealer_warranty",
        requiredForms: ["ftc_buyers_guide_as_is", "ct_k208_used_vehicle_warranty"],
        sourceStatus: "customer_provided_pending_verification",
        notes: [
          "Draft CT rule from dealer input: seven years old or older may be sold As-Is.",
          "Must verify exact CT statutory age calculation, mileage thresholds, form language, and exceptions before production use.",
        ],
      };
    }

    return {
      disposition: "state_required_warranty",
      requiredForms: baseForms,
      warrantyTermLabel: "60 days or 3,000 miles",
      partsAndLaborCoveragePercent: 100,
      sourceStatus: "customer_provided_pending_verification",
      notes: [
        "Draft CT rule from dealer input: within seven years requires 60 days or 3,000 miles full warranty.",
        "Must verify exact CT statutory coverage, systems covered, exclusions, mileage/year calculation, and K-208 requirements before production use.",
      ],
    };
  },
};

export const STATE_USED_WARRANTY_RULE_BACKLOG: StateUsedWarrantyRule[] = [
  CONNECTICUT_USED_WARRANTY_RULE_DRAFT,
  {
    state: "ALL",
    stateName: "All other states",
    sourceStatus: "needs_research",
    summary: "Build a state-by-state table for As-Is availability, implied warranty limits, dealer mandatory warranty terms, mileage/year thresholds, and state forms.",
    evaluate: (input) => ({
      disposition: input.dealerOffersWrittenWarranty
        ? input.dealerWarrantyType === "full" ? "full_warranty" : "limited_warranty"
        : "implied_warranties_only",
      requiredForms: input.dealerOffersWrittenWarranty ? ["ftc_buyers_guide_warranty"] : ["ftc_buyers_guide_implied_warranties"],
      sourceStatus: "needs_research",
      notes: ["State-specific warranty rules have not been verified yet. Default to FTC Buyers Guide workflow plus counsel review."],
    }),
  },
];

export const resolveUsedVehicleWarrantyCompliance = (input: UsedVehicleWarrantyRuleInput): UsedVehicleWarrantyRuleResult => {
  const stateRule = STATE_USED_WARRANTY_RULE_BACKLOG.find((rule) => rule.state === input.saleState.toUpperCase())
    || STATE_USED_WARRANTY_RULE_BACKLOG.find((rule) => rule.state === "ALL");

  const result = stateRule!.evaluate(input);
  const forms = [...result.requiredForms];

  if (input.saleLanguage === "spanish" && !forms.includes("ftc_buyers_guide_implied_warranties")) {
    result.notes.push("Spanish transaction detected: platform must use/post Spanish Buyers Guide where required by the FTC Used Car Rule.");
  }

  if (input.manufacturerWarrantyStillApplies) {
    result.notes.push("Manufacturer warranty may still apply; Buyers Guide should disclose remaining manufacturer warranty only when allowed and accurate.");
  }

  return result;
};

export const USED_VEHICLE_WARRANTY_COMPLIANCE_NEXT_STEPS = [
  "Download/duplicate the current FTC Buyers Guide forms and build a pixel-accurate print renderer.",
  "Verify Connecticut K-208 form source, exact fields, and retention/signature requirements.",
  "Build state-by-state As-Is / implied warranty / limited warranty / full warranty decision table.",
  "Add sale-state awareness to inventory and deal records.",
  "Add warranty selection to dealer admin and rule engine.",
  "Add audit log: which warranty form/version was generated, displayed, printed, and signed.",
];
