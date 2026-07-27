import type { FactoryStickerRenderData, FactoryStickerTheme } from "../contract.ts";

export const themeFor = (canonicalOemId: string | null): FactoryStickerTheme => ({
  oemThemeId: canonicalOemId ? `oem-${canonicalOemId}` : "oem-neutral",
  oemThemeVersion: "1",
  canonicalOemId,
  templateFamilyId: "factory-sticker-standard",
  templateVersion: "1.0.0",
  logoAssetId: null,
  logoAssetVersion: null,
});

// The visual benchmark: a 2025 INFINITI QX80 SENSORY AWD mirroring the
// owner-approved goal sticker exactly (89,450 + 4,250 + 1,995 = 95,695;
// EQUIPMENT GROUP SENSORY 3,400 is included in base and shown informationally).
export const infinitiBenchmark = (): FactoryStickerRenderData => ({
  vin: "JN8AZ3NE5S9123456",
  condition: "used",
  title: "Original Factory Build & MSRP Record",
  identity: { year: "2025", make: "INFINITI", model: "QX80", trim: "SENSORY AWD" },
  pricing: {
    baseMsrp: 89450,
    destinationCharge: 1995,
    optionsTotal: 4250,
    totalMsrp: 95695,
  },
  packages: [
    {
      name: "EQUIPMENT GROUP SENSORY",
      code: null,
      msrp: 3400,
      contents: [
        "Bose 24-Speaker Premium Audio System",
        "Head-Up Display",
        "Quilted Semi-Aniline Leather Seating Surfaces",
        "Power Running Boards w/ LED Accent Lighting",
        "Advanced Air Filtration System",
        "Wireless Charging Pad",
        "Cargo Area Protector",
      ],
    },
  ],
  options: [
    { name: '22" Dark Painted Alloy Wheels', code: "P02", msrp: 1200 },
    { name: "Illuminated Kick Plates", code: "B92", msrp: 350 },
    { name: "Premium Paint - Majestic White Pearl", code: "L11", msrp: 450 },
    { name: "3rd Row Entertainment System", code: "Z66", msrp: 1800 },
    { name: "Cargo Package", code: "J01", msrp: 250, contents: ["Cargo Net", "Cargo Blocks", "First Aid Kit"] },
    { name: "Roof Cross Bars", code: "R01", msrp: 200 },
  ],
  standardEquipment: {
    exterior: [
      "LED Headlights w/ Signature Digital Piano Key Lighting",
      "LED Daytime Running Lights",
      "LED Front and Rear Fog Lights",
      "Power Heated Outside Mirrors w/ LED Turn Signals",
      "Power Folding Outside Mirrors w/ Memory and Reverse Tilt-Down",
      "Privacy Glass",
      "Acoustic Laminated Front Side Glass",
      "Hands-Free Power Liftgate w/ Motion Activated Open",
      "Roof Rails",
      "22-Inch Aluminum-Alloy Wheels w/ All-Season Tires",
      "Rain-Sensing Front Wipers",
      "Rear Window Wiper w/ Washer",
      "Front and Rear Parking Sensors",
      "Tow Hitch Receiver w/ 7-Pin Connector",
    ],
    interior: [
      "Semi-Aniline Leather-Appointed Seating Surfaces",
      "Zero Gravity Front Seats w/ Heating, Ventilation and Driver Seat Memory",
      "Heated 2nd Row Captain's Chairs",
      "Heated 3rd Row Seats",
      "Power Tilt & Telescopic Steering Column w/ Memory",
      "Tri-Zone Automatic Temperature Control",
      "Heated Leather-Wrapped Steering Wheel",
      "Genuine Open-Pore Wood Trim",
      "Ambient Interior Lighting",
      "Power Sunshade - 2nd Row",
      "Power Windows w/ Auto Up/Down",
      "Panoramic Moonroof",
      "Digital Rearview Mirror",
      "Tri-Zone Automatic Climate Control",
    ],
    functional: [
      "5.6L V8 DOHC 32-Valve Engine w/ Variable Valve Event & Lift",
      "9-Speed Automatic Transmission",
      "Intelligent 4WD w/ 2-Speed Transfer Case & Tow Mode",
      "Adaptive Air Suspension",
      "ProPILOT Assist (Adaptive Cruise Control & Lane Centering)",
      "Intelligent Around View Monitor w/ Moving Object Detection",
      "Intelligent Cruise Control",
      "Drive Mode Selector",
      "Hill Start Assist",
      "Hydraulic Body Motion Control",
      "Power Brakes w/ Brake Assist",
      "Trailer Sway Control",
      "Integrated Trailer Brake Controller",
      "Remote Engine Start w/ Intelligent Climate Control",
    ],
    safety_security: [
      "Predictive Forward Collision Warning w/ Automatic Emergency Braking",
      "Blind Spot Intervention",
      "Rear Cross Traffic Alert",
      "Lane Departure Warning and Prevention",
      "High Beam Assist",
      "Intelligent Lane Intervention",
      "Traffic Sign Recognition",
      "Driver Attention Alert",
      "10 Airbags (Incl. Driver Knee Airbag)",
      "LATCH System (2nd Row Outboard)",
      "Tire Pressure Monitoring System w/ Individual Tire Display",
      "Vehicle Security System w/ Immobilizer",
      "SOS Emergency Call",
    ],
  },
  keyFeatures: {},
  colors: {
    exterior: { name: "Majestic White", code: "QAB" },
    interior: { name: "Graphite", code: "G" },
  },
  assembly: { plant: "Canton", city: "Canton", country: "MS USA" },
  mechanical: { engine: "5.6L V8", transmission: "9-SPEED A/T", drivetrain: "AWD" },
  stockNumber: "25QX80SENS12345",
  transportMethod: "Truck",
  factoryCodes: {
    location: "USA",
    emissions: "50 STATE",
    sequence: "012345",
    order: "000123",
    dealer: "12345",
  },
  epa: {
    city: 15,
    highway: 20,
    combined: 17,
    annualFuelCost: 3250,
    ghgScore: 3,
    rangeMiles: null,
    fuelType: "Gasoline",
    smogScore: 5,
    gallonsPer100Miles: 5.9,
    fiveYearCostDifference: -5000,
    classNote: "Standard SUVs range from 14 to 105 MPG. The best vehicle rates 140 MPGe.",
  },
  safety: {
    overall: null,
    frontalDriver: null,
    frontalPassenger: null,
    sideFront: null,
    sideRear: null,
    rollover: 5,
  },
  dealer: {
    name: "Harte INFINITI",
    address: "1 Weston Park Ave",
    city: "Hartford",
    state: "CT",
    zip: "06103",
    phone: "860-555-0140",
  },
  passportUrl: "https://autolabels.io/v/demo-qx80",
  barcodePayload: "JN8AZ3NE5S9123456",
  generic: false,
  disclaimers: [
    "AutoLabels-generated Factory Build & Original MSRP Record created from VIN-specific vehicle data. This is not the original manufacturer Monroney label and is not a replacement for any federally required label on a new motor vehicle.",
  ],
});

