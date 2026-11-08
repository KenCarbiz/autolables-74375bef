// Test inputs for the Dodge Durango gasoline template.
//
// durangoListing(): the one saved Dodge record with a decoded build sheet
// (read-only extract of vehicle_listings), a 2008 Grand Caravan SXT. Production
// has no Durango, so it is used only as an off-year, other-model layout stress
// test, not a production candidate.
// durangoReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type DurangoListing = CatalogListing;
export const durangoListing = (): DurangoListing => recordListing("dodgeRecord.fixture.json");
export const durangoRenderData = (listing: DurangoListing = durangoListing()): FactoryStickerRenderData => recordRenderData(listing);

export const DURANGO_REFERENCE_VIN = "1C4RDHDG7TC153298";

export function durangoReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: DURANGO_REFERENCE_VIN,
    barcodePayload: DURANGO_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Dodge", model: "Durango", trim: "GT Blacktop" },
    bodyClass: "SUV",
    mechanical: { engine: "3.6L V6 24V VVT Pentastar Engine with Stop/Start", transmission: "8-Speed Automatic 850RE Transmission", drivetrain: "RWD" },
    pricing: { baseMsrp: 38995, destinationCharge: 1995, optionsTotal: 2940, totalMsrp: 43930 },
    packages: [{
      name: "Customer Preferred Package 2BD", code: "2BD", msrp: 2245,
      contents: [
        "265/50R20 BSW All-Season LRR Tires", "20-Inch x 8.0-Inch Black Noise Aluminum Wheels", "GT Gloss-Black Badging", "Gloss-Black Badges",
        "Black Roof Rails", "Integrated Roof Rail Crossbars",
      ],
    }],
    options: [{ name: "Black Tubular Side Steps by Mopar", code: null, msrp: 695 }],
    standardEquipment: {
      "Functional/Safety Features": [
        "Advanced Multistage Front Air Bags", "Supplemental Side-Curtain All-Row Air Bags", "Supplemental Front Seat-Mounted Side Air Bags",
        "Driver Inflatable Knee-Bolster Air Bag", "Heavy-Duty 4-Wheel Anti-Lock Disc Brakes", "Electronic Stability Control", "Rain-Brake Support",
        "Sport Mode", "Selectable Steering Modes", "Blind-Spot and Cross-Path Detection", "ParkView Rear Back-Up Camera",
        "ParkSense Rear Park-Assist with Stop", "Dodge Connect (Connected Services) with Trial", "Front Door Passive Entry and Lock", "Push-Button Start",
        "Remote-Start System", "Power Liftgate", "Sentry Key Theft Deterrent System", "Rear-Seat Reminder Alert", "Capless Fuel-Fill", "Compact Spare Tire",
        "24.6-Gallon Fuel Tank",
      ],
      "Interior Features": [
        "Uconnect 5 Nav with 10.1-Inch Touch Screen Display", "8-Way Power Driver and Manual Passenger Seats", "4-Way Power Lumbar Adjustable Driver Seat",
        "2nd-Row 60 / 40 Fold and Tumble Bench Seat", "Red Accent Stitching", "Heated Front Seats", "Heated Steering Wheel",
        "Full-Function Media Hub with 2 USB Plus Aux Port", "SiriusXM 360L with 3-Month Sub Call 800-643-2112", "Apple CarPlay", "Google Android Auto",
        "6 Alpine Speakers", "Integrated Voice Command", "Front 12-Volt Auxiliary Power Outlet", "Steering-Wheel-Mounted Audio Controls",
        "Tilt / Telescoping Steering Column", "Steering-Wheel-Mounted Paddle Shifters", "Remote Folding Third-Row Headrests",
        "A/C with 3-Zone Automatic Temperature Control", "7-Passenger Seating",
      ],
      "Exterior Features": [
        "18-Inch x 8.0-Inch Painted Aluminum Wheels", "265/60R18 BSW All-Season LRR Tires", "Bi-Function LED Projector Headlamps",
        "Dual Rear Exhaust with Bright Tips",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "White Knuckle Clear-Coat Exterior Paint", code: null }, interior: { name: "Black Interior", code: null } },
    assembly: { plant: null, city: "Detroit, Michigan", country: "U.S.A." },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 18, highway: 25, combined: 20, annualFuelCost: 2500, ghgScore: 4, smogScore: 6, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 5.0, co2TailpipeGpm: 434, fiveYearCostDifference: -4000,
      classNote: "Standard SUV 2WD range from 12 to 115 MPGe. The best vehicle rates 146 MPGe.",
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "3-year or 36,000-mile Basic Limited Warranty.", powertrain: "5-year or 60,000-mile Powertrain Limited Warranty.",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "73%" },
      { label: "Major Sources of Foreign Parts Content", value: "Mexico: 21%" },
      { label: "Engine", value: "Mexico" },
      { label: "Transmission", value: "United States" },
    ],
    generic: false,
    disclaimers: [],
  };
}
