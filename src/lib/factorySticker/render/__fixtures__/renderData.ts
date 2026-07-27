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

// ── Kia fixtures (korean-mainstream-factory, kia-us-2026-v1) ───────────

// Fixture 1 — gasoline AWD benchmark. 46,110 + 1,365 + 1,395 = 48,870.
export const kiaTellurideFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  vin: "5XYP5DGC0TG482915",
  identity: { year: "2026", make: "Kia", model: "Telluride", trim: "SX AWD" },
  pricing: { baseMsrp: 46110, destinationCharge: 1395, optionsTotal: 1365, totalMsrp: 48870 },
  options: [
    { name: "Tow Hitch w/ Wiring Harness", code: "TH", msrp: 795 },
    { name: "Roof Rack Cross Bars", code: "RB", msrp: 360 },
    { name: "Carpeted Floor Mats", code: "FM", msrp: 210 },
  ],
  standardEquipment: {
    mechanical: [
      "3.8L GDI V6 Engine - 291 HP",
      "8-Speed Automatic Transmission",
      "Active On-Demand AWD w/ Center Locking Differential",
      "Drive Mode Select w/ Snow Mode",
      "Trailer Sway Control and Pre-Wiring",
      "Self-Leveling Rear Suspension",
    ],
    safety_features: [
      "Forward Collision-Avoidance Assist w/ Pedestrian, Cyclist & Junction",
      "Highway Driving Assist",
      "Blind-Spot View Monitor",
      "Rear Cross-Traffic Collision-Avoidance Assist",
      "Lane Keeping Assist & Lane Following Assist",
      "Driver Attention Warning w/ Leading Vehicle Departure Alert",
      "Safe Exit Assist w/ Rear Occupant Alert",
      "Tire Pressure Monitoring System (TPMS)",
    ],
    interior: [
      "Nappa Leather Seat Trim",
      "Heated & Ventilated Front Seats",
      "Heated Second-Row Outboard Seats",
      "Dual 12.3-Inch Panoramic Curved Display",
      "Harman Kardon Premium Audio - 10 Speakers",
      "Dual-Zone Automatic Climate Control w/ Rear Controls",
      "Smart Key w/ Remote Start",
      "Wireless Phone Charger",
    ],
    exterior: [
      "20-Inch Machined Alloy Wheels",
      "LED Projection Headlights w/ Auto High Beam",
      "Panoramic Sunroof w/ Power Sunshade",
      "Smart Power Liftgate w/ Auto Open",
      "Power-Folding Outside Mirrors w/ LED Turn Signals",
      "Rain-Sensing Front Wipers",
    ],
  },
  colors: { exterior: { name: "Dark Moss", code: "DML" }, interior: { name: "Black", code: "BLK" } },
  assembly: { plant: "West Point", city: "West Point, Georgia", country: "USA" },
  mechanical: { engine: "3.8L GDI V6", transmission: "8-SPEED A/T", drivetrain: "AWD" },
  stockNumber: "26TELSX2915",
  epa: {
    city: 18, highway: 24, combined: 20, annualFuelCost: 2600, ghgScore: 4,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 6, gallonsPer100Miles: 5.0,
    fiveYearCostDifference: -2750, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-telluride",
  barcodePayload: "5XYP5DGC0TG482915",
});

