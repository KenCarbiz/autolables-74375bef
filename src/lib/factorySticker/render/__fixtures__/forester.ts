// Test inputs for the Subaru Forester gasoline template.
//
// foresterListing(): a saved Subaru Forester record with a decoded build sheet
// (read-only extract of vehicle_listings), a 2021 Forester Premium. Production
// has no 2026 Forester, so it is used only as an off-year layout stress test,
// not a production candidate.
// foresterReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type ForesterListing = CatalogListing;
export const foresterListing = (): ForesterListing => recordListing("foresterRecord.fixture.json");
export const foresterRenderData = (listing: ForesterListing = foresterListing()): FactoryStickerRenderData => recordRenderData(listing);

export const FORESTER_REFERENCE_VIN = "4S4SLDL62T3085350";

export function foresterReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: FORESTER_REFERENCE_VIN,
    barcodePayload: FORESTER_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Subaru", model: "Forester", trim: "Wilderness" },
    bodyClass: "SUV",
    mechanical: { engine: "2.5L DOHC SUBARU BOXER Engine w/ Auto Start Stop", transmission: "Lineartronic CVT w/ 8-Speed Manual Shift Mode / SI-DRIVE", drivetrain: "AWD" },
    pricing: { baseMsrp: 36995, destinationCharge: 1450, optionsTotal: 3254, totalMsrp: 41699 },
    packages: [{
      name: "Option Package: 33", code: "33", msrp: 2200,
      contents: ['Subaru 11.6" Multimedia System w/ Navigation', "Harman Kardon Speaker System", "Power Rear Gate", "Full LCD Digital Gauge Cluster Display"],
    }],
    options: [
      { name: "Auto-Dimming Mirror with Compass and HomeLink", code: null, msrp: 447 },
      { name: "Rear Bumper Cover", code: null, msrp: 182 },
      { name: "Carpeted Floor Mats - Wilderness", code: null, msrp: 156 },
      { name: "Rear Seatback Protector", code: null, msrp: 156 },
      { name: "Cargo Sidewall Protector", code: null, msrp: 113 },
    ],
    standardEquipment: {
      Safety: [
        "Symmetrical All-Wheel Drive, Vehicle Dynamics Control", "EyeSight Driver-Assist System w/ Automatic Emergency Steering",
        "Reverse Automatic Braking (RAB)", "Subaru Advanced Frontal Airbag System", "Side-Curtain Airbags w/ Rollover Sensor",
        "Driver's Side Knee & Front Seat Side-Impact Airbags", "Whiplash Protection Front Seats", "4-Wheel Disc Brakes w/ Brake Assist",
        "Blind Spot Detection w/ Rear Cross-Traffic Alert", "Anti-Lock Braking System (ABS)", "Electronic Brake-Force Distribution",
        "Brake Override System & Safety Pedal System", "Anti-Theft Alarm & Immobilizer System", "Front View Monitor w/ 180 Degree Viewing Angle",
        "Rear Vision Camera w/ Dynamic Guidelines",
      ],
      "Performance & Exterior": [
        "2.5L DOHC SUBARU BOXER Engine w/ Auto Start Stop", "Lineartronic CVT w/ 8-Speed Manual Shift Mode / SI-DRIVE",
        "Four-Wheel Independent Raised Suspension: Off-Road Tuned", '9.3" Ground Clearance', '17" Alloy Wheels, Matte Black & 225mm All-Terrain Spare Tire',
        "X-Mode: Dual-Mode: w/ Low Speed / Low Ratio Gradient Control", "Hood Graphic / Front Skid Plate / Roof Spoiler / Panoramic Moonroof",
        "Black Manual-Folding Heated Power Mirrors w/ Turn Signals", "Roof Rails: Raised Ladder Type w/ 800lb Static Load Capacity",
        "LED Steering Responsive Headlights w/ High Beam Assist", "LED Hexagon Pattern Fog Lights",
      ],
      "Comfort, Convenience & Interior": [
        "Dual-Zone Automatic Climate Control w/ Air Filtration System", 'Subaru 11.6" Multimedia Plus System', "Dual Front & Dual Rear Illuminated USB Ports (USB-A/USB-C)",
        "HD Radio & 4 Month SiriusXM w/ 360L Trial Subscription", "MySubaru Companion 5-Year Free Trial Available. T&Cs Apply",
        "Wireless Apple CarPlay & Android Auto & Wireless Charger", "Gray Textured StarTex Upholstery w/ Anodized Copper Accents",
        "Leather-Free Steering Wheel w/ Bluetooth & Audio Switches", "Advanced Adaptive Cruise Control w/ Lane Centering",
        "Keyless Access w/ Push-Button Start / Paddle Shift Switches", "All-Weather Floor Mats & Cargo Tray w/ Subaru Wilderness Logo",
        "60/40 Split Fold-Down Rear Seatback & Retractable Cargo Cover", "10-Way Power Driver's Seat: Includes 2-Way Lumbar Support",
        "Automatic On/Off Headlights / Dual Map Lights / Rear Gate Light", "All-Weather Package w/ Heated Front Seats",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Crystal Black Silica", code: null }, interior: { name: null, code: null } },
    assembly: { plant: null, city: "Lafayette, IN", country: "USA" },
    transportMethod: "Truck",
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 24, highway: 28, combined: 26, annualFuelCost: 1900, ghgScore: 5, smogScore: 6, rangeMiles: null,
      fuelType: "Gasoline", gallonsPer100Miles: 3.8, co2TailpipeGpm: 347, fiveYearCostDifference: -1000,
      classNote: "Small SUVs range from 14 to 138 MPG. The best vehicle rates 146 MPGe.",
    },
    safety: { overall: null, frontalDriver: 5, frontalPassenger: 5, sideFront: 5, sideRear: 5, rollover: null },
    nhtsaNotRated: false,
    dealerRole: null,
    dealer: { name: null, address: null, city: null, state: null, zip: null, phone: null },
    warranty: {
      basic: "3 Years / 36,000 Miles Basic", powertrain: "5 Years / 60,000 Miles Powertrain",
      corrosion: "5 Years / Unlimited Mileage Rust Perforation", roadside: "3 Years / 36,000 24/7 Roadside Assistance", emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "50%" },
      { label: "Major Sources of Foreign Parts Content", value: "Japan: 30%" },
      { label: "Engine", value: "Japan" },
      { label: "Transmission", value: "Japan" },
    ],
    generic: false,
    disclaimers: [],
  };
}
