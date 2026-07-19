export type WarrantyState = "VERIFIED_ACTIVE" | "STARTS_AT_DELIVERY" | "ESTIMATED_COVERAGE" | "CONFIRMATION_REQUIRED" | "VERIFIED_EXPIRED";
export type StartDateCertainty = "verified" | "estimated" | "unknown";
export type WarrantyMatchAuthority = "dealer_verified" | "vehicle_specific" | "cpo_program" | "oem_reference" | "unknown";
export interface WarrantyStateInput {
  isNew: boolean; hasProgram: boolean; authority: WarrantyMatchAuthority;
  hasVerifiedStartDate: boolean; startDateCertainty: StartDateCertainty;
  computedActive: boolean | null; computedExpired: boolean; conflict: boolean;
}
export interface WarrantyStateView {
  state: WarrantyState; headline: string; statusLabel: string; statusCopy: string;
  showCovered: boolean; showExactDates: boolean; showRemaining: boolean;
  timelineMode: "relative" | "exact"; sourceLabel: string; verificationLabel: string;
  tone: "green" | "blue" | "amber" | "slate";
}
const SOURCE_LABEL: Record<WarrantyMatchAuthority, string> = {
  dealer_verified: "Dealer verified", vehicle_specific: "Vehicle records",
  cpo_program: "Factory CPO program", oem_reference: "Manufacturer program reference",
  unknown: "Confirm with dealer",
};
export function resolveWarrantyState(input: WarrantyStateInput, makeLabel?: string | null): WarrantyStateView {
  const make = (makeLabel || "").trim();
  const brand = make ? `${make} factory` : "factory";
  const source = SOURCE_LABEL[input.authority] ?? SOURCE_LABEL.unknown;
  if (input.conflict) return { state: "CONFIRMATION_REQUIRED", headline: "Warranty Information", statusLabel: "CONFIRMATION AVAILABLE", statusCopy: "Coverage details need dealer confirmation for this vehicle.", showCovered: false, showExactDates: false, showRemaining: false, timelineMode: "relative", sourceLabel: source, verificationLabel: "Confirm coverage with the dealer", tone: "amber" };
  if (input.hasVerifiedStartDate && input.computedExpired) return { state: "VERIFIED_EXPIRED", headline: "Factory Warranty", statusLabel: "EXPIRED", statusCopy: "Factory coverage appears to have ended based on the verified time or mileage limit.", showCovered: false, showExactDates: true, showRemaining: false, timelineMode: "exact", sourceLabel: source, verificationLabel: `Start date verified by ${source.toLowerCase()}`, tone: "slate" };
  if (input.hasVerifiedStartDate && input.computedActive === true) return { state: "VERIFIED_ACTIVE", headline: "Factory Warranty", statusLabel: "ACTIVE", statusCopy: "Vehicle-specific factory coverage is currently in effect.", showCovered: true, showExactDates: true, showRemaining: true, timelineMode: "exact", sourceLabel: source, verificationLabel: `Start date verified by ${source.toLowerCase()}`, tone: "green" };
  if (input.isNew && !input.hasVerifiedStartDate) return { state: "STARTS_AT_DELIVERY", headline: "Factory Warranty", statusLabel: "STARTS AT DELIVERY", statusCopy: `Your ${brand} warranty is expected to begin when you take delivery. Final dates will be confirmed by the dealer.`, showCovered: false, showExactDates: false, showRemaining: false, timelineMode: "relative", sourceLabel: input.authority === "oem_reference" ? "Manufacturer program reference" : source, verificationLabel: "Exact dates confirmed at delivery", tone: "blue" };
  if (input.hasProgram && (input.authority === "oem_reference" || input.startDateCertainty !== "verified")) return { state: "ESTIMATED_COVERAGE", headline: "Factory Coverage", statusLabel: "MAY APPLY", statusCopy: "Coverage shown is based on the manufacturer's standard program. Confirm this vehicle's exact coverage with the dealer.", showCovered: false, showExactDates: false, showRemaining: false, timelineMode: "relative", sourceLabel: input.authority === "oem_reference" ? "Manufacturer program reference" : source, verificationLabel: "Confirm exact coverage with the dealer", tone: "amber" };
  return { state: "CONFIRMATION_REQUIRED", headline: "Warranty Information", statusLabel: "CONFIRMATION AVAILABLE", statusCopy: "Ask the dealer to confirm the coverage included with this vehicle.", showCovered: false, showExactDates: false, showRemaining: false, timelineMode: "relative", sourceLabel: source, verificationLabel: "Confirm coverage with the dealer", tone: "amber" };
}