// Fixture 2 — Sportage Hybrid: regulatory/hybrid keeps the gasoline shape
// under the Hybrid Vehicle tag. 38,990 + 325 + 1,425 = 40,740.
export const kiaHybridFixture = (): FactoryStickerRenderData => ({
  ...kiaTellurideFixture(),
  vin: "KNDPUDDF3T7420117",
  identity: { year: "2026", make: "Kia", model: "Sportage Hybrid", trim: "SX-PRESTIGE AWD" },
  pricing: { baseMsrp: 38990, destinationCharge: 1425, optionsTotal: 325, totalMsrp: 40740 },
  options: [
    { name: "Carpeted Floor Mats", code: "FM", msrp: 210 },
    { name: "Cargo Mat", code: "CM", msrp: 115 },
  ],
  standardEquipment: {
    mechanical: [
      "1.6L Turbocharged GDI I4 Hybrid - 231 HP Combined",
      "Permanent-Magnet Synchronous Drive Motor",
      "1.49 kWh Lithium-Ion Polymer Battery",
      "6-Speed Automatic Transmission",
      "Active AWD w/ Center Locking Differential",
      "Regenerative Braking w/ Drive Mode Select",
    ],
    safety_features: [
      "Forward Collision-Avoidance Assist w/ Pedestrian, Cyclist & Junction",
      "Highway Driving Assist 2",
      "Navigation-Based Smart Cruise Control w/ Stop & Go",
      "Blind-Spot View Monitor",
      "360-Degree Surround View Monitor",
      "Remote Smart Parking Assist (RSPA)",
      "Forward & Reverse Parking Collision-Avoidance Assist",
      "Safe Exit Warning",
    ],
    interior: [
      "SynTex Seat Trim w/ Heated & Ventilated Front Seats",
      "Panoramic Curved Display w/ 12.3-Inch Touchscreen Navigation",
      "Harman Kardon Premium Audio",
      "Meridian-Pattern Premium Interior Trim",
      "Ambient Lighting (64 Colors)",
      "Heated Steering Wheel",
      "Smart Key w/ Push Button Start & Remote Start",
      "Wireless Apple CarPlay & Android Auto",
    ],
    exterior: [
      "19-Inch Machined-Finish Alloy Wheels w/ Gloss Black Accents",
      "LED Projection Headlights w/ Front LED Fog Lights",
      "Panoramic Sunroof w/ Power Sunshade",
      "Gloss Black Exterior Accents & Roof Rails",
      "Smart Power Liftgate w/ Auto Open",
      "Metal Door Scuff Plates",
    ],
  },
  colors: { exterior: { name: "Wolf Gray", code: "WG2" }, interior: { name: "Black", code: "BLK" } },
  assembly: { plant: "Gwangju", city: "Gwangju", country: "South Korea" },
  mechanical: { engine: "1.6L T-GDI HYBRID", transmission: "6-SPEED A/T", drivetrain: "AWD" },
  stockNumber: "26SPHSX0117",
  epa: {
    city: 42, highway: 44, combined: 43, annualFuelCost: 1150, ghgScore: 8,
    rangeMiles: null, fuelType: "Hybrid Gasoline-Electric", smogScore: 7, gallonsPer100Miles: 2.3,
    fiveYearCostDifference: 3000, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-sportage-hev",
  barcodePayload: "KNDPUDDF3T7420117",
});

// Fixture 3 — Sportage Plug-In Hybrid: regulatory/phev. 45,190 + 210 + 1,425 = 46,825.
export const kiaPhevFixture = (): FactoryStickerRenderData => ({
  ...kiaHybridFixture(),
  vin: "KNDPVEDF6T7355208",
  identity: { year: "2026", make: "Kia", model: "Sportage Plug-In Hybrid", trim: "X-LINE PRESTIGE AWD" },
  pricing: { baseMsrp: 45190, destinationCharge: 1425, optionsTotal: 210, totalMsrp: 46825 },
  options: [
    { name: "Carpeted Floor Mats", code: "FM", msrp: 210 },
  ],
  standardEquipment: {
    mechanical: [
      "1.6L Turbocharged GDI I4 Plug-In Hybrid - 261 HP Combined",
      "66.9 kW Permanent-Magnet Drive Motor",
      "13.8 kWh Lithium-Ion Polymer Battery",
      "7.2 kW Onboard Charger",
      "6-Speed Automatic Transmission",
      "Active AWD w/ Center Locking Differential",
      "EV / HEV / Automatic Drive Modes",
    ],
    safety_features: [
      "Forward Collision-Avoidance Assist w/ Pedestrian, Cyclist & Junction",
      "Highway Driving Assist 2",
      "Blind-Spot View Monitor",
      "360-Degree Surround View Monitor",
      "Forward & Reverse Parking Collision-Avoidance Assist",
      "Safe Exit Warning",
    ],
    interior: [
      "SynTex Seat Trim w/ Heated & Ventilated Front Seats",
      "Panoramic Curved Display w/ 12.3-Inch Touchscreen Navigation",
      "Harman Kardon Premium Audio",
      "Heated Steering Wheel",
      "Smart Key w/ Push Button Start & Remote Start",
      "Wireless Apple CarPlay & Android Auto",
    ],
    exterior: [
      "19-Inch X-Line Alloy Wheels",
      "LED Projection Headlights w/ Front LED Fog Lights",
      "Raised X-Line Roof Rails & Gloss Black Accents",
      "Panoramic Sunroof w/ Power Sunshade",
      "Smart Power Liftgate w/ Auto Open",
    ],
  },
  mechanical: { engine: "1.6L T-GDI PHEV", transmission: "6-SPEED A/T", drivetrain: "AWD" },
  stockNumber: "26SPPHEV5208",
  epa: {
    city: null, highway: null, combined: 84, annualFuelCost: 1300, ghgScore: 9,
    rangeMiles: 34, fuelType: "PHEV Gasoline-Electric", smogScore: 7, gallonsPer100Miles: null,
    fiveYearCostDifference: 2250, classNote: null, gasCombinedMpg: 35,
  },
  passportUrl: "https://autolabels.io/v/demo-sportage-phev",
  barcodePayload: "KNDPVEDF6T7355208",
});

// Fixture 4 — EV9: regulatory/ev, no gasoline content. 69,900 + 445 + 1,495 = 71,840.
export const kiaEvFixture = (): FactoryStickerRenderData => ({
  ...kiaTellurideFixture(),
  vin: "KNDADFS56T6104472",
  identity: { year: "2026", make: "Kia", model: "EV9", trim: "LAND AWD" },
  pricing: { baseMsrp: 69900, destinationCharge: 1495, optionsTotal: 445, totalMsrp: 71840 },
  options: [
    { name: "Carpeted Floor Mats", code: "FM", msrp: 250 },
    { name: "Cargo Cover", code: "CC", msrp: 195 },
  ],
  standardEquipment: {
    mechanical: [
      "Dual Electric Motors - 379 HP",
      "99.8 kWh Lithium-Ion Battery",
      "800V Architecture w/ DC Fast Charging up to 230 kW",
      "11 kW Onboard Charger",
      "e-AWD w/ Torque Vectoring",
      "Vehicle-to-Load (V2L) Power Supply",
      "i-Pedal One-Pedal Driving",
    ],
    safety_features: [
      "Forward Collision-Avoidance Assist 2 w/ Junction & Lane-Change",
      "Highway Driving Assist 2",
      "Blind-Spot View Monitor",
      "360-Degree Surround View Monitor",
      "Remote Smart Parking Assist 2",
      "Ten Airbags Incl. Front Center Side Airbag",
      "Safe Exit Assist w/ Rear Occupant Alert",
    ],
    interior: [
      "Relaxation Front Seats w/ Heating & Ventilation",
      "Second-Row Captain's Chairs",
      "Triple-Panel Panoramic Display w/ Dual 12.3-Inch Screens",
      "Meridian Premium Audio - 14 Speakers",
      "Digital Key 2 w/ Fingerprint Authentication",
      "Tri-Zone Automatic Climate Control",
      "Wireless Phone Charger",
    ],
    exterior: [
      "20-Inch Aerodynamic Alloy Wheels",
      "Digital Tiger Face w/ Star Map LED Lighting",
      "Digital Pattern Lighting Grille",
      "Flush Door Handles",
      "Dual Sunroof w/ Power Sunshade",
      "Smart Power Liftgate",
    ],
  },
  colors: { exterior: { name: "Ocean Blue Matte", code: "OBM" }, interior: { name: "Gray", code: "GRY" } },
  assembly: { plant: "West Point", city: "West Point, Georgia", country: "USA" },
  mechanical: { engine: "DUAL ELECTRIC MOTORS", transmission: "1-SPEED REDUCTION", drivetrain: "e-AWD" },
  stockNumber: "26EV9LND4472",
  epa: {
    city: 88, highway: 77, combined: 83, annualFuelCost: 850, ghgScore: 10,
    rangeMiles: 280, fuelType: "Electric", smogScore: 10, gallonsPer100Miles: null,
    fiveYearCostDifference: 3750, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-ev9",
  barcodePayload: "KNDADFS56T6104472",
});

// Fixture 5 — long-equipment X-Pro: forces the deliberate continuation page.
// 55,335 + 450 + 1,395 = 57,180.
export const kiaTellurideLongFixture = (): FactoryStickerRenderData => {
  const base = kiaTellurideFixture();
  const std = { ...base.standardEquipment };
  std.comfort = Array.from({ length: 26 }, (_, i) =>
    `Cabin Comfort & Convenience Feature ${String(i + 1).padStart(2, "0")} w/ Extended Adjustment Range`);
  std.technology = Array.from({ length: 24 }, (_, i) =>
    `Kia Connect Technology Function ${String(i + 1).padStart(2, "0")} w/ Over-the-Air Update Support`);
  return {
    ...base,
    vin: "5XYPHDHC2TG519306",
    identity: { year: "2026", make: "Kia", model: "Telluride", trim: "SX PRESTIGE X-PRO AWD" },
    pricing: { baseMsrp: 55335, destinationCharge: 1395, optionsTotal: 450, totalMsrp: 57180 },
    options: [
      { name: "Carpeted Floor Mats", code: "FM", msrp: 210 },
      { name: "Cargo Tray", code: "CT", msrp: 120 },
      { name: "Wheel Locks", code: "WL", msrp: 85 },
      { name: "First Aid Kit", code: "FA", msrp: 35 },
    ],
    standardEquipment: std,
    stockNumber: "26TELXPRO9306",
    passportUrl: "https://autolabels.io/v/demo-telluride-xpro",
    barcodePayload: "5XYPHDHC2TG519306",
  };
};

// ── Mazda fixtures (japanese-factory-technical, mazda-us-2026-v1) ──────

const NEW_LABEL_DISCLAIMERS = [
  "This label is prepared pursuant to the Automobile Information Disclosure Act. Gasoline, license, title, state and local taxes, and dealer-installed options and accessories are not included in the manufacturer's suggested retail price. Dealer final price will vary.",
  "Digitally prepared by AutoLabels.io",
];

// Fixture 1 — CX-90 benchmark. 54,400 + 4,720 + 0 (port) + 1,475 = 60,595.
export const mazdaCx90Fixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  condition: "new",
  title: "Factory Window Sticker — Configuration & MSRP",
  vin: "JM3KKEHC7T1234567",
  identity: { year: "2026", make: "Mazda", model: "CX-90", trim: "3.3 TURBO PREMIUM PLUS AWD" },
  pricing: { baseMsrp: 54400, destinationCharge: 1475, optionsTotal: 4720, totalMsrp: 60595, portOptionsTotal: 0 },
  options: [
    { name: "Rhodium White Premium Paint Charge", code: null, msrp: 595 },
    { name: "Premium Plus Package", code: "PPP", msrp: 2500, contents: ["Surround View Monitor", "Traffic Jam Assist"] },
    { name: "Tow Package", code: "TOW", msrp: 600, contents: ["Trailer Hitch w/ 4-Pin Connector", "Trailer Hitch View"] },
    { name: "21-Inch Alloy Wheels - Dark Finish", code: "W21", msrp: 600 },
    { name: "All-Weather Floor Mats", code: null, msrp: 225 },
    { name: "Cargo Tray", code: null, msrp: 125 },
    { name: "Wheel Locks", code: null, msrp: 75 },
  ],
  portOptions: [{ name: "Rhodium White Premium", code: null, msrp: 0 }],
  standardEquipment: {
    mechanical: [
      "3.3L Inline 6 e-Skyactiv G Turbo Engine - 340 HP",
      "8-Speed Automatic Transmission",
      "i-Activ All-Wheel Drive",
      "G-Vectoring Control Plus",
      "Mi-Drive: Normal, Sport, Off-Road, Towing",
      "5,000-lb Towing Capacity",
    ],
    exterior: [
      "LED Headlights w/ Auto On/Off",
      "LED Daytime Running Lights & Signature Lighting",
      "Power Liftgate w/ Programmable Height",
      "Power-Folding Side Mirrors",
      "Rain-Sensing Windshield Wipers",
      "Panoramic Power Moonroof",
      "Roof Rails",
    ],
    interior: [
      "Three-Row Seating",
      "Nappa Leather-Trimmed Seats",
      "Power Driver & Front-Passenger Seats",
      "Heated & Ventilated Front Seats",
      "Heated Second-Row Outboard Seats",
      "Three-Zone Automatic Climate Control",
      "Mazda Connect Infotainment w/ 12.3-Inch Display",
      "Wireless Apple CarPlay & Android Auto",
      "Bose Premium Audio - 12 Speakers",
      "Head-Up Display",
      "Wireless Phone Charger",
    ],
    safety_features: [
      "i-Activsense Safety Suite",
      "Smart Brake Support w/ Pedestrian Detection",
      "Blind Spot Monitoring w/ Rear Cross Traffic Alert",
      "Lane Departure Warning w/ Lane Keep Assist",
      "Mazda Radar Cruise Control w/ Stop & Go",
      "Driver Attention Alert",
      "360-Degree View Monitor",
      "Front & Rear Parking Sensors",
      "Anti-Theft Engine Immobilizer",
    ],
  },
  colors: { exterior: { name: "Rhodium White Premium", code: "46G" }, interior: { name: "Black", code: "BLK" } },
  assembly: { plant: "Hiroshima", city: "Hiroshima", country: "Japan" },
  mechanical: { engine: "3.3L TURBO I6", transmission: "8-SPEED A/T", drivetrain: "i-ACTIV AWD" },
  stockNumber: "26CX90PPA",
  transportMethod: "OCEAN",
  factoryCodes: { location: null, emissions: "50 STATE", sequence: null, order: null, dealer: "00000" },
  epa: {
    city: 21, highway: 28, combined: 24, annualFuelCost: 2250, ghgScore: 5,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 7, gallonsPer100Miles: 4.2,
    fiveYearCostDifference: 1750, classNote: null,
  },
  safety: null,
  warranty: {
    basic: "3-Year/36,000-Mile Basic Limited Warranty",
    powertrain: "5-Year/60,000-Mile Powertrain Limited Warranty",
    corrosion: null,
    roadside: "5-Year/Unlimited-Mile Roadside Assistance",
    emissions: null,
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "0%" },
    { label: "Major foreign parts content", value: "Japan 85%" },
    { label: "Final assembly point", value: "Hiroshima, Japan" },
    { label: "Country of origin - engine", value: "Japan" },
    { label: "Country of origin - transmission", value: "Japan" },
  ],
  dealer: { name: "Mazda North American Operations", address: null, city: "Irvine", state: "CA", zip: "92618-2922", phone: null },
  passportUrl: "https://autolabels.io/v/demo-cx90",
  barcodePayload: "JM3KKEHC7T1234567",
  disclaimers: NEW_LABEL_DISCLAIMERS,
});

