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

// ── Five-OEM design-system fixtures (shared engine, versioned profiles) ──

const oemBase = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  packages: [],
  keyFeatures: {},
  safety: { overall: null, frontalDriver: null, frontalPassenger: null, sideFront: null, sideRear: null, rollover: null },
});

// Jeep — approved adventure-performance benchmark (gasoline Wrangler).
export const jeepFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  vin: "1C4HJXFG5SW551234",
  identity: { year: "2025", make: "Jeep", model: "Wrangler", trim: "RUBICON 4-DOOR 4x4" },
  pricing: { baseMsrp: 51095, destinationCharge: 1895, optionsTotal: 3215, totalMsrp: 56205 },
  options: [
    { name: "Sky One-Touch Power Top", code: "HT1", msrp: 2075 },
    { name: "Integrated Off-Road Camera", code: "XNP", msrp: 595 },
    { name: "All-Weather Slush Mats", code: "CWA", msrp: 170 },
    { name: "Trailer Hitch Zoom", code: "XFJ", msrp: 375 },
  ],
  standardEquipment: {
    functional: [
      "3.6L Pentastar V6 Engine w/ ESS",
      "8-Speed Automatic Transmission",
      "Rock-Trac Full-Time 4WD w/ 4:1 Transfer Case",
      "Tru-Lok Front and Rear Locking Differentials",
      "Electronic Front Sway-Bar Disconnect",
      "4.10 Rear Axle Ratio",
      "Heavy-Duty Dana 44 Front and Rear Axles",
      "Skid Plates - Transfer Case and Fuel Tank",
      "Off-Road+ Drive Mode",
    ],
    exterior: [
      "33-Inch All-Terrain Tires on 17-Inch Wheels",
      "Steel Rock Rails",
      "LED Headlights and Fog Lights",
      "Removable Full Doors",
      "Fold-Down Windshield",
      "Tow Hooks - 2 Front / 1 Rear",
    ],
    interior: [
      "Heated Front Seats and Steering Wheel",
      "12.3-Inch Uconnect 5 Touchscreen",
      "Wireless Apple CarPlay and Android Auto",
      "Wash-Out Interior w/ Drain Plugs",
      "115V Auxiliary Power Outlet",
    ],
    safety_security: [
      "Automatic Emergency Braking",
      "Blind Spot Monitoring w/ Rear Cross Path",
      "Adaptive Cruise Control",
      "Electronic Roll Mitigation",
      "Hill Start Assist and Hill Descent Control",
      "Tire Pressure Monitoring Display",
    ],
  },
  colors: { exterior: { name: "Firecracker Red", code: "PRC" }, interior: { name: "Black", code: "A7X9" } },
  assembly: { plant: "Toledo", city: "Toledo", country: "OH USA" },
  mechanical: { engine: "3.6L V6", transmission: "8-SPEED A/T", drivetrain: "4x4" },
  stockNumber: "25WRRUB1234",
  epa: {
    city: 17, highway: 23, combined: 19, annualFuelCost: 2900, ghgScore: 4,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 5, gallonsPer100Miles: 5.3,
    fiveYearCostDifference: -3250, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-wrangler",
  barcodePayload: "1C4HJXFG5SW551234",
});