export const newConditionBenchmark = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  condition: "new",
  title: "Factory Window Sticker — Configuration & MSRP",
  disclaimers: [],
});

// No EPA data at all: the fuel-economy panel must collapse without artifacts.
export const noEpaFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  vin: "2T3P1RFV8MW123456",
  identity: { year: "2021", make: "Toyota", model: "RAV4", trim: "XLE" },
  epa: null,
  safety: null,
  passportUrl: "https://autolabels.io/v/demo-rav4",
  barcodePayload: "2T3P1RFV8MW123456",
});

// Enough standard equipment to overflow page 1 and force a continuation
// page; pricing, banner, VIN, and disclosures must remain on page 1.
export const longEquipmentFixture = (): FactoryStickerRenderData => {
  const base = infinitiBenchmark();
  const categories = ["exterior", "interior", "safety_features", "mechanical", "technology", "comfort"];
  const standardEquipment: Record<string, string[]> = {};
  let n = 0;
  for (const cat of categories) {
    standardEquipment[cat] = Array.from({ length: 40 }, () => {
      n += 1;
      return `${cat.replace(/_/g, " ").toUpperCase()} EQUIPMENT ITEM ${String(n).padStart(3, "0")} WITH EXTENDED DESCRIPTION`;
    });
  }
  return { ...base, standardEquipment, keyFeatures: {} };
};