// Fixture 2 — CX-90 PHEV: regulatory/phev. 56,950 + 820 + 1,475 = 59,245.
export const mazdaPhevFixture = (): FactoryStickerRenderData => ({
  ...mazdaCx90Fixture(),
  vin: "JM3KKEHA8T1156789",
  identity: { year: "2026", make: "Mazda", model: "CX-90 PHEV", trim: "PREMIUM PLUS AWD" },
  pricing: { baseMsrp: 56950, destinationCharge: 1475, optionsTotal: 820, totalMsrp: 59245 },
  options: [
    { name: "Rhodium White Premium Paint Charge", code: null, msrp: 595 },
    { name: "All-Weather Floor Mats", code: null, msrp: 225 },
  ],
  portOptions: [],
  standardEquipment: {
    mechanical: [
      "2.5L e-Skyactiv PHEV Powertrain - 323 HP Combined",
      "Permanent-Magnet Synchronous Drive Motor",
      "17.8 kWh Lithium-Ion Battery",
      "8-Speed Automatic Transmission",
      "i-Activ All-Wheel Drive",
      "Mi-Drive: EV, Normal, Sport, Off-Road, Towing",
      "7.2 kW Onboard Charger",
    ],
    exterior: [
      "LED Headlights w/ Auto On/Off",
      "Power Liftgate w/ Programmable Height",
      "Panoramic Power Moonroof",
      "Power-Folding Side Mirrors",
      "Roof Rails",
    ],
    interior: [
      "Three-Row Seating",
      "Nappa Leather-Trimmed Seats",
      "Heated & Ventilated Front Seats",
      "Three-Zone Automatic Climate Control",
      "Mazda Connect Infotainment w/ 12.3-Inch Display",
      "Wireless Apple CarPlay & Android Auto",
      "Bose Premium Audio - 12 Speakers",
      "Head-Up Display",
    ],
    safety_features: [
      "i-Activsense Safety Suite",
      "Smart Brake Support w/ Pedestrian Detection",
      "Blind Spot Monitoring w/ Rear Cross Traffic Alert",
      "Mazda Radar Cruise Control w/ Stop & Go",
      "360-Degree View Monitor",
      "Front & Rear Parking Sensors",
    ],
  },
  mechanical: { engine: "2.5L I4 PHEV", transmission: "8-SPEED A/T", drivetrain: "i-ACTIV AWD" },
  stockNumber: "26CX90PHEV89",
  epa: {
    city: null, highway: null, combined: 56, annualFuelCost: 2050, ghgScore: 7,
    rangeMiles: 26, fuelType: "PHEV Gasoline-Electric", smogScore: 7, gallonsPer100Miles: null,
    fiveYearCostDifference: 500, classNote: null, gasCombinedMpg: 25,
  },
  passportUrl: "https://autolabels.io/v/demo-cx90-phev",
  barcodePayload: "JM3KKEHA8T1156789",
});

// Fixture 3 — MX-5 Miata RF: short content, long color descriptions.
// 39,650 + 595 + 1,185 = 41,430.
export const mazdaMiataFixture = (): FactoryStickerRenderData => ({
  ...mazdaCx90Fixture(),
  vin: "JM1NDAM75T0612345",
  identity: { year: "2026", make: "Mazda", model: "MX-5 Miata RF", trim: "GRAND TOURING" },
  pricing: { baseMsrp: 39650, destinationCharge: 1185, optionsTotal: 595, totalMsrp: 41430 },
  options: [
    { name: "Soul Red Crystal Metallic Paint Charge", code: null, msrp: 595 },
  ],
  portOptions: [],
  standardEquipment: {
    mechanical: [
      "2.0L Skyactiv-G I4 Engine - 181 HP",
      "6-Speed Manual Transmission",
      "Rear-Wheel Drive",
      "Limited-Slip Differential",
      "Sport-Tuned Suspension w/ Bilstein Dampers",
    ],
    exterior: [
      "Power-Retractable Fastback Hardtop",
      "LED Headlights & Taillights",
      "17-Inch Dark-Finish Alloy Wheels",
      "Heated Power Side Mirrors",
    ],
    interior: [
      "Nappa Leather-Trimmed Sport Seats",
      "Heated Front Seats",
      "Mazda Connect w/ 8.8-Inch Display",
      "Wireless Apple CarPlay & Android Auto",
      "Bose Audio w/ Headrest Speakers - 9 Speakers",
    ],
    safety_features: [
      "Smart Brake Support",
      "Blind Spot Monitoring w/ Rear Cross Traffic Alert",
      "Lane Departure Warning",
      "Traffic Sign Recognition",
    ],
  },
  colors: {
    exterior: { name: "Soul Red Crystal Metallic", code: "46V" },
    interior: { name: "Sport Tan Nappa Leather", code: "TAN" },
  },
  mechanical: { engine: "2.0L SKYACTIV-G I4", transmission: "6-SPEED M/T", drivetrain: "RWD" },
  stockNumber: "26MX5RFGT45",
  epa: {
    city: 26, highway: 34, combined: 29, annualFuelCost: 1900, ghgScore: 6,
    rangeMiles: null, fuelType: "Premium Gasoline", smogScore: 6, gallonsPer100Miles: 3.4,
    fiveYearCostDifference: 250, classNote: null,
  },
  passportUrl: "https://autolabels.io/v/demo-mx5rf",
  barcodePayload: "JM1NDAM75T0612345",
});

// Fixture 4 — long-equipment CX-90: forces the deliberate continuation page.
// 61,325 + 4,720 + 0 (port) + 1,475 = 67,520.
export const mazdaLongFixture = (): FactoryStickerRenderData => {
  const base = mazdaCx90Fixture();
  const std = { ...base.standardEquipment };
  std.comfort = Array.from({ length: 26 }, (_, i) =>
    `Cabin Comfort & Convenience Feature ${String(i + 1).padStart(2, "0")} w/ Extended Adjustment Range`);
  std.technology = Array.from({ length: 24 }, (_, i) =>
    `Connected Technology Function ${String(i + 1).padStart(2, "0")} w/ Over-the-Air Update Support`);
  return {
    ...base,
    vin: "JM3KKEHC3T1229984",
    identity: { year: "2026", make: "Mazda", model: "CX-90", trim: "3.3 TURBO S PREMIUM PLUS AWD" },
    pricing: { baseMsrp: 61325, destinationCharge: 1475, optionsTotal: 4720, totalMsrp: 67520, portOptionsTotal: 0 },
    standardEquipment: std,
    stockNumber: "26CX90TS9984",
    passportUrl: "https://autolabels.io/v/demo-cx90-ts",
    barcodePayload: "JM3KKEHC3T1229984",
  };
};

// ── Subaru fixtures (japanese-factory-technical, subaru-us-2026-v1) ────

// Fixture 1 — Outback Touring XT benchmark. 42,795 + 3,101 + 1,420 = 47,316.
export const subaruOutbackFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  condition: "new",
  title: "Factory Window Sticker — Configuration & MSRP",
  vin: "4S4BTGPD0T3456789",
  identity: { year: "2026", make: "Subaru", model: "Outback", trim: "TOURING XT AWD" },
  pricing: { baseMsrp: 42795, destinationCharge: 1420, optionsTotal: 3101, totalMsrp: 47316 },
  options: [
    { name: "Optional Package 32", code: "32", msrp: 2060, contents: ["Power Moonroof", "Multimedia Navigation System", "Harman Kardon Premium Audio"] },
    { name: "Crystal White Pearl", code: "0H1", msrp: 395 },
    { name: "Auto-Dimming Mirror w/ Compass", code: "OA2", msrp: 285 },
    { name: "All-Weather Floor Liners", code: "0B1", msrp: 141 },
    { name: "Rear Seatback Protector", code: "0C1", msrp: 142 },
    { name: "Cargo Net", code: "0D1", msrp: 78 },
  ],
  standardEquipment: {
    mechanical: [
      "2.4L Turbocharged Subaru Boxer Engine - 260 HP",
      "Lineartronic CVT w/ Paddle Shifters",
      "Subaru Symmetrical All-Wheel Drive",
      "X-MODE w/ Hill Descent Control",
      "Vehicle Dynamics Control w/ Active Torque Vectoring",
      "Four-Wheel Independent Suspension",
    ],
    exterior: [
      "LED Steering-Responsive Headlights",
      "High Beam Assist w/ LED Fog Lights",
      "Power Rear Gate w/ Height Memory",
      "Heated Exterior Mirrors",
      "Windshield-Wiper De-Icer",
      "Roof Rails w/ Retractable Cross Bars",
      "18-Inch Machined Alloy Wheels",
    ],
    interior: [
      "Java Brown Nappa Leather-Trimmed Upholstery",
      "Heated & Ventilated Front Seats",
      "Heated Rear Outboard Seats",
      "Heated Steering Wheel",
      "10-Way Power Driver's Seat w/ Memory",
      "Dual-Zone Automatic Climate Control",
      "Keyless Access w/ Push-Button Start",
      "11.6-Inch Subaru Multimedia Touchscreen",
      "Wireless Apple CarPlay & Android Auto",
      "Wireless Device Charging",
    ],
    safety_features: [
      "EyeSight Driver Assist Technology",
      "Advanced Adaptive Cruise Control w/ Lane Centering",
      "Pre-Collision Braking & Throttle Management",
      "Lane Departure & Sway Warning",
      "Blind-Spot Detection w/ Lane Change Assist",
      "Rear Cross-Traffic Alert",
      "Reverse Automatic Braking",
      "DriverFocus Distraction Mitigation System",
      "Front View Monitor",
    ],
  },
  colors: {
    exterior: { name: "Crystal White Pearl", code: "K1X" },
    interior: { name: "Java Brown Nappa Leather", code: "JBR" },
  },
  assembly: { plant: "Subaru of Indiana Automotive", city: "Lafayette, Indiana", country: "USA" },
  mechanical: { engine: "2.4L TURBO BOXER", transmission: "LINEARTRONIC CVT", drivetrain: "SYMMETRICAL AWD" },
  stockNumber: "S260145",
  transportMethod: "RAIL",
  factoryCodes: { location: null, emissions: "50 STATE", sequence: null, order: null, dealer: "S4102" },
  epa: {
    city: 23, highway: 30, combined: 26, annualFuelCost: 2150, ghgScore: 5,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 6, gallonsPer100Miles: 3.8,
    fiveYearCostDifference: 500, classNote: null,
  },
  safety: null,
  warranty: {
    basic: "3-Year/36,000-Mile Basic Limited Warranty",
    powertrain: "5-Year/60,000-Mile Powertrain Limited Warranty",
    corrosion: "5-Year Rust Perforation Limited Warranty",
    roadside: "3-Year/36,000-Mile Roadside Assistance",
    emissions: null,
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "50%" },
    { label: "Major foreign parts content", value: "Japan 30%" },
    { label: "Final assembly point", value: "Lafayette, Indiana, USA" },
    { label: "Country of origin - engine", value: "USA" },
    { label: "Country of origin - transmission", value: "Japan" },
  ],
  dealer: { name: "Subaru Distributors Corp.", address: null, city: "Orangeburg", state: "NY", zip: "10962", phone: null },
  passportUrl: "https://autolabels.io/v/demo-outback",
  barcodePayload: "4S4BTGPD0T3456789",
  disclaimers: NEW_LABEL_DISCLAIMERS,
});

