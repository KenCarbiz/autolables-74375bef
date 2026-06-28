// ──────────────────────────────────────────────────────────────
// Connecticut DMV Form K-208
// CT Licensed Dealer Vehicle Inspection Form
//
// Per CGS 14-62(g), CT licensed dealers must complete a safety
// inspection on every used motor vehicle before retail sale.
//
// Penalties:
//   - $500 fine if inspection not performed
//   - $250 fine if customer copy not provided
//
// Copies: Customer receives one, dealer retains one in the deal.
//
// Source: https://portal.ct.gov/-/media/DMV/20/29/K208pdf.pdf
// ──────────────────────────────────────────────────────────────

export interface K208FormData {
  // Vehicle Information
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleBodyStyle: string;
  vehicleVin: string;
  vehicleColor: string;
  vehicleMileage: string;
  vehiclePlate: string;

  // Dealer Information
  dealerName: string;
  dealerPhone: string;
  dealerAddress: string;
  dealerCity: string;
  dealerState: string;
  dealerZip: string;
  dealerLicenseNumber: string;

  // Inspection Items — each is "pass" | "fail" | "na"
  inspectionItems: Record<string, "pass" | "fail" | "na" | "">;

  // Certification
  inspectedBy: string;        // Name of inspector
  inspectionDate: string;
  inspectorSignature: string;
  inspectorSignatureType: "draw" | "type";

  // Buyer Information
  buyerName: string;
  buyerAddress: string;
  buyerSignature: string;
  buyerSignatureType: "draw" | "type";
  buyerDate: string;

  // Notes
  notes: string;
  failureNotes: string;       // What failed and what was done
}

// The OFFICIAL CT DMV Form K-208 line items (NEW 10-2012), in form order. The
// real form is a single PASS/FAIL list with an "Explanation of Defects or
// Repairs Needed" per item — not an expanded shop checklist. This is the form
// the service department fills, so it must match the State document exactly.
export const K208_INSPECTION_CATEGORIES = [
  {
    category: "Safety Inspection",
    items: [
      { id: "service_brakes", label: "Service Brakes" },
      { id: "parking_brake", label: "Parking Brake" },
      { id: "tires_wheels", label: "Tires / Wheels" },
      { id: "steering_system", label: "Steering System" },
      { id: "suspension", label: "Suspension" },
      { id: "frame_chassis", label: "Frame / Chassis" },
      { id: "exhaust", label: "Exhaust" },
      { id: "fuel_system", label: "Fuel System" },
      { id: "headlights", label: "Headlights" },
      { id: "stop_turn_lights", label: "Stop / Turn Lights" },
      { id: "misc_lights", label: "Misc. Lights" },
      { id: "wipers_washer", label: "Wipers / Washer" },
      { id: "windshield_tint", label: "Windshield, Tint" },
      { id: "horn", label: "Horn" },
      { id: "vin_verified", label: "VIN Verified" },
      { id: "mirrors", label: "Mirrors" },
      { id: "seat_belts", label: "Seat Belts" },
      { id: "air_bags", label: "Air Bags" },
      { id: "emissions", label: "Emissions" },
    ],
  },
];

// Inspection result — the dealer must initial A, B, or C on the State form.
export const K208_INSPECTION_RESULTS = [
  { code: "A", label: "In condition for legal operation on any highway of this state and may be covered by a warranty." },
  { code: "B", label: "In condition for legal operation on any highway of this state, but is being sold 'AS IS', and is not subject to warranty under CGS 42-224." },
  { code: "C", label: "NOT in condition for legal operation on the highways of Connecticut and is being sold in 'AS IS' condition with the defects noted. There is NO warranty." },
] as const;

// The exact licensee certification language printed on the State K-208 form.
export const K208_CERTIFICATION_TEXT =
  "The information provided to the Commissioner of Motor Vehicles herein is subscribed by me, the undersigned, under penalty of false statement in accordance with the provisions of Section 14-110 and 53a-157b of the Connecticut General Statutes. I understand that if I make a false written statement which I do not believe to be true, with the intent to mislead a public servant, I will be subject to prosecution under the above cited laws.";

export const K208_BUYER_ACKNOWLEDGMENT_TEXT =
  "I, the undersigned buyer, acknowledge that I have received a copy of this completed vehicle safety inspection form as required by Connecticut law. I understand that this inspection was performed by the dealer prior to the sale of this vehicle. I acknowledge that a copy of this form has been provided to me and that the dealer retains a copy in the deal file.";

export const K208_PENALTIES = {
  noInspection: "$500 fine — Failure to perform safety inspection before retail sale (CGS 14-62(g))",
  noCopyToCustomer: "$250 fine — Failure to provide customer with a copy of the inspection form",
};

export const emptyK208: K208FormData = {
  vehicleYear: "",
  vehicleMake: "",
  vehicleModel: "",
  vehicleBodyStyle: "",
  vehicleVin: "",
  vehicleColor: "",
  vehicleMileage: "",
  vehiclePlate: "",
  dealerName: "",
  dealerPhone: "",
  dealerAddress: "",
  dealerCity: "",
  dealerState: "CT",
  dealerZip: "",
  dealerLicenseNumber: "",
  inspectionItems: {},
  inspectedBy: "",
  inspectionDate: "",
  inspectorSignature: "",
  inspectorSignatureType: "draw",
  buyerName: "",
  buyerAddress: "",
  buyerSignature: "",
  buyerSignatureType: "draw",
  buyerDate: "",
  notes: "",
  failureNotes: "",
};
