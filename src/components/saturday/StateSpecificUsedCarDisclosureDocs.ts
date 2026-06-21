// State-specific used car disclosure document registry backlog.
// Purpose: track every state-level document a dealer may want or need in a used-vehicle packet.
// This is a research/backlog registry, not a legal rules database yet.
// Every state entry must be verified against official state sources and counsel before production.

export type DisclosureDocRequirementStatus =
  | "required_verified"
  | "dealer_optional"
  | "needs_state_research"
  | "pending_official_form"
  | "counsel_review_required";

export type DisclosureDocTrigger =
  | "all_used_vehicles"
  | "state_sale"
  | "as_is_sale"
  | "warranty_sale"
  | "limited_warranty"
  | "full_warranty"
  | "dealer_certified"
  | "oem_cpo"
  | "emissions"
  | "safety_inspection"
  | "odometer"
  | "title_brand"
  | "lemon_law_buyback"
  | "salvage_rebuilt"
  | "flood_damage"
  | "airbag_deployed"
  | "recall"
  | "commercial_vehicle"
  | "ev_hybrid"
  | "vehicle_history"
  | "Spanish_transaction"
  | "dealer_requested";

export type StateDisclosureDocument = {
  id: string;
  state: string;
  stateName: string;
  title: string;
  category:
    | "federal"
    | "state_warranty"
    | "state_inspection"
    | "emissions"
    | "odometer"
    | "title_brand"
    | "damage_disclosure"
    | "recall_disclosure"
    | "certification"
    | "language_access"
    | "dealer_custom";
  requirementStatus: DisclosureDocRequirementStatus;
  triggers: DisclosureDocTrigger[];
  description: string;
  autoPopulateFrom: Array<
    | "inventory"
    | "dealer_profile"
    | "customer_deal"
    | "service_inspection"
    | "warranty_engine"
    | "certification_engine"
    | "vehicle_history"
    | "state_rules_engine"
  >;
  signatureRoles: Array<"dealer" | "service" | "customer" | "manager" | "notary" | "none">;
  packetPlacement: "pre_sale" | "deal_packet" | "delivery" | "post_sale_archive";
  notes: string[];
};

export const FEDERAL_USED_CAR_DISCLOSURE_DOCS: StateDisclosureDocument[] = [
  {
    id: "federal-ftc-buyers-guide",
    state: "ALL",
    stateName: "Federal",
    title: "FTC Used Car Buyers Guide",
    category: "federal",
    requirementStatus: "counsel_review_required",
    triggers: ["all_used_vehicles", "as_is_sale", "warranty_sale", "limited_warranty", "full_warranty", "Spanish_transaction"],
    description: "Federal Buyers Guide workflow for used vehicles, including As-Is, implied warranties, dealer warranty, and Spanish-language versions where applicable.",
    autoPopulateFrom: ["inventory", "dealer_profile", "warranty_engine", "customer_deal"],
    signatureRoles: ["customer", "dealer"],
    packetPlacement: "pre_sale",
    notes: [
      "Use official FTC form/version and preserve posted/printed/signed copy in audit trail.",
      "State law may alter As-Is availability or require additional warranty forms.",
    ],
  },
  {
    id: "federal-odometer-disclosure",
    state: "ALL",
    stateName: "Federal",
    title: "Odometer Disclosure Statement",
    category: "odometer",
    requirementStatus: "counsel_review_required",
    triggers: ["odometer", "all_used_vehicles"],
    description: "Odometer disclosure packet item, generally populated from mileage, VIN, buyer, seller, and title/deal records.",
    autoPopulateFrom: ["inventory", "dealer_profile", "customer_deal"],
    signatureRoles: ["customer", "dealer"],
    packetPlacement: "deal_packet",
    notes: ["Rules vary by age/vehicle class and title process. Verify current federal/state handling."],
  },
];

