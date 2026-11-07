// Test inputs for the Maserati GranTurismo gasoline template.
//
// maseratiListing(): production has no saved Maserati record, so this reuses
// the saved 2024 Lexus GX Premium+ record (read-only extract of
// vehicle_listings) as an off-year, other-make layout stress test, not a
// production candidate and not a Maserati.
// maseratiReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type MaseratiListing = CatalogListing;
export const maseratiListing = (): MaseratiListing => recordListing("lexusRecord.fixture.json");
export const maseratiRenderData = (listing: MaseratiListing = maseratiListing()): FactoryStickerRenderData => recordRenderData(listing);

export const MASERATI_REFERENCE_VIN = "ZAMBMVDBXTX465057";

export function maseratiReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: MASERATI_REFERENCE_VIN,
    barcodePayload: MASERATI_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Maserati", model: "GranTurismo", trim: "Trofeo" },
    bodyClass: "Coupe",
    mechanical: { engine: "3.0L Twin Turbo V6 Engine", transmission: "8-Speed ZF Automatic Transmission", drivetrain: "AWD" },
    pricing: { baseMsrp: 166000, destinationCharge: 2195, optionsTotal: 10850, totalMsrp: 179345, gasGuzzlerTax: 0 },
    packages: [
      {
        name: "Adas Package 1", code: null, msrp: 5180,
        contents: ["Adaptive Cruise Control", "Active Blind Spot Assist", "Active Lane Keeping", "Driver Drowsy Detection", "Surround View Camera"],
      },
      { name: "Comfort Package", code: null, msrp: 1240, contents: ["Ventilated Front Seats", "Kick Sensor"] },
    ],
    options: [
      { name: "Red Brake Calipers", code: null, msrp: 1320 },
      { name: "Night Interaction - QBJ", code: "QBJ", msrp: 3110 },
    ],
    standardEquipment: {
      "Performance / Handling": [
        "3.0L Twin Turbo V6 Engine", "8-Speed ZF Automatic Transmission", "Q4 All-Wheel Drive (AWD)", "Adaptive Air Suspension",
        "Skyhook Electronic Active Damping System", "Electronic Limited-Slip Differential (eLSD)", "Drive Modes - Comfort, GT, Sport & Corsa", "Launch Control",
        "Trofeo-Specific Front & Rear Fascias", "Carbon Fiber Exterior Accents", "Quad Exhaust in Chrome", "Sport Exhaust System", "Gloss Black Window Surround",
        "Badging in Black Chrome - Trident", "Trofeo Badge in Black Chrome with Red Surround", "Stainless Steel Doorsills",
        "20/21-inch Staggered Forged Pegaso-Design Wheels", "Summer Tires", "Matte Black Painted Brake Calipers with Maserati Script", "Engine Start/Stop System",
      ],
      "Comfort / Convenience": [
        "Extended Full Grain Leather Upholstery w/ Linear Graphic-Design Stitching", "Open Pore Radica Trim", "Ambient Interior Lighting", "Alcantara Headliner",
        "18-Way Power Front Seats w/ Driver Memory", "Heated Front Seats", "Heated Leather Steering Wheel with Drive Mode Selector", "Power Adjustable Steering Column",
        "Aluminum Column-Mounted Paddle Shifters", "Dual-Zone Automatic Climate Control", "Frameless Rear View Mirror", "Heated, Power Folding Door Mirrors",
        "Autodimming Exterior Door Mirrors", "Power Trunk", "Keyless Entry & HomeLink Garage Door Opener", "12.3-inch Full Digital TFT Instrument Cluster",
        "Dual 12-inch & 8.8-inch Maserati Intelligent Assistant", "Navigation / Apple CarPlay / Android Auto", "SiriusXM with 360L (1yr Trial Subscription)",
        "Maserati Connected Services", "Alexa Built-In - See Maserati.com for details", "Sonus Faber Premium Audio System (12-Speakers)", "Digital Smart Clock on Dashboard",
        "Wireless Charging", "Wearable Key",
      ],
      "Safety / Security": [
        "Airbag System (Dual Stage Front, Side & Head)", "Front & Rear Parking Sensors w/ Rear Active Braking", "AEB with Pedestrian Recognition", "Rear View Backup Camera",
        "Full LED Headlamps & Taillamps", "Alarm System", "Electronic Parking Brake", "Tire Pressure Monitoring System (TPMS)",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Night Interaction", code: "QBJ" }, interior: { name: "Red/Red/Red", code: "N88" } },
    assembly: { plant: null, city: "Turin", country: "Italy" },
    transportMethod: "Port Newark",
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 18, highway: 27, combined: 21, annualFuelCost: 2950, ghgScore: 4, smogScore: 4, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 4.8, co2TailpipeGpm: 412, fiveYearCostDifference: -6250,
      classNote: "Subcompact Car range from 17 to 90 MPG. The best vehicle rates 140 MPGe.",
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "Transferrable four year/50,000 mile new car limited warranty with 24/7 Roadside Assistance.", powertrain: null,
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "0%" },
      { label: "Major Sources of Foreign Parts Content", value: "Italy: 65%" },
      { label: "Engine", value: "Italy" },
      { label: "Transmission", value: "Italy" },
    ],
    generic: false,
    disclaimers: [],
  };
}
