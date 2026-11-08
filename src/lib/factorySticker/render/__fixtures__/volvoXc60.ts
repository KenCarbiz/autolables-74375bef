// Test inputs for the Volvo XC60 B5 template.
//
// volvoXc60Listing(): a saved Volvo XC60 record with a decoded build sheet
// (read-only extract of vehicle_listings), a 2022 XC60 Momentum (B5 mild
// hybrid). The template's reference is a 2025 sticker, so it is used only as an
// off-year layout stress test, not a production candidate.
// volvoXc60ReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type VolvoXc60Listing = CatalogListing;
export const volvoXc60Listing = (): VolvoXc60Listing => recordListing("volvoXc60Record.fixture.json");
export const volvoXc60RenderData = (listing: VolvoXc60Listing = volvoXc60Listing()): FactoryStickerRenderData => recordRenderData(listing);

export const VOLVO_XC60_REFERENCE_VIN = "YV4M12RC2S1102787";

export function volvoXc60ReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: VOLVO_XC60_REFERENCE_VIN,
    barcodePayload: VOLVO_XC60_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2025", make: "Volvo", model: "XC60", trim: "B5 AWD Plus" },
    bodyClass: "SUV",
    mechanical: { engine: "2.0L Turbo-Charged, Direct Injected Engine", transmission: "8-Speed Geartronic Automatic Trans w/ Start-Stop", drivetrain: "AWD" },
    pricing: { baseMsrp: 51700, destinationCharge: 1295, optionsTotal: 1150, totalMsrp: 54145 },
    packages: [{ name: "Climate Package", code: null, msrp: 750, contents: [] }],
    options: [
      { name: "Mud Flaps: Front & Rear*", code: null, msrp: 225 },
      { name: "Bumper Cover - Stainless Steel*", code: null, msrp: 175 },
    ],
    standardEquipment: {
      Performance: [
        "2.0L Turbo-Charged, Direct Injected Engine", "8-Speed Geartronic Automatic Trans w/ Start-Stop", "247 HP and 266 lb-ft Torque",
        "48V Mild Hybrid System with Regenerative Braking & Integ. Starter Generator with 13 HP", "Anti-Lock Braking System (ABS)",
        "Advanced Electronic Stability Control (ESC)", "Electric Power Assisted Steering", '19" Diamond Cut Alloy Wheel with All Season Tires',
      ],
      "Audio & Technology": [
        '12.3" Digital Driver Display', "USB-C Ports, 2 Front + 2 Rear", "Bluetooth Connectivity",
        "Digital Services Package 4-Yr Subscription includes: Google built-in with Google Maps, Google Play Store & Google Assistant",
        "Volvo Cars Remote App Services Remote Start and Remote Lock/Unlock", "Road Sign Information", "Over-the-Air Updates", "Apple CarPlay",
        "SiriusXM Radio with Trial Subscription", "High Performance Sound",
      ],
      "Safety & Security": [
        "LED Headlights with DRL, AHB, and ABL", "BLIS: Blind Spot Information System with Steer Assist and Cross Traffic Alert",
        "Collision Avoidance featuring: Low & High Speed Collision Mitigation Detects Vehicle/Pedestrian/Cyclist/Large Animal",
        "Oncoming Mitigation by Braking", "Driver Alert Control", "Front, Side & Curtain Airbags with Driver Side Knee Airbag",
        "Whiplash Protection System (WHIPS) in Front Seats", "Pilot Assist: Driver Assistance System with Adaptive Cruise Control",
        "Automatic Unlocking after Collision", "Lane Keeping Aid", "Forward Collision Warning", "Post Impact Braking", "Tempa Spare Wheel including Jack Kit",
      ],
      "Luxury & Convenience": [
        "Laminated Panoramic Sunroof with Power Sunshade", "Leather or Leatherette (RD00 or UE00) Upholstery Seating Surfaces",
        "Keyless entry with hands-free power tailgate opening and closing", "Heated Front Seats", "High-Gloss Black Mesh Grille and Lower Outer Grille",
        "High-Gloss Black Window Trim, Mirror Caps & Grill Frame", "Fully color adapted sills and bumpers", "Glossy Black Integrated Roof Rails",
        "Retractable Rear View Mirrors", "2-Way Power Lumbar Support, Front Seats", "Power Front Seats with Driver Seat Memory", "Air Purifier", "Homelink",
        "2-Zone Automatic Climate Control", "Laminated Glass, Side Door Windows", "360 Surround View Camera",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Denim Blue", code: null }, interior: { name: "Maroon Brown Leather", code: null } },
    assembly: { plant: null, city: "Torslanda", country: "Sweden" },
    transportMethod: "Truck",
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 23, highway: 30, combined: 26, annualFuelCost: 2450, ghgScore: 5, smogScore: 6, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 3.8, co2TailpipeGpm: 343, fiveYearCostDifference: -2750,
      classNote: "Small Sport Utility Vehicles range from 14 to 118 MPG. The best vehicle rates 140 MPGe.",
    },
    safety: { overall: 5, frontalDriver: 5, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: 4 },
    nhtsaNotRated: false,
    dealerRole: "original_delivery",
    dealer: { name: "Kundert Volvo Hasbr 3438", address: "315 West Pleasantview Ave.", city: "Hackensack", state: "NJ", zip: "07601", phone: null },
    warranty: {
      basic: "48 Month/50,000 Mile Limited Warranty Coverage", powertrain: null,
      corrosion: '144 Month Corrosion Protection "Unlimited Mileage"', roadside: "Volvo Roadside Assistance Plus valid through 48 Month/50,000 Mile", emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "0%" },
      { label: "Major Sources of Foreign Parts Content", value: "Sweden: 40%" },
      { label: "Engine", value: "Sweden" },
      { label: "Transmission", value: "Japan" },
    ],
    generic: false,
    disclaimers: [],
  };
}
