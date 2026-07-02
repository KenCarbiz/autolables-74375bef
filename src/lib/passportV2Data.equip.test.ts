import { describe, it, expect } from "vitest";
import { cleanEquipmentList } from "./passportV2Data";

// ──────────────────────────────────────────────────────────────
// Equipment canonicalization: the NeoVIN decode emits every variant
// of one feature as its own row plus hundreds of engineering spec
// rows. These regressions keep the overview/highlights panels from
// regressing back into the six-sunroof card dump.
// ──────────────────────────────────────────────────────────────

describe("concept-family merge", () => {
  it("collapses six sunroof variants into one row", () => {
    const out = cleanEquipmentList([
      "Front Sunroof", "Glass Sunroof", "One-Touch Opening Sunroof-Front",
      "Panoramic Sunroof", "Power Sunroof", "Sunroof-Tilting",
    ]);
    expect(out).toEqual(["Panoramic sunroof"]);
  });

  it("collapses headlight variants and keeps the LED qualifier", () => {
    const out = cleanEquipmentList(["Headlights", "Headlight Control", "LED Headlights-Low Beam", "Auto High-Beam Headlights"]);
    expect(out).toEqual(["LED headlights (auto high-beam)"]);
  });

  it("collapses heated and ventilated seat variants", () => {
    const out = cleanEquipmentList(["Heated Front Seats", "Heated Rear Seats", "Ventilated Front Seats", "Climate Controlled Front Seats"]);
    expect(out).toEqual(["Heated & ventilated seats"]);
  });

  it("keeps a single family member's own wording", () => {
    const out = cleanEquipmentList(["Panoramic Sunroof", "Tow Hitch"]);
    expect(out).toEqual(["Panoramic Sunroof", "Tow Hitch"]);
  });
});

describe("spec and engineering noise", () => {
  it("drops parenthesized measurements and chassis dimensions", () => {
    const out = cleanEquipmentList([
      "Front Wheel Diameter (21 in)", "Front Wheel Width (8.5 in)", "Short Wheelbase",
      "Cargo Volume (75.4 cu ft)", "Tow Hitch",
    ]);
    expect(out).toEqual(["Tow Hitch"]);
  });

  it("drops sub-attribute rows but keeps shopper-meaningful warnings", () => {
    const out = cleanEquipmentList([
      "Activates Brake Lights", "Activates Seat Belts", "Seat belt warning",
      "Blind Spot Warning", "Low Tire Pressure Warning",
    ]);
    expect(out).toEqual(["Blind Spot Warning", "Low Tire Pressure Warning"]);
  });
});

describe("containment dedupe", () => {
  it("drops a generic item whose words are a subset of a specific sibling", () => {
    const out = cleanEquipmentList(["Roof Rails", "Aluminum Roof Rails", "Third Row Seat", "Power Third Row Seat"]);
    expect(out).toEqual(["Aluminum Roof Rails", "Power Third Row Seat"]);
  });

  it("treats plural and singular tokens as the same word", () => {
    const out = cleanEquipmentList(["Fog Light", "LED Fog Lights"]);
    expect(out).toEqual(["LED Fog Lights"]);
  });

  it("keeps genuinely distinct items", () => {
    const out = cleanEquipmentList(["Leather Steering Wheel", "Tow Hitch", "Wireless Phone Charging"]);
    expect(out).toEqual(["Leather Steering Wheel", "Tow Hitch", "Wireless Phone Charging"]);
  });
});
