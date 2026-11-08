// Test inputs for the Lamborghini Urus plug-in hybrid template.
//
// urusListing(): a saved 2018 Chevrolet Volt (the only saved plug-in hybrid with a
// decoded build sheet and a verified EPA match; read-only extract of
// vehicle_listings, the standard-equipment list trimmed). Production has no
// Lamborghini Urus, so it is used only as an off-year, other-make layout stress test,
// not a production candidate.
// urusReferenceMatchData(): the OEM reference sticker's own transcribed values
// for side-by-side visual comparison with the reference PDF ONLY; the reference has no text layer, so values are read from its raster. Never
// use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type UrusListing = CatalogListing;
export const urusListing = (): UrusListing => recordListing("voltRecord.fixture.json");
export const urusRenderData = (listing: UrusListing = urusListing()): FactoryStickerRenderData => recordRenderData(listing);

export const URUS_REFERENCE_VIN = "ZPBUD6ZL8TLA42157";

export function urusReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: URUS_REFERENCE_VIN,
    barcodePayload: URUS_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Lamborghini", model: "Urus", trim: "SE" },
    bodyClass: "SUV",
    mechanical: { engine: null, transmission: null, drivetrain: null },
    pricing: { baseMsrp: 276741, destinationCharge: 3995, optionsTotal: 65557, totalMsrp: 346293 },
    packages: [],
    options: [
      { name: "Seat belts Arancio Leonis", code: null, msrp: 1690 },
      { name: "Arancio Borealis", code: null, msrp: 9999 },
      { name: "Big Interior Carbon Package - Shiny", code: null, msrp: 8682 },
      { name: "Park Assistance Package with Remote Park", code: null, msrp: 4187 },
      { name: "Rims Galanthus 23\" shiny black", code: null, msrp: 6246 },
      { name: "Orange Calipers", code: null, msrp: 1406 },
      { name: "Ambient Light Package", code: null, msrp: 3486 },
      { name: "Advanced 3D \"Bang&Olufsen Sound", code: null, msrp: 7990 },
      { name: "Bicolor leather Interior with contrast", code: null, msrp: 3273 },
      { name: "Style Package Full in High Gloss Black", code: null, msrp: 4015 },
      { name: "Full Electric Front Seats", code: null, msrp: 3617 },
      { name: "All-Weather Mats Kit - US", code: null, msrp: 609 },
      { name: "Door Lights Lamborghini Logo - US", code: null, msrp: 783 },
      { name: "Valve Caps with Logo - US", code: null, msrp: 330 },
      { name: "Privacy Glass Acoustic and Heat", code: null, msrp: 2375 },
      { name: "Bumpers in High Gloss Black and", code: null, msrp: 414 },
      { name: "Panoramic Roof", code: null, msrp: 3590 },
      { name: "Black Anodized Treatment on", code: null, msrp: 817 },
      { name: "Embroidered Lamborghini Shield", code: null, msrp: 1063 },
      { name: "Black Matt Exhaust Tailpipes", code: null, msrp: 985 },
    ],
    standardEquipment: {
      "The Following is Standard Equipment": [
        "Active Torque-Vectoring Electronic Rear Differential",
        "Hybrid Body in White in aluminum and steel",
        "Air suspension with active damping and electromechanical active roll stabilization",
        "Power vacuum brake system with ABS",
        "Carbon-ceramic brakes",
        "Electronic parking brake",
        "ESC system",
        "Matrix LED adaptive headlamps with high beam assist and tail lights",
        "4-zone automatic air conditioning",
        "External mirrors (with heating, electrically adjustable and foldable, autodimming)",
        "Ignition key with remote control (Keyless)",
        "Electric tailgate",
        "Driver airbag: single stage with adaptivity",
        "Passenger bag: dual stage with adaptivity",
        "Front and rear side #thorax' airbags",
        "Curtain airbags for head protection for front and rear passengers",
        "Front and rear parking sensor",
        "Cruise control",
      ]
    },
    keyFeatures: {},
    colors: { exterior: { name: "Arancio Borealis", code: null }, interior: { name: "Nero Ade", code: null } },
    assembly: { plant: null, city: "Sant'Agata Bolognese", country: "Italy" },
    transportMethod: "By Sea",
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: null, highway: null, combined: 48, annualFuelCost: 2300, ghgScore: 6, smogScore: 2, rangeMiles: 35, fuelType: "Premium Gasoline and Electricity",
      combinedMpge: 48, gasCombinedMpg: 20, kwhPer100Miles: 70, chargeTimeHours: 4, electricRangeMiles: 35, totalRangeMiles: 450,
      co2TailpipeGpm: 166, fiveYearCostDifference: -3000
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: null,
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "0%" },
      { label: "Germany", value: "64%" },
      { label: "Italy", value: "10%" },
      { label: "Engine", value: "Germany" },
      { label: "Transmission", value: "Germany" }
    ],
    generic: false,
    disclaimers: [],
  };
}