// Jeep 4xe — PHEV regulatory module proof (regulatory/phev).
export const jeep4xeFixture = (): FactoryStickerRenderData => ({
  ...jeepFixture(),
  vin: "1C4RJYB65SC663421",
  identity: { year: "2026", make: "Jeep", model: "Grand Cherokee", trim: "TRAILHAWK 4xe" },
  pricing: { baseMsrp: 65480, destinationCharge: 1995, optionsTotal: 5475, totalMsrp: 72950 },
  options: [
    { name: "Advanced ProTech Group IV", code: "AJY", msrp: 2385 },
    { name: "Rear Seat Entertainment Group", code: "AXN", msrp: 2090 },
    { name: "Trailer Tow Package", code: "AHX", msrp: 1000 },
  ],
  standardEquipment: {
    functional: [
      "2.0L Turbocharged I4 PHEV Powertrain",
      "Dual Electric Motor Generators",
      "17.3 kWh Lithium-Ion Battery Pack",
      "8-Speed TorqueFlite Automatic Transmission",
      "Quadra-Trac II 4x4 w/ 2-Speed Transfer Case",
      "Quadra-Lift Air Suspension",
      "Selec-Terrain Drive Modes - Auto/Sport/Rock/Snow/Mud-Sand",
      "Electric Limited-Slip Rear Differential",
      "Skid Plates - Underbody Protection Group",
      "7.2 kW Onboard Charger",
    ],
    exterior: [
      "18-Inch Off-Road Wheels w/ All-Terrain Tires",
      "Anti-Glare Hood Decal",
      "Red Front Tow Hooks",
      "LED Headlights w/ Auto High Beam",
      "Power Liftgate",
    ],
    interior: [
      "Ventilated Front Seats w/ Suede Inserts",
      "10.1-Inch Uconnect 5 NAV Display",
      "Digital Cluster w/ Off-Road Pages",
      "Heated Steering Wheel",
      "Wireless Charging Pad",
    ],
    safety_security: [
      "Automatic Emergency Braking w/ Pedestrian Detection",
      "Active Lane Management",
      "Adaptive Cruise Control w/ Stop & Go",
      "Blind Spot Monitoring",
      "Surround View Camera",
      "Intersection Collision Assist",
    ],
  },
  colors: { exterior: { name: "Hydro Blue", code: "PBJ" }, interior: { name: "Global Black", code: "X7" } },
  mechanical: { engine: "2.0L I4 PHEV", transmission: "8-SPEED A/T", drivetrain: "4x4" },
  stockNumber: "26GC4XE3421",
  epa: {
    city: null, highway: null, combined: 56, annualFuelCost: 2700, ghgScore: 7,
    rangeMiles: 26, fuelType: "PHEV Gasoline-Electric", smogScore: 5, gallonsPer100Miles: null,
    fiveYearCostDifference: -250, classNote: null, gasCombinedMpg: 23,
  },
  passportUrl: "https://autolabels.io/v/demo-gc4xe",
  barcodePayload: "1C4RJYB65SC663421",
});

// Toyota — mainstream-structured (red identity band only).
export const toyotaFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  vin: "5TDAAAB52SS091877",
  identity: { year: "2025", make: "Toyota", model: "Grand Highlander", trim: "XLE AWD" },
  pricing: { baseMsrp: 45020, destinationCharge: 1450, optionsTotal: 1950, totalMsrp: 48420 },
  options: [
    { name: "Premium Audio w/ JBL and NAV", code: "PJ", msrp: 1050 },
    { name: "Panoramic Moonroof", code: "PR", msrp: 500 },
    { name: "50-State Emissions", code: "FE", msrp: 0 },
    { name: "Carpet Mat Package", code: "CF", msrp: 400 },
  ],
  standardEquipment: {
    mechanical: [
      "2.4L Turbocharged 4-Cylinder Engine",
      "8-Speed Automatic Transmission",
      "Dynamic Torque Vectoring AWD",
      "Drive Mode Select - ECO/Normal/Sport",
      "Trailering Prep - 5,000 lb Rating",
    ],
    safety_features: [
      "Toyota Safety Sense 3.0",
      "Pre-Collision w/ Pedestrian Detection",
      "Full-Speed Dynamic Radar Cruise Control",
      "Lane Departure Alert w/ Steering Assist",
      "Blind Spot Monitor w/ Rear Cross Traffic Alert",
      "Proactive Driving Assist",
      "8 Airbags",
    ],
    exterior: [
      "18-Inch Machined Alloy Wheels",
      "LED Projector Headlights",
      "Power Liftgate w/ Kick Sensor",
      "Roof Rails",
      "Heated Power Outside Mirrors",
    ],
    interior: [
      "Heated Front Seats - SofTex Trim",
      "12.3-Inch Toyota Audio Multimedia Touchscreen",
      "Wireless Apple CarPlay and Android Auto",
      "Tri-Zone Automatic Climate Control",
      "Smart Key w/ Push Button Start",
      "7 USB Ports",
    ],
  },
  colors: { exterior: { name: "Wind Chill Pearl", code: "089" }, interior: { name: "Graphite", code: "FB20" } },
  assembly: { plant: "Princeton", city: "Princeton", country: "IN USA" },
  mechanical: { engine: "2.4L TURBO I4", transmission: "8-SPEED A/T", drivetrain: "AWD" },
  stockNumber: "25GHXLE1877",
  epa: {
    city: 20, highway: 26, combined: 22, annualFuelCost: 2350, ghgScore: 5,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 6, gallonsPer100Miles: 4.5,
    fiveYearCostDifference: -1750, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-grandhighlander",
  barcodePayload: "5TDAAAB52SS091877",
});