// Fixture 2 — Solterra: regulatory/ev, no gasoline content.
// 44,995 + 536 + 1,420 = 46,951.
export const subaruSolterraFixture = (): FactoryStickerRenderData => ({
  ...subaruOutbackFixture(),
  vin: "JTMABABA5TA098765",
  identity: { year: "2026", make: "Subaru", model: "Solterra", trim: "LIMITED AWD" },
  pricing: { baseMsrp: 44995, destinationCharge: 1420, optionsTotal: 536, totalMsrp: 46951 },
  options: [
    { name: "Harbor Mist Gray Pearl", code: "0H2", msrp: 395 },
    { name: "All-Weather Floor Liners", code: "0B1", msrp: 141 },
  ],
  standardEquipment: {
    mechanical: [
      "Dual Electric Motors - 338 HP",
      "74.7 kWh Lithium-Ion Battery",
      "StarDrive Symmetrical All-Wheel Drive",
      "DC Fast Charging up to 150 kW",
      "11 kW Onboard Charger",
      "X-MODE w/ Grip Control & Downhill Assist",
      "Regenerative Braking Paddles",
    ],
    exterior: [
      "LED Headlights w/ Auto High Beam",
      "Power Rear Gate",
      "Roof Rails",
      "20-Inch Dark Metallic Alloy Wheels",
      "Heated Exterior Mirrors",
    ],
    interior: [
      "SofTex-Trimmed Upholstery",
      "Heated & Ventilated Front Seats",
      "Heated Steering Wheel",
      "14-Inch Multimedia Touchscreen",
      "Wireless Apple CarPlay & Android Auto",
      "Harman Kardon Premium Audio",
      "Wireless Device Charging",
      "Digital Rearview Mirror",
    ],
    safety_features: [
      "Advanced Adaptive Cruise Control w/ Lane Centering",
      "Pre-Collision Braking w/ Intersection Support",
      "Blind-Spot Detection w/ Lane Change Assist",
      "Rear Cross-Traffic Alert",
      "360-Degree Surround View Monitor",
      "Front & Rear Parking Sensors w/ Automatic Braking",
    ],
  },
  colors: {
    exterior: { name: "Harbor Mist Gray Pearl", code: "0H2" },
    interior: { name: "Black SofTex", code: "BLK" },
  },
  assembly: { plant: "Motomachi", city: "Toyota City", country: "Japan" },
  mechanical: { engine: "DUAL ELECTRIC MOTORS", transmission: "1-SPEED REDUCTION", drivetrain: "STARDRIVE AWD" },
  stockNumber: "S260322",
  transportMethod: "OCEAN",
  epa: {
    city: 111, highway: 93, combined: 102, annualFuelCost: 700, ghgScore: 10,
    rangeMiles: 227, fuelType: "Electric", smogScore: 10, gallonsPer100Miles: null,
    fiveYearCostDifference: 4000, classNote: null,
  },
  warranty: {
    basic: "3-Year/36,000-Mile Basic Limited Warranty",
    powertrain: "5-Year/60,000-Mile Powertrain Limited Warranty",
    corrosion: null,
    roadside: "3-Year/36,000-Mile Roadside Assistance",
    emissions: "8-Year/100,000-Mile High-Voltage Battery Limited Warranty",
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "0%" },
    { label: "Major foreign parts content", value: "Japan 90%" },
    { label: "Final assembly point", value: "Toyota City, Japan" },
    { label: "Country of origin - motors", value: "Japan" },
    { label: "Country of origin - battery", value: "Japan" },
  ],
  passportUrl: "https://autolabels.io/v/demo-solterra",
  barcodePayload: "JTMABABA5TA098765",
});

// Fixture 3 — long-equipment Ascent: forces the deliberate continuation page.
// 48,995 + 2,240 + 1,420 = 52,655.
export const subaruAscentLongFixture = (): FactoryStickerRenderData => {
  const base = subaruOutbackFixture();
  const std = { ...base.standardEquipment };
  std.comfort = Array.from({ length: 26 }, (_, i) =>
    `Three-Row Comfort & Convenience Feature ${String(i + 1).padStart(2, "0")} w/ Extended Adjustment Range`);
  std.technology = Array.from({ length: 24 }, (_, i) =>
    `Subaru Connected Technology Function ${String(i + 1).padStart(2, "0")} w/ Over-the-Air Update Support`);
  return {
    ...base,
    vin: "4S4WMAWD1T3123456",
    identity: { year: "2026", make: "Subaru", model: "Ascent", trim: "TOURING AWD" },
    pricing: { baseMsrp: 48995, destinationCharge: 1420, optionsTotal: 2240, totalMsrp: 52655 },
    options: [
      { name: "Optional Package 23", code: "23", msrp: 1845, contents: ["Panoramic Moonroof", "Cabin Air Filtration"] },
      { name: "Crystal White Pearl", code: "0H1", msrp: 395 },
    ],
    standardEquipment: std,
    stockNumber: "S260488",
    passportUrl: "https://autolabels.io/v/demo-ascent",
    barcodePayload: "4S4WMAWD1T3123456",
  };
};

// ── Honda fixtures (japanese-factory-technical, honda-us-2026-v1) ──────

// Fixture 1 — CR-V Hybrid benchmark: Honda Genuine Accessories are
// port-installed items. 37,750 + 0 factory + 925 port + 1,395 = 40,070.
export const hondaCrvHybridFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  condition: "new",
  title: "Factory Window Sticker — Configuration & MSRP",
  vin: "7FARS6H93TE123456",
  identity: { year: "2026", make: "Honda", model: "CR-V Hybrid", trim: "SPORT TOURING AWD" },
  pricing: { baseMsrp: 37750, destinationCharge: 1395, optionsTotal: null, totalMsrp: 40070, portOptionsTotal: 925 },
  options: [],
  portOptions: [
    { name: "All-Season Floor Mats", code: "08P17", msrp: 200 },
    { name: "Cargo Tray", code: "08U45", msrp: 150 },
    { name: "Door Edge Guard Film", code: "08P20", msrp: 175 },
    { name: "Rear Bumper Applique", code: "08P48", msrp: 125 },
    { name: "Wheel Locks", code: "08W42", msrp: 125 },
    { name: "Wireless Phone Charger", code: "08U58", msrp: 150 },
  ],
  standardEquipment: {
    mechanical: [
      "204-HP 2.0-Liter Atkinson-Cycle 4-Cylinder Engine",
      "Two-Motor Hybrid System",
      "Real Time AWD w/ Intelligent Control System",
      "4-Mode Drive System (ECON / Normal / Sport / Snow)",
      "Regenerative Braking System",
      "MacPherson Strut Front / Multi-Link Rear Suspension",
      "Hill Descent Control",
    ],
    exterior: [
      "19-Inch Alloy Wheels w/ 235/55R19 All-Season Tires",
      "Power Moonroof w/ Tilt Feature",
      "Hands-Free Access Power Tailgate",
      "LED Headlights w/ Auto On/Off",
      "LED Fog Lights & Daytime Running Lights",
      "Power-Folding Heated Side Mirrors w/ Integrated Turn Indicators",
      "Roof Rails",
      "Rear Privacy Glass",
    ],
    interior: [
      "Leather-Trimmed Seats",
      "Heated & Ventilated Front Seats",
      "Power Driver's Seat w/ 2-Position Memory",
      "60/40 Split Fold-Down Rear Seat",
      "Leather-Wrapped Heated Steering Wheel",
      "Dual-Zone Automatic Climate Control w/ Humidity Control",
      "12.3-Inch Color Touchscreen",
      "Wireless Apple CarPlay & Android Auto Compatibility",
      "Premium Audio System - 12 Speakers",
      "USB Type-C Ports (Front & Rear)",
      "Wireless Phone Charger",
      "Multi-View Rear Camera w/ Dynamic Guidelines",
    ],
    safety_features: [
      "Honda Sensing Suite",
      "Collision Mitigation Braking System",
      "Road Departure Mitigation System",
      "Adaptive Cruise Control w/ Low-Speed Follow",
      "Lane Keeping Assist System",
      "Traffic Sign Recognition",
      "Blind Spot Information System w/ Cross Traffic Monitor",
      "LED Daytime Running Lights",
      "Tire Pressure Monitoring System w/ Location & Pressure Indicators",
    ],
  },
  colors: { exterior: { name: "Platinum White Pearl", code: "NH-883P" }, interior: { name: "Black Leather", code: "BK" } },
  assembly: { plant: "East Liberty", city: "East Liberty, Ohio", country: "USA" },
  mechanical: { engine: "2.0L HYBRID I4", transmission: "E-CVT", drivetrain: "REAL TIME AWD" },
  stockNumber: "524-1000",
  transportMethod: "TRUCK",
  factoryCodes: { location: null, emissions: "50 STATE", sequence: null, order: null, dealer: "524100" },
  epa: {
    city: 43, highway: 36, combined: 40, annualFuelCost: 1300, ghgScore: 8,
    rangeMiles: null, fuelType: "Hybrid Gasoline-Electric", smogScore: 7, gallonsPer100Miles: 2.5,
    fiveYearCostDifference: 2500, classNote: null,
  },
  safety: null,
  warranty: {
    basic: "3-Year/36,000-Mile Limited Vehicle Warranty",
    powertrain: "5-Year/60,000-Mile Powertrain Limited Warranty",
    corrosion: "10-Year/Unlimited-Mile Corrosion Perforation Warranty",
    roadside: "5-Year/60,000-Mile Hybrid System Limited Warranty",
    emissions: "7-Year/100,000-Mile Emissions System Warranty",
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "55%" },
    { label: "Major foreign parts content", value: "Japan 20%" },
    { label: "Final assembly point", value: "East Liberty, Ohio, USA" },
    { label: "Country of origin - engine", value: "USA" },
    { label: "Country of origin - transmission", value: "USA" },
  ],
  dealer: { name: "ABC Honda", address: "123 Main Street", city: "Alpharetta", state: "GA", zip: "30009", phone: null },
  passportUrl: "https://autolabels.io/v/demo-crv-hybrid",
  barcodePayload: "7FARS6H93TE123456",
  disclaimers: NEW_LABEL_DISCLAIMERS,
});

