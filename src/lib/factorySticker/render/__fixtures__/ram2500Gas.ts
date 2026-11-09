// Test inputs for the Ram 2500 gasoline template.
//
// ram2500GasListing(): the saved 2022 Ram 2500 Tradesman (6.4L gasoline V8)
// record shared with the diesel template. It is the same model line in another
// model year, so it is a layout stress test, not a production candidate.
// ram2500GasReferenceMatchData(): the verified Stellantis label for a 2026 Ram
// 2500 Big Horn Crew Cab 4X4 (VIN 3C6UR5DJ7TG302125), transcribed for
// side-by-side visual comparison with the reference PDF ONLY. Never use it as a
// default or for any other vehicle. Printed total $66,355 = base $57,155 +
// options $6,605 + destination $2,595.

import type { FactoryStickerRenderData } from "../contract.ts";
import { ram2500Listing, ram2500RenderData, type Ram2500Listing } from "./ram2500.ts";

export const RAM2500_GAS_REFERENCE_VIN = "3C6UR5DJ7TG302125";

export const ram2500GasListing = (): Ram2500Listing => ram2500Listing();
export const ram2500GasRenderData = (listing: Ram2500Listing = ram2500GasListing()): FactoryStickerRenderData => ram2500RenderData(listing);

export function ram2500GasReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: RAM2500_GAS_REFERENCE_VIN,
    barcodePayload: RAM2500_GAS_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null, fuelType: "Unleaded" },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "RAM", model: "2500", trim: "Big Horn Crew Cab" },
    bodyClass: "Pickup",
    mechanical: { engine: "6.4L V8 HEMI HD Engine", transmission: "8-Speed Automatic 8HP75-LCV Transmission", drivetrain: "4X4" },
    pricing: { baseMsrp: 57155, destinationCharge: 2595, optionsTotal: 6605, totalMsrp: 66355 },
    packages: [
      { name: "Customer Preferred Package 2UZ", code: null, msrp: null, contents: [] },
      { name: "5th Wheel / Gooseneck Towing Prep Group", code: null, msrp: 745, contents: [] },
      {
        name: "Big Horn Level 2 Equipment Group", code: null, msrp: 3035,
        contents: [
          "Dual Wireless Charging Pad", "Fold-Flat Load Floor Storage", "Red Tail Lamp Bezels", "Luxury Steering Wheel", "Sun Visors with Illuminated Vanity Mirrors",
          "Glove Box Lamp", "Premium Cloth Bucket Seats", "Exterior 115V AC Outlet", "2nd-Row In-Floor Storage Bins", "Power Heat/Fold/Telescoping Mirrors",
          "Power Telescoping Mirrors", "Automatic Power-Folding Mirrors", "Heated Front Seats", "Anti-Spin Differential Rear Axle", "Rear Power-Sliding Window",
          "8-Way Power Adjustable Driver Seat", "Forward and Reverse Utility Lights", "Heated Steering Wheel", "9 Alpine Speakers with Subwoofer",
          "Steering-Wheel-Mounted Audio Controls", "Blind-Spot with Tag-Trailer & Cross-Path Detection", "Remote-Start System", "400W Inverter",
        ],
      },
    ],
    options: [
      { name: "Molten Red Pearl-Coat Exterior Paint", code: null, msrp: 295 },
      { name: "Front and Rear Rubber Floor Mats by Mopar", code: null, msrp: 235 },
      { name: "Clearance Lamps", code: null, msrp: 180 },
      { name: "Rear Wheelhouse Liners", code: null, msrp: 195 },
      { name: "20-Inch x 8.0-Inch Polished Aluminum Wheels", code: null, msrp: 1695 },
      { name: "MyFlexCare Service (See Dealer for Details)", code: null, msrp: 225 },
    ],
    standardEquipment: {
      "Functional/Safety Features": [
        "Adaptive Cruise Control with Stop", "Pedestrian / Cyclist Emergency Braking", "Full-Speed Forward-Collision Warning Plus",
        "ParkSense Front and Rear Park-Assist System", "Advanced Multistage Front Air Bags", "Electric Shift-On-The-Fly Transfer Case", "Electronic Stability Control",
        "Hill-Start Assist", "Trailer Brake Controller", "Sentry Key Theft Deterrent System", "Remote Keyless-Entry", "Tire Pressure Monitoring Display",
        "Selectable Tire-Fill Alert", "Tailgate-Ajar Warning-Lamp", "220-Amp Alternator",
      ],
      "Interior Features": [
        "Uconnect 5 with 8.4-Inch Touch Screen Display", "Google Android Auto", "Apple CarPlay", "SiriusXM with 3-Month Radio Sub Call 800-643-2112",
        "Ram Connect (Connected Services) with Trial", "4G LTE Wi-Fi Hot Spot", "Integrated Voice Command", "Full-Function Media Hub with 2-USB Plus Aux Port",
        "40/20/40 Split Bench Seat", "Power Front Windows with 1-Touch Up / Down", "Front and Rear Floor Mats",
      ],
      "Exterior Features": [
        "18-Inch x 8.0-Inch Polished Aluminum Wheels", "LT275/70R18E BSW All-Season Tires", "LED Low/High Reflector Headlamps", "Front LED Fog Lamps",
        "Pwr Adj Heated TT Mirrors w/ Manual Fold/Telescope", "31-Gallon Fuel Tank", "Full-Size Spare Tire", "Locking Tailgate", "Class V Receiver-Hitch",
        "7-Pin Wiring Harness", "Trailer-Tow with 4-Pin Connector Wiring", "Tailgate-Handle LED Hitch Lamp", "Automatic Headlamps",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Molten Red Pearl-Coat Exterior Paint", code: null }, interior: { name: "Black Interior Color", code: null } },
    assembly: { plant: null, city: "Saltillo", country: "Mexico" },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: null,
    safety: { overall: 4, frontalDriver: 4, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: 3 },
    nhtsaNotRated: false,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "3-year or 36,000-mile Basic Limited Warranty.", powertrain: "10-year or 100,000-mile Powertrain Limited Warranty (Retail Purchases).",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
