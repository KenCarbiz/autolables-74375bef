// Test inputs for the Honda Odyssey template.
//
// hondaOdysseyListing(): a saved Honda Odyssey record with a decoded build
// sheet (read-only extract of vehicle_listings), a 2025 Odyssey EX-L. The
// template's reference is a 2026 Touring sticker, so it is used only as an
// off-year layout stress test, not a production candidate.
// hondaOdysseyReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type HondaOdysseyListing = CatalogListing;
export const hondaOdysseyListing = (): HondaOdysseyListing => recordListing("hondaOdysseyRecord.fixture.json");
export const hondaOdysseyRenderData = (listing: HondaOdysseyListing = hondaOdysseyListing()): FactoryStickerRenderData => recordRenderData(listing);

export const HONDA_ODYSSEY_REFERENCE_VIN = "5FNRL6H86TB039158";

export function hondaOdysseyReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: HONDA_ODYSSEY_REFERENCE_VIN,
    barcodePayload: HONDA_ODYSSEY_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Honda", model: "Odyssey", trim: "Touring" },
    bodyClass: "Minivan",
    mechanical: { engine: "280hp 3.5-Liter VTEC V6 Engine with Variable Cylinder Management (VCM)", transmission: "10-Speed Automatic Transmission", drivetrain: "FWD" },
    pricing: { baseMsrp: 47495, destinationCharge: 1495, optionsTotal: 0, totalMsrp: 48990 },
    packages: [],
    options: [],
    standardEquipment: {
      "Technical Features": ["280hp 3.5-Liter VTEC V6 Engine with Variable Cylinder Management (VCM)", "10-Speed Automatic Transmission", "Intelligent Traction Management"],
      "Safety Features": [
        "Driver's and Front Passenger's Airbags", "Driver's and Front Passenger's Side Airbags", "Three Row Side Curtain Airbags",
        "Driver's and Front Passenger's Knee Airbags", "Vehicle Stability Assist (VSA)", "Anti-Lock Braking System (ABS)", "Electronic Brake Distribution (EBD)",
        "Tire Pressure Monitoring System", "LED Daytime Running Lights", "LATCH System for Child Seats",
      ],
      "Interior Features": [
        "Leather-Trimmed Interior", "Leather-Wrapped Steering Wheel", "Audio System with 7 Speakers",
        '9" Color Touchscreen w/ Honda Navigation, Voice Recognition and Multi-View Rear Camera', "Traffic (In select areas)",
        "Rear Entertainment System with Wireless Headset Capability (Wireless Headset Not Included)", "TFT Meter Display",
        "Wireless Apple CarPlay/Android Auto Integration", "Wireless Phone Charger", "CabinTalk", "CabinWatch", "Push-Button Start",
        "Tri-Zone Automatic Climate Control", "Driver's 12-Way Power Seat with Memory incl 4-Way Power Lumbar", "Heated Front Seats",
        "Front Passenger's 8-Way Power Seat incl. 4-Way Power Lumbar", "Auto Dimming Rearview Mirror", "HomeLink System", "Illuminated Visor Vanity Mirrors",
        "Magic Slide 2nd Row Seats", "60/40 Fold-Down 3rd Row", "Floor Mats", "115-Volt Power Outlet", "2nd & 3rd-Row Sunshades",
      ],
      "Exterior Features": [
        "Dual Power Sliding Doors", "Blind Spot Information System (BSI) w/ Cross Traffic Monitor", "Power Moonroof with Tilt Feature", "Power Tailgate",
        '19" Alloy Wheels', "235/55 R19 All-Season Tires", "LED Headlights w/ Auto-High Beam", "Auto-On/Off Headlights", "LED Fog Lights",
        "Heated Power Door Mirrors with Turn Indicators", "LED Taillights", "Rear Privacy Glass", "Front and Rear Parking Sensors",
        "Smart Entry System with Security System", "Remote Engine Start", "Walk Away Auto Lock",
      ],
      "Honda Sensing": [
        "Adaptive Cruise Control (ACC)", "Collision Mitigation Braking System (CMBS)", "Lane Keeping Assist System (LKAS)", "Road Departure Mitigation (RDM)",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Smoke Blue Pearl", code: null }, interior: { name: "Gray", code: null } },
    assembly: { plant: null, city: "Lincoln", country: "USA" },
    transportMethod: "Allo 276 DEC",
    factoryCodes: { dealer: "801423", emissions: "50 State" },
    epa: {
      city: 19, highway: 28, combined: 22, annualFuelCost: 2250, ghgScore: 4, smogScore: 4, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 4.5, co2TailpipeGpm: 395, fiveYearCostDifference: -2750,
      classNote: "Minivans range from 20 to 83 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: 5, frontalDriver: 5, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: 4 },
    nhtsaNotRated: false,
    dealerRole: "original_delivery",
    dealer: { name: "Braunability", address: "631 W. 11th Street", city: "Winamac", state: "IN", zip: "46996", phone: null },
    warranty: { basic: null, powertrain: null, corrosion: null, roadside: "Honda Roadside Assistance 3YR/36K Mile Warranty Term", emissions: null },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "70%" },
      { label: "Final Assembly Point", value: "Lincoln, Alabama, U.S.A." },
      { label: "Engine", value: "U.S.A." },
      { label: "Transmission", value: "U.S.A." },
    ],
    generic: false,
    disclaimers: [],
  };
}
