// Test inputs for the Buick Envista gasoline template.
//
// envistaListing(): a SYNTHETIC stress record. No Buick row exists in the saved
// vehicle_listings, so every value is invented for layout testing only; it is
// not a real vehicle and not a production candidate.
// envistaReferenceMatchData(): the OEM reference sticker's own transcribed
// values, for side-by-side visual comparison with the reference PDF ONLY.
// Never use it as a default or for any other vehicle.

import type { FactoryStickerRenderData } from "../contract.ts";
import { recordListing, recordRenderData, type CatalogListing } from "./catalogRecord.ts";

export type EnvistaListing = CatalogListing;
export const envistaListing = (): EnvistaListing => recordListing("buickRecord.fixture.json");
export const envistaRenderData = (listing: EnvistaListing = envistaListing()): FactoryStickerRenderData => recordRenderData(listing);

export const ENVISTA_REFERENCE_VIN = "KL47LCEP5TB310242";

export function envistaReferenceMatchData(base: FactoryStickerRenderData): FactoryStickerRenderData {
  return {
    ...base,
    vin: ENVISTA_REFERENCE_VIN,
    barcodePayload: ENVISTA_REFERENCE_VIN,
    neovin: undefined,
    passportUrl: "",
    title: "Reference match (side-by-side comparison only)",
    condition: "new",
    identity: { year: "2026", make: "Buick", model: "Envista", trim: "Avenir" },
    bodyClass: "SUV",
    mechanical: { engine: "ECOTEC 1.2L Turbo", transmission: "6-Spd Automatic", drivetrain: null },
    pricing: { baseMsrp: 29500, destinationCharge: 1795, optionsTotal: 2154, totalMsrp: 33449 },
    packages: [],
    options: [
      { name: "Moonroof, Power, Tilt-Sliding with Manual Sunshade", code: null, msrp: 795 },
      { name: "Avenir Advanced Safety Package", code: null, msrp: 795 },
      { name: "3 Years SiriusXM", code: null, msrp: 299 },
      { name: "All-Weather Floor Liners (Dealer Installed)", code: null, msrp: 265 },
    ],
    standardEquipment: {
      "Owner Benefits": [
        "3 Year / 36,000 Mile* Bumper-to-Bumper Limited Warranty", "5 Year / 60,000 Mile* Powertrain Limited Warranty, Roadside Assistance & Courtesy Transportation",
        "First Maintenance Visit",
      ],
      "Performance & Mechanical": ["Stabilitrak, Stability Control System", "Steering Column, Tilt and Telescopic", "Tire Fill Alert (Excl Spare)"],
      "Connectivity & Technology": [
        "Keyless Open", "Keyless Start", "Remote Vehicle Starter System", "Audio System, 11\" Diagonal Color HD Touchscreen, AM/FM Stereo",
        "Wireless Apple CarPlay and Wireless Android Auto Capable", "Wireless Charging", "Buick Quiettuning with Active Noise Cancellation",
        "8 Years OnStar Basics", "3 Years OnStar One", "SiriusXM Audio w/Trial", "Rear Seat Reminder", "USB Ports, Rear, Dual, Charge-Only",
        "Audio System - 6 Speaker", "Driver Information Center, 8\" Diagonal Display",
      ],
      Interior: [
        "Windows, Power, Express Down All", "Seat Adjuster, Driver 8-Way Power", "40/60 Split-Bench Rear Folding Seat", "Seat Adjuster, Front Passenger 4-Way Manual",
        "Seat Adjuster, 2-Way Power Driver Lumbar Control", "Sensor, Cabin Humidity", "Air Conditioning, Single Zone Automatic Climate Control",
        "Lighting, Interior, Overhead Courtesy Lamp", "Visors, Driver/Frnt Passenger w/ Illuminated Vanity Mirrors", "Inside Rearview Mirror, Auto Dimming",
        "Engine Air Filtration Monitor", "Microfilter Technology", "Heated Wrapped, Flat Bottom Steering Wheel",
      ],
      Exterior: [
        "Rear Window Defroster", "Door Handles, Body Color", "Mirror Caps, Body Color", "Wheels, 19\" Avenir Premium Pearl Nickel Aluminum",
        "Body-Color Bodyside Moldings", "Headlamps, LED", "Daytime Running Lamps, LED", "Rear Liftgate, Power", "Lamps, Turn Signal Indicators Front LED",
        "Tail Lamps, LED", "Visors, Driver/Frnt Passenger",
      ],
      "Safety & Security": [
        "Buick Driver Confidence: *Intellibeam *Following Distance Indicator *Forward Collision Alert *Lane Keep Assist with Lane Departure Warning *Automatic Emergency Braking *Front Pedestrian Braking",
        "HD Rear Vision Camera", "Rear Park Assist", "Rear Cross Traffic Alert", "Lane Change Alert with Side Blind Zone Alert", "Adaptive Cruise Control",
        "Mirrors, Outside Heated, Power Adjustable Side Auto Dimming, Manual Folding w/ Turn Signal Indicators", "Wipers, Front Intermittent, Rainsense",
      ],
    },
    keyFeatures: {},
    colors: { exterior: { name: "Ocean Blue Metallic", code: null }, interior: { name: "Pebble Gray w/Whisper Beige", code: null } },
    assembly: { plant: null, city: "Bupyeong Gu, IN", country: "Korea" },
    transportMethod: null,
    factoryCodes: { dealer: null, emissions: null },
    epa: {
      city: 28, highway: 32, combined: 30, annualFuelCost: 1650, ghgScore: 6, smogScore: 6, rangeMiles: null,
      fuelType: "Gasoline or E85", atvType: "FFV", gallonsPer100Miles: 3.3, co2TailpipeGpm: 297, fiveYearCostDifference: 250,
      classNote: "Small station wagons range from 17 to 121 MPG. The best vehicle rates 146 MPGe. Values are based on gasoline and do not reflect performance and ratings based on E85.",
    },
    safety: { overall: null, frontalDriver: 5, frontalPassenger: 4, sideFront: null, sideRear: null, rollover: 4 },
    nhtsaNotRated: false,
    dealerRole: "original_delivery",
    dealer: { name: "Champion Buick GMC Inc", address: "7885 W Grand River", city: "Brighton", state: "MI", zip: "48114-9338", phone: null },
    warranty: {
      basic: "3 Year / 36,000 Mile* Bumper-to-Bumper Limited Warranty", powertrain: "5 Year / 60,000 Mile* Powertrain Limited Warranty",
      corrosion: null, roadside: null, emissions: null,
    },
    partsContent: [
      { label: "U.S./Canadian Parts Content", value: "3%" },
      { label: "Major Sources of Foreign Parts Content", value: "Korea: 53%" },
      { label: "Major Sources of Foreign Parts Content", value: "China: 20%" },
      { label: "Engine", value: "Mexico" },
      { label: "Transmission", value: "Mexico" },
    ],
    generic: false,
    disclaimers: [],
  };
}
