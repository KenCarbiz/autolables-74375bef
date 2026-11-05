// Test inputs for the Aston Martin Vantage Roadster gasoline template.
//
// astonListing(): production has no saved Aston Martin record, so this reuses
// the saved 2022 Toyota 4Runner SR5 record (read-only extract of
// vehicle_listings) as an off-year, other-make layout stress test, not a
// production candidate and not an Aston Martin.
// astonReferenceMatchData(): the OEM reference sticker's own transcribed
// values (read from the raster scan; the PDF has no text layer), for
// side-by-side visual comparison with the reference PDF ONLY. Never use it as
// a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type AstonListing = CatalogListing;
export const astonListing = (): AstonListing => recordListing("toyota4runnerRecord.fixture.json");
export const astonRenderData = (listing: AstonListing = astonListing()): FactoryStickerRenderData => recordRenderData(listing);

export const ASTON_REFERENCE_VIN = "SCFSMGGW0TGP11016";

export function astonReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: ASTON_REFERENCE_VIN,
    barcodePayload: ASTON_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Aston Martin", model: "Vantage", trim: "Roadster Auto" },
    bodyClass: "Convertible",
    mechanical: { engine: "4.0L Twin Turbo V8", transmission: "8-speed automatic", drivetrain: "RWD" },
    pricing: { baseMsrp: 205900, destinationCharge: 3500, optionsTotal: 4925, totalMsrp: 221525, gasGuzzlerTax: 0 },
    packages: [],
    options: [
      { name: "Leather Colour - Contemporary", code: null, msrp: 3500 },
      { name: "AML Battery Maintainer", code: null, msrp: 445 },
      { name: "AML Car Cover", code: null, msrp: 580 },
      { name: "AML License Plate Frame", code: null, msrp: 65 },
      { name: "AML Sunshade", code: null, msrp: 120 },
      { name: "AML Umbrella", code: null, msrp: 215 },
    ],
    standardEquipment: {
      "Engineering and Performance": [
        "2-door coupe", "5 Selectable Drive Modes", "656hp 4.0L Twin Turbo V8 Engine", "8-speed automatic transmission",
        "Electronic Rear Differential and Dynamic Torque Vectoring", "Alloy torque tube with carbon fiber propeller shaft",
      ],
      "Safety and Security": [
        "Lane Keep Assist (LKA)", "Autonomous Emergency Braking (AEB)", "Automatic headlights with Auto High Beam (AHB)", "Traffic Sign Recognition (TSR)",
        "Dynamic Stability Control (DSC), Traction Control (TC), and Positive Torque Control (PTC)",
        "Dual-Stage Driver & Passenger Front Airbags and Seat Mounted & Curtain Side Impact Airbags",
      ],
      "Comfort and Convenience": [
        "10.25\" TFT Touch Screen Central Display", "10.25\" TFT Driver Information Display", "Apple CarPlay", "12-Way Heated Front Seats with 3-Position Memory",
        "Adaptive Cruise Control (ACC)", "Wireless Charging", "Bluetooth Phone & Streaming Audio", "Satellite Radio with Trial Subscription - 1yr",
        "360 Degree Camera with Front & Rear Parking Sensors", "Power Folding Heated Exterior Mirrors", "Power-Adjustable Steering Column",
        "Dual-Zone Automatic Climate Control", "Rain-Sensing Wipers", "Electronic Park Brake (EPB)", "Auto-dimming interior rear-view mirror with garage door opener",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Lunar White", code: null }, interior: { name: "All Oxford Tan Haircell Leather", code: null } },
    assembly: { plant: null, city: "Gaydon, Warwickshire", country: "UK" },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 15, highway: 22, combined: 18, annualFuelCost: 3450, ghgScore: 3, smogScore: 4, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 5.6, co2TailpipeGpm: 498, fiveYearCostDifference: -8500,
      classNote: "Two Seater range from 9 to 53 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "3 years unlimited mileage warranty", powertrain: null, corrosion: null, roadside: "24 hour roadside assistance", emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "3%" },
      { label: "Major Sources of Foreign Parts Content", value: "UK: 66%" },
      { label: "Major Sources of Foreign Parts Content", value: "Germany: 22%" },
      { label: "Engine", value: "Germany" },
      { label: "Transmission", value: "Germany" },
    ],
    generic: false,
    disclaimers: [],
  };
}
