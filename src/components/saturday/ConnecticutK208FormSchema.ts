// Connecticut DMV K-208 form schema and autofill mapping.
// Source form: CT Licensed Dealer Vehicle Inspection Form, K-208 NEW 10-2012.
// Production renderer should use the official PDF/layout and populate these fields from
// inventory, dealer profile, service signoff, and customer deal data.

import type { ConnecticutK208Record, K208ChecklistItem } from "./ConnecticutK208Workflow";

export type ConnecticutK208InspectionCode = "A" | "B" | "C";

export type ConnecticutK208VehicleFields = {
  year: string;
  make: string;
  model: string;
  bodyStyle: string;
  vin: string;
  mileage: string;
};

export type ConnecticutK208DealerFields = {
  dealerName: string;
  phoneNumber: string;
  address: string;
  townCity: string;
  state: string;
  zipCode: string;
  principal: string;
  dealerLicenseNumber: string;
};

export type ConnecticutK208BuyerFields = {
  buyerNamePrint: string;
  buyerSignatureDate?: string;
};

export type ConnecticutK208InspectionResult = {
  code: ConnecticutK208InspectionCode;
  label: string;
  description: string;
  requiresWarranty: boolean;
  asIs: boolean;
};

export type ConnecticutK208InspectionItemId =
  | "service_brakes"
  | "parking_brake"
  | "tires_wheels"
  | "steering_system"
  | "suspension"
  | "frame_chassis"
  | "exhaust"
  | "fuel_system"
  | "headlights"
  | "stop_turn_lights"
  | "misc_lights"
  | "wipers_washer"
  | "windshield_tint"
  | "horn"
  | "vin_verified"
  | "mirrors"
  | "seat_belts"
  | "air_bags"
  | "emissions";

export type ConnecticutK208InspectionLine = {
  id: ConnecticutK208InspectionItemId;
  label: string;
  pass: boolean;
  fail: boolean;
  explanation: string;
};

export type ConnecticutK208AutofillPayload = {
  vehicle: ConnecticutK208VehicleFields;
  dealer: ConnecticutK208DealerFields;
  buyer: ConnecticutK208BuyerFields;
  inspectionResult: ConnecticutK208InspectionResult;
  inspectionLines: ConnecticutK208InspectionLine[];
  licenseePrintedName: string;
  licenseeSignatureDate?: string;
  formVersion: "K-208 NEW 10-2012";
};

export const CONNECTICUT_K208_FORM_VERSION = "K-208 NEW 10-2012" as const;

export const CONNECTICUT_K208_FORM_REQUIREMENTS = {
  title: "CT Licensed Dealer Vehicle Inspection Form",
  agency: "State of Connecticut Department of Motor Vehicles - Commercial Vehicle Safety Division",
  statuteReference: "CGS 14-62(g)",
  mustBeCompletedInEntirety: true,
  dealerUse: "Used by a Connecticut licensed dealer before offering a used motor vehicle for retail sale.",
  buyerCopyRequired: true,
  certificationMustBeSignedByLicensee: true,
};

export const CONNECTICUT_K208_INSPECTION_RESULTS: Record<ConnecticutK208InspectionCode, ConnecticutK208InspectionResult> = {
  A: {
    code: "A",
    label: "Legal operation; may be covered by warranty",
    description: "This vehicle is deemed to be in condition for legal operation on any highway of this state and may be covered by a warranty.",
    requiresWarranty: true,
    asIs: false,
  },
  B: {
    code: "B",
    label: "Legal operation; sold AS IS",
    description: "This vehicle is deemed to be in condition for legal operation on any highway of this state, but is being sold 'AS IS', and is not subject to warranty under CGS 42-224.",
    requiresWarranty: false,
    asIs: true,
  },
  C: {
    code: "C",
    label: "Not in condition for legal operation; sold AS IS",
    description: "This vehicle is NOT in condition for legal operation on the highways of Connecticut and is being sold in 'AS IS' condition with the defects noted below. There is NO warranty.",
    requiresWarranty: false,
    asIs: true,
  },
};

