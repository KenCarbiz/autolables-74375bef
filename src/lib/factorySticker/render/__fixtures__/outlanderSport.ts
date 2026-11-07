// Test inputs for the Mitsubishi Outlander Sport gasoline template.
//
// outlanderSportListing(): the one saved Mitsubishi record with a decoded build
// sheet (read-only extract of vehicle_listings), a 2024 Eclipse Cross.
// Production has no 2026 Outlander Sport, so it is used only as an off-year,
// other-model layout stress test, not a production candidate.
// outlanderSportReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForSticker } from "../../../../../supabase/functions/factory-sticker-orchestrate/normalize.ts";
import type { FactoryStickerRenderData } from "../contract.ts";
import { canonicalPassportUrl } from "../../reproduction.ts";

interface OutlanderSportRecord {
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

export type OutlanderSportListing = Record<string, unknown> & { vin: string; slug: string };

export function outlanderSportListing(): OutlanderSportListing {
  const r = JSON.parse(readFileSync(join(__dirname, "outlanderSportRecord.fixture.json"), "utf8")) as OutlanderSportRecord;
  return {
    vin: r.vin, slug: r.slug, ymm: r.ymm, trim: r.trim, condition: r.condition,
    mc_attributes: { body_type: r.body_type, build_sheet: r.build_sheet, ...r.mc_extra },
    epa_economy: r.epa_economy,
  };
}

export function outlanderSportRenderData(listing: OutlanderSportListing = outlanderSportListing()): FactoryStickerRenderData {
  return normalizeForSticker(listing, {}, canonicalPassportUrl(listing.slug), "Factory Window Sticker").data;
}

export const OUTLANDER_SPORT_REFERENCE_VIN = "JA4ARUAUXTU030987";

export function outlanderSportReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: OUTLANDER_SPORT_REFERENCE_VIN,
    barcodePayload: OUTLANDER_SPORT_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Mitsubishi", model: "Outlander Sport", trim: "2.0 S" },
    bodyClass: "SUV",
    mechanical: { engine: "2.0L DOHC I4 MIVEC", transmission: "Continuously Variable Transmission", drivetrain: "AWD" },
    pricing: { baseMsrp: 24995, destinationCharge: 1795, optionsTotal: 455, totalMsrp: 27245 },
    packages: [{
      name: "Welcome Package", code: null, msrp: 215,
      contents: ["Touch Up Paint Pen (Body Color)", "Carpet Floor Mats", "Owners Manual Portfolio", "Essentials Kit"],
    }],
    options: [{ name: "Tonneau Cover", code: null, msrp: 240 }],
    standardEquipment: {
      "Mechanical Features": ["2.0L MIVEC DOHC 4-cylinder", "Continuously Variable Transmission (CVT)", "All-Wheel Control (AWC)"],
      "Exterior Features": [
        "LED low and high beam headlights", "LED daytime running lights", "LED tail lights", "Heated power side mirrors",
        "16-Inch steel wheels with wheel covers", "215/70R16 all-season tires", "Temporary spare tire",
      ],
      "Interior Features": ["6-way adjustable driver seat", "4-way adjustable passenger seat", "Fabric seating surfaces"],
      "Convenience Features": [
        "8.0-inch Smartphone-link Display Audio (SDA)", "Apple CarPlay and Android Auto", "SiriusXM with 3-month All Access trial",
        "4 speakers", "Drive mode selector", "Remote keyless entry", "Auto-dimming rearview mirror",
      ],
      "Safety & Security": [
        "Forward Collision Mitigation (FCM) with pedestrian detection", "Lane Departure Warning (LDW)", "Automatic High Beam (AHB)",
        "LATCH (Lower Anchors and Tethers for Children)", "Rear Seat Alert", "7 Airbags",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Octane Blue Metallic", code: null }, interior: { name: "Black", code: null } },
    assembly: { plant: null, city: "Kurashiki", country: "Japan" },
    transportMethod: "Truck",
    factoryCodes: { dealer: null, emissions: "50-State Emissions Standard" },
    epa: {
      city: 23, highway: 29, combined: 26, annualFuelCost: 1900, ghgScore: 5, smogScore: 4, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 3.8, co2TailpipeGpm: 344, fiveYearCostDifference: -1000,
      classNote: "Small SUVs range from 14 to 125 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: 4, frontalDriver: 4, frontalPassenger: 4, sideFront: 5, sideRear: 5, rollover: 4 },
    nhtsaNotRated: false,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "5-year or 60,000-mile Bumper-to-Bumper Limited Warranty.", powertrain: "10-year or 100,000-mile Powertrain Limited Warranty.",
      corrosion: "7-year or 100,000-mile Anti-Corrosion/Perforation Limited Warranty.", roadside: "5-year unlimited-mile Roadside Assistance.",
      emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "0%" },
      { label: "Major Sources of Foreign Parts Content", value: "Japan: 95%" },
      { label: "Engine", value: "Japan" },
      { label: "Transmission", value: "Japan" },
    ],
    generic: false,
    disclaimers: [],
  };
}