// Fixture 2 — Pilot gasoline. 54,580 + 0 factory + 695 port + 1,395 = 56,670.
export const hondaPilotFixture = (): FactoryStickerRenderData => ({
  ...hondaCrvHybridFixture(),
  vin: "5FNYG1H8XTB000184",
  identity: { year: "2026", make: "Honda", model: "Pilot", trim: "ELITE AWD" },
  pricing: { baseMsrp: 54580, destinationCharge: 1395, optionsTotal: null, totalMsrp: 56670, portOptionsTotal: 695 },
  portOptions: [
    { name: "All-Season Floor Mats", code: "08P17", msrp: 245 },
    { name: "Cargo Tray", code: "08U45", msrp: 195 },
    { name: "Roof Rack Cross Bars", code: "08L04", msrp: 255 },
  ],
  standardEquipment: {
    mechanical: [
      "285-HP 3.5-Liter V6 Engine",
      "10-Speed Automatic Transmission",
      "Intelligent Variable Torque Management AWD",
      "Drive-Mode Selection - 7 Modes",
      "Hill Descent Control",
      "MacPherson Strut Front / Multi-Link Rear Suspension",
    ],
    exterior: [
      "20-Inch Alloy Wheels",
      "One-Touch Power Moonroof",
      "Hands-Free Access Power Tailgate",
      "LED Headlights w/ Auto High Beams",
      "Power-Folding Heated Side Mirrors",
      "Rain-Sensing Windshield Wipers",
      "Roof Rails",
    ],
    interior: [
      "Leather-Trimmed Seating - 7 Passenger w/ Captain's Chairs",
      "Heated & Ventilated Front Seats",
      "Heated Second-Row Seats",
      "Driver-Seat Memory",
      "Tri-Zone Automatic Climate Control",
      "9-Inch Color Touchscreen",
      "Wireless Apple CarPlay & Android Auto",
      "Bose Premium Audio - 12 Speakers",
      "Wireless Phone Charger",
      "CabinWatch & CabinTalk",
    ],
    safety_features: [
      "Honda Sensing Suite",
      "Collision Mitigation Braking System",
      "Road Departure Mitigation System",
      "Adaptive Cruise Control w/ Low-Speed Follow",
      "Lane Keeping Assist System",
      "Blind Spot Information System w/ Cross Traffic Monitor",
      "Multi-Angle Rearview Camera",
      "Front & Rear Parking Sensors",
    ],
  },
  colors: { exterior: { name: "Platinum White Pearl", code: "NH-883P" }, interior: { name: "Black Leather", code: "BK" } },
  assembly: { plant: "Lincoln", city: "Lincoln, Alabama", country: "USA" },
  mechanical: { engine: "3.5L V6", transmission: "10-SPEED A/T", drivetrain: "i-VTM4 AWD" },
  stockNumber: "H260184",
  epa: {
    city: 19, highway: 25, combined: 21, annualFuelCost: 2450, ghgScore: 4,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 5, gallonsPer100Miles: 4.8,
    fiveYearCostDifference: -1500, classNote: null,
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "60%" },
    { label: "Major foreign parts content", value: "Japan 15%" },
    { label: "Final assembly point", value: "Lincoln, Alabama, USA" },
    { label: "Country of origin - engine", value: "USA" },
    { label: "Country of origin - transmission", value: "USA" },
  ],
  warranty: {
    basic: "3-Year/36,000-Mile Limited Vehicle Warranty",
    powertrain: "5-Year/60,000-Mile Powertrain Limited Warranty",
    corrosion: "5-Year/Unlimited-Mile Corrosion Perforation Warranty",
    roadside: "3-Year/36,000-Mile Roadside Assistance",
    emissions: null,
  },
  passportUrl: "https://autolabels.io/v/demo-pilot",
  barcodePayload: "5FNYG1H8XTB000184",
});

// Fixture 3 — Prologue: regulatory/ev, no gasoline content.
// 59,750 + 0 factory + 350 port + 1,450 = 61,550.
export const hondaPrologueFixture = (): FactoryStickerRenderData => ({
  ...hondaCrvHybridFixture(),
  vin: "5FNYD3H37TB012908",
  identity: { year: "2026", make: "Honda", model: "Prologue", trim: "ELITE AWD" },
  pricing: { baseMsrp: 59750, destinationCharge: 1450, optionsTotal: null, totalMsrp: 61550, portOptionsTotal: 350 },
  portOptions: [
    { name: "All-Season Floor Mats", code: "08P17", msrp: 200 },
    { name: "Wheel Locks", code: "08W42", msrp: 150 },
  ],
  standardEquipment: {
    mechanical: [
      "Dual Electric Motors - 288 HP",
      "85 kWh Lithium-Ion Battery",
      "DC Fast Charging up to 155 kW",
      "11.5 kW Onboard Charger",
      "All-Wheel Drive w/ Regenerative Braking Control",
      "One-Pedal Driving",
    ],
    exterior: [
      "21-Inch Alloy Wheels",
      "Panoramic Roof",
      "Hands-Free Access Power Tailgate",
      "LED Headlights w/ Auto High Beams",
      "Power-Folding Heated Side Mirrors",
      "Roof Rails",
    ],
    interior: [
      "Perforated Leather-Trimmed Seats",
      "Heated & Ventilated Front Seats",
      "Heated Steering Wheel",
      "11.3-Inch Color Touchscreen w/ Google Built-In",
      "Wireless Apple CarPlay & Android Auto",
      "Bose Premium Audio - 12 Speakers",
      "Wireless Phone Charger",
      "Head-Up Display",
    ],
    safety_features: [
      "Honda Sensing Suite",
      "Collision Mitigation Braking System",
      "Blind Spot Information System w/ Cross Traffic Monitor",
      "Adaptive Cruise Control",
      "Lane Keeping Assist System",
      "Multi-Angle Rearview Camera",
      "Front & Rear Parking Sensors",
    ],
  },
  colors: { exterior: { name: "North Shore Pearl", code: "NSP" }, interior: { name: "Gray Leather", code: "GRY" } },
  assembly: { plant: "Ramos Arizpe", city: "Ramos Arizpe", country: "Mexico" },
  mechanical: { engine: "DUAL ELECTRIC MOTORS", transmission: "1-SPEED REDUCTION", drivetrain: "AWD" },
  stockNumber: "H260322",
  epa: {
    city: 99, highway: 90, combined: 95, annualFuelCost: 750, ghgScore: 10,
    rangeMiles: 273, fuelType: "Electric", smogScore: 10, gallonsPer100Miles: null,
    fiveYearCostDifference: 3500, classNote: null,
  },
  warranty: {
    basic: "3-Year/36,000-Mile Limited Vehicle Warranty",
    powertrain: "5-Year/60,000-Mile Powertrain Limited Warranty",
    corrosion: "5-Year/Unlimited-Mile Corrosion Perforation Warranty",
    roadside: "3-Year/36,000-Mile Roadside Assistance",
    emissions: "8-Year/100,000-Mile High-Voltage Battery Limited Warranty",
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "20%" },
    { label: "Major foreign parts content", value: "Mexico 55%" },
    { label: "Final assembly point", value: "Ramos Arizpe, Mexico" },
    { label: "Country of origin - motors", value: "Mexico" },
    { label: "Country of origin - battery", value: "USA" },
  ],
  passportUrl: "https://autolabels.io/v/demo-prologue",
  barcodePayload: "5FNYD3H37TB012908",
});

