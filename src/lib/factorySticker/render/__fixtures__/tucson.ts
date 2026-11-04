// Test inputs for the Hyundai Tucson gasoline template.
//
// tucsonListings(): the two real saved Harte records (read-only extract of
// vehicle_listings), expanded into the listing rows the orchestrator reads.
// referenceMatchData(): the OEM reference sticker's own transcribed values,
// for side-by-side visual comparison with the reference PDF ONLY. Never use
// it as a default or for any other vehicle.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForSticker } from "../../../../../supabase/functions/factory-sticker-orchestrate/normalize.ts";
import type { FactoryStickerRenderData } from "../contract.ts";
import { canonicalPassportUrl } from "../../reproduction.ts";

type Op =
  | { op: "remove"; item: string }
  | { op: "insertFirst"; item: string }
  | { op: "insertAfter" | "insertBefore"; anchor: string; item: string }
  | { op: "replace"; item: string; with: string };

interface TucsonRecord {
  id: string;
  vin: string;
  slug: string;
  ymm: string;
  trim: string;
  condition: string;
  mc_attributes: Record<string, unknown>;
  build_sheet: Record<string, unknown>;
  standardExtra: Record<string, string[]>;
  standardPatch: Op[];
  keyPatch: Op[];
  epa_economy: Record<string, unknown>;
}

interface TucsonFixture {
  sharedStandard: string[];
  sharedKeyFeatures: string[];
  vehicles: TucsonRecord[];
}

const patch = (base: string[], ops: Op[]): string[] => {
  const out = [...base];
  for (const o of ops) {
    if (o.op === "remove") out.splice(out.indexOf(o.item), 1);
    else if (o.op === "insertFirst") out.unshift(o.item);
    else if (o.op === "replace") out[out.indexOf(o.item)] = o.with;
    else out.splice(out.indexOf(o.anchor) + (o.op === "insertAfter" ? 1 : 0), 0, o.item);
  }
  return out;
};

const load = (): TucsonFixture =>
  JSON.parse(readFileSync(join(__dirname, "tucsonRecords.fixture.json"), "utf8")) as TucsonFixture;

export type TucsonListing = Record<string, unknown> & { vin: string; slug: string };

export function tucsonListings(): TucsonListing[] {
  const fx = load();
  return fx.vehicles.map((v) => ({
    vin: v.vin, slug: v.slug, ymm: v.ymm, trim: v.trim, condition: v.condition,
    mc_attributes: {
      ...v.mc_attributes,
      build_sheet: {
        ...v.build_sheet,
        standard: { ...v.standardExtra, STANDARD: patch(fx.sharedStandard, v.standardPatch) },
        key_features: { STANDARD: patch(fx.sharedKeyFeatures, v.keyPatch) },
      },
    },
    epa_economy: v.epa_economy,
  }));
}

export function tucsonRenderData(listing: TucsonListing): FactoryStickerRenderData {
  return normalizeForSticker(listing, {}, canonicalPassportUrl(listing.slug), "Factory Window Sticker").data;
}

export const REFERENCE_MATCH_VIN = "5NMJACDE3TH655783";

export function referenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: REFERENCE_MATCH_VIN,
    barcodePayload: REFERENCE_MATCH_VIN,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    identity: { year: "2026", make: "Hyundai", model: "Tucson", trim: "SE" },
    bodyClass: "SUV",
    mechanical: { engine: "Smartstream 2.5L 4-Cylinder", transmission: "8-Speed Automatic", drivetrain: "AWD" },
    pricing: { baseMsrp: 30700, destinationCharge: 1600, optionsTotal: 825, totalMsrp: 33125 },
    packages: [],
    options: [
      { name: "Carpeted Floor Mats", code: null, msrp: 240 },
      { name: "Cargo Net", code: null, msrp: 60 },
      { name: "First Aid Kit", code: null, msrp: 45 },
      { name: "Tow Hitch", code: null, msrp: 480 },
    ],
    standardEquipment: {
      "Advanced Safety Technologies": [
        "Front, Front Side, Side-Curtain, & Rear Side Airbags", "Forward Collision-Avoidance Assist",
        "Lane Keeping Assist; Lane Following Assist", "Driver Attention Warning", "Blind-Spot Collision Warning",
        "Rear Cross-Traffic Collision-Avoidance Assist", "Rearview Camera", "Immobilizer",
      ],
      "Powertrain Technology": [
        "Smartstream 2.5L 4-Cylinder Engine w/ Idle Stop & Go", "8-Speed Automatic Transmission w/ SHIFTRONIC",
        "HTRAC AWD",
      ],
      Exterior: ["17\" Alloy Wheels; Temporary Spare Tire", "Automatic LED Headlights", "LED Daytime Running Lights"],
      "Comfort & Convenience": ["Proximity Key w/ Push Button Start", "Smart Cruise Control", "Front & Rear USB Ports"],
      "Multimedia & Connectivity": [
        "12.3\" Audio w/ AM/FM/HD Radio", "SiriusXM Radio w/ 90-Day Trial Subscription (not available in AK & HI)",
        "Wireless Android Auto & Apple CarPlay", "Bluelink+ All-inclusive Connected Services (enrollment required)",
        "Full Tank of Fuel",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Shimmering Silver", code: null }, interior: { name: "Black/Black", code: null } },
    assembly: { plant: null, city: "Montgomery, Alabama", country: "U.S.A." },
    transportMethod: "Truck",
    factoryCodes: { dealer: "NY126", emissions: null },
    epa: {
      city: 24, highway: 30, combined: 26, annualFuelCost: 1900, ghgScore: 5, smogScore: 6, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 3.8, co2TailpipeGpm: 337, fiveYearCostDifference: -1000,
      classNote: "Small SUVs range from 14 to 125 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: 5, frontalDriver: 4, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: 4 },
    dealerRole: "original_delivery",
    dealer: { name: "Millennium Hyundai", address: "265 North Franklin Street", city: "Hempstead", state: "NY", zip: "11550", phone: null },
    warranty: {
      basic: "5-year/60,000-mile New Vehicle Warranty*", powertrain: "10-year/100,000-mile Powertrain Warranty*",
      corrosion: "7-year/Unlimited-mile Anti-perforation Warranty*", roadside: "5-year/Unlimited-mile Roadside Assistance",
      emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "51 %" },
      { label: "Major Sources of Foreign Parts Content", value: "Korea: 31 %" },
      { label: "Engine", value: "U.S.A" },
      { label: "Transmission", value: "U.S.A" },
    ],
    generic: false,
    disclaimers: [],
  };
}
