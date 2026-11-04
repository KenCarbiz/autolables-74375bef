// Test inputs for the Jeep Wrangler gasoline template.
//
// wranglerListing(): the one saved 2023 Wrangler record (read-only extract of
// vehicle_listings). Production has no 2026 Wrangler, so it is used only as an
// off-year layout stress test (2023 record), not a production candidate.
// wranglerReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForSticker } from "../../../../../supabase/functions/factory-sticker-orchestrate/normalize.ts";
import type { FactoryStickerRenderData } from "../contract.ts";
import { canonicalPassportUrl } from "../../reproduction.ts";

interface WranglerRecord {
  vin: string;
  slug: string;
  ymm: string;
  trim: string;
  condition: string;
  body_type: string;
  build_sheet: Record<string, unknown>;
  epa_economy: Record<string, unknown>;
}

export type WranglerListing = Record<string, unknown> & { vin: string; slug: string };

export function wranglerListing(): WranglerListing {
  const r = JSON.parse(readFileSync(join(__dirname, "wranglerRecord.fixture.json"), "utf8")) as WranglerRecord;
  return {
    vin: r.vin, slug: r.slug, ymm: r.ymm, trim: r.trim, condition: r.condition,
    mc_attributes: { body_type: r.body_type, build_sheet: r.build_sheet },
    epa_economy: r.epa_economy,
  };
}

export function wranglerRenderData(listing: WranglerListing = wranglerListing()): FactoryStickerRenderData {
  return normalizeForSticker(listing, {}, canonicalPassportUrl(listing.slug), "Factory Window Sticker").data;
}

export const WRANGLER_REFERENCE_VIN = "1C4RJXSJ5TW323044";

export function wranglerReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: WRANGLER_REFERENCE_VIN,
    barcodePayload: WRANGLER_REFERENCE_VIN,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Jeep", model: "Wrangler 4-Door", trim: "Willys 392" },
    bodyClass: "SUV",
    mechanical: { engine: "6.4L V8 SRT HEMI MDS Engine", transmission: "8-Speed Automatic 8HP75 Transmission", drivetrain: "4WD" },
    pricing: { baseMsrp: 69995, destinationCharge: 1995, optionsTotal: 2490, totalMsrp: 74480 },
    packages: [{
      name: "Customer Preferred Package 27T", code: "27T", msrp: 1895,
      contents: ["Black 3-Piece Hard Top", "Rear Window Defroster", "Rear Window Wiper / Washer", "Freedom Panel Storage Bag"],
    }],
    options: [{ name: "Anvil Clear-Coat Exterior Paint", code: null, msrp: 595 }],
    standardEquipment: {
      "Functional/Safety Features": [
        "Hood with Air-Intake Scoop", "Integrated Off-Road Camera", "Off-Road Plus Mode", "2.72:1 Selec-Trac Full-Time 4WD System",
        "3rd Generation Heavy-Duty Dana 44 Front Axle", "Dana M220 Wide Full-Floating Rear Axle", "4.56 Rear Axle Ratio",
        "Tru-Lok Rear Axle", "Transfer Case Skid-Plate Shield", "Rock-Protection Sill Rails", "ParkSense Rear Park-Assist System",
        "Blind-Spot and Cross-Path Detection", "Adaptive Cruise Control with Stop", "Full-Speed Forward-Collision Warning Plus",
        "Steering-Wheel-Mounted Shift Control", "Front Door Passive Entry and Lock", "Supplemental Side Air Bags",
        "Windshield with Corning Gorilla Glass", "Acoustic Laminated Front Door Glass", "Receiver Hitch", "7-Pin and 4-Pin Wiring Harness",
      ],
      "Interior Features": [
        "Willys 392 Swing Gate Plaque", "Uconnect 5 Nav with 12.3-Inch Touch Screen Display", "Alpine Premium Audio System",
        "Apple CarPlay", "Google Android Auto", "SiriusXM 360L with 3-Month Sub Call 800-643-2112",
        "Jeep Connect (Connected Services) w/ Trial", "4G LTE Wi-Fi Hot Spot", "Integrated Voice Command",
        "7-Inch Driver Information Digital Cluster Display", "Full-Function Media Hub with 2-USB Plus Aux-Port",
        "115-Volt Auxiliary Power-Outlet", "8-Way Power Adjustable Driver Seat", "8-Way Power Adjustable Front Passenger Seat",
        "4-Way Power Lumbar Adjustable Driver Seat", "4-Way Power Lumbar Adjustable Front Passenger Seat", "Heated Front Seats",
      ],
      "Exterior Features": [
        "17-Inch x 8.0-Inch Machined Wheels w/ Black Pockets", "35-Inch LT315/70R17C 113/110S Tires", "Hinge-Gate Reinforcement by Mopar",
        "LED Front Fog Lamps", "LED Premium Reflector Headlamps", "Integrated Window Antenna",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Anvil Clear-Coat Exterior Paint", code: null }, interior: { name: "Black Interior Color", code: null } },
    assembly: { plant: null, city: "Toledo, Ohio", country: "U.S.A." },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 13, highway: 16, combined: 14, annualFuelCost: 4450, ghgScore: 2, smogScore: 1, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 7.1, co2TailpipeGpm: 633, fiveYearCostDifference: -13750,
      classNote: "Small SUV 4WD range from 14 to 138 MPGe. The best vehicle rates 146 MPGe.",
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "3-year or 36,000-mile Basic Limited Warranty.", powertrain: "5-year or 60,000-mile Powertrain Limited Warranty.",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "68%" },
      { label: "Major Sources of Foreign Parts Content", value: "Mexico: 18%" },
      { label: "Engine", value: "Mexico" },
      { label: "Transmission", value: "Germany" },
    ],
    generic: false,
    disclaimers: [],
  };
}