// Lexus — premium-minimalist monochrome (must not read as Toyota re-badged).
export const lexusFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  vin: "JTJAM7BX4S5334120",
  identity: { year: "2025", make: "Lexus", model: "GX 550", trim: "LUXURY+" },
  pricing: { baseMsrp: 81250, destinationCharge: 1350, optionsTotal: 3190, totalMsrp: 85790 },
  options: [
    { name: "Mark Levinson 21-Speaker Audio", code: "ML", msrp: 1140 },
    { name: "Head-Up Display", code: "HU", msrp: 900 },
    { name: "Cool Box Console", code: "CB", msrp: 170 },
    { name: "Illuminated Door Sills", code: "DS", msrp: 450 },
    { name: "22-Inch Dark Finish Wheels", code: "W22", msrp: 530 },
  ],
  standardEquipment: {
    mechanical: [
      "3.4L Twin-Turbo V6 Engine",
      "10-Speed Direct-Shift Automatic Transmission",
      "Full-Time 4WD w/ Torsen Limited-Slip Center Differential",
      "Adaptive Variable Suspension",
      "Multi-Terrain Select",
    ],
    interior: [
      "Semi-Aniline Leather Seating",
      "Heated and Ventilated Front and Second-Row Seats",
      "Massaging Driver Seat",
      "14-Inch Lexus Interface Touchscreen",
      "Mark Levinson-Ready Acoustic Glass",
      "64-Color Ambient Illumination",
      "Heated Wood-Trimmed Steering Wheel",
    ],
    exterior: [
      "20-Inch Machined-Finish Alloy Wheels",
      "Triple-Beam LED Headlights",
      "Power Moonroof",
      "Hands-Free Power Rear Door",
      "Roof Rails",
    ],
    safety_features: [
      "Lexus Safety System+ 3.0",
      "Pre-Collision w/ Intersection Support",
      "All-Speed Dynamic Radar Cruise Control",
      "Lane Tracing Assist",
      "Panoramic View Monitor",
      "Advanced Park",
    ],
  },
  colors: { exterior: { name: "Incognito", code: "1L2" }, interior: { name: "Saddle Tan", code: "4A60" } },
  assembly: { plant: "Tahara", city: "Tahara", country: "Japan" },
  mechanical: { engine: "3.4L TT V6", transmission: "10-SPEED A/T", drivetrain: "4WD" },
  stockNumber: "25GX550LX4120",
  epa: {
    city: 15, highway: 21, combined: 17, annualFuelCost: 3250, ghgScore: 3,
    rangeMiles: null, fuelType: "Premium Gasoline", smogScore: 5, gallonsPer100Miles: 5.9,
    fiveYearCostDifference: -5000, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-gx550",
  barcodePayload: "JTJAM7BX4S5334120",
});

