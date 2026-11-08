// Test inputs for the Chevrolet Silverado 2500 diesel template.
//
// silveradoListing(): the one saved large Chevrolet with a decoded build sheet
// (read-only extract of vehicle_listings), a 2023 Tahoe Z71. Production has no
// Silverado 2500, so it is used only as an off-year, other-model layout stress
// test, not a production candidate.
// silveradoReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY. Never
// use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type SilveradoListing = CatalogListing;
export const silveradoListing = (): SilveradoListing => recordListing("silveradoRecord.fixture.json");
export const silveradoRenderData = (listing: SilveradoListing = silveradoListing()): FactoryStickerRenderData => recordRenderData(listing);

export const SILVERADO_REFERENCE_VIN = "1GC4KREY2TF289348";

export function silveradoReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: SILVERADO_REFERENCE_VIN,
    barcodePayload: SILVERADO_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null, fuelType: "Diesel" },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Chevrolet", model: "Silverado 2500", trim: "High Country" },
    bodyClass: "Pickup",
    mechanical: { engine: "Duramax 6.6L Turbo-Diesel", transmission: "Allison 10-Speed Auto", drivetrain: "4WD" },
    pricing: { baseMsrp: 73600, destinationCharge: 2795, optionsTotal: 16559, totalMsrp: 92954 },
    packages: [
      { name: "Technology Package", code: null, msrp: 1340, contents: ["Rear Camera Mirror", "Head-Up Display"] },
      { name: "Z71 Off-Road Package", code: null, msrp: 325, contents: ["Off-Road Suspension Including Twin Tube Shocks", "Hill Descent Control", "Skid Plates"] },
    ],
    options: [
      { name: "ENG: Duramax 6.6L Turbo-Diesel", code: null, msrp: 9990 },
      { name: "Power Retractable Assist Steps with Perimeter Lighting", code: null, msrp: 1500 },
      { name: "Power Sunroof", code: null, msrp: 995 },
      { name: "Polar White Tricoat", code: null, msrp: 995 },
      { name: "3 Years OnStar One Subject to Terms: Info at OnStar.com/Plans", code: null, msrp: 800 },
      { name: "3 Years, SiriusXM (Non-Transferable) See SiriusXM.com/Terms", code: null, msrp: 299 },
      { name: "Multi-Flex Tailgate", code: null, msrp: 260 },
      { name: "LED Roof Marker Lamps", code: null, msrp: 55 },
      { name: "Rear Axle: 3.42 Ratio", code: null, msrp: null, included: true },
    ],
    standardEquipment: {
      "Owner Benefits": [
        "3 Year / 36,000 Mile* Bumper-to-Bumper Limited Warranty",
        "5 Year / 100,000 Mile* Powertrain Limited Warranty, Roadside Assistance & Courtesy Transportation",
        "First Maintenance Visit",
      ],
      "Safety & Security": [
        "Automatic Emergency Braking", "Forward Collision Alert", "Front Pedestrian Braking", "Lane Departure Warning", "Following Distance Indicator", "IntelliBeam",
        "Rear Cross Traffic Alert", "Trailer Side Blind Zone Alert", "Safety Alert Seat", "Buckle to Drive", "Teen Driver Mode",
      ],
      "Performance & Mechanical": [
        "Auto-Locking Rear Diff", "AutoTrac Transfer Case", "220 Amp Alternator", "Dig. Variable Steering Assist", "All-Terrain Tires",
        "Trailering Package with Hitch Guidance", "Trailer Brake Controller",
      ],
      "Connectivity & Technology": [
        "Chevy Infotainment 3 Premium 13.4\" Diag HD Color Touchscreen w/Google Built-In Compatibility Including Nav Capability, Bluetooth for Most Phones",
        "Wireless Apple CarPlay & Wireless Android Auto for Compatible Phones", "8 Years OnStar Basics See OnStar.com for Terms",
        "SiriusXM Radio Capable, Trial Included with Subscription Sold Separately", "Bose Premium Sound System", "HD Surround Vision",
        "120V Interior and Cargo Bed Power Outlets", "Driver Information Center 12.3\" Diag Display", "Keyless Open & Start", "Remote Start",
        "Universal Home Remote", "Wireless Charging", "Push Button Start",
      ],
      Interior: [
        "Dual Zone Climate Control", "Front Bucket Seats", "Ventilated Front Seats", "Heated Front Seats", "10-Way Power Seats",
        "60/40 Rear Folding Bench Seat with Storage Package", "Driver Seat & Mirror Memory", "Heated & Wrapped Steering Wheel",
      ],
      Exterior: [
        "Chevytec Spray-On Bedliner", "Cornerstep Rear Bumper", "Power Adjustable Heated Trailering Mirrors", "Animated LED Headlamps with LED Daytime Running Lamps",
        "LED Fog Lamps", "Power Rear Sliding Window", "Rain Sensing Wipers",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Polar White Tricoat", code: null }, interior: { name: "Jet Black / Umber", code: null } },
    assembly: { plant: null, city: "Flint, MI", country: "U.S.A." },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: null,
    safety: null,
    nhtsaNotRated: true,
    dealerRole: "original_delivery",
    dealer: { name: "Covert Chevrolet Buick GMC", address: "PO Box J", city: "Bastrop", state: "TX", zip: "78602-1977", phone: null },
    warranty: {
      basic: "3 Year / 36,000 Mile* Bumper-to-Bumper Limited Warranty", powertrain: "5 Year / 100,000 Mile* Powertrain Limited Warranty",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