export const CONNECTICUT_USED_CAR_DISCLOSURE_DOCS: StateDisclosureDocument[] = [
  {
    id: "ct-k208-vehicle-inspection-form",
    state: "CT",
    stateName: "Connecticut",
    title: "K-208 CT Licensed Dealer Vehicle Inspection Form",
    category: "state_inspection",
    requirementStatus: "pending_official_form",
    triggers: ["state_sale", "all_used_vehicles", "safety_inspection"],
    description: "Connecticut dealer vehicle inspection form tied to service safety inspection, dealer/licensee signoff, buyer copy, and customer signature workflow.",
    autoPopulateFrom: ["inventory", "dealer_profile", "service_inspection", "warranty_engine", "customer_deal"],
    signatureRoles: ["service", "customer"],
    packetPlacement: "pre_sale",
    notes: [
      "Official K-208 PDF has been uploaded and mapped into ConnecticutK208FormSchema.",
      "Service department should complete checklist before customer signs.",
      "Buyer must receive a copy.",
    ],
  },
  {
    id: "ct-used-vehicle-warranty-disclosure",
    state: "CT",
    stateName: "Connecticut",
    title: "Connecticut Used Vehicle Warranty Disclosure",
    category: "state_warranty",
    requirementStatus: "counsel_review_required",
    triggers: ["state_sale", "as_is_sale", "warranty_sale", "limited_warranty", "full_warranty"],
    description: "Connecticut-specific warranty disclosure logic for As-Is versus warranty coverage based on vehicle age, mileage, sale status, and dealer warranty election.",
    autoPopulateFrom: ["inventory", "dealer_profile", "warranty_engine", "customer_deal"],
    signatureRoles: ["customer", "dealer"],
    packetPlacement: "deal_packet",
    notes: [
      "Dealer-provided working rule is tracked separately and must be verified before production.",
      "Should coordinate with FTC Buyers Guide and K-208 inspection result A/B/C.",
    ],
  },
  {
    id: "ct-emissions-compliance-disclosure",
    state: "CT",
    stateName: "Connecticut",
    title: "Connecticut Emissions Compliance Disclosure",
    category: "emissions",
    requirementStatus: "needs_state_research",
    triggers: ["state_sale", "emissions"],
    description: "Connecticut emissions-related disclosure/verification item for applicable used vehicles.",
    autoPopulateFrom: ["inventory", "service_inspection", "state_rules_engine"],
    signatureRoles: ["service", "customer"],
    packetPlacement: "delivery",
    notes: ["K-208 references emissions compliance; verify separate document needs and exceptions."],
  },
];

const createStateBacklogDocs = (state: string, stateName: string): StateDisclosureDocument[] => [
  {
    id: `${state.toLowerCase()}-used-warranty-rules`,
    state,
    stateName,
    title: `${stateName} Used Vehicle Warranty / As-Is Disclosure`,
    category: "state_warranty",
    requirementStatus: "needs_state_research",
    triggers: ["state_sale", "as_is_sale", "warranty_sale", "limited_warranty", "full_warranty"],
    description: `Research and map ${stateName} rules for As-Is sales, implied warranties, dealer limited/full warranties, mandatory warranty terms, mileage/year thresholds, and state-specific forms.`,
    autoPopulateFrom: ["inventory", "dealer_profile", "warranty_engine", "customer_deal", "state_rules_engine"],
    signatureRoles: ["customer", "dealer"],
    packetPlacement: "deal_packet",
    notes: ["Backlog placeholder. Must verify official forms and rule triggers before production."],
  },
  {
    id: `${state.toLowerCase()}-damage-title-disclosures`,
    state,
    stateName,
    title: `${stateName} Damage / Branded Title Disclosure`,
    category: "title_brand",
    requirementStatus: "needs_state_research",
    triggers: ["title_brand", "salvage_rebuilt", "flood_damage", "lemon_law_buyback", "airbag_deployed"],
    description: `Research and map ${stateName} state-specific disclosures for salvage/rebuilt title, flood damage, lemon law buyback, airbag deployment, structural damage, and other branded-title events.`,
    autoPopulateFrom: ["inventory", "vehicle_history", "customer_deal", "state_rules_engine"],
    signatureRoles: ["customer", "dealer"],
    packetPlacement: "deal_packet",
    notes: ["Backlog placeholder. Integrate with vehicle history/provider data and title brand data."],
  },
  {
    id: `${state.toLowerCase()}-inspection-emissions`,
    state,
    stateName,
    title: `${stateName} Inspection / Emissions Disclosure`,
    category: "state_inspection",
    requirementStatus: "needs_state_research",
    triggers: ["safety_inspection", "emissions", "state_sale"],
    description: `Research and map ${stateName} requirements for safety inspection, emissions compliance, inspection stickers, buyer acknowledgments, and dealer obligations.`,
    autoPopulateFrom: ["inventory", "service_inspection", "state_rules_engine"],
    signatureRoles: ["service", "customer", "dealer"],
    packetPlacement: "pre_sale",
    notes: ["Backlog placeholder. Connecticut K-208 is the first state-specific implementation model."],
  },
];