// Fixture 4 — long-equipment Pilot: forces the deliberate continuation page.
export const hondaLongFixture = (): FactoryStickerRenderData => {
  const base = hondaPilotFixture();
  const std = { ...base.standardEquipment };
  std.comfort = Array.from({ length: 26 }, (_, i) =>
    `Three-Row Comfort & Convenience Feature ${String(i + 1).padStart(2, "0")} w/ Extended Adjustment Range`);
  std.technology = Array.from({ length: 24 }, (_, i) =>
    `HondaLink Technology Function ${String(i + 1).padStart(2, "0")} w/ Over-the-Air Update Support`);
  return {
    ...base,
    vin: "5FNYG1H84TB055671",
    identity: { year: "2026", make: "Honda", model: "Pilot", trim: "BLACK EDITION AWD" },
    pricing: { baseMsrp: 56580, destinationCharge: 1395, optionsTotal: null, totalMsrp: 58670, portOptionsTotal: 695 },
    standardEquipment: std,
    stockNumber: "H260671",
    passportUrl: "https://autolabels.io/v/demo-pilot-be",
    barcodePayload: "5FNYG1H84TB055671",
  };
};

// ── Acura fixtures (premium-factory-technical, acura-us-2026-v1) ───────

// Fixture 1 — RDX benchmark. 50,800 + 4,650 + 1,195 = 56,645.
export const acuraRdxFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  condition: "new",
  title: "Factory Window Sticker — Configuration & MSRP",
  vin: "5J8TC2H86SL007905",
  identity: { year: "2025", make: "Acura", model: "RDX", trim: "SH-AWD A-SPEC ADVANCE" },
  pricing: { baseMsrp: 50800, destinationCharge: 1195, optionsTotal: 4650, totalMsrp: 56645 },
  options: [
    { name: "Urban Gray Pearl", code: null, msrp: 600 },
    { name: "A-Spec Advance Package", code: "ASA", msrp: 2600, contents: ["20-Inch Alloy Wheels", "Performance Tires"] },
    { name: "Technology Package", code: "TEC", msrp: 1200 },
    { name: "Door Sill Trim", code: null, msrp: 250 },
  ],
  standardEquipment: {
    mechanical: [
      "272-HP 2.0-Liter Direct Injection VTEC Turbo 4-Cylinder Engine",
      "10-Speed Automatic Transmission w/ Paddle Shifters",
      "Super Handling All-Wheel Drive (SH-AWD)",
      "Electric Power Steering",
      "Immobilizer Theft-Deterrent System",
    ],
    safety_features: [
      "Driver's & Front Passenger's Airbags",
      "Side Curtain Airbags w/ Rollover Sensor",
      "Vehicle Stability Assist (VSA)",
      "Anti-Lock Braking System (ABS)",
      "Tire Pressure Monitoring System",
      "AcuraWatch: Collision Mitigation Braking System",
      "AcuraWatch: Adaptive Cruise Control",
      "AcuraWatch: Lane Keeping Assist System",
      "AcuraWatch: Road Departure Mitigation",
    ],
    interior: [
      "Driver Information Memory System",
      "Heated Front Seats",
      "Perforated Leather-Trimmed Sport Seats w/ Piping",
      "16-Way Power Seats",
      "High Resolution Center Display w/ True Touchpad Interface",
      "Blind Spot Information (BSI)",
      "AcuraLink Connected Services",
      "Acura ELS Studio 3D Premium Audio - 16 Speakers",
      "Dual-Zone Automatic Climate Control w/ Air Filtration",
      "Wireless Phone Charger",
    ],
    exterior: [
      "Jewel Eye LED Headlights",
      "LED Daytime Running Lights & Taillights",
      "Panoramic Moonroof w/ Tilt & Slide",
      "Hands-Free Access Power Tailgate",
      "Heated Power Door Mirrors w/ Turn Indicators",
      "Keyless Access System w/ Smart Entry",
    ],
  },
  colors: { exterior: { name: "Urban Gray Pearl", code: "NH-912P" }, interior: { name: "Red", code: "RD" } },
  assembly: { plant: "East Liberty", city: "East Liberty, Ohio", country: "USA" },
  mechanical: { engine: "2.0L VTEC TURBO", transmission: "10-SPEED A/T", drivetrain: "SH-AWD" },
  stockNumber: "A250790",
  transportMethod: "TRUCK",
  factoryCodes: { location: null, emissions: "50 STATE", sequence: null, order: null, dealer: "251578" },
  epa: {
    city: 21, highway: 26, combined: 23, annualFuelCost: 2750, ghgScore: 5,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 5, gallonsPer100Miles: 4.3,
    fiveYearCostDifference: -4250, classNote: null,
  },
  safety: { overall: 5, frontalDriver: 5, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: 5 },
  warranty: {
    basic: "4-Year/50,000-Mile Limited Vehicle Warranty",
    powertrain: "6-Year/70,000-Mile Powertrain Warranty",
    corrosion: null,
    roadside: "Full Tank of Fuel",
    emissions: "SiriusXM 3-Month Trial",
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "60%" },
    { label: "Major foreign parts content", value: "Japan 35%" },
    { label: "Final assembly point", value: "East Liberty, Ohio, USA" },
    { label: "Country of origin - engine", value: "USA" },
    { label: "Country of origin - transmission", value: "USA" },
  ],
  dealer: { name: "Miami Acura", address: "16601 S. Dixie Highway", city: "Miami", state: "FL", zip: "33157", phone: null },
  passportUrl: "https://autolabels.io/v/demo-rdx",
  barcodePayload: "5J8TC2H86SL007905",
  disclaimers: [
    "Vehicle information compiled from verified manufacturer, regulatory, and dealer data. Not an original manufacturer-issued label.",
    "Digitally prepared by AutoLabels.io",
  ],
});

// Fixture 2 — ZDX: regulatory/ev, no gasoline content. 64,500 + 600 + 1,395 = 66,495.
export const acuraZdxFixture = (): FactoryStickerRenderData => ({
  ...acuraRdxFixture(),
  vin: "5J8YD8H37SL201456",
  identity: { year: "2025", make: "Acura", model: "ZDX", trim: "A-SPEC AWD" },
  pricing: { baseMsrp: 64500, destinationCharge: 1395, optionsTotal: 600, totalMsrp: 66495 },
  options: [
    { name: "Double Apex Blue Pearl", code: null, msrp: 600 },
  ],
  standardEquipment: {
    mechanical: [
      "Dual Electric Motors - 490 HP",
      "102 kWh Lithium-Ion Battery",
      "DC Fast Charging up to 190 kW",
      "11.5 kW Onboard Charger",
      "All-Wheel Drive w/ Regenerative Braking Control",
      "One-Pedal Driving",
    ],
    safety_features: [
      "AcuraWatch 360",
      "Collision Mitigation Braking System",
      "Blind Spot Information w/ Rear Cross Traffic Monitor",
      "Adaptive Cruise Control",
      "Lane Keeping Assist System",
      "Front & Rear Parking Sensors",
    ],
    interior: [
      "Perforated Leather-Trimmed Sport Seats",
      "Heated & Ventilated Front Seats",
      "11.3-Inch Center Display w/ Google Built-In",
      "Wireless Apple CarPlay & Android Auto",
      "Bang & Olufsen Premium Audio - 18 Speakers",
      "Dual-Zone Automatic Climate Control",
      "Wireless Phone Charger",
      "Head-Up Display",
    ],
    exterior: [
      "22-Inch Alloy Wheels",
      "Jewel Eye LED Headlights",
      "Panoramic Fixed Glass Roof",
      "Hands-Free Access Power Tailgate",
      "Heated Power Door Mirrors",
      "Flush Door Handles",
    ],
  },
  colors: { exterior: { name: "Double Apex Blue Pearl", code: "B-627P" }, interior: { name: "Orchid", code: "OR" } },
  assembly: { plant: "Ramos Arizpe", city: "Ramos Arizpe", country: "Mexico" },
  mechanical: { engine: "DUAL ELECTRIC MOTORS", transmission: "1-SPEED REDUCTION", drivetrain: "AWD" },
  stockNumber: "A250912",
  epa: {
    city: 90, highway: 82, combined: 86, annualFuelCost: 900, ghgScore: 10,
    rangeMiles: 278, fuelType: "Electric", smogScore: 10, gallonsPer100Miles: null,
    fiveYearCostDifference: 3250, classNote: null,
  },
  safety: null,
  warranty: {
    basic: "4-Year/50,000-Mile Limited Vehicle Warranty",
    powertrain: "6-Year/70,000-Mile Powertrain Warranty",
    corrosion: null,
    roadside: "8-Year/100,000-Mile High-Voltage Battery Limited Warranty",
    emissions: null,
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "15%" },
    { label: "Major foreign parts content", value: "Mexico 60%" },
    { label: "Final assembly point", value: "Ramos Arizpe, Mexico" },
    { label: "Country of origin - motors", value: "Mexico" },
    { label: "Country of origin - battery", value: "USA" },
  ],
  passportUrl: "https://autolabels.io/v/demo-zdx",
  barcodePayload: "5J8YD8H37SL201456",
});

