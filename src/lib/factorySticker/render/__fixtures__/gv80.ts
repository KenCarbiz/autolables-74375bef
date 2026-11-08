// Test inputs for the Genesis GV80 gasoline template.
//
// gv80Listing(): the one saved Genesis record with a decoded build sheet
// (read-only extract of vehicle_listings), a 2024 G70 sedan. Production has no
// GV80, so it is used only as an off-year, other-model layout stress test, not
// a production candidate.
// gv80ReferenceMatchData(): the OEM reference sticker's own transcribed values,
// for side-by-side visual comparison with the reference PDF ONLY. Never use it
// as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type Gv80Listing = CatalogListing;
export const gv80Listing = (): Gv80Listing => recordListing("genesisRecord.fixture.json");
export const gv80RenderData = (listing: Gv80Listing = gv80Listing()): FactoryStickerRenderData => recordRenderData(listing);

export const GV80_REFERENCE_VIN = "KMUHEESC1TU295029";

export function gv80ReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: GV80_REFERENCE_VIN,
    barcodePayload: GV80_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Genesis", model: "GV80", trim: "3.5T Prestige" },
    bodyClass: "SUV",
    mechanical: { engine: "3.5L Twin-Turbo V6", transmission: "8-speed Automatic Transmission", drivetrain: "AWD" },
    pricing: { baseMsrp: 82330, destinationCharge: 1495, optionsTotal: 1590, totalMsrp: 85415 },
    packages: [],
    options: [
      { name: "SAVILE SILVER(SSS) Paint", code: null, msrp: 650 },
      { name: "First Aid Kit", code: null, msrp: 65 },
      { name: "NFC Key Card", code: null, msrp: 30 },
      { name: "Bumper Applique", code: null, msrp: 90 },
      { name: "Side Steps", code: null, msrp: 755 },
    ],
    standardEquipment: {
      "Advanced Safety Technology": [
        "Forward Collision-Avoidance Assist", "Lane Keeping Assist", "Lane Following Assist", "Driver Attention Warning", "Forward Attention Warning",
        "Blind-Spot Collision-Avoidance Assist", "Blind-Spot View Monitor", "Rear Cross-Traffic Collision-Avoidance Assist", "Parking Distance Assist",
        "Parking Collision-Avoidance Assist", "Safe Exit Assist", "Advanced Rear Occupant Alert",
      ],
      "Powertrain Technology": ["3.5L Twin-Turbo V6", "All-Wheel Drive with Terrain Mode", "8-speed Automatic Transmission", "Electronically Controlled Suspension"],
      Exterior: ["Panoramic Sunroof", "Power Hands-Free Smart Liftgate w/ Auto Open", "Auto-dimming Power-folding Outside Mirrors w/ Genesis Logo Puddle Lamps"],
      "Comfort & Convenience": [
        "Power Folding 3rd Row", "Premium Finish Trim", "Premium Upper Instrument Panel", "Carpeted Floor Mats", "Power Front Seats with 4-Way Power Lumbar",
        "Power Cushion Extension, Bolster, and Ergo-Motion (Driver)", "Heated & Ventilated Front Seats", "Heated 2nd Row Seats (outboard)",
        "Heated Power Tilt & Telescoping Steering Wheel", "4-Zone Climate Control with Rear Controls", "Mood Curator", "Smart Cruise Control",
        "Highway Driving Assist", "Surround View Monitor", "Remote Smart Parking Assist", "Head-Up Display",
      ],
      "Multimedia & Connectivity": [
        "27\" OLED Instrument Cluster & Navigation", "SiriusXM Radio w/ 90-day trial subscription", "Wireless Apple CarPlay & Android Auto",
        "Bang & Olufsen Premium Audio", "Genesis Digital Key", "Wireless Device Charger - Front",
      ],
      "3.5T Prestige Features": [
        "22-inch Alloy Wheels", "Nappa Leather Seating Surfaces", "Microfiber Suede Headliner & Pillars", "Ventilated 2nd Row Seats (outboard)",
        "Heated Front Console Armrest", "Soft-Close Doors / Power Rear Side Sunshades", "Digital Rearview Mirror", "Active Noise Control",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "SAVILE SILVER", code: null }, interior: { name: "BORDEAUX BROWN/SLATE", code: null } },
    assembly: { plant: null, city: "Ulsan", country: "Korea" },
    transportMethod: "Truck",
    factoryCodes: { dealer: "CA701", emissions: "This vehicle is certified to meet emission requirements in all 50 states" },
    epa: {
      city: 16, highway: 22, combined: 19, annualFuelCost: 3300, ghgScore: 4, smogScore: 5, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 5.3, co2TailpipeGpm: 473, fiveYearCostDifference: -8000,
      classNote: "Standard SUVs range from 14 to 115 MPGe. The best vehicle rates 146 MPGe.",
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: "original_delivery",
    dealer: { name: "Genesis of Palm Springs", address: "4057 E Palm Canyon Dr", city: "Palm Springs", state: "CA", zip: "92264", phone: null },
    warranty: {
      basic: "5-year/60,000-mile New Vehicle Warranty", powertrain: "10-year/100,000-mile Powertrain Warranty",
      corrosion: "7-year/Unlimited-mile Anti-perforation Warranty", roadside: null, emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "3%" },
      { label: "Major Sources of Foreign Parts Content", value: "Korea: 80%" },
      { label: "Engine", value: "Korea" },
      { label: "Transmission", value: "Korea" },
    ],
    generic: false,
    disclaimers: [],
  };
}
