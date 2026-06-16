// ──────────────────────────────────────────────────────────────
// State Compliance Engine
//
// Per-state auto dealer disclosure requirements for addendums,
// window stickers, doc fees, and add-on products.
//
// Each tenant/store has a state. When generating any document,
// the compliance engine injects the correct state-specific
// disclosures automatically.
//
// Sources:
//   16 CFR § 455 (FTC Used Car Rule)
//   CA SB 766 (eff. Oct 1, 2026)
//   CT CGS § 14-62 (Conveyance Fee)
//   FL § 501.976(18) (Dealer Fee)
//   OR OAR 137-020-0020 (Price Disclosure)
//   State AG enforcement guidance (AZ, NJ, IL, MD 2024-2026)
// ──────────────────────────────────────────────────────────────

import { getStateRule } from "@/lib/stateCompliance";

// Doc-fee caps for the Northeast rollout corridor are sourced from the
// validator engine (lib/stateCompliance) so the printed cap can never
// desync from the number the red-team enforces. States outside this set
// keep their local value until they're verified and added here.
const NORTHEAST_CAP_STATES = new Set(["CT", "MA", "ME", "NH", "RI", "VT", "NY", "NJ", "PA"]);

export interface StateCompliance {
  stateCode: string;
  stateName: string;

  // Doc fee
  docFeeTerminology: string;
  docFeeMaxCap: number | null;
  docFeeDisclosures: string[];   // Required disclosures ON the doc fee line

  // Add-on disclosures — injected into every addendum for this state
  addOnDisclosures: string[];

  // Buyers Guide
  buyersGuideExempt: boolean;    // Maine & Wisconsin have own rules
  buyersGuideNotes: string;

  // Special state flags
  requiresMultiLanguage: boolean;
  requiredLanguages: string[];   // e.g. ["es", "zh", "tl", "vi", "ko"]
  carsActState: boolean;         // California CARS Act specific
  requiresBoldType: boolean;     // CA: 12pt heading, 10pt body
  postSalePurchaseWindowDays: number; // CA: 10 days
  noBenefitItemBlocking: boolean;     // CA: block nitrogen < 95%, etc.
  recordRetentionYears: number;       // CA: 2 years, NMVTIS: 7 years

  // Contract clause — FTC requires this in the sales contract
  salesContractClause: string;
}

// ──────────────────────────────────────────────────────────────
// Federal baseline — applies to ALL states
// ──────────────────────────────────────────────────────────────

export const FEDERAL_DISCLOSURES = {
  addOnDisclosures: [
    "This add-on product or service is not required to purchase, finance, or lease this vehicle.",
    "Declining any optional product will not affect your ability to purchase this vehicle or the terms of any financing offer.",
    "The products listed on this addendum are not products of, administered by, or guaranteed by the vehicle manufacturer.",
  ],
  financingDisclosure:
    "If this purchase is being financed, the inclusion of these products in the financed amount will increase the total amount financed, the monthly payment, the total finance charge, and the total amount paid over the life of the loan.",
  salesContractClause:
    "The information you see on the window form for this vehicle is part of this contract. Information on the window form overrides any contrary provisions in the contract of sale.",
  warrantyDisclosure:
    "All guarantee and warranty terms, conditions, and exclusions are defined exclusively in the respective program documentation provided at delivery. No oral representations by dealership personnel shall modify written program terms.",
  consumerProtection:
    "Consumers with questions may contact their state Department of Consumer Protection, the state Attorney General's office, or the Federal Trade Commission at ftc.gov.",
};

// ──────────────────────────────────────────────────────────────
// Per-state compliance overrides
// ──────────────────────────────────────────────────────────────