// Chevrolet — american-utility: capability packages with long descriptions.
export const chevroletFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  vin: "3GCUDDED5SG412209",
  identity: { year: "2025", make: "Chevrolet", model: "Silverado 1500", trim: "LT CREW CAB 4WD" },
  pricing: { baseMsrp: 48600, destinationCharge: 1995, optionsTotal: 5125, totalMsrp: 55720 },
  packages: [],
  options: [
    {
      name: "All Star Edition",
      code: "PCV",
      msrp: 1395,
      contents: ["Dual-Zone Climate", "10-Way Power Driver Seat", "Trailering w/ Hitch Guidance"],
    },
    {
      name: "Z71 Off-Road and Protection Package",
      code: "Z71",
      msrp: 995,
      contents: ["Rancho Twin-Tube Shocks", "Hill Descent Control", "Skid Plates", "All-Weather Floor Liners"],
    },
    {
      name: "Trailering Package w/ Integrated Brake Controller",
      code: "Z82",
      msrp: 1195,
    },
    { name: "20-Inch Gloss Black Painted Wheels", code: "RD5", msrp: 995 },
    { name: "Spray-On Bedliner", code: "CGN", msrp: 545 },
  ],
  standardEquipment: {
    mechanical: [
      "2.7L Turbo High-Output Engine - 310 HP / 430 lb-ft",
      "8-Speed Automatic Transmission",
      "Autotrac Single-Speed Transfer Case",
      "9.5-Inch Rear Axle",
      "Automatic Stop/Start w/ Disable",
      "Trailer Brake Controller Prewiring",
      "700-Amp Battery",
    ],
    exterior: [
      "17-Inch Bright Silver Painted Aluminum Wheels",
      "LED Reflector Headlights",
      "CornerStep Rear Bumper",
      "EZ Lift Power Lock and Release Tailgate",
      "12 Fixed Cargo Tie-Downs",
      "Deep-Tinted Glass",
    ],
    interior: [
      "Cloth 40/20/40 Front Bench Seat",
      "13.4-Inch Diagonal Color Touchscreen",
      "Wireless Apple CarPlay and Android Auto",
      "12.3-Inch Digital Driver Information Center",
      "Steering Column - Manual Tilt and Telescoping",
    ],
    safety_features: [
      "Automatic Emergency Braking",
      "Front Pedestrian Braking",
      "Forward Collision Alert",
      "Following Distance Indicator",
      "Lane Keep Assist w/ Lane Departure Warning",
      "IntelliBeam Auto High Beams",
      "HD Rear Vision Camera",
    ],
  },
  colors: { exterior: { name: "Summit White", code: "GAZ" }, interior: { name: "Jet Black", code: "H0U" } },
  assembly: { plant: "Fort Wayne", city: "Fort Wayne", country: "IN USA" },
  mechanical: { engine: "2.7L TURBO I4", transmission: "8-SPEED A/T", drivetrain: "4WD" },
  stockNumber: "25SILLT2209",
  epa: {
    city: 19, highway: 21, combined: 20, annualFuelCost: 2600, ghgScore: 4,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 5, gallonsPer100Miles: 5.0,
    fiveYearCostDifference: -2500, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-silverado",
  barcodePayload: "3GCUDDED5SG412209",
});

// BMW — german-technical: option codes as secondary technical information.
export const bmwFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  vin: "WBA53FJ05SCT44821",
  identity: { year: "2025", make: "BMW", model: "530i xDrive", trim: "SEDAN (G60)" },
  pricing: { baseMsrp: 62200, destinationCharge: 1175, optionsTotal: 4350, totalMsrp: 67725 },
  packages: [],
  options: [
    { name: "Premium Package", code: "ZPP", msrp: 1700, contents: ["Heated Steering Wheel", "Head-Up Display", "Parking Assistant Plus"] },
    { name: "Driving Assistance Professional", code: "ZDP", msrp: 1700 },
    { name: "M Sport Brakes w/ Blue Calipers", code: "2NH", msrp: 650 },
    { name: "Harman Kardon Surround Sound", code: "688", msrp: 300 },
  ],
  standardEquipment: {
    mechanical: [
      "2.0L TwinPower Turbo I4 - 255 HP",
      "8-Speed Sport Automatic Transmission",
      "xDrive Intelligent All-Wheel Drive",
      "Adaptive M Suspension Compatibility",
      "Brake Energy Regeneration",
    ],
    exterior: [
      "19-Inch V-Spoke Bicolor Wheels (Code 872)",
      "Adaptive LED Headlights (Code 5A1)",
      "Illuminated Kidney Grille - Iconic Glow",
      "Power Folding Heated Mirrors",
      "Flush Door Handles",
    ],
    interior: [
      "Veganza Perforated Upholstery",
      "BMW Curved Display - 12.3 + 14.9 Inch",
      "BMW Operating System 8.5",
      "Ambient Lighting w/ Interaction Bar",
      "Sport Seats w/ Memory (Code 481)",
      "Automatic Climate Control - 4 Zone",
    ],
    safety_features: [
      "Active Guard w/ Frontal Collision Warning",
      "Active Blind Spot Detection",
      "Lane Departure Warning",
      "Parking Assistant w/ Reversing Assistant",
      "Attentiveness Assistant",
      "Tire Pressure Monitor",
    ],
  },
  colors: { exterior: { name: "Phytonic Blue Metallic", code: "C1M" }, interior: { name: "Cognac Veganza", code: "VACQ" } },
  assembly: { plant: "Dingolfing", city: "Dingolfing", country: "Germany" },
  mechanical: { engine: "2.0L TURBO I4", transmission: "8-SPEED A/T", drivetrain: "xDRIVE AWD" },
  stockNumber: "25530IX4821",
  epa: {
    city: 26, highway: 34, combined: 29, annualFuelCost: 1900, ghgScore: 6,
    rangeMiles: null, fuelType: "Premium Gasoline", smogScore: 7, gallonsPer100Miles: 3.4,
    fiveYearCostDifference: 250, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-530i",
  barcodePayload: "WBA53FJ05SCT44821",
});


