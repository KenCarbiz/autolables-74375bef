// Test inputs for the Lexus RX 350 gasoline template.
//
// lexusListing(): a saved Lexus record with a decoded build sheet (read-only
// extract of vehicle_listings), a 2024 Lexus GX Premium+. Production has no RX
// record, so it is used only as an off-year, other-model layout stress test,
// not a production candidate.
// lexusReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type LexusListing = CatalogListing;
export const lexusListing = (): LexusListing => recordListing("lexusRecord.fixture.json");
export const lexusRenderData = (listing: LexusListing = lexusListing()): FactoryStickerRenderData => recordRenderData(listing);

export const LEXUS_REFERENCE_VIN = "2T2BAMCA2TC168505";

export function lexusReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: LEXUS_REFERENCE_VIN,
    barcodePayload: LEXUS_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Lexus", model: "RX 350", trim: "AWD" },
    bodyClass: "SUV",
    mechanical: { engine: "2.4L 4-Cyl Turbo Engine with 275 HP", transmission: "8-Speed Automatic Transmission", drivetrain: "AWD" },
    pricing: { baseMsrp: 58490, destinationCharge: 1550, optionsTotal: 5169, totalMsrp: 65209 },
    packages: [
      {
        name: "Convenience Package", code: null, msrp: 1670,
        contents: ["Panoramic View Monitor, Advanced Park; Traffic Jam Assist (Requires Drive Connect Subscription; 3-Year Trial Included. 4G Network Dependent.)"],
      },
      {
        name: "Technology Package", code: null, msrp: 1475,
        contents: ["Head-Up Display, Digital Rearview Mirror; Digital Key (Requires Remote Connect Subscription; 3-Year Trial Included. 4G Network Dependent.)"],
      },
    ],
    options: [
      { name: "Panorama Glass Roof", code: null, msrp: 500 },
      { name: "Power Rear Door with Kick Sensor", code: null, msrp: 150 },
      { name: "Premium Paint", code: null, msrp: 500 },
      { name: "Multimedia Screen Protector - Glass", code: null, msrp: 109 },
      { name: "Black Emblem Overlays", code: null, msrp: 325 },
      { name: "All Weather Floor Liner, All Weather Cargo Mat", code: null, msrp: 360 },
      { name: "Cargo Net", code: null, msrp: 80 },
    ],
    standardEquipment: {
      "Mechanical & Performance": ["2.4L 4-Cyl Turbo Engine with 275 HP", "8-Speed Automatic Transmission"],
      "Exterior/Interior": ["Bi-LED Headlamps", "Multi-zone Climate Control", "Power Folding & Heated Outer Mirrors", "Wireless Phone Charger"],
      "Safety/Advanced Technology": [
        "Lexus Safety System+ 3.0", "Blind Spot Monitor w/ Rear Cross Traffic Alert", "Digital Latch with Safe Exit Assist", "Intuitive Parking Assist with Auto Braking",
      ],
      "Connected Technologies": ["SiriusXM(R) 3-Month Trial Subscription", "Wireless Apple CarPlay(R) Integration", "Wireless Android Auto(TM) Capability"],
      "Premium+ Features": [
        "21-in Alloy Wheels", "Lexus Interface with 14-inch Touchscreen Display", "Connected Services Capable. 4G Network Dependent. See Lexus.com for Details.",
        "Leather-Trimmed Heated & Ventilated Power Front Seats with Driver Seat Memory", "Power Moonroof with Roof Rails", "Thematic Ambient Illumination",
        "Wood & Leather-Trimmed Heated Steering Wheel",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Eminent White Pearl", code: null }, interior: { name: null, code: null } },
    assembly: { plant: null, city: "Cambridge, Ontario", country: "Canada" },
    transportMethod: "Truck",
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 21, highway: 28, combined: 24, annualFuelCost: 2600, ghgScore: 5, smogScore: 6, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 4.2, co2TailpipeGpm: 370, fiveYearCostDifference: -4500,
      classNote: "Small SUVs range from 14 to 125 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: 5, frontalDriver: 4, frontalPassenger: 4, sideFront: 5, sideRear: 5, rollover: 4 },
    nhtsaNotRated: false,
    dealerRole: "original_delivery",
    dealer: { name: "Lexus of Route 10", address: "130 Route 10 West", city: "Whippany", state: "NJ", zip: "07981", phone: null },
    warranty: undefined,
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
