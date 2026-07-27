// Shape variants for the visual-regression matrix.
//
// A template can look perfect on its own reference vehicle and break on
// the shapes real inventory actually produces: a stripped base model with
// almost no equipment, a loaded one that overflows, a name too long for
// its box, a package with more members than fit, an EV whose EPA panel is
// a different module entirely. Each variant below is a deterministic
// transform of a base fixture, so every registered template can be driven
// through all of them.

import type { FactoryStickerRenderData } from "../contract.ts";

export type VariantId =
  | "minimum_content"
  | "maximum_content"
  | "option_heavy"
  | "long_model_trim"
  | "long_package_name"
  | "electrified";

export const VARIANT_IDS: VariantId[] = [
  "minimum_content",
  "maximum_content",
  "option_heavy",
  "long_model_trim",
  "long_package_name",
  "electrified",
];

const clone = (d: FactoryStickerRenderData): FactoryStickerRenderData =>
  JSON.parse(JSON.stringify(d)) as FactoryStickerRenderData;

/** A base model: the least a document can carry and still be a document. */
function minimumContent(base: FactoryStickerRenderData): FactoryStickerRenderData {
  const d = clone(base);
  d.identity = { ...d.identity, model: "Base", trim: null };
  d.options = [];
  d.packages = [];
  d.standardEquipment = { mechanical: ["2.0L 4-Cylinder Engine", "Front-Wheel Drive"] };
  d.pricing = {
    baseMsrp: 24995,
    destinationCharge: 1395,
    optionsTotal: 0,
    totalMsrp: 26390,
  };
  d.epa = null;
  d.safety = null;
  d.nhtsaNotRated = true;
  d.partsContent = [];
  d.warranty = null;
  return d;
}

/** Everything at once: the overflow case. */
function maximumContent(base: FactoryStickerRenderData): FactoryStickerRenderData {
  const d = clone(base);
  const bulk = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix} Feature ${i + 1} With A Descriptive Name`);
  d.standardEquipment = {
    exterior: bulk("Exterior", 14),
    interior: bulk("Interior", 16),
    mechanical: bulk("Mechanical", 12),
    safety_features: bulk("Safety", 15),
  };
  d.options = [
    { name: "Premium Package", code: "PP1", msrp: 3250, contents: bulk("Package", 8) },
    { name: "Technology Package", code: "TP2", msrp: 1995, contents: bulk("Tech", 6) },
    { name: "Cold Weather Package", code: "CW3", msrp: 850, contents: bulk("Cold", 4) },
    { name: "Premium Metallic Paint", code: "PMP", msrp: 595 },
    { name: "All-Weather Floor Liners", code: "AWF", msrp: 250 },
  ];
  const optionsTotal = 3250 + 1995 + 850 + 595 + 250;
  const base_ = 58995;
  const dest = 1595;
  d.pricing = {
    baseMsrp: base_, destinationCharge: dest, optionsTotal,
    totalMsrp: base_ + optionsTotal + dest,
  };
  return d;
}

/** Many priced options — the case that must never double-price. */
function optionHeavy(base: FactoryStickerRenderData): FactoryStickerRenderData {
  const d = clone(base);
  d.options = [
    {
      name: "Advanced Driver Assistance Package", code: "ADA", msrp: 2195,
      contents: [
        "Adaptive Cruise Control", "Lane Centering Assist", "Head-Up Display",
        "Surround View Camera", "Reverse Automatic Braking", "Traffic Sign Recognition",
      ],
    },
    { name: "Panoramic Power Moonroof", code: "PMR", msrp: 1495 },
    { name: "Premium Audio System", code: "PAS", msrp: 1195 },
    { name: "Towing Package", code: "TOW", msrp: 895, contents: ["Trailer Hitch", "Wiring Harness"] },
    { name: "20-Inch Wheel Upgrade", code: "W20", msrp: 795 },
    { name: "Premium Metallic Paint", code: "PMP", msrp: 595 },
    { name: "All-Weather Floor Liners", code: "AWF", msrp: 250 },
    { name: "Black Interior", code: "BLK", msrp: null, included: true },
  ];
  const optionsTotal = 2195 + 1495 + 1195 + 895 + 795 + 595 + 250;
  const base_ = 47595;
  const dest = 1395;
  d.pricing = {
    baseMsrp: base_, destinationCharge: dest, optionsTotal,
    totalMsrp: base_ + optionsTotal + dest,
  };
  return d;
}

/** A name long enough to test the header's auto-fit. */
function longModelTrim(base: FactoryStickerRenderData): FactoryStickerRenderData {
  const d = minimumContent(base);
  d.identity = {
    ...d.identity,
    model: "Grand Touring Long Wheelbase",
    trim: "PLATINUM RESERVE EDITION AWD",
  };
  return d;
}

/** A package name and members long enough to test the option grid. */
function longPackageName(base: FactoryStickerRenderData): FactoryStickerRenderData {
  const d = clone(base);
  d.options = [
    {
      name: "Executive Demonstration Preferred Equipment Group Package",
      code: "XPG",
      msrp: 4995,
      contents: [
        "Heated And Ventilated Front Bucket Seats",
        "Power Adjustable Steering Column With Memory",
        "Head-Up Display With Navigation Prompts",
        "Surround View Camera With Recording",
      ],
    },
    { name: "Premium Metallic Paint", code: "PMP", msrp: 595 },
  ];
  d.pricing = {
    baseMsrp: 52995, destinationCharge: 1495, optionsTotal: 5590,
    totalMsrp: 52995 + 5590 + 1495,
  };
  return d;
}

/** Battery-electric: MPGe, range, no gallons-per-100-miles. */
function electrified(base: FactoryStickerRenderData): FactoryStickerRenderData {
  const d = optionHeavy(base);
  d.mechanical = { engine: "DUAL ELECTRIC MOTORS", transmission: "SINGLE-SPEED", drivetrain: "AWD" };
  d.epa = {
    city: 118, highway: 101, combined: 110, annualFuelCost: 700, ghgScore: 10,
    rangeMiles: 312, fuelType: "Electric", smogScore: 10, gallonsPer100Miles: null,
    fiveYearCostDifference: 5500, classNote: null,
  };
  d.warranty = {
    basic: "4-Year/50,000-Mile Basic Limited Warranty",
    powertrain: "8-Year/100,000-Mile Electric Powertrain Warranty",
    corrosion: null,
    roadside: "4-Year/50,000-Mile Roadside Assistance",
    emissions: "8-Year/100,000-Mile High-Voltage Battery Limited Warranty",
  };
  return d;
}

const BUILDERS: Record<VariantId, (b: FactoryStickerRenderData) => FactoryStickerRenderData> = {
  minimum_content: minimumContent,
  maximum_content: maximumContent,
  option_heavy: optionHeavy,
  long_model_trim: longModelTrim,
  long_package_name: longPackageName,
  electrified,
};

export function buildVariant(
  base: FactoryStickerRenderData,
  variant: VariantId,
): FactoryStickerRenderData {
  return BUILDERS[variant](base);
}