export const STATE_DISCLOSURE_RESEARCH_BACKLOG: Array<{ state: string; stateName: string }> = [
  { state: "AL", stateName: "Alabama" },
  { state: "AK", stateName: "Alaska" },
  { state: "AZ", stateName: "Arizona" },
  { state: "AR", stateName: "Arkansas" },
  { state: "CA", stateName: "California" },
  { state: "CO", stateName: "Colorado" },
  { state: "CT", stateName: "Connecticut" },
  { state: "DE", stateName: "Delaware" },
  { state: "FL", stateName: "Florida" },
  { state: "GA", stateName: "Georgia" },
  { state: "HI", stateName: "Hawaii" },
  { state: "ID", stateName: "Idaho" },
  { state: "IL", stateName: "Illinois" },
  { state: "IN", stateName: "Indiana" },
  { state: "IA", stateName: "Iowa" },
  { state: "KS", stateName: "Kansas" },
  { state: "KY", stateName: "Kentucky" },
  { state: "LA", stateName: "Louisiana" },
  { state: "ME", stateName: "Maine" },
  { state: "MD", stateName: "Maryland" },
  { state: "MA", stateName: "Massachusetts" },
  { state: "MI", stateName: "Michigan" },
  { state: "MN", stateName: "Minnesota" },
  { state: "MS", stateName: "Mississippi" },
  { state: "MO", stateName: "Missouri" },
  { state: "MT", stateName: "Montana" },
  { state: "NE", stateName: "Nebraska" },
  { state: "NV", stateName: "Nevada" },
  { state: "NH", stateName: "New Hampshire" },
  { state: "NJ", stateName: "New Jersey" },
  { state: "NM", stateName: "New Mexico" },
  { state: "NY", stateName: "New York" },
  { state: "NC", stateName: "North Carolina" },
  { state: "ND", stateName: "North Dakota" },
  { state: "OH", stateName: "Ohio" },
  { state: "OK", stateName: "Oklahoma" },
  { state: "OR", stateName: "Oregon" },
  { state: "PA", stateName: "Pennsylvania" },
  { state: "RI", stateName: "Rhode Island" },
  { state: "SC", stateName: "South Carolina" },
  { state: "SD", stateName: "South Dakota" },
  { state: "TN", stateName: "Tennessee" },
  { state: "TX", stateName: "Texas" },
  { state: "UT", stateName: "Utah" },
  { state: "VT", stateName: "Vermont" },
  { state: "VA", stateName: "Virginia" },
  { state: "WA", stateName: "Washington" },
  { state: "WV", stateName: "West Virginia" },
  { state: "WI", stateName: "Wisconsin" },
  { state: "WY", stateName: "Wyoming" },
  { state: "DC", stateName: "District of Columbia" },
];

export const STATE_SPECIFIC_USED_CAR_DISCLOSURE_DOCS: StateDisclosureDocument[] = [
  ...FEDERAL_USED_CAR_DISCLOSURE_DOCS,
  ...CONNECTICUT_USED_CAR_DISCLOSURE_DOCS,
  ...STATE_DISCLOSURE_RESEARCH_BACKLOG.filter((state) => state.state !== "CT").flatMap((state) => createStateBacklogDocs(state.state, state.stateName)),
];

export const DISCLOSURE_PACKET_CATEGORIES = [
  "FTC Buyers Guide",
  "State warranty / As-Is disclosure",
  "State inspection form",
  "Emissions disclosure",
  "Odometer disclosure",
  "Title brand / damage disclosure",
  "Recall acknowledgment",
  "Certified / warranty upgrade disclosure",
  "Language access / Spanish transaction forms",
  "Dealer custom acknowledgments",
];

export const getDisclosureDocsForState = (state: string) =>
  STATE_SPECIFIC_USED_CAR_DISCLOSURE_DOCS.filter((doc) => doc.state === "ALL" || doc.state === state.toUpperCase());
