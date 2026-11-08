// Test inputs for the Alfa Romeo Giulia Veloce gasoline template.
//
// alfaListing(): the one saved Alfa Romeo record with a decoded build sheet
// (read-only extract of vehicle_listings), a 2020 Stelvio Ti Sport Carbon.
// Production has no Giulia, so it is used only as an off-year, other-model
// layout stress test, not a production candidate.
// alfaReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type AlfaListing = CatalogListing;
export const alfaListing = (): AlfaListing => recordListing("alfaRecord.fixture.json");
export const alfaRenderData = (listing: AlfaListing = alfaListing()): FactoryStickerRenderData => recordRenderData(listing);

export const ALFA_REFERENCE_VIN = "ZARFAMAN9T7696545";

export function alfaReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: ALFA_REFERENCE_VIN,
    barcodePayload: ALFA_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Alfa Romeo", model: "Giulia", trim: "Veloce" },
    bodyClass: "Sedan",
    mechanical: { engine: "2.0L 280HP I4 DI Turbo Engine w/ Engine Stop/Start", transmission: "8-Speed Automatic 8HP50 Transmission", drivetrain: "RWD" },
    pricing: { baseMsrp: 44995, destinationCharge: 3250, optionsTotal: 8870, totalMsrp: 57115 },
    packages: [
      { name: "Sprint RWD - Package 22L", code: "22L", msrp: null, contents: [] },
      { name: "Driving Assist Package", code: null, msrp: 300, contents: ["Advanced Vehicle Anti-Theft System", "Intelligent Speed Assist", "Active Driving Assist System"] },
      { name: "Premium Interior and Sound Package", code: null, msrp: 2250, contents: ["14-Speaker Harman Kardon Premium Audio", "Leather Dash and Upper Doors"] },
      {
        name: "Veloce Package", code: null, msrp: 1625,
        contents: [
          "Power Adjustable Seat Bolsters", "Limited-Slip Differential", "Silver \"Veloce\" Badge", "\"Q2\" Badge",
          "Aluminum Steering-Column-Mounted Paddle Shifters", "Gloss-Red Calipers with White Script",
        ],
      },
    ],
    options: [
      { name: "Vesuvio Gray Metallic Exterior Paint", code: null, msrp: 695 },
      { name: "Red Leather Sport Seats", code: null, msrp: 750 },
      { name: "Dual-Pane Sunroof", code: null, msrp: 1500, contents: ["Gloss-Black Window Surround Moldings"] },
      { name: "Alfa Connect (Connected Services) w/ Trial", code: null, msrp: null },
      { name: "19-Inch x 8.0-Inch Sport Aluminum Wheels", code: null, msrp: 1750 },
    ],
    standardEquipment: {
      "Functional/Safety Features": [
        "Full-Speed Forward-Collision Warning Plus", "Lane-Keep Assist", "Traffic Sign Recognition", "Driver Attention Alert", "Active Blind-Spot Assist",
        "Adaptive Cruise Control with Full Stop", "Front and Rear Park-Assist Sensors", "Dual-Advanced Front Airbags", "Supplemental Side-Curtain Front and Rear Air Bags",
        "LATCH-Ready Child-Seat Anchor System", "Rear Back-up Camera", "Automatic-Dimming Exterior Mirrors", "Power-Folding Heated Mirrors",
        "Rain-Sensitive Windshield Wipers", "Passive Entry / Push-Button Start", "Remote-Start System", "Universal Garage-Door Opener", "Air Quality System",
        "Sport Suspension", "Carbon Fiber Drive Shaft", "Alfa DNA Drive Mode System",
      ],
      "Interior Features": [
        "Cluster with 12.3-Inch TFT Color Display", "8.8-Inch AM / FM / HD Radio with Navigation", "Apple CarPlay", "Google Android Auto",
        "SiriusXM with 3-Month Radio Sub Call 800-643-2112", "Wireless Charging Pad", "Handsfree Phone and Audio", "Steering-Wheel-Mounted Audio Controls",
        "Heated Front Seats", "Heated Rear Seats", "Heated Steering Wheel", "8-Way Power Adjustable Driver Seat", "6-Way Power Adjustable Front Passenger Seat",
        "4-Way Power Lumbar Adjustable Driver Seat", "4-Way Power Lumbar Adjustable Front Passenger Seat", "Rear-Seat 40/20/40 with Trunk Pass-Thru", "Aluminum Interior Trim",
      ],
      "Exterior Features": [
        "18-Inch x 8.0-Inch Dark Turbine Aluminum Wheels", "225/45R18 BSW All-Season Performance Tires", "4-Wheel Discs with Brembo Front Brakes",
        "Gloss Black Exterior Mirrors", "LED Daytime Running Lights", "LED Trilobe Headlamps", "LED Dark Taillamps", "Heated Windshield Washer Nozzles",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Vesuvio Gray Metallic Exterior Paint", code: null }, interior: { name: "Black Interior Color", code: null } },
    assembly: { plant: null, city: "Cassino", country: "Italy" },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 24, highway: 33, combined: 27, annualFuelCost: 2300, ghgScore: 5, smogScore: 4, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 3.7, co2TailpipeGpm: 330, fiveYearCostDifference: -3000,
      classNote: "Midsize cars range from 15 to 139 MPGe. The best vehicle rates 146 MPGe.",
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "4-year or 50,000-mile Basic Warranty.", powertrain: "4-year or 50,000-mile Powertrain Warranty.",
      corrosion: null, roadside: "Roadside assistance; certain restrictions apply.", emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "0%" },
      { label: "Major Sources of Foreign Parts Content", value: "Italy: 42%" },
      { label: "Major Sources of Foreign Parts Content", value: "Germany: 14%" },
      { label: "Engine", value: "Italy" },
      { label: "Transmission", value: "Germany" },
    ],
    generic: false,
    disclaimers: [],
  };
}