const STATE_OVERRIDES: Record<string, Partial<StateCompliance>> = {
  CA: {
    stateName: "California",
    docFeeTerminology: "Document Processing Charge",
    docFeeMaxCap: 85,
    docFeeDisclosures: [
      "This charge represents costs and profits to the dealer for handling documents relating to the sale.",
    ],
    addOnDisclosures: [
      "IMPORTANT: This add-on product or service is not required, and you can buy or lease this vehicle without it.",
      "You have up to ten (10) days after the date of sale to purchase any optional add-on product or service listed on this addendum.",
      "The dealer is prohibited from charging for any add-on product or service that provides no benefit to you.",
    ],
    requiresMultiLanguage: true,
    requiredLanguages: ["es", "zh", "tl", "vi", "ko"],
    carsActState: true,
    requiresBoldType: true,
    postSalePurchaseWindowDays: 10,
    noBenefitItemBlocking: true,
    recordRetentionYears: 2,
    salesContractClause:
      "The information you see on the window form for this vehicle is part of this contract. Information on the window form overrides any contrary provisions in the contract of sale. Notice: A contract shall contain a notice with a heading in at least 12-point bold type and the text in at least 10-point bold type, circumscribed by a line, immediately above the contract signature line.",
  },

  CT: {
    stateName: "Connecticut",
    docFeeTerminology: "Conveyance Fee",
    docFeeMaxCap: null,
    docFeeDisclosures: [
      "This conveyance fee is NOT payable to the State of Connecticut.",
      "This fee is negotiable.",
      "This fee covers: preparation, submission, and processing of documents necessary to issue or transfer a certificate of title, register a vehicle, or transfer registration.",
      "You may elect to submit the documentation required for the registration and transfer of ownership to the Commissioner of Motor Vehicles yourself, in which case the dealer shall reduce this fee by a proportional amount.",
    ],
    addOnDisclosures: [
      "This addendum is provided pursuant to applicable federal and Connecticut state consumer protection requirements.",
    ],
    recordRetentionYears: 7,
  },

  FL: {
    stateName: "Florida",
    docFeeTerminology: "Dealer Fee",
    docFeeMaxCap: 1000,
    docFeeDisclosures: [
      "This charge represents costs and profits to the dealer for items such as inspecting, cleaning, and adjusting vehicles and preparing documents related to the sale.",
      "This dealer fee is included in the advertised price of this vehicle.",
    ],
    addOnDisclosures: [
      "The advertised price of this vehicle includes all fees and charges that you must pay, excluding only government fees (taxes, title, and registration).",
    ],
  },

  OR: {
    stateName: "Oregon",
    docFeeTerminology: "Documentation Fee",
    docFeeMaxCap: 200,
    docFeeDisclosures: [
      "This fee is negotiable.",
      "This fee covers preparation and submission of documents necessary to comply with state and federal laws related to the sale of this vehicle.",
      "The dealer may process these documents without charging this fee.",
    ],
  },

  WA: {
    stateName: "Washington",
    docFeeTerminology: "Documentation Fee",
    docFeeMaxCap: 200,
    docFeeDisclosures: [
      "This fee is negotiable.",
      "Negotiability of this fee may be a factor in determining the price you pay for this vehicle.",
    ],
  },

  NY: {
    stateName: "New York",
    docFeeTerminology: "Documentation Fee",
    docFeeMaxCap: 175,
    docFeeDisclosures: [],
  },

  TX: {
    stateName: "Texas",
    docFeeTerminology: "Documentation Fee",
    docFeeMaxCap: 150,
    docFeeDisclosures: [],
  },

  MD: {
    stateName: "Maryland",
    docFeeTerminology: "Processing Fee",
    docFeeMaxCap: 500,
    docFeeDisclosures: [],
  },

  IL: {
    stateName: "Illinois",
    docFeeTerminology: "Documentation Fee",
    docFeeMaxCap: 324,
    docFeeDisclosures: [],
  },

  MN: {
    stateName: "Minnesota",
    docFeeTerminology: "Documentation Fee",
    docFeeMaxCap: 125,
    docFeeDisclosures: [],
  },

  NH: {
    stateName: "New Hampshire",
    docFeeTerminology: "Documentation Fee",
    // New Hampshire does NOT cap dealer documentation fees (verified 2026;
    // RI is the only New England state with a statutory cap).
    docFeeMaxCap: null,
    docFeeDisclosures: [],
  },

  RI: {
    stateName: "Rhode Island",
    docFeeTerminology: "Documentary Fee",
    // Rhode Island caps the documentary/preparation fee at $200 (verified
    // 2026, RI Automobile Dealers Association).
    docFeeMaxCap: 200,
    docFeeDisclosures: [],
  },

  NC: {
    stateName: "North Carolina",
    docFeeTerminology: "Documentation / Processing Fee",
    docFeeMaxCap: 899,
    docFeeDisclosures: [],
  },

  NJ: {
    stateName: "New Jersey",
    docFeeTerminology: "Documentation Fee",
    docFeeMaxCap: null,
    docFeeDisclosures: [],
    addOnDisclosures: [
      "Dealer may not add and charge for aftermarket merchandise without the consumer's knowledge and authorization.",
    ],
  },

  MA: {
    stateName: "Massachusetts",
    docFeeTerminology: "Documentation Fee",
    docFeeMaxCap: null,
    docFeeDisclosures: [],
    addOnDisclosures: [
      "This addendum discloses the total price of all products and services. No hidden fees or undisclosed charges are permitted.",
    ],
  },

  PA: {
    stateName: "Pennsylvania",
    docFeeTerminology: "Documentary Fee",
    // PA caps the documentary fee and CPI-indexes it annually. Effective
    // Jan 2026: $490 online / $409 manual processing. We use the $490
    // ceiling for the over-cap guard; the $409 manual tier needs counsel
    // verification per deal.
    docFeeMaxCap: 490,
    docFeeDisclosures: [
      "The documentary fee is not an official fee and is not required by law.",
    ],
    addOnDisclosures: [
      "Online statements and representations about this vehicle and its pricing constitute advertisements under Pennsylvania law.",
    ],
  },

  // Maine & Wisconsin — exempt from FTC Buyers Guide (have own state versions)
  ME: {
    stateName: "Maine",
    docFeeTerminology: "Administrative Fee",
    docFeeMaxCap: null,
    docFeeDisclosures: [],
    buyersGuideExempt: true,
    buyersGuideNotes: "Maine has its own used vehicle disclosure requirements. The federal FTC Buyers Guide is not required but may still be used.",
  },

  WI: {
    stateName: "Wisconsin",
    docFeeTerminology: "Service Fee",
    docFeeMaxCap: null,
    docFeeDisclosures: [],
    buyersGuideExempt: true,
    buyersGuideNotes: "Wisconsin has its own used vehicle disclosure requirements. The federal FTC Buyers Guide is not required but may still be used.",
  },
};

