// Test inputs for the Ford F-250 Super Duty diesel template.
//
// f250Listing(): the one saved Ford pickup with a decoded build sheet
// (read-only extract of vehicle_listings), a 2024 F-150 XLT. Production has no
// F-250, so it is used only as an off-year, other-model layout stress test, not a
// production candidate.
// f250ReferenceMatchData(): the OEM reference sticker's own transcribed values,
// for side-by-side visual comparison with the reference PDF ONLY. Never use it
// as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type F250Listing = CatalogListing;
export const f250Listing = (): F250Listing => recordListing("f250Record.fixture.json");
export const f250RenderData = (listing: F250Listing = f250Listing()): FactoryStickerRenderData => recordRenderData(listing);

export const F250_REFERENCE_VIN = "1FT8W2BM2TEE18967";

export function f250ReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: F250_REFERENCE_VIN,
    barcodePayload: F250_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null, fuelType: "Diesel" },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Ford", model: "F-250 Super Duty", trim: "Lariat" },
    bodyClass: "Pickup",
    mechanical: { engine: "6.7 HI Output Power Stroke", transmission: "10-Speed Auto TorqShift", drivetrain: "4X4" },
    pricing: { baseMsrp: 65840, destinationCharge: 2795, optionsTotal: 21300, totalMsrp: 89935 },
    packages: [
      { name: "Preferred Equipment Pkg.608A", code: null, msrp: null, contents: [] },
      { name: "Black Appearance Package", code: null, msrp: 4295, contents: ["LT275/65R20E BSW All-Terrain", "Wheel Well Liners - Rear", "Hi Gloss Black Alum Wheels-20", "Tough Bed Spray in Bedliner"] },
      { name: "FX4 Off-Road Package", code: null, msrp: 600, contents: ["Skid Plates"] },
    ],
    options: [
      { name: "6.7 HI Output Power Stroke", code: null, msrp: 13495 },
      { name: "10-Speed Auto TorqShift", code: null, msrp: null, included: true },
      { name: "3.31 Electronic-Locking Axle", code: null, msrp: 430 },
      { name: "Front License Plate Bracket", code: null, msrp: null, included: true },
      { name: "11100# GVWR Package", code: null, msrp: null, included: true },
      { name: "Rapid Heat Supplemental Heater", code: null, msrp: 350 },
      { name: "Engine Block Heater", code: null, msrp: 250 },
      { name: "50 State Emissions", code: null, msrp: null, included: true },
      { name: "Power Sliding Rear Window", code: null, msrp: 505 },
      { name: "SiriusXM W/360L (3 Mos Trial)", code: null, msrp: null, included: true },
      { name: "5th Wheel Hitch Prep Package", code: null, msrp: 750 },
      { name: "High Capacity Trailer Tow Pkg", code: null, msrp: null, included: true },
      { name: "Jack", code: null, msrp: null, included: true },
      { name: "Upfitter Switches", code: null, msrp: 250 },
      { name: "410 Amp Dual Alternator", code: null, msrp: null, included: true },
      { name: "Tailgate Step", code: null, msrp: 375 },
      { name: "Dual Battery", code: null, msrp: null, included: true },
      { name: "Conn Pkg: 1 Yr Incl W/Ford App", code: null, msrp: null, included: true },
    ],
    standardEquipment: {
      Exterior: [
        "Headlamps - Auto High Beam", "Headlamps - Autolamp (On/Off)", "LED Reflector Headlamps", "Pickup Box, Tie Down Hooks", "Power Tailgate Lock",
        "Powerscope TT Power-Fold Mirrors, Power/Heated", "Rear Window Privacy Glass W/Defrost", "Tow Hooks", "Trailer Brake Controller", "Trailer Sway Control",
        "Wipers - Rain-Sensing",
      ],
      Interior: [
        "12\" Cluster Display", "1Touch Up/Down Dr/Pass Win", "Ambient Lighting-Fixed", "Dual-Zone Electronic Auto Climate Control", "Heated Steering Wheel",
        "Htd/Ventilated Frt Seats", "Outside Temp Display", "Particulate Air Filter", "Power Locks and Windows", "Pwr Driver and Pass Seat", "Tilt/Telescope Str Column",
      ],
      Functional: [
        "360-Degree Camera", "5G Modem", "B&O Sound System", "BLIS W/Cross-Traffic Alert", "Electrochromic Mirror", "Ford App",
        "Intelligent Access W/Push Button Start", "Mono Beam Coil Spring Frt Suspension W/Stab Bar", "Pre-Collision Assist W/AEB", "Rear Parking Sensors",
        "Reverse Brake Assist", "SYNC4 W/EVR & 12\" Screen",
      ],
      "Safety/Security": [
        "AdvanceTrac with RSC", "Airbags - Safety Canopy", "Belt-Minder Chime", "Driver/Passenger Air Bags", "LED Ctr High Mnt Stop Lamp",
        "Secure Pkg 1 Yr Included", "SOS Post-Crash Alert Sys", "Tire Pressure Monit Sys",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Oxford White", code: null }, interior: { name: "Black Onyx ActiveX Trimmed", code: null } },
    assembly: { plant: null, city: "Kentucky", country: null },
    transportMethod: "Rail",
    factoryCodes: { dealer: null, emissions: null },
    epa: null,
    safety: null,
    nhtsaNotRated: true,
    dealerRole: "original_delivery",
    dealer: { name: "Capitol Ford", address: "4490 Cerrillos Road", city: "Santa Fe", state: "NM", zip: "87507", phone: null },
    warranty: {
      basic: "3YR/36,000 Bumper / Bumper", powertrain: "5YR/60,000 Powertrain; 5YR/100,000 Diesel Engine",
      corrosion: null, roadside: "5YR/60,000 Roadside Assist", emissions: null,
    },
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
