// Test inputs for the Kia Sorento gasoline template.
//
// sorentoListing(): the one saved Kia Sorento record with a decoded build sheet
// (read-only extract of vehicle_listings), a 2024 Sorento S. Production has no
// 2026 Sorento, so it is used only as an off-year layout stress test, not a
// production candidate.
// sorentoReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type SorentoListing = CatalogListing;
export const sorentoListing = (): SorentoListing => recordListing("sorentoRecord.fixture.json");
export const sorentoRenderData = (listing: SorentoListing = sorentoListing()): FactoryStickerRenderData => recordRenderData(listing);

export const SORENTO_REFERENCE_VIN = "5XYRG4JC7TG466476";

export function sorentoReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: SORENTO_REFERENCE_VIN,
    barcodePayload: SORENTO_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Kia", model: "Sorento", trim: "LX" },
    bodyClass: "SUV",
    mechanical: { engine: "2.5L Gas Direct Injection (GDI) 4-Cyl Engine", transmission: "8-Speed Automatic Transmission", drivetrain: "FWD" },
    pricing: { baseMsrp: 32390, destinationCharge: 1495, optionsTotal: 730, totalMsrp: 34615 },
    packages: [],
    options: [
      { name: "Glacial White Pearl Paint", code: null, msrp: 495 },
      { name: "Carpeted Floor Mats", code: null, msrp: 235 },
    ],
    standardEquipment: {
      Mechanical: ["2.5L Gas Direct Injection (GDI) 4-Cyl Engine", "8-Speed Automatic Transmission", "Drive Mode Select"],
      "Advanced Driver-Assistance Systems": [
        "Forward Collision-Avoidance Assist - Cyclist/Jct Turning", "Blind-Spot Collision Warning", "Rear Cross-Traffic Collision-Avoidance Assist",
        "Lane Keeping Assist & Lane Following Assist", "Driver Attention Warning & High Beam Assist", "Safe Exit Assist", "Smart Cruise Control w/Stop & Go",
      ],
      Safety: [
        "Dual Front Advanced Airbags & Driver's Knee Airbag", "Dual Front and Rear Seat-Mounted Side Airbags", "Full-Length Side Curtain Airbags",
        "Electronic Stability Control", "Tire Pressure Monitoring System", "Power Rear Door Child Locks",
      ],
      "Interior, Comfort & Convenience": [
        "12.3\" Touchscreen w/Wireless Android Auto & Apple CarPlay", "Kia Connect w/Comp 3-Yr Ultimate.* Where Available**",
        "SIRIUSXM w/Free 3-Mo. Subscription*", "Rear View Camera with Dynamic Guidelines", "4.0\" Instrument Display", "Front & Rear USB Charge Ports",
        "Steering Wheel Controls (Bluetooth/Audio/Cruise)", "Smart Key w/ Push Button & Remote Start", "One-Touch Slide & Fold 2nd Row Seats",
        "Leather Wrapped Steering Wheel & Shift Knob", "Rear Occupant Alert w/ Sensors",
      ],
      Exterior: [
        "17\" Alloy Wheels", "LED Projector Headlights w/ Auto-On/Off", "LED Positioning Lights", "Power Adj. Heated Outside Mirrors w/LED Turn Signals", "Compact Spare Tire",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Glacial White Pearl", code: null }, interior: { name: "Black", code: null } },
    assembly: { plant: null, city: "West Point, GA", country: "USA" },
    transportMethod: null,
    factoryCodes: { dealer: "FL083", emissions: null },
    epa: {
      city: 23, highway: 31, combined: 26, annualFuelCost: 1900, ghgScore: 5, smogScore: 6, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 3.8, co2TailpipeGpm: 339, fiveYearCostDifference: -1000,
      classNote: "SMALL SUVS range from 14 to 138 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: 5, frontalDriver: 4, frontalPassenger: 4, sideFront: 5, sideRear: 5, rollover: 4 },
    nhtsaNotRated: false,
    dealerRole: "original_delivery",
    dealer: { name: "Greenway Kia West", address: "3407 West Colonial Drive", city: "Orlando", state: "FL", zip: "32808", phone: null },
    warranty: {
      basic: "5 Year/60,000 Mile Limited Basic Warranty", powertrain: "10 Year/100,000 Mile Limited Powertrain Warranty",
      corrosion: null, roadside: "5 Year/60,000 Mile Roadside Assistance", emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "55%" },
      { label: "Major Sources of Foreign Parts Content", value: "Korea: 30%" },
      { label: "Engine", value: "USA" },
      { label: "Transmission", value: "USA" },
    ],
    generic: false,
    disclaimers: [],
  };
}
