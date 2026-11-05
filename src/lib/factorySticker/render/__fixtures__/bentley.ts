// Test inputs for the Bentley Continental GT plug-in hybrid template.
//
// bentleyListing(): a saved 2018 Chevrolet Volt (the only saved plug-in hybrid with a
// decoded build sheet and a verified EPA match; read-only extract of
// vehicle_listings, the standard-equipment list trimmed). Production has no
// Bentley Continental GT, so it is used only as an off-year, other-make layout stress test,
// not a production candidate.
// bentleyReferenceMatchData(): the OEM reference sticker's own transcribed values
// for side-by-side visual comparison with the reference PDF ONLY. Never
// use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type BentleyListing = CatalogListing;
export const bentleyListing = (): BentleyListing => recordListing("voltRecord.fixture.json");
export const bentleyRenderData = (listing: BentleyListing = bentleyListing()): FactoryStickerRenderData => recordRenderData(listing);

export const BENTLEY_REFERENCE_VIN = "SCBCP2ZG1TC024060";

export function bentleyReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: BENTLEY_REFERENCE_VIN,
    barcodePayload: BENTLEY_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Bentley", model: "Continental GT", trim: "Azure" },
    bodyClass: "Coupe",
    mechanical: { engine: null, transmission: null, drivetrain: null },
    pricing: { baseMsrp: 344400, destinationCharge: 4150, optionsTotal: 47780, totalMsrp: 396330 },
    packages: [],
    options: [
      { name: "Linen", code: null, msrp: null, included: true },
      { name: "Mulliner Range-Solid and Metallic", code: null, msrp: 13655 },
      { name: "Naim for Bentley", code: null, msrp: 10525 },
      { name: "Bentley Rotating Display", code: null, msrp: 7615 },
      { name: "Dual Finish-OpnPore DrkBurrWal&Grnd Blk", code: null, msrp: 5940 },
      { name: "22\" 10 Spoke Whl-Black&Bright Machined", code: null, msrp: 4380 },
      { name: "Bright Chrome Diamond Knurling", code: null, msrp: 2925 },
      { name: "Animated Welcome Lamps - By Mulliner", code: null, msrp: 1490 },
      { name: "Heated Windshield", code: null, msrp: 960 },
      { name: "Contrast Binding to Carpet Overmats", code: null, msrp: 290 },
    ],
    standardEquipment: {
      "Powertrain & Chassis": [
        "4 Litre, Twin-Turbocharged High Performance V8 Hybrid",
        "8 Speed Dual Clutch Transmission",
        "Active All-Wheel Drive",
        "Air Suspension with Continuous Damping Control",
      ],
      "Craftsmanship, Comfort & Convenience": [
        "Electrically Operated Door Mirrors with Heating, Power Folding and Memory Function",
        "Infotainment System with 12.3 inch High Resolution Display",
        "Data Connect Package",
        "Full LED Headlights with High Beam Assist",
        "Full LED Tail Lamps",
        "Hide Trimmed Gear Lever",
        "Remote Controlled Garage Door Opener",
        "Hybrid Battery Charger",
        "Bentley Keybox",
        "Valet Key",
      ],
      "Azure Features": [
        "22\" Azure Wheel - Silver Painted and Bright Machined",
        "Touring Specification",
        "Panoramic Glass Roof",
        "Harmony Diamond Quilt Specification",
        "Colour Specification",
        "Front Seat Comfort Specification",
        "Front Wellness Seating",
        "Contrast Stitching",
        "Single Finish - Open Pore Crown Cut Walnut Veneer",
        "Heated, Single Tone, 3 Spoke, Hide Trimmed Steering Wheel",
        "Illuminated Treadplates",
        "Mood Lighting Specification",
        "Sports Pedals",
        "Jewel Fuel and Oil Filler Caps",
      ]
    },
    keyFeatures: {},
    colors: { exterior: { name: "Silver Storm", code: null }, interior: { name: "Linen", code: null } },
    assembly: { plant: null, city: "Crewe, England", country: "United Kingdom" },
    transportMethod: "Truck",
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: null, highway: null, combined: 46, annualFuelCost: 2400, ghgScore: 6, smogScore: 4, rangeMiles: 30, fuelType: "Premium Gasoline and Electricity",
      combinedMpge: 46, gasCombinedMpg: 19, kwhPer100Miles: 73, chargeTimeHours: 3, electricRangeMiles: 30, totalRangeMiles: 440,
      co2TailpipeGpm: 161, fiveYearCostDifference: -3500
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: null,
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "0%" },
      { label: "Germany", value: "62%" },
      { label: "Engine", value: "Germany" },
      { label: "Transmission", value: "Germany" }
    ],
    generic: false,
    disclaimers: [],
  };
}