// Second OEM profile proof: same engine and arithmetic, visibly different
// mainstream-structured presentation (banded header, accent keyline,
// category heading bars).
export const nissanBenchmark = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  vin: "5N1DR3DK5SC220145",
  identity: { year: "2025", make: "Nissan", model: "Pathfinder", trim: "PLATINUM 4WD" },
  pricing: { baseMsrp: 49820, destinationCharge: 1390, optionsTotal: 2340, totalMsrp: 53550 },
  packages: [
    {
      name: "PLATINUM PREMIUM PACKAGE",
      code: null,
      msrp: 1990,
      contents: [
        "Bose Premium Audio System - 13 Speakers",
        "Wireless Apple CarPlay",
        "Heated Second-Row Captain's Chairs",
        "Panoramic Moonroof",
      ],
    },
  ],
  options: [
    { name: "Lighting Package", code: "L92", msrp: 795 },
    { name: "Premium Paint - Scarlet Ember", code: "P54", msrp: 445 },
    { name: "Captain's Chairs Console", code: "C03", msrp: 550 },
    { name: "Roof Rail Crossbars", code: "R10", msrp: 550 },
  ],
  standardEquipment: {
    exterior: [
      "LED Headlights w/ Signature Daytime Running Lights",
      "LED Fog Lights",
      "Power Heated Outside Mirrors w/ LED Turn Signals",
      "Privacy Glass",
      "Motion-Activated Power Liftgate",
      "Roof Rails",
      "20-Inch Machined Aluminum-Alloy Wheels",
      "Rain-Sensing Front Wipers",
      "Rear Window Wiper w/ Washer",
      "Front and Rear Parking Sensors",
      "Tow Hitch Receiver w/ 7-Pin Connector",
    ],
    interior: [
      "Semi-Aniline Leather-Appointed Seating Surfaces",
      "Heated and Ventilated Front Seats w/ Driver Memory",
      "Heated Second-Row Captain's Chairs",
      "Heated Steering Wheel",
      "Tri-Zone Automatic Climate Control",
      "Power Panoramic Moonroof",
      "Power Windows w/ Auto Up/Down",
      "Digital Rearview Mirror",
      "Wireless Charging Pad",
      "12.3-Inch Digital Dashboard",
    ],
    functional: [
      "3.5L V6 DOHC 24-Valve Direct Injection Engine",
      "9-Speed Automatic Transmission",
      "Intelligent 4WD w/ 7 Drive and Terrain Modes",
      "ProPILOT Assist (Adaptive Cruise Control & Lane Centering)",
      "Intelligent Around View Monitor",
      "Intelligent Cruise Control",
      "Hill Start Assist",
      "Hill Descent Control",
      "Trailer Sway Control",
      "Remote Engine Start",
    ],
    safety_security: [
      "Automatic Emergency Braking w/ Pedestrian Detection",
      "Blind Spot Warning and Intervention",
      "Rear Cross Traffic Alert",
      "Lane Departure Warning",
      "High Beam Assist",
      "Traffic Sign Recognition",
      "Driver Attention Alert",
      "10 Airbags (Incl. Driver Knee Airbag)",
      "Rear Door Alert",
      "Tire Pressure Monitoring System",
      "Vehicle Security System w/ Immobilizer",
    ],
  },
  mechanical: { engine: "3.5L V6", transmission: "9-SPEED A/T", drivetrain: "4WD" },
  stockNumber: "25PATHPLAT0145",
  colors: {
    exterior: { name: "Scarlet Ember", code: "NBL" },
    interior: { name: "Charcoal", code: "G" },
  },
  assembly: { plant: "Smyrna", city: "Smyrna", country: "TN USA" },
  epa: {
    city: 20,
    highway: 25,
    combined: 22,
    annualFuelCost: 2350,
    ghgScore: 5,
    rangeMiles: null,
    fuelType: "Gasoline",
    smogScore: 6,
    gallonsPer100Miles: 4.5,
    fiveYearCostDifference: -1750,
    classNote: "Standard SUVs range from 14 to 105 MPG. The best vehicle rates 140 MPGe.",
  },
  passportUrl: "https://autolabels.io/v/demo-pathfinder",
  barcodePayload: "5N1DR3DK5SC220145",
});

