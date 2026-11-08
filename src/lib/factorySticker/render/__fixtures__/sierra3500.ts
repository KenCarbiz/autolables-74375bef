// Test inputs for the GMC Sierra 3500 diesel template.
//
// sierraListing(): the one saved large GMC with a decoded build sheet
// (read-only extract of vehicle_listings), a 2021 Yukon Denali. Production has no
// Sierra 3500, so it is used only as an off-year, other-model layout stress
// test, not a production candidate.
// sierraReferenceMatchData(): the OEM reference sticker's own transcribed values,
// for side-by-side visual comparison with the reference PDF ONLY. Never use it
// as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type SierraListing = CatalogListing;
export const sierraListing = (): SierraListing => recordListing("sierraRecord.fixture.json");
export const sierraRenderData = (listing: SierraListing = sierraListing()): FactoryStickerRenderData => recordRenderData(listing);

export const SIERRA_REFERENCE_VIN = "1GT4UYEY3TF226179";

export function sierraReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: SIERRA_REFERENCE_VIN,
    barcodePayload: SIERRA_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null, fuelType: "Diesel" },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "GMC", model: "Sierra 3500", trim: "DRW Denali Ultimate" },
    bodyClass: "Pickup",
    mechanical: { engine: "Duramax 6.6L Turbo-Diesel", transmission: "10-Speed Auto", drivetrain: null },
    pricing: { baseMsrp: 101700, destinationCharge: 2795, optionsTotal: 1170, totalMsrp: 105665 },
    packages: [
      { name: "Gooseneck/5th Wheel Package", code: null, msrp: 545, contents: ["Stamped Bed Holes w/Caps", "7-Pin Trailer Harness"] },
    ],
    options: [
      { name: "Onyx Black", code: null, msrp: 495 },
      { name: "Premium Floor Liners", code: null, msrp: 130 },
      { name: "Rear Axle 3.42 Ratio", code: null, msrp: null, included: true },
      { name: "GVWR, 14,000 LBS. (6350 KG)", code: null, msrp: null, included: true },
      { name: "Wheels 18\" Polished Aluminum", code: null, msrp: null, included: true },
    ],
    standardEquipment: {
      "Owner Benefits": [
        "3 Year / 36,000 Mile* Bumper-to-Bumper Limited Warranty",
        "5 Year / 100,000 Mile* Powertrain Limited Warranty, Roadside Assistance & Courtesy Transportation",
        "First Maintenance Visit",
      ],
      "Safety & Security": [
        "Forward Collision Alert", "Following Distance Indicator", "Front Pedestrian Braking", "IntelliBeam", "Lane Departure Warning", "Buckle to Drive",
        "Automatic Emergency Braking", "Safety Alert Seat", "Rear Cross Traffic Alert", "HD Surround Vision", "Front & Rear Park Assist", "Trailer Side Blind Zone Alert",
      ],
      "Performance & Mechanical": [
        "Auto Locking Rear Diff", "2 Spd AutoTrac Transfer Case", "StabiliTrak w/ Trailer Sway Control & Hill Start Assist", "Dig. Variable Steering Assist",
        "All-Terrain Tires", "Trailering Package", "Trailer Brake Controller", "Vehicle Trailering App",
      ],
      "Connectivity & Technology": [
        "Premium GMC Infotainment System 13.4\" Diag Color Touchscreen w/Google Built-In Compatibility Including Nav Capability, Bluetooth for Most Phones",
        "Wireless Apple CarPlay & Wireless Android Auto for Compatible Phones", "8 Years OnStar Basics See OnStar.com for Terms",
        "3 Years OnStar One; Info at OnStar.com/Plans", "SiriusXM Audio with SXM Trial Subscription", "Bose Premium Series 12-Speaker System",
        "Color Driver Info Center 12.3\"", "Bed View Camera", "Open and Start Remote Keyless", "Remote Start", "Wireless Charging",
      ],
      Interior: [
        "16 Way Pwr Front Bucket Seats", "Ventilated Front Seats", "Heated Frt & Rear Outer Seats", "60/40 Rear Folding Bench Seat with Storage Package",
        "Driver Seat & Mirror Memory", "Leather Wrapped Steering Wheel",
      ],
      Exterior: [
        "Power Assist Steps", "Power Fold/Extend & Heated Trailer Mirrors w/Auto-Dim", "LED Fog Lamps", "Chrome Front Recovery Hooks", "Spray-On Bedliner",
        "LED Cargo Area Lighting", "Power Rear Sliding Window", "GMC MultiPro Tailgate", "Roof Marker Lamps", "Headlamps, Animated LED Projectors",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Onyx Black", code: null }, interior: { name: "Alpine Umber", code: null } },
    assembly: { plant: null, city: "Flint, MI", country: "U.S.A." },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: null,
    safety: null,
    nhtsaNotRated: true,
    dealerRole: "original_delivery",
    dealer: { name: "Deacon Jones Autopark, Inc.", address: "PO Box 2280", city: "Smithfield", state: "NC", zip: "27577-2280", phone: null },
    warranty: {
      basic: "3 Year / 36,000 Mile* Bumper-to-Bumper Limited Warranty", powertrain: "5 Year / 100,000 Mile* Powertrain Limited Warranty",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
