// Test inputs for the Cadillac Escalade IQL electric template.
//
// cadillacListing(): a saved 2026 Tesla Model Y (the only saved 2026 electric
// SUV with a decoded build sheet; read-only extract of vehicle_listings, the
// standard-equipment list trimmed to its first 110 items). Production has no
// Cadillac, so it is used only as an other-make layout stress test, not a
// production candidate.
// cadillacReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY. Never
// use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type CadillacListing = CatalogListing;
export const cadillacListing = (): CadillacListing => recordListing("cadillacRecord.fixture.json");
export const cadillacRenderData = (listing: CadillacListing = cadillacListing()): FactoryStickerRenderData => recordRenderData(listing);

export const CADILLAC_REFERENCE_VIN = "1GYLEMKLXTU107500";

export function cadillacReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: CADILLAC_REFERENCE_VIN,
    barcodePayload: CADILLAC_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Cadillac", model: "Escalade IQL", trim: "Premium Sport" },
    bodyClass: "SUV",
    mechanical: { engine: null, transmission: null, drivetrain: null },
    pricing: { baseMsrp: 151205, destinationCharge: 2895, optionsTotal: 7794, totalMsrp: 161894 },
    packages: [
      { name: "Onyx Package", code: null, msrp: 4295, contents: ["24\" Low Gloss Black Alloy Wheels", "Black Center Caps", "Gloss Black Escalade Nameplate", "Lamps - Perimeter Illumination"] },
    ],
    options: [
      { name: "Vibrant White Tricoat", code: null, msrp: 1325 },
      { name: "Black Roof", code: null, msrp: 1100 },
      { name: "Mobile Service Plus 4YR Plan", code: null, msrp: 799 },
      { name: "GM NACS DC Adapter", code: null, msrp: 275 },
      { name: "Roof Sun Shade", code: null, msrp: null, included: true },
    ],
    standardEquipment: {
      "Owner Benefits": [
        "4 Year/50,000 Mile* Bumper-to-Bumper Limited Warranty",
        "8 Year/100,000 Mile* Electric Vehicle Propulsion Battery Warranty, Roadside Assistance & Courtesy Transportation",
        "Whichever Comes First",
        "First Maintenance Visit",
        "8 Years OnStar Basics",
      ],
      Performance: ["Dual Motor AWD", "4-Wheel Steer w/ Cadillac Arrival Mode", "Air Ride Adaptive Suspension", "Magnetic Ride Control", "Charging Module, 19.2 kW"],
      "Luxury & Convenience": [
        "Super Cruise Equipped, Upgraded to 3 Years OnStar One with Super Cruise",
        "Nouveauluxe Seating",
        "16-Way Power Front Row Seating w/ 8-Way Power, 4-Way Lumbar, 2-Way Shoulder Adjustment, & 2-Way Back Bolster Adjustment",
        "Seats, Heated Front Driver and Passenger Cushion Back with Dual Mode Switches",
        "Seats, Ventilated Driver and Front Passenger",
        "Seat, Drvr & Frt Pass Memory",
        "Seat, Drvr & Frt Pass Massage",
        "Seats, 2nd Row Bucket, Power Release",
        "Seats, Heated 2nd Row Cushion & Back w/Single Mode Switch",
        "Seats, 3rd Row 60/40 Split-Bench, Power Fold",
        "Dual Wireless Charging, Front Row",
        "Power Outlet, 110-Volt",
        "5-Zone HVAC",
        "AKG Studio Reference 38-Speaker Audio",
        "55\" Total Diagonal Curved Screen",
        "Head-Up Display",
        "eTrunk",
        "Heated Wiper Park",
        "Panoramic Fixed Glass Roof",
        "Rear Liftgate w/Independently Operable Rear Lift Glass",
        "Rear Camera Mirror & Washer",
        "Grille, Illuminating",
        "Power Open/Close Doors",
        "Connected Cameras, Non-Functional; Requires Future Software Update",
        "Smart Trailering",
      ],
      "Safety & Security": [
        "Safety Alert Seat", "Enhanced Automatic Emergency Braking", "Front Pedestrian and Bicyclist Braking", "Enhanced Automatic Parking Assist", "Night Vision",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Vibrant White Tricoat", code: null }, interior: { name: "Camelia w/ Backen", code: null } },
    assembly: { plant: null, city: "Detroit, MI", country: "U.S.A." },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: { city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null, rangeMiles: null, fuelType: "Electricity" },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: "original_delivery",
    dealer: { name: "Myrtle Beach Cadillac", address: "PO Box 425", city: "Myrtle Beach", state: "SC", zip: "29578-0425", phone: null },
    warranty: {
      basic: "4 Year/50,000 Mile* Bumper-to-Bumper Limited Warranty", powertrain: "8 Year/100,000 Mile* Electric Vehicle Propulsion Battery Warranty",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