// ── Genesis fixtures (korean-premium-factory, genesis-us-2025-v1) ──────

// Fixture 1 — premium gasoline SUV benchmark. 74,700 + 3,050 + 1,395 = 79,145.
export const genesisGv80Fixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  vin: "KMUHCESC5SU301992",
  identity: { year: "2025", make: "Genesis", model: "GV80", trim: "3.5T PRESTIGE AWD" },
  pricing: { baseMsrp: 74700, destinationCharge: 1395, optionsTotal: 3050, totalMsrp: 79145 },
  options: [
    { name: "Matte Paint - Brooklyn Brown", code: "MT", msrp: 1500 },
    { name: "22-Inch Dark Multi-Spoke Wheels", code: "W22", msrp: 1050 },
    { name: "Second-Row Side Window Blinds", code: "SB", msrp: 500 },
  ],
  standardEquipment: {
    mechanical: [
      "3.5L Twin-Turbocharged V6 - 375 HP",
      "8-Speed Automatic Transmission w/ Paddle Shifters",
      "HTRAC All-Wheel Drive w/ Multi-Terrain Modes",
      "Electronically Controlled Suspension w/ Road Preview",
      "Launch Control",
    ],
    safety_features: [
      "Forward Collision-Avoidance Assist 2 w/ Junction and Lane-Change",
      "Highway Driving Assist II",
      "Blind-Spot View Monitor",
      "Surround View Monitor w/ 3D",
      "Remote Smart Parking Assist",
      "10 Airbags Incl. Center Side Airbag",
      "Safe Exit Assist",
    ],
    interior: [
      "Nappa Leather Seating Surfaces",
      "Ergo Motion Driver Seat w/ Massage",
      "Heated and Ventilated Front and Second-Row Seats",
      "27-Inch OLED Integrated Display",
      "Bang & Olufsen 3D Premium Audio - 18 Speakers",
      "Mood Curator w/ Fragrance Diffusion",
      "Three-Zone Automatic Climate Control",
      "Heated Wood-and-Leather Steering Wheel",
    ],
    exterior: [
      "Two-Line Quad Headlamps w/ Adaptive Beam",
      "Crest Grille w/ G-Matrix Pattern",
      "20-Inch Machined Alloy Wheels",
      "Power Panoramic Sunroof",
      "Hands-Free Smart Power Liftgate",
      "Acoustic Laminated Glass",
    ],
  },
  colors: { exterior: { name: "Vik Black", code: "NBB" }, interior: { name: "Vanilla Beige", code: "VNE" } },
  assembly: { plant: "Ulsan", city: "Ulsan", country: "South Korea" },
  mechanical: { engine: "3.5L TT V6", transmission: "8-SPEED A/T", drivetrain: "AWD" },
  stockNumber: "25GV80PR1992",
  epa: {
    city: 16, highway: 22, combined: 18, annualFuelCost: 3100, ghgScore: 3,
    rangeMiles: null, fuelType: "Premium Gasoline", smogScore: 5, gallonsPer100Miles: 5.6,
    fiveYearCostDifference: -4250, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-gv80",
  barcodePayload: "KMUHCESC5SU301992",
});