// ──────────────────────────────────────────────────────────────
// Compliance engine functions
// ──────────────────────────────────────────────────────────────

const DEFAULT_COMPLIANCE: StateCompliance = {
  stateCode: "",
  stateName: "",
  docFeeTerminology: "Documentation Fee",
  docFeeMaxCap: null,
  docFeeDisclosures: [],
  addOnDisclosures: [],
  buyersGuideExempt: false,
  buyersGuideNotes: "",
  requiresMultiLanguage: false,
  requiredLanguages: [],
  carsActState: false,
  requiresBoldType: false,
  postSalePurchaseWindowDays: 0,
  noBenefitItemBlocking: false,
  recordRetentionYears: 7, // NMVTIS default
  salesContractClause: FEDERAL_DISCLOSURES.salesContractClause,
};

/**
 * Get the full compliance profile for a state.
 * Merges federal baseline with state-specific overrides.
 */
export function getStateCompliance(stateCode: string): StateCompliance {
  const code = stateCode.toUpperCase().trim();
  const override = STATE_OVERRIDES[code] || {};

  return {
    ...DEFAULT_COMPLIANCE,
    stateCode: code,
    ...override,
    // Single source of truth for the cap number: the Northeast rollout
    // states read their doc-fee cap from the validator engine so the
    // printed disclosure and the red-team can never disagree.
    docFeeMaxCap: NORTHEAST_CAP_STATES.has(code)
      ? (getStateRule(code)?.docFee.cap ?? null)
      : (override.docFeeMaxCap ?? DEFAULT_COMPLIANCE.docFeeMaxCap),
    // Merge add-on disclosures: federal + state-specific
    addOnDisclosures: [
      ...FEDERAL_DISCLOSURES.addOnDisclosures,
      ...(override.addOnDisclosures || []),
    ],
    // Merge doc fee disclosures
    docFeeDisclosures: override.docFeeDisclosures || [],
    // Sales contract clause: state-specific overrides federal
    salesContractClause: override.salesContractClause || FEDERAL_DISCLOSURES.salesContractClause,
  };
}

/**
 * Get all disclosures that should appear on an addendum for a given state.
 * Returns them in the order they should be displayed.
 */
export function getAddendumDisclosures(stateCode: string): string[] {
  const compliance = getStateCompliance(stateCode);
  const disclosures: string[] = [];

  // 1. Add-on disclosures (federal + state)
  disclosures.push(...compliance.addOnDisclosures);

  // 2. Financing disclosure (federal, always)
  disclosures.push(FEDERAL_DISCLOSURES.financingDisclosure);

  // 3. Warranty disclaimer (federal, always)
  disclosures.push(FEDERAL_DISCLOSURES.warrantyDisclosure);

  // 4. Doc fee disclosures (state-specific)
  if (compliance.docFeeDisclosures.length > 0) {
    disclosures.push(
      `${compliance.docFeeTerminology.toUpperCase()} DISCLOSURE: ` +
      compliance.docFeeDisclosures.join(" ")
    );
  }

  // 5. Consumer protection (federal, always)
  disclosures.push(FEDERAL_DISCLOSURES.consumerProtection);

  // 6. CA CARS Act specific
  if (compliance.carsActState) {
    disclosures.push(
      "CALIFORNIA SB 766 NOTICE: Under California law (SB 766), " +
      "this disclosure must be provided in at least 12-point bold type for headings and " +
      "10-point bold type for text, circumscribed by a line, immediately above the " +
      "contract signature line. If this negotiation is being conducted primarily in " +
      "Spanish, Chinese, Tagalog, Vietnamese, or Korean, this disclosure must also " +
      "be provided in that language."
    );
  }

  return disclosures;
}

