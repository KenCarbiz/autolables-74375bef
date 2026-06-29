// Pre-Delivery Inspection (PDI) — the dealer's own final check before the
// customer takes delivery. Distinct from the State K-208 safety inspection: a
// technician OR a service writer may complete it. Default item list; adjust to
// the dealer's process as needed.

export const PDI_ITEMS = [
  { id: "exterior", label: "Exterior clean & undamaged" },
  { id: "interior", label: "Interior clean & undamaged" },
  { id: "fluids", label: "All fluids checked & topped off" },
  { id: "tires", label: "Tire pressures set, lug nuts torqued" },
  { id: "lights", label: "All exterior lights & signals work" },
  { id: "wipers_horn", label: "Wipers, washers & horn work" },
  { id: "road_test", label: "Road test completed — no issues" },
  { id: "battery", label: "Battery & charging system OK" },
  { id: "keys", label: "All keys / remotes present & working" },
  { id: "accessories", label: "Owner's manual, floor mats & accessories present" },
  { id: "fuel", label: "Fuel level adequate for delivery" },
  { id: "plates", label: "Plates / temporary tags installed" },
] as const;

export const PDI_CERTIFICATION_TEXT =
  "I certify that I have completed the pre-delivery inspection of this vehicle and that the items above reflect its condition. Any items marked as a defect have an explanation noted.";
