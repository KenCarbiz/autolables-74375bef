import { describe, it, expect } from "vitest";
import { readBuildSheet, classifyPackage } from "./buildSheet";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const listingWith = (build_sheet: unknown): VehicleListing =>
  ({ mc_attributes: { build_sheet } } as unknown as VehicleListing);

const SHEET = {
  packages: [
    { name: "Premium Package", msrp: 2900, contents: ["Panoramic Moonroof", "Bose Premium Audio", "B93", "Ventilated Front Seats"] },
    { name: "Lighting Package", msrp: 640, contents: ["LED Fog Lamps"] },
  ],
  options: [
    { name: "Illuminated Kick Plates", msrp: 465 },
    { name: "Tow Hitch Receiver" },
    { name: "L92" },
  ],
  key_features: {
    adas: ["ProPILOT Assist", "Blind Spot Warning"],
    infotainment: ["Wireless Apple CarPlay", "12.3-inch Touchscreen"],
    seats: ["Heated Front Seats"],
  },
  standard: {
    safety_features: ["Automatic Emergency Braking", "IIHS Top Safety Pick"],
    exterior_lighting: ["LED Headlights"],
    misc: ["Cup Holders", "Rear Spoiler"],
  },
  generic: false,
  decoded_at: "2026-07-01T00:00:00Z",
  source: "neovin",
};

describe("readBuildSheet", () => {
  const sheet = readBuildSheet(listingWith(SHEET))!;

  it("returns null when no structured decode exists", () => {
    expect(readBuildSheet(listingWith(undefined))).toBeNull();
    expect(readBuildSheet(listingWith({ packages: [], options: [], key_features: {}, standard: {} }))).toBeNull();
  });

  it("keeps packages with MSRP and denoised contents", () => {
    expect(sheet.packages).toHaveLength(2);
    expect(sheet.packages[0].msrp).toBe(2900);
    // The option code inside the package contents is stripped.
    expect(sheet.packages[0].contents).toEqual(["Panoramic Moonroof", "Bose Premium Audio", "Ventilated Front Seats"]);
  });

  it("denoises standalone options but keeps their MSRPs", () => {
    expect(sheet.options.map((o) => o.name)).toEqual(["Illuminated Kick Plates", "Tow Hitch Receiver"]); // L92 dropped
    expect(sheet.options[0].msrp).toBe(465);
  });

  it("maps feed categories to shopper order, safety first", () => {
    const cats = sheet.keyFeatures.map(([c]) => c);
    expect(cats[0]).toBe("Safety & Driver Assistance");
    expect(cats).toContain("Technology & Connectivity");
    expect(cats).toContain("Seating & Interior");
  });

  it("cleans ratings noise out of standard equipment and counts it", () => {
    const safety = sheet.standard.find(([c]) => c === "Safety & Driver Assistance")?.[1] ?? [];
    expect(safety).toContain("Automatic Emergency Braking");
    expect(safety).not.toContain("IIHS Top Safety Pick");
    expect(sheet.standardCount).toBeGreaterThan(0);
  });

  it("totals visible option value from known MSRPs", () => {
    expect(sheet.estValue).toBe(2900 + 640 + 465);
  });

  it("flags generic (typical-for-trim) decodes", () => {
    const g = readBuildSheet(listingWith({ ...SHEET, generic: true }))!;
    expect(g.generic).toBe(true);
  });
});

describe("truck package organization", () => {
  it("classifies typical American-truck package names", () => {
    expect(classifyPackage("Equipment Group 302A High")).toBe("Equipment Group");
    expect(classifyPackage("Preferred Equipment Group 1LT")).toBe("Equipment Group");
    expect(classifyPackage("Trailer Tow Package")).toBe("Towing & Hauling");
    expect(classifyPackage("Max Trailer Tow Package")).toBe("Towing & Hauling");
    expect(classifyPackage("FX4 Off-Road Package")).toBe("Off-Road");
    expect(classifyPackage("Z71 Off Road and Protection Package")).toBe("Off-Road");
    expect(classifyPackage("Ford Co-Pilot360 Assist 2.0")).toBe("Safety & Technology");
    expect(classifyPackage("Cold Weather Package")).toBe("Comfort & Convenience");
    expect(classifyPackage("Chrome Appearance Package")).toBe("Appearance & Wheels");
    expect(classifyPackage("Bed Utility Package")).toBe("Protection & Utility");
    expect(classifyPackage("Mystery Bundle")).toBe("Other Packages");
  });

  it("orders packages: equipment group first, then by kind, biggest MSRP first within kind", () => {
    const truck = readBuildSheet(listingWith({
      packages: [
        { name: "Chrome Appearance Package", msrp: 995, contents: [] },
        { name: "Trailer Tow Package", msrp: 1195, contents: [] },
        { name: "Max Trailer Tow Package", msrp: 2295, contents: [] },
        { name: "Equipment Group 302A High", msrp: 3500, contents: [] },
        { name: "FX4 Off-Road Package", msrp: 1005, contents: [] },
        { name: "Bed Utility Package", msrp: 350, contents: [] },
      ],
      options: [], key_features: {}, standard: {}, generic: false,
    }))!;
    expect(truck.packages.map((p) => p.name)).toEqual([
      "Equipment Group 302A High",
      "Max Trailer Tow Package",   // towing, higher MSRP first
      "Trailer Tow Package",
      "FX4 Off-Road Package",
      "Chrome Appearance Package",
      "Bed Utility Package",
    ]);
    expect(truck.estValue).toBe(995 + 1195 + 2295 + 3500 + 1005 + 350);
  });
});
