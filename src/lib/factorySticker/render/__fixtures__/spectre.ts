// Test inputs for the Rolls-Royce Spectre electric template.
//
// spectreListing(): a saved 2023 Subaru Solterra (the closest saved electric
// SUV with a decoded build sheet; read-only extract of vehicle_listings, the
// standard-equipment list trimmed to its first 110 items). Production has no
// Rolls-Royce, so it is used only as an other-make, off-year layout stress
// test, not a production candidate.
// spectreReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY. The
// reference has no text layer, so the values are read from its raster. Never
// use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type SpectreListing = CatalogListing;
export const spectreListing = (): SpectreListing => recordListing("spectreRecord.fixture.json");
export const spectreRenderData = (listing: SpectreListing = spectreListing()): FactoryStickerRenderData => recordRenderData(listing);

export const SPECTRE_REFERENCE_VIN = "SCATK2C0XTU232396";

export function spectreReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: SPECTRE_REFERENCE_VIN,
    barcodePayload: SPECTRE_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Rolls-Royce", model: "Spectre", trim: "Spectre" },
    bodyClass: "Coupe",
    mechanical: { engine: null, transmission: null, drivetrain: null },
    pricing: { baseMsrp: 395000, destinationCharge: 2750, optionsTotal: 38200, totalMsrp: 474050 },
    packages: [],
    options: [
      { name: "Main Exterior Colour Arctic White", code: null, msrp: 13500 },
      { name: "23\" 7 Spoke Fully Polished Wheel", code: null, msrp: null, included: true },
      { name: "Illuminated Grille", code: null, msrp: null, included: true },
      { name: "Primary Interior Colour Arctic White", code: null, msrp: null, included: true },
      { name: "Secondary Interior Colour Navy Blue", code: null, msrp: null, included: true },
      { name: "Tertiary Interior Colour Mandarin", code: null, msrp: null, included: true },
      { name: "Bespoke Interior - Module Editing", code: null, msrp: null, included: true },
      { name: "Extended Leather Headliner", code: null, msrp: null, included: true },
      { name: "Shooting Star Headliner", code: null, msrp: null, included: true },
      { name: "Coloured Stitching Mandarin", code: null, msrp: 2600 },
      { name: "Coloured IP Inner Stitch Mandarin", code: null, msrp: 1000 },
      { name: "Contrast Seat Piping Mandarin", code: null, msrp: 5000 },
      { name: "RR Monogram to all Headrests Mandarin", code: null, msrp: null, included: true },
      { name: "Starlight Doors", code: null, msrp: 13700 },
      { name: "Ventilated Massage Seats", code: null, msrp: null, included: true },
      { name: "Heated Passenger Surround", code: null, msrp: null, included: true },
      { name: "Open Pore - Blackwood", code: null, msrp: null, included: true },
      { name: "Coloured Steering Wheel Navy Blue", code: null, msrp: 2400 },
      { name: "Advanced Driver Assistance Systems", code: null, msrp: null, included: true },
      { name: "Rolls-Royce Bespoke Audio", code: null, msrp: null, included: true },
      { name: "Lambswool Footmats", code: null, msrp: null, included: true },
      { name: "Signature Key Mandarin", code: null, msrp: null, included: true },
      { name: "Occasional Use Charging Cable", code: null, msrp: null, included: true },
      { name: "RR Connected Services", code: null, msrp: null, included: true },
      { name: "US Temporary Charge Port", code: null, msrp: null, included: true },
      { name: "US Charging Adapters", code: null, msrp: null, included: true },
      { name: "Apple CarPlay", code: null, msrp: null, included: true },
      { name: "Refrigerant", code: null, msrp: null, included: true },
      { name: "Storage for Wireless Charging", code: null, msrp: null, included: true },
      { name: "Personal eSIM", code: null, msrp: null, included: true },
      { name: "Selectable Daytime Driving Lights", code: null, msrp: null, included: true },
      { name: "Local Legislation Adherence", code: null, msrp: null, included: true },
      { name: "Intelligent Emergency Call", code: null, msrp: null, included: true },
      { name: "Teleservices", code: null, msrp: null, included: true },
      { name: "RR Connected Apps", code: null, msrp: null, included: true },
    ],
    standardEquipment: {
      "Standard Engineering and Safety Features": [
        "120 kWh Lithium-Ion battery with AC and DC charging capability",
        "Two Separately Excited Synchronous Motors (SSM)",
        "Rolls-Royce All-Wheel Drive, All-Wheel Steering and Independent Air Suspension",
        "Aluminum Spaceframe Structure",
        "Dynamic Cruise Control",
        "Park Distance Control, front and rear",
        "Driver Assistant Systems: Lane Departure with Active Steer, Collision Warning with Active Braking, Drive Recorder, Reversing Assistant, Head-Up Display, Park Assist, and Speed Limit Information",
        "Rear View Camera and Surround View Camera with 3D view",
        "Rolls-Royce LED Headlights, side (parking) and rear lights",
        "Electric Parking Brake with Drive-off Assistance and Dynamic Emergency Brake",
        "Intelligent Emergency Call",
        "Power-assisted ventilated disc brakes (all wheels) with four channel Anti-lock Braking System, Brake Energy Regeneration, Dynamic Stability Control, Dynamic Traction Control and Cornering Brake Control",
        "Supplemental Restraint System: Driver and front passenger airbags, side impact airbags, active knee protection, and head protection system",
        "Front & rear three-point, pre-tensioning seatbelts with force limiters in front positions and Front & rear seat active head restraints",
        "Laminated glass with climate control glazing, rain-sensing variable-speed windshield wipers, and heated rear windshield",
        "\"B\" (Brake) Button activating one-pedal driving mode for stronger brake recuperation"
      ],
      "Standard Comfort and Convenience Features": [
        "Spirit of Ecstasy hood ornament",
        "Comfort Access keyless entry",
        "Effortless Entry Coach Doors with power closing assistance",
        "Soft Close latches for all doors and power open/close for luggage compartment",
        "Heated, full leather covered multi-function steering wheel",
        "Heated and electronically adjustable front seats with memory settings",
        "Automatic 4-zone climate control",
        "Integrated Umbrellas",
        "Self-righting wheel centers",
        "10.25\" Central Information Display with Touch Screen",
        "Digital 12.3\" LED backlit Instrument Dials",
        "Satellite Navigation System with Real-Time Traffic Information",
        "SPIRIT infotainment operated by touch, controller and voice commands",
        "Premium audio system: 415-watt 9-channel amplifier, 16 speakers",
        "FM/SiriusXM 360L (1 yr-trial)",
        "Apple Car Play and Android Auto Compatibility",
        "Bluetooth\u00ae wireless technology",
        "Wireless Smart Phone Charging",
        "USB Type-C ports",
        "Personal eSIM 5G"
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: null, code: null }, interior: { name: null, code: null } },
    assembly: { plant: null, city: null, country: null },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 67, highway: 75, combined: 70, annualFuelCost: 1200, ghgScore: 9, smogScore: 10, rangeMiles: 253, fuelType: "Electricity",
      co2TailpipeGpm: 0, fiveYearCostDifference: 2500, kwhPer100Miles: 48, chargeTimeHours: 10,
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: "Rolls-Royce Motor Cars Philadelphia", address: "100 Route 73 North", city: "Palmyra", state: "NJ", zip: "08065", phone: null },
    warranty: {
      basic: "4-year/unlimited-mileage limited warranty.", powertrain: null, corrosion: null,
      roadside: "4-year/unlimited-mileage roadside assistance program.", emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "00%" },
      { label: "Germany", value: "00%" },
    ],
    generic: false,
    disclaimers: [],
  };
}
