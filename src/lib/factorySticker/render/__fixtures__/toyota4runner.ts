// Test inputs for the Toyota 4Runner gasoline template.
//
// toyota4runnerListing(): a saved Toyota 4Runner record with a decoded build
// sheet (read-only extract of vehicle_listings), a 2022 4Runner SR5. Production
// has no 2026 4Runner, so it is used only as an off-year layout stress test,
// not a production candidate.
// toyota4runnerReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type Toyota4runnerListing = CatalogListing;
export const toyota4runnerListing = (): Toyota4runnerListing => recordListing("toyota4runnerRecord.fixture.json");
export const toyota4runnerRenderData = (listing: Toyota4runnerListing = toyota4runnerListing()): FactoryStickerRenderData => recordRenderData(listing);

export const TOYOTA_4RUNNER_REFERENCE_VIN = "JTEVA5BR4T5163183";

export function toyota4runnerReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: TOYOTA_4RUNNER_REFERENCE_VIN,
    barcodePayload: TOYOTA_4RUNNER_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Toyota", model: "4Runner", trim: "SR5" },
    bodyClass: "SUV",
    mechanical: { engine: "i-FORCE 2.4L 4cyl Turbocharged Engine", transmission: "8-Spd Automatic Transmission", drivetrain: "4WD" },
    pricing: { baseMsrp: 44270, destinationCharge: 1595, optionsTotal: 1358, totalMsrp: 47223 },
    packages: [],
    options: [
      { name: "50 State Emissions", code: "FE", msrp: 0, included: true },
      { name: "Fixed Running Boards", code: "KH", msrp: 345 },
      { name: "Premium Paint", code: "PC", msrp: 475 },
      { name: "Floor Mats- All Weather- '4Runner'", code: "63", msrp: 248 },
      { name: "Cargo Tray- All Weather '4Runner'", code: "R5", msrp: 140 },
      { name: "Door Edge Guards- Front Color Keyed", code: "D5", msrp: 150 },
      { name: "Owner's Portfolio", code: "DK", msrp: 0, included: true },
    ],
    standardEquipment: {
      "Mechanical & Performance": ["i-FORCE 2.4L 4cyl Turbocharged Engine", "8-Spd Automatic Transmission", "Part-Time 4WD System", "Tow Hitch Receiver w/7 & 4-Pin Connector"],
      "Safety & Convenience": [
        "Toyota Safety Sense 3.0 w/Pre-Collision", "Connected Services Capable. 4G network dependent. See Toyota.com for details.",
        "Blind Spot Monitor (BSM) w/ Rear Cross-Traffic Alert (RCTA)", "Smart Key System",
      ],
      Exterior: ["17-in Alloy Wheels", "Power Rear Window", "LED Headlights and Fog Lights", "Black Roof Rails", "Temporary Spare Tire"],
      Interior: [
        "Fabric-Trimmed Seats w/ Driver Lumbar Support", "8-in. Toyota Audio Multimedia w/ 8-Speakers, Wireless Apple CarPlay and Android Auto Compatibility",
        "SiriusXM w/3-Month Trial", "Leather-trimmed steering wheel",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Supersonic Red", code: "FA10" }, interior: { name: null, code: null } },
    assembly: { plant: null, city: "Tahara, Aichi", country: "Japan" },
    transportMethod: "Truck",
    factoryCodes: { dealer: "45074", emissions: null },
    epa: {
      city: 19, highway: 25, combined: 21, annualFuelCost: 2350, ghgScore: 4, smogScore: 6, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 4.8, co2TailpipeGpm: 417, fiveYearCostDifference: -3250,
      classNote: "Standard SUVs range from 12 to 115 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: 4, frontalDriver: 4, frontalPassenger: 4, sideFront: 5, sideRear: 5, rollover: 3 },
    nhtsaNotRated: false,
    dealerRole: "original_delivery",
    dealer: { name: "Mechanicsville Toyota", address: "6546 Mechanicsville Pike", city: "Mechanicsville", state: "VA", zip: "23111", phone: null },
    warranty: undefined,
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
