// Test inputs for the Chrysler Voyager gasoline template.
//
// voyagerListing(): the one saved Chrysler minivan record (read-only extract
// of vehicle_listings), a 2014 Town & Country. Production has no 2026
// Voyager, so it is used only as an off-year, other-model layout stress test,
// not a production candidate.
// voyagerReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForSticker } from "../../../../../supabase/functions/factory-sticker-orchestrate/normalize.ts";
import type { FactoryStickerRenderData } from "../contract.ts";
import { canonicalPassportUrl } from "../../reproduction.ts";

interface VoyagerRecord {
  vin: string;
  slug: string;
  ymm: string;
  trim: string;
  condition: string;
  body_type: string;
  build_sheet: Record<string, unknown>;
  epa_economy: Record<string, unknown>;
  mc_extra: Record<string, unknown>;
}

export type VoyagerListing = Record<string, unknown> & { vin: string; slug: string };

export function voyagerListing(): VoyagerListing {
  const r = JSON.parse(readFileSync(join(__dirname, "voyagerRecord.fixture.json"), "utf8")) as VoyagerRecord;
  return {
    vin: r.vin, slug: r.slug, ymm: r.ymm, trim: r.trim, condition: r.condition,
    mc_attributes: { body_type: r.body_type, build_sheet: r.build_sheet, ...r.mc_extra },
    epa_economy: r.epa_economy,
  };
}

export function voyagerRenderData(listing: VoyagerListing = voyagerListing()): FactoryStickerRenderData {
  return normalizeForSticker(listing, {}, canonicalPassportUrl(listing.slug), "Factory Window Sticker").data;
}

export const VOYAGER_REFERENCE_VIN = "2C4RC1CG9TR284610";

export function voyagerReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: VOYAGER_REFERENCE_VIN,
    barcodePayload: VOYAGER_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Chrysler", model: "Voyager", trim: "LX" },
    bodyClass: "Minivan",
    mechanical: { engine: "3.6L V6 24V VVT Engine with Stop/Start", transmission: "9-Speed Automatic Transmission", drivetrain: null },
    pricing: { baseMsrp: 41395, destinationCharge: 1995, optionsTotal: 890, totalMsrp: 44280 },
    packages: [{
      name: "Customer Preferred Package 27E", code: "27E", msrp: 395,
      contents: ["Inflatable Spare Tire Kit", "17-Inch Inflatable Spare Tire"],
    }],
    options: [{ name: "Red Hot Pearl-Coat Exterior Paint", code: null, msrp: 495 }],
    standardEquipment: {
      "Functional/Safety Features": [
        "Advanced Multistage Front Air Bags", "Driver Inflatable Knee-Bolster Air Bag", "Passenger Inflatable Knee-Bolster Air Bag",
        "Supplemental Side-Curtain All-Rows Air Bags", "Supplemental Front Seat-Mounted Side Air Bags", "LATCH-Ready Child-Seat Anchor System",
        "ParkView Rear Back-Up Camera", "Electronic Stability Control", "Blind-Spot and Rear Cross-Path Detection", "Lane-Departure Warning Plus",
        "Pedestrian Emergency Braking", "Full-Speed Forward-Collision Warning Plus", "Hill-Start Assist", "ParkSense Rear Park-Assist with Stop",
        "Adaptive Cruise Control with Stop and Go", "Rear-Seat Reminder Alert", "Remote Start System", "Security Alarm", "19-Gallon Fuel Tank",
      ],
      "Interior Features": [
        "Uconnect 5 with 10.1-Inch Touch Screen Display", "Google Android Auto", "Apple CarPlay", "2nd and 3rd-Row Stow 'n Go Seats with Easy-Tilt",
        "3rd-Row Stow 'n Go 60 / 40 Bench", "8-Way Power Adjustable Driver Seat", "2nd-Row In-Floor Storage Bins", "2nd-Row Power Windows",
        "Steering-Wheel-Mounted Audio Controls", "Tilt / Telescope Steering Column", "Front Floor Mats", "6 Speakers",
        "SiriusXM with 3-Month Radio Sub Call 800-643-2112", "4G LTE Wi-Fi Hot Spot", "Power Liftgate", "Power Sliding Doors",
        "Heated Front Seats", "Heated Steering Wheel", "Chrysler Connect (Connected Services) with Trial",
      ],
      "Exterior Features": [
        "17-Inch x 7.0-Inch Aluminum Wheels", "235/65R17 BSW All-Season Tires", "Rain-Sensitive Windshield Wipers", "Halogen Headlamps",
        "High-Beam Daytime Running Headlamps", "Exterior Mirrors with Heating Element", "Remote Proximity Keyless Entry for All Doors",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Red Hot Pearl-Coat Exterior Paint", code: null }, interior: { name: "Black / Black / Black Interior Colors", code: null } },
    assembly: { plant: null, city: "Windsor, Ontario", country: "Canada" },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 19, highway: 28, combined: 22, annualFuelCost: 2250, ghgScore: 4, smogScore: 5, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 4.5, co2TailpipeGpm: 401, fiveYearCostDifference: -2750,
      classNote: "Minivan range from 20 to 83 MPGe. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: 5, frontalDriver: 5, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: 4 },
    nhtsaNotRated: false,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "3-year or 36,000-mile Basic Limited Warranty.", powertrain: "5-year or 60,000-mile Powertrain Limited Warranty.",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "69%" },
      { label: "Major Sources of Foreign Parts Content", value: "Mexico: 21%" },
      { label: "Engine", value: "Mexico" },
      { label: "Transmission", value: "United States" },
    ],
    generic: false,
    disclaimers: [],
  };
}
