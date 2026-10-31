// Single resolver for "which state's rules govern this document". The
// per-rooftop store state wins (multi-store groups cross state lines),
// then the dealer's configured doc-fee state, then the profile state.
// Every compliance surface must resolve through this so the addendum,
// stickers, red-team, and Buyers Guide can never disagree on jurisdiction.
export const resolveOperatingState = (
  settings: { doc_fee_state?: string | null; dealer_state?: string | null },
  storeState?: string | null,
): string =>
  normalizeStateCode(storeState || settings.doc_fee_state || settings.dealer_state || "")
  || (storeState || settings.doc_fee_state || settings.dealer_state || "").trim().toUpperCase();

export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" }, { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

const STATE_BY_NAME = new Map(US_STATES.map((s) => [s.name.toLowerCase(), s.code]));
const STATE_CODES = new Set(US_STATES.map((s) => s.code));

/**
 * Two-letter code for a stored state, accepting the full names older records
 * hold ("Connecticut" becomes "CT"). Empty when the value is not a US state,
 * so the caller can keep the stored text rather than discard it.
 */
export function normalizeStateCode(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim().replace(/\.$/, "").replace(/\s+/g, " ");
  if (!text) return "";
  const upper = text.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  return STATE_BY_NAME.get(text.toLowerCase()) ?? "";
}