// Fixture 3 — long-equipment MDX: forces the deliberate continuation page.
// 74,950 + 3,200 + 1,195 = 79,345.
export const acuraLongFixture = (): FactoryStickerRenderData => {
  const base = acuraRdxFixture();
  const std = { ...base.standardEquipment };
  std.comfort = Array.from({ length: 26 }, (_, i) =>
    `Cabin Comfort & Convenience Feature ${String(i + 1).padStart(2, "0")} w/ Extended Adjustment Range`);
  std.technology = Array.from({ length: 24 }, (_, i) =>
    `AcuraLink Technology Function ${String(i + 1).padStart(2, "0")} w/ Over-the-Air Update Support`);
  return {
    ...base,
    vin: "5J8YE1H09SL033721",
    identity: { year: "2025", make: "Acura", model: "MDX", trim: "TYPE S ADVANCE SH-AWD" },
    pricing: { baseMsrp: 74950, destinationCharge: 1195, optionsTotal: 3200, totalMsrp: 79345 },
    options: [
      { name: "Urban Gray Pearl", code: null, msrp: 600 },
      { name: "Advance Package", code: "ADV", msrp: 2600, contents: ["Surround View Camera", "16-Way Power Seats"] },
    ],
    standardEquipment: std,
    stockNumber: "A250337",
    passportUrl: "https://autolabels.io/v/demo-mdx",
    barcodePayload: "5J8YE1H09SL033721",
  };
};

// ── INFINITI new-vehicle fixture (luxury-factory-technical, v2) ────────

// New QX80: full factory panel set. 109,900 + 1,150 + 1,995 = 113,045.
export const infinitiQx80NewFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  condition: "new",
  title: "Factory Window Sticker — Configuration & MSRP",
  vin: "JN8AZ3DC0T9500123",
  identity: { year: "2026", make: "INFINITI", model: "QX80", trim: "AUTOGRAPH 4WD" },
  pricing: { baseMsrp: 109900, destinationCharge: 1995, optionsTotal: 1150, totalMsrp: 113045 },
  options: [
    { name: "Premium Paint - Dynamic Metal", code: "PP", msrp: 650 },
    { name: "Illuminated Kick Plates", code: "IKP", msrp: 500 },
  ],
  standardEquipment: {
    mechanical: [
      "3.5L Twin-Turbocharged V6 - 450 HP",
      "9-Speed Automatic Transmission",
      "Intelligent 4WD w/ Drive Mode Selector",
      "Electronic Air Suspension w/ Dynamic Damping",
      "Hill Start Assist & Trailer Sway Control",
    ],
    safety_features: [
      "INFINITI Safety Shield",
      "Automatic Emergency Braking w/ Pedestrian Detection",
      "Blind Spot Warning & Blind Spot Intervention",
      "Lane Departure Warning & Lane Departure Prevention",
      "Intelligent Cruise Control",
      "Around View Monitor w/ Moving Object Detection",
      "Traffic Sign Recognition",
      "Rear Automatic Braking",
    ],
    interior: [
      "Semi-Aniline Leather-Appointed Seating",
      "Massaging Front Seats w/ Heating & Ventilation",
      "Heated Second-Row Captain's Chairs",
      "Biometric Cooling - Second Row",
      "14.3-Inch Dual Infiniti InTouch Displays",
      "Klipsch Reference Premiere Audio - 24 Speakers",
      "Tri-Zone Automatic Climate Control",
      "Heated Steering Wheel w/ Memory",
      "Head-Up Display",
      "Wireless Apple CarPlay & Android Auto",
      "Wireless Phone Charger",
    ],
    exterior: [
      "22-Inch Forged Aluminum-Alloy Wheels",
      "Adaptive LED Headlights w/ Signature DRLs",
      "Power Panoramic Moonroof",
      "Hands-Free Power Liftgate",
      "Power-Folding Heated Mirrors w/ Reverse Tilt",
      "Rain-Sensing Wipers",
      "Dark Chrome Exterior Accents",
    ],
  },
  colors: {
    exterior: { name: "Dynamic Metal", code: "KBY" },
    interior: { name: "Graphite and Burgundy", code: "GBR" },
  },
  assembly: { plant: "Yukuhashi", city: "Yukuhashi, Fukuoka", country: "Japan" },
  mechanical: { engine: "3.5L TT V6", transmission: "9-SPEED A/T", drivetrain: "4WD" },
  stockNumber: "IN2650123",
  transportMethod: "OCEAN",
  factoryCodes: { location: null, emissions: "50 STATE", sequence: null, order: null, dealer: "10472" },
  epa: {
    city: 16, highway: 19, combined: 17, annualFuelCost: 3350, ghgScore: 3,
    rangeMiles: null, fuelType: "Premium Gasoline", smogScore: 5, gallonsPer100Miles: 5.9,
    fiveYearCostDifference: -5250, classNote: null,
  },
  safety: { overall: 5, frontalDriver: 5, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: 4 },
  warranty: {
    basic: "4-Year/60,000-Mile Basic Limited Warranty",
    powertrain: "6-Year/70,000-Mile Powertrain Limited Warranty",
    corrosion: "7-Year/Unlimited-Mile Corrosion Coverage",
    roadside: "4-Year/Unlimited-Mile Roadside Assistance",
    emissions: null,
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "0%" },
    { label: "Major foreign parts content", value: "Japan 75%" },
    { label: "Final assembly point", value: "Yukuhashi, Fukuoka, Japan" },
    { label: "Country of origin - engine", value: "Japan" },
    { label: "Country of origin - transmission", value: "Japan" },
  ],
  dealer: { name: "INFINITI of Coral Gables", address: "4152 Ponce de Leon Blvd", city: "Coral Gables", state: "FL", zip: "33146", phone: null },
  passportUrl: "https://autolabels.io/v/demo-qx80-new",
  barcodePayload: "JN8AZ3DC0T9500123",
  disclaimers: [
    "Vehicle information compiled from verified manufacturer, regulatory and dealer data. This document may not be the original manufacturer-issued label.",
    "Digitally prepared by AutoLabels.io",
  ],
});

// ── Hyundai fixtures (luxury-factory composition, hyundai-us-2026-v2) ──

// Benchmark Palisade: SmartSense terminology, port accessories, full
// panel set. 53,945 + 0 factory + 445 port + 1,415 = 55,805.
export const hyundaiPalisadeFixture = (): FactoryStickerRenderData => ({
  ...oemBase(),
  condition: "new",
  title: "Factory Window Sticker — Configuration & MSRP",
  vin: "KM8R7DGE8TU612345",
  identity: { year: "2026", make: "Hyundai", model: "Palisade", trim: "CALLIGRAPHY AWD" },
  pricing: { baseMsrp: 53945, destinationCharge: 1415, optionsTotal: null, totalMsrp: 55805, portOptionsTotal: 445 },
  options: [],
  portOptions: [
    { name: "Carpeted Floor Mats", code: "FM", msrp: 225 },
    { name: "Cargo Cover", code: "CC", msrp: 190 },
    { name: "First Aid Kit", code: "FA", msrp: 30 },
  ],
  standardEquipment: {
    mechanical: [
      "3.5L GDI V6 Engine - 287 HP",
      "8-Speed Automatic Transmission",
      "HTRAC All Wheel Drive w/ Drive Mode Select",
      "Idle Stop & Go",
      "Electronic Parking Brake w/ Auto Hold",
      "Self-Leveling Rear Suspension",
    ],
    safety_features: [
      "Hyundai SmartSense",
      "Forward Collision-Avoidance Assist w/ Junction Turning",
      "Blind-Spot Collision-Avoidance Assist",
      "Blind-Spot View Monitor",
      "Highway Driving Assist 2",
      "Navigation-Based Smart Cruise Control",
      "Lane Keeping Assist & Lane Following Assist",
      "Driver Attention Warning",
      "Safe Exit Assist w/ Rear Occupant Alert",
      "Rear Cross-Traffic Collision-Avoidance Assist",
      "Remote Smart Parking Assist",
      "Surround View Monitor",
    ],
    interior: [
      "Quilted Nappa Leather Seating",
      "Heated & Ventilated Front and Second-Row Seats",
      "Second-Row Captain's Chairs w/ Wing-Out Headrests",
      "Power-Folding Third Row",
      "Ergo Motion Driver's Seat w/ Memory",
      "Heated Steering Wheel",
      "Tri-Zone Automatic Climate Control",
      "12.3-Inch Digital Cluster + 12.3-Inch Navigation",
      "Bose Premium Audio - 12 Speakers",
      "Wireless Apple CarPlay & Android Auto",
      "Digital Key 2 w/ Fingerprint Reader",
      "Wireless Device Charging - Front & Second Row",
      "Head-Up Display",
    ],
    exterior: [
      "21-Inch Machined Alloy Wheels",
      "LED Projection Headlamps w/ Signature DRLs",
      "Panoramic Sunroof w/ Power Sunshade",
      "Hands-Free Smart Liftgate",
      "Power-Folding Heated Mirrors",
      "Rain-Sensing Wipers",
      "Acoustic Laminated Front Glass",
      "Roof Rails",
    ],
  },
  colors: { exterior: { name: "Moonlight Cloud", code: "UB7" }, interior: { name: "Pecan Brown Nappa", code: "PBN" } },
  assembly: { plant: "Ulsan", city: "Ulsan", country: "South Korea" },
  mechanical: { engine: "3.5L GDI V6", transmission: "8-SPEED A/T", drivetrain: "HTRAC AWD" },
  stockNumber: "H2660145",
  transportMethod: "OCEAN",
  factoryCodes: { location: null, emissions: "50 STATE", sequence: null, order: null, dealer: "FL044" },
  epa: {
    city: 19, highway: 26, combined: 21, annualFuelCost: 2500, ghgScore: 4,
    rangeMiles: null, fuelType: "Gasoline", smogScore: 6, gallonsPer100Miles: 4.8,
    fiveYearCostDifference: -1500, classNote: null,
  },
  safety: { overall: 5, frontalDriver: 5, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: 4 },
  warranty: {
    basic: "5-Year/60,000-Mile New Vehicle Limited Warranty",
    powertrain: "10-Year/100,000-Mile Powertrain Limited Warranty",
    corrosion: "7-Year/Unlimited-Mile Anti-Perforation Warranty",
    roadside: "5-Year/Unlimited-Mile Roadside Assistance",
    emissions: "3-Year/36,000-Mile Complimentary Maintenance",
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "1%" },
    { label: "Major foreign parts content", value: "Korea 85%" },
    { label: "Final assembly point", value: "Ulsan, South Korea" },
    { label: "Country of origin - engine", value: "Korea" },
    { label: "Country of origin - transmission", value: "Korea" },
  ],
  dealer: { name: "Hyundai of North Miami", address: "16600 NW 2nd Ave", city: "Miami", state: "FL", zip: "33169", phone: null },
  passportUrl: "https://autolabels.io/v/demo-palisade",
  barcodePayload: "KM8R7DGE8TU612345",
  disclaimers: [
    "Vehicle information compiled from verified manufacturer, regulatory and dealer data. This document may not be the original manufacturer-issued label.",
    "Digitally prepared by AutoLabels.io",
  ],
});

