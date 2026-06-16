// State-by-state dealer documentation fee terminology and max caps
// Sources: state DMV regulations, dealer association guidelines
export interface DocFeeConfig {
  state: string;
  stateCode: string;
  terminology: string;         // What they call it in that state
  maxFee: number | null;       // null = no cap
  notes: string;
}

export const STATE_DOC_FEES: DocFeeConfig[] = [
  { state: "Alabama", stateCode: "AL", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Alaska", stateCode: "AK", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Arizona", stateCode: "AZ", terminology: "Document Fee", maxFee: null, notes: "Must be disclosed" },
  { state: "Arkansas", stateCode: "AR", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "California", stateCode: "CA", terminology: "Documentation or Document Processing Charge", maxFee: 85, notes: "Capped at $85 (adjusted periodically)" },
  { state: "Colorado", stateCode: "CO", terminology: "Document Handling Fee", maxFee: null, notes: "Must be posted" },
  { state: "Connecticut", stateCode: "CT", terminology: "Conveyance Fee", maxFee: null, notes: "Must be disclosed on addendum" },
  { state: "Delaware", stateCode: "DE", terminology: "Document Preparation Fee", maxFee: null, notes: "No state cap" },
  { state: "Florida", stateCode: "FL", terminology: "Electronic Filing Fee / Dealer Fee", maxFee: 1000, notes: "Must be disclosed, negotiable" },
  { state: "Georgia", stateCode: "GA", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Hawaii", stateCode: "HI", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Idaho", stateCode: "ID", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Illinois", stateCode: "IL", terminology: "Documentation Fee", maxFee: 324.24, notes: "Capped, adjusted annually" },
  { state: "Indiana", stateCode: "IN", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Iowa", stateCode: "IA", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Kansas", stateCode: "KS", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Kentucky", stateCode: "KY", terminology: "Processing Fee", maxFee: null, notes: "No state cap" },
  { state: "Louisiana", stateCode: "LA", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Maine", stateCode: "ME", terminology: "Administrative Fee / Doc Fee", maxFee: null, notes: "Must be posted" },
  { state: "Maryland", stateCode: "MD", terminology: "Processing Fee", maxFee: 500, notes: "Capped at $500" },
  { state: "Massachusetts", stateCode: "MA", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Michigan", stateCode: "MI", terminology: "Document Fee", maxFee: null, notes: "No state cap" },
  { state: "Minnesota", stateCode: "MN", terminology: "Documentation Fee", maxFee: 125, notes: "Capped at $125" },
  { state: "Mississippi", stateCode: "MS", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Missouri", stateCode: "MO", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Montana", stateCode: "MT", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Nebraska", stateCode: "NE", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Nevada", stateCode: "NV", terminology: "Document Preparation Fee", maxFee: null, notes: "No state cap" },
  { state: "New Hampshire", stateCode: "NH", terminology: "Documentation Fee", maxFee: null, notes: "No statutory cap (verified 2026)" },
  { state: "New Jersey", stateCode: "NJ", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "New Mexico", stateCode: "NM", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "New York", stateCode: "NY", terminology: "Documentation Fee", maxFee: 175, notes: "Capped at $175" },
  { state: "North Carolina", stateCode: "NC", terminology: "Documentation / Processing Fee", maxFee: 899, notes: "Capped" },
  { state: "North Dakota", stateCode: "ND", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Ohio", stateCode: "OH", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Oklahoma", stateCode: "OK", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Oregon", stateCode: "OR", terminology: "Documentation Fee / Negotiability Disclosure", maxFee: 200, notes: "Capped at $200" },
  { state: "Pennsylvania", stateCode: "PA", terminology: "Documentary Fee", maxFee: 490, notes: "Capped (CPI-indexed): $490 online / $409 manual, eff. Jan 2026" },
  { state: "Rhode Island", stateCode: "RI", terminology: "Documentary Fee", maxFee: 200, notes: "Capped at $200 (verified 2026)" },
  { state: "South Carolina", stateCode: "SC", terminology: "Closing Fee / Administrative Fee", maxFee: null, notes: "No state cap" },
  { state: "South Dakota", stateCode: "SD", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Tennessee", stateCode: "TN", terminology: "Processing Fee", maxFee: null, notes: "No state cap" },
  { state: "Texas", stateCode: "TX", terminology: "Documentation Fee / Doc Fee", maxFee: 150, notes: "Capped at $150" },
  { state: "Utah", stateCode: "UT", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Vermont", stateCode: "VT", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Virginia", stateCode: "VA", terminology: "Processing Fee", maxFee: null, notes: "No state cap" },
  { state: "Washington", stateCode: "WA", terminology: "Documentation Fee / Negotiability Fee", maxFee: 200, notes: "Capped at $200" },
  { state: "West Virginia", stateCode: "WV", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "Wisconsin", stateCode: "WI", terminology: "Service Fee", maxFee: null, notes: "No state cap" },
  { state: "Wyoming", stateCode: "WY", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
  { state: "District of Columbia", stateCode: "DC", terminology: "Documentation Fee", maxFee: null, notes: "No state cap" },
];

export const getDocFeeForState = (stateCode: string): DocFeeConfig | undefined =>
  STATE_DOC_FEES.find(s => s.stateCode === stateCode.toUpperCase());

export const getDocFeeTerminology = (stateCode: string): string => {
  const config = getDocFeeForState(stateCode);
  return config?.terminology || "Documentation Fee";
};

// The statutory doc-fee disclosure sentence. Includes the state's
// terminology and the state-specific required clauses. Rendered on the
// addendum AND fed into the compliance validator so the required-verbiage
// check passes. Connecticut (Conn. Gen. Stat. §14-62) is a disclosure
// statute — the fee is negotiable and not payable to the State, with no cap.
export const getDocFeeDisclosure = (stateCode: string, amount: number): string => {
  const label = getDocFeeTerminology(stateCode);
  const lower = label.toLowerCase();
  if (stateCode.toUpperCase() === "CT") {
    return `Dealer Conveyance / Processing Fee: $${amount.toFixed(2)}. This fee is negotiable. The "dealer conveyance fee" or "dealer processing fee" means a fee charged by a dealer to recover reasonable costs for processing all documentation and performing services related to the closing of a sale, including but not limited to the registration and transfer of ownership of the motor vehicle which is the subject of the sale. This fee is not payable to the State of Connecticut. When the buyer elects, where appropriate, to submit the documentation for registration and transfer of ownership to the Commissioner of Motor Vehicles, the dealer conveyance/processing fee shall be reduced by the portion attributable to those services.`;
  }
  return `${label}: A ${lower} of $${amount.toFixed(2)} is charged to cover the cost of processing documents related to the sale of this vehicle. This ${lower} is a charge by the dealer and is not a tax or government fee.`;
};