// Fixture 2 — long-equipment G90: forces the deliberate continuation page.
export const genesisG90LongFixture = (): FactoryStickerRenderData => {
  const base = genesisGv80Fixture();
  const std = { ...base.standardEquipment };
  std.comfort = Array.from({ length: 26 }, (_, i) =>
    `Rear Executive Comfort Feature ${String(i + 1).padStart(2, "0")} w/ Extended Adjustment Range`);
  std.technology = Array.from({ length: 24 }, (_, i) =>
    `Connected Technology Function ${String(i + 1).padStart(2, "0")} w/ Over-the-Air Update Support`);
  return {
    ...base,
    vin: "KMTFC4SD3SU022761",
    identity: { year: "2025", make: "Genesis", model: "G90", trim: "5.0 ULTIMATE RWD" },
    pricing: { baseMsrp: 91750, destinationCharge: 1395, optionsTotal: 4400, totalMsrp: 97545 },
    options: [
      { name: "Rear Executive Package", code: "REP", msrp: 3300, contents: ["Power Reclining Rear Seats", "Rear Entertainment Displays", "Rear Refrigerated Console"] },
      { name: "Matte Paint - Makalu Gray", code: "MT", msrp: 1100 },
    ],
    standardEquipment: std,
    mechanical: { engine: "5.0L V8", transmission: "8-SPEED A/T", drivetrain: "RWD" },
    stockNumber: "25G90ULT2761",
    passportUrl: "https://autolabels.io/v/demo-g90",
    barcodePayload: "KMTFC4SD3SU022761",
  };
};

// Fixture 3 — Electrified GV70: regulatory/ev module, no gasoline content.
export const genesisEvFixture = (): FactoryStickerRenderData => ({
  ...genesisGv80Fixture(),
  vin: "KMUKCDTB5SU115530",
  identity: { year: "2025", make: "Genesis", model: "Electrified GV70", trim: "ADVANCED AWD" },
  pricing: { baseMsrp: 66450, destinationCharge: 1395, optionsTotal: 1650, totalMsrp: 69495 },
  options: [
    { name: "Matte Paint - Matterhorn White", code: "MT", msrp: 1500 },
    { name: "Cargo Package", code: "CP", msrp: 150, contents: ["Cargo Net", "Cargo Cover"] },
  ],
  standardEquipment: {
    mechanical: [
      "Dual Electric Motors - 429 HP (483 HP w/ Boost Mode)",
      "e-AWD w/ Disconnector Actuator System",
      "77.4 kWh Lithium-Ion Battery",
      "800V DC Fast Charging up to 240 kW",
      "10.9 kW Onboard Charger",
      "Vehicle-to-Load (V2L) Power Supply",
      "i-Pedal One-Pedal Driving",
    ],
    safety_features: [
      "Forward Collision-Avoidance Assist 2",
      "Highway Driving Assist II",
      "Blind-Spot View Monitor",
      "Surround View Monitor",
      "Remote Smart Parking Assist",
      "10 Airbags",
    ],
    interior: [
      "Leatherette Seating w/ Recycled Materials",
      "Heated and Ventilated Front Seats",
      "14.5-Inch Infotainment Display",
      "Digital Key 2 w/ Fingerprint Authentication",
      "Bang & Olufsen Premium Audio",
      "Dual-Zone Climate w/ After-Blow",
    ],
    exterior: [
      "Two-Line Headlamps",
      "Crest Grille - Closed EV Design",
      "20-Inch Aerodynamic Alloy Wheels",
      "Power Panoramic Sunroof",
      "Hands-Free Power Liftgate",
    ],
  },
  colors: { exterior: { name: "Matterhorn White Matte", code: "M2W" }, interior: { name: "Obsidian Black", code: "OBK" } },
  mechanical: { engine: "DUAL ELECTRIC MOTORS", transmission: "1-SPEED REDUCTION", drivetrain: "e-AWD" },
  stockNumber: "25EGV70AD5530",
  epa: {
    city: 98, highway: 87, combined: 93, annualFuelCost: 950, ghgScore: 10,
    rangeMiles: 236, fuelType: "Electric", smogScore: 10, gallonsPer100Miles: null,
    fiveYearCostDifference: 4750, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-egv70",
  barcodePayload: "KMUKCDTB5SU115530",
});

export const genericDecodeFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  generic: true,
  disclaimers: [
    "AutoLabels-generated Factory Build & Original MSRP Record created from VIN-specific vehicle data. This is not the original manufacturer Monroney label and is not a replacement for any federally required label on a new motor vehicle.",
    "Equipment shown is typical for this trim; VIN-specific decode was not available.",
  ],
});