/**
 * Validate that a doc fee amount doesn't exceed the state cap.
 * Returns { valid, message }.
 */
export function validateDocFee(stateCode: string, amount: number): {
  valid: boolean;
  message: string;
  maxCap: number | null;
} {
  const compliance = getStateCompliance(stateCode);
  if (compliance.docFeeMaxCap === null) {
    return { valid: true, message: "No state cap", maxCap: null };
  }
  if (amount > compliance.docFeeMaxCap) {
    return {
      valid: false,
      message: `${compliance.stateName} caps the ${compliance.docFeeTerminology} at $${compliance.docFeeMaxCap}. Your amount of $${amount} exceeds this limit.`,
      maxCap: compliance.docFeeMaxCap,
    };
  }
  return { valid: true, message: `Within ${compliance.stateName} cap of $${compliance.docFeeMaxCap}`, maxCap: compliance.docFeeMaxCap };
}

/**
 * Check if a product might provide "no benefit" (CA CARS Act).
 * Returns warnings for products that AG offices have flagged.
 */
export function checkNoBenefitItems(productName: string): string | null {
  const lower = productName.toLowerCase();

  if (lower.includes("nitrogen") && (lower.includes("tire") || lower.includes("fill"))) {
    return "WARNING: Nitrogen tire fill products have been flagged by the FTC and state AGs as potentially providing no benefit unless nitrogen purity exceeds 95%. California SB 766 prohibits charging for add-ons that provide no benefit.";
  }

  if (lower.includes("vin etch") || lower.includes("vin-etch") || lower.includes("vehicle identification etch")) {
    return "CAUTION: VIN etching products have been scrutinized by state AGs. Ensure the product provides genuine theft deterrent value and is not priced disproportionately to cost.";
  }

  if (lower.includes("fabric protection") || lower.includes("fabric guard")) {
    return "CAUTION: Fabric/upholstery protection products have been the subject of state AG enforcement actions. Ensure clear disclosure of what the product covers and its limitations.";
  }

  if (lower.includes("paint sealant") && !lower.includes("ceramic") && !lower.includes("ppf")) {
    return "CAUTION: Basic paint sealant products (not ceramic coating or PPF) have been scrutinized. Ensure the product provides measurable protection beyond a standard car wash.";
  }

  return null;
}

// ──────────────────────────────────────────────────────────────
// FTC Buyers Guide — complete systems list
// ──────────────────────────────────────────────────────────────

export const FTC_BUYERS_GUIDE_SYSTEMS = [
  {
    category: "Engine",
    items: [
      "All lubricated internal engine parts",
      "Water pump",
      "Fuel pump",
      "Manifolds",
      "Engine block",
      "Cylinder heads",
      "Rotary engine housings",
      "Flywheel",
    ],
  },
  {
    category: "Transmission",
    items: [
      "All lubricated internal transmission parts",
      "Torque converter",
      "Drive shaft",
      "Universal joints",
      "Rear axle",
      "All internally lubricated parts",
    ],
  },
  {
    category: "Steering",
    items: [
      "Steering gear housing and all internal parts",
      "Power steering pump",
      "Valve body",
      "Piston and rack",
    ],
  },
  {
    category: "Brakes",
    items: [
      "Master cylinder",
      "Vacuum assist booster",
      "Wheel cylinders",
      "Hydraulic lines and fittings",
      "Disc brake calipers",
    ],
  },
  {
    category: "Electrical",
    items: [
      "Alternator",
      "Voltage regulator",
      "Starter",
      "Ignition switch",
      "Electronic ignition",
    ],
  },
  {
    category: "Cooling",
    items: [
      "Radiator",
      "Heater core",
      "Thermostat",
      "Cooling fans",
    ],
  },
  {
    category: "Air Conditioning",
    items: [
      "Compressor",
      "Condenser",
      "Evaporator",
    ],
  },
];
