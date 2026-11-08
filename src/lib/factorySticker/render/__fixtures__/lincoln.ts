// Test inputs for the Lincoln Nautilus gasoline template.
//
// lincolnListing(): the one saved Lincoln record with a decoded build sheet
// (read-only extract of vehicle_listings), a 2008 MKZ Base. Production has no
// Nautilus, so it is used only as an off-year, other-model layout stress test,
// not a production candidate.
// lincolnReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type LincolnListing = CatalogListing;
export const lincolnListing = (): LincolnListing => recordListing("lincolnRecord.fixture.json");
export const lincolnRenderData = (listing: LincolnListing = lincolnListing()): FactoryStickerRenderData => recordRenderData(listing);

export const LINCOLN_REFERENCE_VIN = "5LMPJ8JA4TJ081447";

export function lincolnReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: LINCOLN_REFERENCE_VIN,
    barcodePayload: LINCOLN_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Lincoln", model: "Nautilus", trim: "Premiere I" },
    bodyClass: "SUV",
    mechanical: { engine: "2.0L Turbocharged I-4 Engine", transmission: "8-Spd Auto Transmission", drivetrain: "AWD" },
    pricing: { baseMsrp: 53995, destinationCharge: 2295, optionsTotal: 700, totalMsrp: 56990 },
    packages: [{ name: "Equipment Group 101A", code: "101A", msrp: null, contents: ["Conn Pkg: 4 Yr Incl w/Lncn-AP"] }],
    options: [
      { name: "Red Carpet Met CC", code: null, msrp: 750 },
      { name: "18\" Mini Spare Wheel and Tire", code: null, msrp: 450 },
      { name: "Smile State Discount", code: null, msrp: -500 },
      { name: "50 State Emissions", code: null, msrp: null, included: true },
      { name: "Bluecruise Equip:4Yrs Incl", code: null, msrp: null, included: true },
      { name: "Front License Plate Bracket", code: null, msrp: null, included: true },
    ],
    standardEquipment: {
      Exterior: [
        "Easy Fuel Capless Filler", "Full LED Headlights", "Grille-Bright Chrme Jewels", "Lincoln Embrace", "LED Taillamps",
        "Mirrors-Heated/Autofold/Signal/Sec Approach Lamps", "Power Liftgate", "Privacy Glass", "Rain Sensitive Wipers", "Rear Wiper/Washer/Defrost",
      ],
      Interior: [
        "11.1 Centerstack Screen", "48-Inch Display", "Auto-Dimming Rearview Mirr", "Cargo Management System", "Dual-Zone Climate Control",
        "Heated Steering Wheel", "Leather Wrapped Str Wheel", "Power Tilt/Telescoping Steering Column w/Memory", "Seat-2nd Rw 60/40 Easyfold",
        "Seats - Comfort 10-Way Pwr Drvr and 8-Way Pwr Pass", "Seats-Heated Front w/Driver Memory Setting",
      ],
      Functional: [
        "360 Degree Camera", "Adaptive Cruise Control", "BLIS w/Cross-Traffic Alert", "Electric Pwr Asst Steering", "Intell Access w/Push Start",
        "Lane-Keeping System", "Lincoln Connect 5G Modem w/WiFi Capability", "Lincoln Co-Pilot360 DR2.0", "Lincoln Dig Experience", "Phone as a Key (PaaK)",
        "Rear Parking Sensors", "SecuriCode Keyless Keypad", "Wireless Charging Pad",
      ],
      "Safety/Security": [
        "AdvanceTrac with RSC", "Airbags-Dual Stage Front", "Airbags-Side Impact/Safety Canopy Side Air Curtains", "Auto High Beams", "Perimeter Alarm",
        "Personal Safety System", "Pre-Collision Assist w/AEB", "SOS Post-Crash Alert Sys", "Tire Pressure Monitor Sys",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Red Carpet Met CC", code: null }, interior: { name: "MD LT Spc Gry Lincoln Sft T", code: null } },
    assembly: { plant: null, city: "Louisville, Kentucky", country: "U.S.A." },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 21, highway: 29, combined: 24, annualFuelCost: 2050, ghgScore: 5, smogScore: 5, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 4.2, co2TailpipeGpm: 369, fiveYearCostDifference: -1750,
      classNote: "Small SUVs range from 14 to 138 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: 5, frontalDriver: 5, frontalPassenger: 4, sideFront: 5, sideRear: 5, rollover: 4 },
    nhtsaNotRated: false,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "4-year or 50,000-mile warranty.", powertrain: "6-year or 70,000-mile powertrain warranty.",
      corrosion: null, roadside: "4-year or 50,000-mile pickup and delivery service.", emissions: null,
    },
    partsContent: [],
    generic: false,
    disclaimers: [],
  };
}