// IONIQ 5: regulatory/ev, no gasoline content. 55,400 + 210 port + 1,415 = 57,025.
export const hyundaiIoniq5Fixture = (): FactoryStickerRenderData => ({
  ...hyundaiPalisadeFixture(),
  vin: "KM8KRDDF8TU098765",
  identity: { year: "2026", make: "Hyundai", model: "IONIQ 5", trim: "LIMITED AWD" },
  pricing: { baseMsrp: 55400, destinationCharge: 1415, optionsTotal: null, totalMsrp: 57025, portOptionsTotal: 210 },
  portOptions: [
    { name: "Carpeted Floor Mats", code: "FM", msrp: 210 },
  ],
  standardEquipment: {
    mechanical: [
      "Dual Electric Motors - 320 HP",
      "84 kWh Lithium-Ion Battery",
      "800V Architecture w/ DC Fast Charging up to 350 kW",
      "10.9 kW Onboard Charger",
      "HTRAC e-AWD",
      "Vehicle-to-Load (V2L) Power Supply",
      "i-Pedal One-Pedal Driving",
    ],
    safety_features: [
      "Hyundai SmartSense",
      "Forward Collision-Avoidance Assist 2",
      "Highway Driving Assist 2",
      "Blind-Spot View Monitor",
      "Surround View Monitor",
      "Remote Smart Parking Assist 2",
      "Safe Exit Assist",
    ],
    interior: [
      "Eco-Processed Leather Seating",
      "Heated & Ventilated Front Seats",
      "Sliding Universal Island Console",
      "Dual 12.3-Inch Panoramic Displays",
      "Bose Premium Audio - 8 Speakers",
      "Digital Key 2",
      "Wireless Apple CarPlay & Android Auto",
      "Wireless Device Charging",
      "Head-Up Display w/ Augmented Reality",
    ],
    exterior: [
      "20-Inch Aero Alloy Wheels",
      "Pixel LED Headlamps & Taillamps",
      "Vision Roof (Fixed Glass)",
      "Hands-Free Smart Liftgate",
      "Flush Door Handles",
      "Power-Folding Heated Mirrors",
    ],
  },
  colors: { exterior: { name: "Digital Teal Pearl", code: "DTG" }, interior: { name: "Obsidian Black", code: "OBK" } },
  assembly: { plant: "HMGMA", city: "Ellabell, Georgia", country: "USA" },
  mechanical: { engine: "DUAL ELECTRIC MOTORS", transmission: "1-SPEED REDUCTION", drivetrain: "HTRAC e-AWD" },
  stockNumber: "H2660322",
  transportMethod: "TRUCK",
  epa: {
    city: 110, highway: 92, combined: 101, annualFuelCost: 700, ghgScore: 10,
    rangeMiles: 260, fuelType: "Electric", smogScore: 10, gallonsPer100Miles: null,
    fiveYearCostDifference: 4000, classNote: null,
  },
  safety: null,
  warranty: {
    basic: "5-Year/60,000-Mile New Vehicle Limited Warranty",
    powertrain: "10-Year/100,000-Mile Powertrain Limited Warranty",
    corrosion: "7-Year/Unlimited-Mile Anti-Perforation Warranty",
    roadside: "5-Year/Unlimited-Mile Roadside Assistance",
    emissions: "10-Year/100,000-Mile High-Voltage Battery Limited Warranty",
  },
  partsContent: [
    { label: "U.S./Canadian parts content (carline)", value: "35%" },
    { label: "Major foreign parts content", value: "Korea 45%" },
    { label: "Final assembly point", value: "Ellabell, Georgia, USA" },
    { label: "Country of origin - motors", value: "Korea" },
    { label: "Country of origin - battery", value: "USA" },
  ],
  passportUrl: "https://autolabels.io/v/demo-ioniq5",
  barcodePayload: "KM8KRDDF8TU098765",
});

// Tucson Hybrid: gasoline-shape module under the Hybrid Vehicle tag.
// 42,590 + 210 port + 1,395 = 44,195.
export const hyundaiTucsonHybridFixture = (): FactoryStickerRenderData => ({
  ...hyundaiPalisadeFixture(),
  vin: "KM8JFCD1XTU443210",
  identity: { year: "2026", make: "Hyundai", model: "Tucson Hybrid", trim: "LIMITED AWD" },
  pricing: { baseMsrp: 42590, destinationCharge: 1395, optionsTotal: null, totalMsrp: 44195, portOptionsTotal: 210 },
  portOptions: [
    { name: "Carpeted Floor Mats", code: "FM", msrp: 210 },
  ],
  standardEquipment: {
    mechanical: [
      "1.6L Turbocharged GDI I4 Hybrid - 231 HP Combined",
      "Permanent-Magnet Synchronous Drive Motor",
      "1.49 kWh Lithium-Ion Polymer Battery",
      "6-Speed Automatic Transmission",
      "HTRAC All Wheel Drive",
      "Regenerative Braking w/ Drive Mode Select",
    ],
    safety_features: [
      "Hyundai SmartSense",
      "Forward Collision-Avoidance Assist w/ Junction Turning",
      "Highway Driving Assist 2",
      "Blind-Spot View Monitor",
      "Surround View Monitor",
      "Remote Smart Parking Assist",
      "Safe Exit Warning",
    ],
    interior: [
      "Leather Seating Surfaces",
      "Heated & Ventilated Front Seats",
      "Panoramic Curved Display w/ 12.3-Inch Navigation",
      "Bose Premium Audio",
      "Heated Steering Wheel",
      "Digital Key 2",
      "Wireless Apple CarPlay & Android Auto",
    ],
    exterior: [
      "19-Inch Alloy Wheels",
      "LED Projection Headlamps",
      "Panoramic Sunroof",
      "Hands-Free Smart Liftgate",
      "Power-Folding Heated Mirrors",
    ],
  },
  colors: { exterior: { name: "Amazon Gray", code: "A5G" }, interior: { name: "Black", code: "BLK" } },
  assembly: { plant: "Ulsan", city: "Ulsan", country: "South Korea" },
  mechanical: { engine: "1.6L T-GDI HYBRID", transmission: "6-SPEED A/T", drivetrain: "HTRAC AWD" },
  stockNumber: "H2660488",
  epa: {
    city: 38, highway: 38, combined: 38, annualFuelCost: 1300, ghgScore: 8,
    rangeMiles: null, fuelType: "Hybrid Gasoline-Electric", smogScore: 7, gallonsPer100Miles: 2.6,
    fiveYearCostDifference: 2250, classNote: null,
  },
  safety: null,
  passportUrl: "https://autolabels.io/v/demo-tucson-hev",
  barcodePayload: "KM8JFCD1XTU443210",
});

// Long-equipment Palisade: forces the deliberate continuation page.
export const hyundaiLongFixture = (): FactoryStickerRenderData => {
  const base = hyundaiPalisadeFixture();
  const std = { ...base.standardEquipment };
  std.comfort = Array.from({ length: 26 }, (_, i) =>
    `Three-Row Comfort & Convenience Feature ${String(i + 1).padStart(2, "0")} w/ Extended Adjustment Range`);
  std.technology = Array.from({ length: 24 }, (_, i) =>
    `Bluelink Connected Technology Function ${String(i + 1).padStart(2, "0")} w/ Over-the-Air Update Support`);
  return {
    ...base,
    vin: "KM8R7DGE1TU559876",
    identity: { year: "2026", make: "Hyundai", model: "Palisade", trim: "CALLIGRAPHY NIGHT EDITION AWD" },
    pricing: { baseMsrp: 55345, destinationCharge: 1415, optionsTotal: null, totalMsrp: 57205, portOptionsTotal: 445 },
    standardEquipment: std,
    stockNumber: "H2660671",
    passportUrl: "https://autolabels.io/v/demo-palisade-ne",
    barcodePayload: "KM8R7DGE1TU559876",
  };
};

export const genericDecodeFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  generic: true,
  disclaimers: [
    "AutoLabels-generated Factory Build & Original MSRP Record created from VIN-specific vehicle data. This is not the original manufacturer Monroney label and is not a replacement for any federally required label on a new motor vehicle.",
    "Equipment shown is typical for this trim; VIN-specific decode was not available.",
  ],
});
