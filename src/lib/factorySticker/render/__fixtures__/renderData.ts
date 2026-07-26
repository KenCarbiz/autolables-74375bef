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

// The visual benchmark: an INFINITI QX80 rendered as a USED-vehicle
// "Original Factory Build & MSRP Record" (89450 + 4250 + 1995 = 95695).
export const infinitiBenchmark = (): FactoryStickerRenderData => ({
  vin: "JN8AZ2NE8P9123456",
  condition: "used",
  title: "Original Factory Build & MSRP Record",
  identity: { year: "2026", make: "INFINITI", model: "QX80", trim: "Autograph" },
  pricing: {
    baseMsrp: 89450,
    destinationCharge: 1995,
    optionsTotal: 4250,
    totalMsrp: 95695,
  },
  packages: [
    {
      name: "PREMIUM REAR SEAT PACKAGE",
      code: "P01",
      msrp: null,
      contents: ["MASSAGING FRONT SEATS", "REAR SEAT ENTERTAINMENT", "HEADREST PILLOWS"],
    },
  ],
  options: [
    { name: "ILLUMINATED KICK PLATES", code: "K01", msrp: 500 },
    { name: "WELCOME LIGHTING", code: null, msrp: 425 },
    { name: "ROOF RAIL CROSSBARS", code: null, msrp: 375 },
    { name: "CARGO PACKAGE", code: null, msrp: 450 },
    { name: "22-INCH DARK FORGED WHEELS", code: "W22", msrp: 2500 },
  ],
  standardEquipment: {
    safety_features: ["FORWARD COLLISION WARNING", "LANE DEPARTURE WARNING", "10 AIRBAGS"],
    interior: ["SEMI-ANILINE LEATHER SEATS", "TRI-ZONE CLIMATE CONTROL"],
    exterior: ["LED HEADLIGHTS", "POWER PANORAMIC MOONROOF", "ROOF RAILS"],
    mechanical: ["ELECTRONIC AIR SUSPENSION", "TOW HITCH RECEIVER"],
  },
  keyFeatures: {
    adas: ["PROPILOT ASSIST 2.1", "BLIND SPOT INTERVENTION"],
    infotainment: ["WIRELESS CARPLAY", "BOSE PERFORMANCE AUDIO - 24 SPEAKERS"],
  },
  colors: {
    exterior: { name: "Moonbow Blue", code: "RCF" },
    interior: { name: "Graphite Semi-Aniline Leather", code: "G" },
  },
  assembly: { plant: "Kyushu Plant", city: "Kanda", country: "Japan" },
  epa: {
    city: 16,
    highway: 19,
    combined: 17,
    annualFuelCost: 2900,
    ghgScore: 3,
    rangeMiles: null,
    fuelType: "Premium Unleaded",
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
  barcodePayload: "JN8AZ2NE8P9123456",
  generic: false,
  disclaimers: [
    "Reconstructed factory build record for reference. Not the original manufacturer window sticker.",
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

export const genericDecodeFixture = (): FactoryStickerRenderData => ({
  ...infinitiBenchmark(),
  generic: true,
  disclaimers: [
    "Reconstructed factory build record for reference. Not the original manufacturer window sticker.",
    "Equipment shown is typical for this trim; VIN-specific decode was not available.",
  ],
});