// EV regulatory module proof: MPGe + range language, no gasoline structures.
export const evFixture = (): FactoryStickerRenderData => ({
  ...nissanBenchmark(),
  vin: "JN1AF0BB5SM731209",
  identity: { year: "2025", make: "Nissan", model: "Ariya", trim: "EVOLVE+ e-4ORCE" },
  pricing: { baseMsrp: 47190, destinationCharge: 1390, optionsTotal: 1035, totalMsrp: 49615 },
  packages: [],
  options: [
    { name: "Premium Paint - Northern Lights", code: "P77", msrp: 635 },
    { name: "Illuminated Kick Plates", code: "B92", msrp: 400 },
  ],
  standardEquipment: {
    exterior: [
      "LED Headlights w/ Adaptive Beam",
      "LED Daytime Running Lights",
      "Flush Aerodynamic Door Handles",
      "19-Inch Aerodynamic Aluminum-Alloy Wheels",
      "Power Panoramic Moonroof",
      "Rain-Sensing Front Wipers",
    ],
    interior: [
      "Vegan Leather-Appointed Seating",
      "Heated and Ventilated Front Seats",
      "Heated Steering Wheel",
      "Dual 12.3-Inch Displays",
      "Wireless Apple CarPlay",
      "Head-Up Display",
      "Motorized Center Console",
    ],
    functional: [
      "Dual Electric Motors - 389 HP Combined",
      "e-4ORCE All-Wheel Drive",
      "87 kWh Liquid-Cooled Battery",
      "DC Fast Charging up to 130 kW (CCS)",
      "7.2 kW Onboard Charger",
      "e-Pedal Step One-Pedal Driving",
      "ProPILOT Assist 2.0 (Hands-Off Highway)",
      "Intelligent Around View Monitor",
    ],
    safety_security: [
      "Automatic Emergency Braking w/ Pedestrian Detection",
      "Blind Spot Warning and Intervention",
      "Rear Cross Traffic Alert",
      "Lane Departure Warning",
      "Traffic Sign Recognition",
      "Driver Attention Alert",
      "10 Airbags",
      "Tire Pressure Monitoring System",
    ],
  },
  mechanical: { engine: "DUAL ELECTRIC MOTORS", transmission: "1-SPEED REDUCTION", drivetrain: "e-4ORCE AWD" },
  stockNumber: "25ARIYAEV1209",
  colors: {
    exterior: { name: "Northern Lights", code: "XKY" },
    interior: { name: "Blue Nebula", code: "B" },
  },
  assembly: { plant: "Tochigi", city: "Tochigi", country: "Japan" },
  epa: {
    city: 93,
    highway: 81,
    combined: 87,
    annualFuelCost: 1000,
    ghgScore: 10,
    rangeMiles: 289,
    fuelType: "Electric",
    smogScore: 10,
    gallonsPer100Miles: null,
    fiveYearCostDifference: 4250,
    classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-ariya",
  barcodePayload: "JN1AF0BB5SM731209",
});

export const genericDecodeFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  generic: true,
  disclaimers: [
    "AutoLabels-generated Factory Build & Original MSRP Record created from VIN-specific vehicle data. This is not the original manufacturer Monroney label and is not a replacement for any federally required label on a new motor vehicle.",
    "Equipment shown is typical for this trim; VIN-specific decode was not available.",
  ],
});