export const CONNECTICUT_K208_INSPECTION_ITEMS: Array<{ id: ConnecticutK208InspectionItemId; label: string }> = [
  { id: "service_brakes", label: "Service Brakes" },
  { id: "parking_brake", label: "Parking Brake" },
  { id: "tires_wheels", label: "Tires/Wheels" },
  { id: "steering_system", label: "Steering System" },
  { id: "suspension", label: "Suspension" },
  { id: "frame_chassis", label: "Frame/Chassis" },
  { id: "exhaust", label: "Exhaust" },
  { id: "fuel_system", label: "Fuel System" },
  { id: "headlights", label: "Headlights" },
  { id: "stop_turn_lights", label: "Stop/Turn Lights" },
  { id: "misc_lights", label: "Misc. Lights" },
  { id: "wipers_washer", label: "Wipers/Washer" },
  { id: "windshield_tint", label: "Windshield, Tint" },
  { id: "horn", label: "Horn" },
  { id: "vin_verified", label: "VIN Verified" },
  { id: "mirrors", label: "Mirrors" },
  { id: "seat_belts", label: "Seat Belts" },
  { id: "air_bags", label: "Air Bags" },
  { id: "emissions", label: "Emissions" },
];

const checklistToLine = (item: K208ChecklistItem): ConnecticutK208InspectionLine | undefined => {
  const normalizedId = item.id.replace(/-/g, "_") as ConnecticutK208InspectionItemId;
  const match = CONNECTICUT_K208_INSPECTION_ITEMS.find((inspectionItem) => inspectionItem.id === normalizedId);
  if (!match) return undefined;
  return {
    id: match.id,
    label: match.label,
    pass: item.status === "checked" || item.status === "not_applicable",
    fail: item.status === "needs_attention",
    explanation: item.notes || "",
  };
};

export const buildEmptyK208InspectionLines = (): ConnecticutK208InspectionLine[] =>
  CONNECTICUT_K208_INSPECTION_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    pass: false,
    fail: false,
    explanation: "",
  }));

export const deriveK208InspectionCode = (record: ConnecticutK208Record): ConnecticutK208InspectionCode => {
  if (record.warrantyDisposition === "state_required_warranty" || record.warrantyDisposition === "limited_warranty" || record.warrantyDisposition === "full_warranty") return "A";
  const hasNeedsAttention = record.checklist.some((item) => item.status === "needs_attention");
  return hasNeedsAttention ? "C" : "B";
};

export const buildConnecticutK208AutofillPayload = (input: {
  record: ConnecticutK208Record;
  dealer: Partial<ConnecticutK208DealerFields>;
  buyer?: Partial<ConnecticutK208BuyerFields>;
  bodyStyle?: string;
  licenseePrintedName?: string;
}): ConnecticutK208AutofillPayload => {
  const code = deriveK208InspectionCode(input.record);
  const mappedLines = input.record.checklist.map(checklistToLine).filter(Boolean) as ConnecticutK208InspectionLine[];
  const linesById = new Map(mappedLines.map((line) => [line.id, line]));
  const inspectionLines = buildEmptyK208InspectionLines().map((line) => linesById.get(line.id) || line);

  return {
    vehicle: {
      year: String(input.record.modelYear || ""),
      make: input.record.make || "",
      model: input.record.model || "",
      bodyStyle: input.bodyStyle || "",
      vin: input.record.vin || "",
      mileage: input.record.mileage ? String(input.record.mileage) : "",
    },
    dealer: {
      dealerName: input.dealer.dealerName || "",
      phoneNumber: input.dealer.phoneNumber || "",
      address: input.dealer.address || "",
      townCity: input.dealer.townCity || "",
      state: input.dealer.state || "CT",
      zipCode: input.dealer.zipCode || "",
      principal: input.dealer.principal || "",
      dealerLicenseNumber: input.dealer.dealerLicenseNumber || "",
    },
    buyer: {
      buyerNamePrint: input.buyer?.buyerNamePrint || "",
      buyerSignatureDate: input.buyer?.buyerSignatureDate,
    },
    inspectionResult: CONNECTICUT_K208_INSPECTION_RESULTS[code],
    inspectionLines,
    licenseePrintedName: input.licenseePrintedName || input.record.serviceSignature.signerName || "",
    licenseeSignatureDate: input.record.serviceSignature.signedAt,
    formVersion: CONNECTICUT_K208_FORM_VERSION,
  };
};

export const CONNECTICUT_K208_AUTOFILL_FIELD_MAP = {
  inventory: ["year", "make", "model", "bodyStyle", "vin", "mileage"],
  dealerProfile: ["dealerName", "phoneNumber", "address", "townCity", "state", "zipCode", "principal", "dealerLicenseNumber"],
  serviceWorkflow: ["inspectionResult", "inspectionItemPassFail", "defectsOrRepairsNeeded", "licenseeSignature", "licenseePrintedName", "licenseeSignatureDate"],
  dealCustomer: ["buyerNamePrint", "buyerSignatureDate"],
};
