// Test inputs for the Fiat 500e electric template.
//
// fiatListing(): a saved 2024 Tesla Model Y Performance (a saved electric SUV
// with a decoded build sheet; read-only extract of vehicle_listings, the
// standard-equipment list trimmed to its first 110 items). Production has no
// Fiat, so it is used only as an off-year, other-make layout stress test, not a
// production candidate.
// fiatReferenceMatchData(): the OEM reference sticker's own transcribed values
// (a 2025 example), for side-by-side visual comparison with the reference PDF
// ONLY. Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type FiatListing = CatalogListing;
export const fiatListing = (): FiatListing => recordListing("fiatRecord.fixture.json");
export const fiatRenderData = (listing: FiatListing = fiatListing()): FactoryStickerRenderData => recordRenderData(listing);

export const FIAT_REFERENCE_VIN = "ZFAFFAC47SX254142";

export function fiatReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: FIAT_REFERENCE_VIN,
    barcodePayload: FIAT_REFERENCE_VIN,
    neovin: { ratingMetadata: [], madeIn: null },
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2025", make: "Fiat", model: "500e", trim: "Giorgio Armani" },
    bodyClass: "Hatchback",
    mechanical: { engine: "400V GKN097 Front Electric Drive Motor", transmission: "Front-Offset 1-Speed Gearbox", drivetrain: null },
    pricing: { baseMsrp: 30500, destinationCharge: 1995, optionsTotal: 5000, totalMsrp: 37495 },
    packages: [
      {
        name: "Customer Preferred Package 21G", code: null, msrp: 5000,
        contents: [
          "Black Pedals", "Heated Front Seats", "JBL Premium Audio System", "Bright Front Door Sill Scuff Pads", "Automatic High-Beam Headlamp-Control",
          "Automatic-Dimming Rear-View Mirror", "Body-Color Exterior Mirrors", "Dark Chrome Exterior Accents", "\"Giorgio Armani\" Badge", "Armani Logo Seat Belts",
          "Armani Fabric Interior Accents", "Giorgio Armani Edition", "Deluxe Headliner", "Front Seat-Back Map Pockets", "Painted Front Bumper",
          "17-Inch x 7-inch Alloy Wheels with Armani Logo", "205/45R17 Summer Tires",
        ],
      },
    ],
    options: [],
    standardEquipment: {
      "Functional/Safety Features": [
        "400V 42 kWh Battery Pack", "One-Pedal Driving", "Regenerative 2-Wheel ABS Disc Brakes", "EV eCoasting", "Electronic Stability Control",
        "Full-Speed Forward-Collision Warning Plus", "Lane-Departure Warning Plus", "Drowsy Driver Detection", "Traffic Sign Information", "Speed Control",
        "Rain-Sensitive Windshield Wipers", "ParkSense Rear Park-Assist System", "ParkView Rear Back-Up Camera", "Electric Park Brake",
        "Driver Inflatable Knee-Bolster Air Bag", "Supplemental Side-Curtain Front and Rear Air Bags", "Supplemental Front Seat-Mounted Side Air Bags",
        "Tire Pressure Information System", "Tire Service Kit", "Keyless Enter 'n Go System",
      ],
      "Interior Features": [
        "Air Conditioning with Automatic Temperature Control", "Remote Climate-Control Activation", "Cluster with 7.0-Inch TFT Color Display",
        "Uconnect 5 Nav w/ 10.25-Inch Touch Screen Display", "SiriusXM 360L with 3-Month Sub Call 800-643-2112", "6 Speakers", "Wireless Apple CarPlay",
        "Wireless Google Android Auto", "4G LTE Wi-Fi Hot Spot", "Alexa Built-In (Wi-Fi Required)", "Integrated Voice Command",
        "Connected Travel and Traffic Services", "Wireless Charging Pad", "Front Row USB Types A and C", "Pushbutton Start", "6-Way Manual Adjustable Driver Seat",
        "4-Way Manual Adjustable Front Passenger Seat", "Rear 50/50 Split Folding Seat", "Tilt / Telescope Steering Column", "Power Windows with Front 1-Touch Up / Down Feature",
      ],
      "Exterior Features": [
        "17-Inch x 7.0-Inch Aluminum Multi-Spoke Wheels", "205/45R17 All-Season Tires", "LED Low/High Reflector Headlamps", "LED Daytime Running Headlamps",
        "Automatic Headlamps", "LED Tail Lamps", "Power Mirrors",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Green Metallic Exterior Paint", code: null }, interior: { name: "Eco Green Interior Color", code: null } },
    assembly: { plant: null, city: "Baltimore, Maryland", country: "U.S.A." },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 127, highway: 104, combined: 116, annualFuelCost: 700, ghgScore: 9, smogScore: 10, rangeMiles: 149, fuelType: "Electricity",
      co2TailpipeGpm: 0, fiveYearCostDifference: 6000, kwhPer100Miles: 29, chargeTimeHours: 6,
    },
    safety: null,
    nhtsaNotRated: true,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "Basic Limited Warranty: 4 Years / 50,000 Miles.", powertrain: "Electric Powertrain: 8 Years / 100,000 Miles.",
      corrosion: null, roadside: "High Voltage Battery Pack: 8 Years / 100,000 Miles.", emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "0%" },
      { label: "Hungary", value: "40%" },
      { label: "Italy", value: "35%" },
      { label: "Engine", value: "Italy" },
      { label: "Transmission", value: "Italy" },
    ],
    generic: false,
    disclaimers: [],
  };
}
