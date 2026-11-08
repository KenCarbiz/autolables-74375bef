// Test inputs for the Ram 2500 diesel template.
//
// ram2500Listing(): the one saved Ram 2500 record with a decoded build sheet
// (read-only extract of vehicle_listings), a 2022 Ram 2500 Tradesman with the
// 6.4L gasoline V8. It is the same model line in another model year and
// powertrain, so it is used only as a layout stress test, not a production
// candidate.
// ram2500ReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY. Never
// use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type Ram2500Listing = CatalogListing;
export const ram2500Listing = (): Ram2500Listing => recordListing("ramRecord.fixture.json");
export const ram2500RenderData = (listing: Ram2500Listing = ram2500Listing()): FactoryStickerRenderData => recordRenderData(listing);

export const RAM2500_REFERENCE_VIN = "3C63R5SL8TG192914";

export function ram2500ReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: RAM2500_REFERENCE_VIN,
    barcodePayload: RAM2500_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null, fuelType: "Diesel" },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "RAM", model: "2500", trim: "Limited Crew Cab" },
    bodyClass: "Pickup",
    mechanical: { engine: "6.7L I6 Cummins HO Turbo Diesel Engine", transmission: "8-Speed TorqueFlite HD Automatic Transmission", drivetrain: "4X4" },
    pricing: { baseMsrp: 76365, destinationCharge: 2195, optionsTotal: 20165, totalMsrp: 98725 },
    packages: [
      { name: "Customer Preferred Package 24M", code: null, msrp: null, contents: ["3.42 Axle Ratio", "GVW Rating - 11,040 Pounds"] },
      { name: "Chrome Bumper Package", code: null, msrp: 95, contents: ["Bright Rear Bumper", "Bright Front Bumper"] },
      { name: "Tow Technology Plus Group", code: null, msrp: 895, contents: ["Digital Rear-View Mirror with Side Cameras", "Trailer Reverse Steering Control"] },
      {
        name: "Limited Level 1 Equipment Group", code: null, msrp: 4595,
        contents: [
          "Traffic Sign Recognition", "Drowsy Driver Detection", "Active Lane-Management System", "Anti-Spin Differential Rear Axle",
          "Center Stop Lamp with Cargo-View Camera", "Power Deployable Running Boards", "Adaptive Steering System", "Surround-View Camera System",
          "Trailer Tire Pressure Monitoring System", "Spray-In Bedliner by Mopar", "Trailer Reverse Guidance",
        ],
      },
      { name: "6.7L I6 Cummins HO Turbo Diesel Engine", code: null, msrp: 12995, contents: ["3.42 Axle Ratio", "GVW Rating - 11,040 Pounds"] },
    ],
    options: [
      { name: "Diamond Black Crystal Pearl-Coat Exterior Paint", code: null, msrp: 295 },
      { name: "Power Sunroof", code: null, msrp: 1195 },
      { name: "Transfer Case Skid-Plate Shield", code: null, msrp: 95 },
    ],
    standardEquipment: {
      "Functional/Safety Features": [
        "Advanced Multistage Front Air Bags", "Adaptive Cruise Control with Stop", "Pedestrian / Cyclist Emergency Braking", "Full-Speed Forward-Collision Warning Plus",
        "ParkView Rear Back-Up Camera", "ParkSense Front and Rear Park-Assist System", "Electric Shift-On-The-Fly Transfer Case", "Electronic Stability Control",
        "Blind-Spot with Tag-Trailer & Cross-Path Detection", "Emergency Vehicle Alert System", "Remote-Start System", "Sentry Key Theft Deterrent System",
        "Selectable Tire-Fill Alert", "Tailgate-Ajar Warning-Lamp",
      ],
      "Interior Features": [
        "Uconnect 5 Nav with 14.4-Inch Touch Screen Display", "SiriusXM 360L with 3-Month Sub Call 800-643-2112", "Apple CarPlay", "Google Android Auto",
        "Front Passenger Interactive Display", "17-Speaker Harman Kardon Premium Sound", "Dual Wireless Charging Pad", "Cluster with 12-Inch TFT Color Display",
        "A/C with Dual-Zone Auto Temperature Control", "Radio / Driver Seat / Mirrors / Pedals Memory", "Heated Front Seats", "Ventilated Front Seats",
        "8-Way Power Adjustable Driver Seat", "Heated Second-Row Seats", "Heated Steering Wheel",
      ],
      "Exterior Features": [
        "Truck Bed Cargo Divider (Removed w/ 5th Wheel/GN)", "4-Adjustable Cargo Tie-Down Hooks", "Deployable Bed-Step by Mopar", "RamBox Cargo-Mgmt (Removed w/ 5th Wheel/GN)",
        "Power Heat/Fold/Telescoping Memory Mirrors", "20\" x 8.0\" Diamond-Cut Alum Whls w/ Black Pockets", "LT285/60R20E OWL On/Off-Road Tires", "31-Gallon Fuel Tank",
        "Full-Size Spare Tire", "Class V Receiver-Hitch", "Tailgate-Handle LED Hitch Lamp", "Exterior 115V AC Outlet",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Diamond Black Crystal Pearl-Coat Exterior Paint", code: null }, interior: { name: "Black Interior Color", code: null } },
    assembly: { plant: null, city: "Saltillo", country: "Mexico" },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: null,
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "3-year or 36,000-mile Basic Limited Warranty.", powertrain: "5-year or 100,000-mile Powertrain Limited Warranty.",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
