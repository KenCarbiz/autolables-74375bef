import { describe, it, expect } from "vitest";
import { cleanEquipmentList } from "./passportV2Data";

describe("cleanEquipmentList", () => {
  it("drops raw option codes", () => {
    expect(cleanEquipmentList(["B10", "E10", "Heated Seats"])).toEqual(["Heated Seats"]);
  });

  it("drops metadata, ratings, and paint noise", () => {
    const out = cleanEquipmentList([
      "MSRP",
      "IIHS Top Safety Pick",
      "Frontal Crash",
      "Metallic Paint",
      "Panoramic Moonroof",
    ]);
    expect(out).toEqual(["Panoramic Moonroof"]);
  });

  it("removes generic category filler", () => {
    expect(cleanEquipmentList(["Engine", "Transmission", "Power Windows", "Apple CarPlay"]))
      .toEqual(["Apple CarPlay"]);
  });

  it("de-dupes across US/UK spelling and casing", () => {
    const out = cleanEquipmentList(["Alloy Wheels", "alloy wheels", "Colour Display", "Color Display"]);
    expect(out).toEqual(["Alloy Wheels", "Color Display"]);
  });

  it("keeps real features and preserves order", () => {
    const input = ["Navigation System", "Bose Audio", "Blind Spot Warning"];
    expect(cleanEquipmentList(input)).toEqual(input);
  });

  it("returns an empty list when everything is noise", () => {
    expect(cleanEquipmentList(["B10", "MSRP", "Engine", ""])).toEqual([]);
  });
});
