import { describe, expect, it } from "vitest";
import {
  isVehicleClassLabel, normalizeEquipment, scoreEquipment, selectEquipment, SELECTED_EQUIPMENT_NOTE,
  type ClassifiedItem,
} from "./equipmentSelection";
import { classifiedEquipment } from "./render/contract";
import { qx55ClassFixture } from "./render/__fixtures__/renderData";

const items = (rows: Array<[string, ClassifiedItem["category"]?, boolean?]>): ClassifiedItem[] =>
  rows.map(([item, category = "OTHER", key = false], order) => ({ item, category, key, order }));

describe("equipment normalization", () => {
  it("collapses exact and case-insensitive duplicates to one line", () => {
    const { lines, total } = normalizeEquipment(items([["Heated Seats"], ["heated seats"], ["HEATED  SEATS"], ["Sunroof"]]));
    expect(lines.map((l) => l.text)).toEqual(["Heated Seats", "Sunroof"]);
    expect(total).toBe(2);
  });

  it("collapses an item present in both the standard and key-feature layers", () => {
    const data = { ...qx55ClassFixture(), standardEquipment: { STANDARD: ["Apple CarPlay", "Turbo Boost"] }, keyFeatures: { adas: ["apple carplay", "ProPILOT Assist"] } };
    const classified = classifiedEquipment(data);
    expect(classified.map((c) => c.item)).toEqual(["Apple CarPlay", "Turbo Boost", "ProPILOT Assist"]);
    expect(classified.find((c) => c.item === "Apple CarPlay")!.key).toBe(true);
    expect(classified.find((c) => c.item === "Turbo Boost")!.key).toBe(false);
  });

  it("groups siblings that share a prefix before a dash", () => {
    const { lines } = normalizeEquipment(items([["LED Headlights-Low Beam", "EXTERIOR"], ["LED Headlights-High Beam", "EXTERIOR"], ["Sunroof", "EXTERIOR"]]));
    expect(lines.map((l) => l.text)).toEqual(["LED Headlights: Low Beam, High Beam", "Sunroof"]);
    expect(lines[0].sources).toEqual(["LED Headlights-Low Beam", "LED Headlights-High Beam"]);
  });

  it("groups siblings that share a prefix before a parenthesis", () => {
    const { lines } = normalizeEquipment(items([["Cargo Cover (Retractable)"], ["Cargo Cover (Tonneau)"]]));
    expect(lines.map((l) => l.text)).toEqual(["Cargo Cover: Retractable, Tonneau"]);
  });

  it("merges front and rear pairs only when the values match", () => {
    const same = normalizeEquipment(items([["Front Wheel Width (8 in)"], ["Rear Wheel Width (8 in)"]]));
    expect(same.lines.map((l) => l.text)).toEqual(["Front/Rear Wheel Width (8 in)"]);
    const differ = normalizeEquipment(items([["Front Wheel Width (8 in)"], ["Rear Wheel Width (9 in)"]]));
    expect(differ.lines).toHaveLength(2);
  });

  it("does not merge unrelated hyphenated words or items in different categories", () => {
    expect(normalizeEquipment(items([["Anti-lock Brakes"], ["Anti-theft System"], ["Wi-Fi Hotspot"]])).lines).toHaveLength(3);
    expect(normalizeEquipment(items([["Seat-Heated", "INTERIOR"], ["Seat-Ventilated", "COMFORT_CONVENIENCE"]])).lines).toHaveLength(2);
  });

  it("excludes body-class labels from the sticker but counts them as verified", () => {
    for (const label of ["Full Size SUV", "Executive SUV", "Compact SUV", "Luxury Midsize SUV"]) expect(isVehicleClassLabel(label)).toBe(true);
    expect(isVehicleClassLabel("Heated Seats")).toBe(false);
    expect(isVehicleClassLabel("SUV Roof Rails")).toBe(false);
    const { lines, total } = normalizeEquipment(items([["Full Size SUV"], ["Sunroof"]]));
    expect(lines.map((l) => l.text)).toEqual(["Sunroof"]);
    expect(total).toBe(2);
  });

  it("only rearranges source words and records every source", () => {
    const rows = items([
      ["LED Headlights-Low Beam", "EXTERIOR"], ["LED Headlights-High Beam", "EXTERIOR"],
      ["Front Wheel Width (8 in)", "EXTERIOR"], ["Rear Wheel Width (8 in)", "EXTERIOR"], ["Sunroof", "EXTERIOR"],
    ]);
    const { lines } = normalizeEquipment(rows);
    const sourceWords = new Set(rows.flatMap((r) => r.item.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
    for (const line of lines) {
      for (const w of line.text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) expect(sourceWords.has(w)).toBe(true);
      expect(line.sources.length).toBeGreaterThan(0);
    }
    expect(lines.flatMap((l) => l.sources).sort()).toEqual(rows.map((r) => r.item).sort());
  });
});

describe("significance ranking", () => {
  it("ranks key features and marquee systems above engineering trivia", () => {
    const key = scoreEquipment("Cabin Air Filter", "COMFORT_CONVENIENCE", true);
    const engine = scoreEquipment("3.5L V6 Engine", "POWERTRAIN", false);
    const adas = scoreEquipment("Adaptive Cruise Control", "SAFETY_SECURITY", false);
    const audio = scoreEquipment("Bose Premium Audio", "TECHNOLOGY", false);
    const roof = scoreEquipment("Panoramic Moonroof", "EXTERIOR", false);
    const trivia = [
      scoreEquipment("Front Wheel Width (8 in)", "EXTERIOR", false),
      scoreEquipment("Isofix Child Seat Anchors", "INTERIOR", false),
      scoreEquipment("Spacesaver Spare Wheel", "EXTERIOR", false),
      scoreEquipment("Cargo Area Light", "FUNCTIONAL", false),
    ];
    for (const s of [key, engine, adas, audio, roof]) for (const t of trivia) expect(s).toBeGreaterThan(t);
  });

  it("is deterministic and breaks ties by source order", () => {
    const rows = items([["Alpha Trim", "OTHER"], ["Beta Trim", "OTHER"], ["Gamma Trim", "OTHER"]]);
    const { lines } = normalizeEquipment(rows);
    expect(selectEquipment(lines, 2).map((l) => l.text)).toEqual(["Alpha Trim", "Beta Trim"]);
    expect(selectEquipment(lines, 2)).toEqual(selectEquipment(lines, 2));
  });

  it("selects the top lines then prints them in category order, source order within a category", () => {
    const rows = items([
      ["Wheel Trim", "EXTERIOR"], ["Heated Seats", "COMFORT_CONVENIENCE"], ["Turbo Engine", "POWERTRAIN"],
      ["Adaptive Cruise Control", "SAFETY_SECURITY"], ["Cargo Area Light", "FUNCTIONAL"], ["Leather Seats", "COMFORT_CONVENIENCE"],
    ]);
    const { lines } = normalizeEquipment(rows);
    const picked = selectEquipment(lines, 4).map((l) => l.text);
    expect(picked).toEqual(["Turbo Engine", "Heated Seats", "Leather Seats", "Adaptive Cruise Control"]);
    expect(selectEquipment(lines, 99)).toHaveLength(6);
    expect(selectEquipment(lines, 0)).toEqual([]);
  });

  it("nests selections: a larger count keeps everything a smaller one printed", () => {
    const rows = items(Array.from({ length: 30 }, (_, i) => [`Verified Feature ${i} Trim`, "OTHER", i % 7 === 0] as [string, "OTHER", boolean]));
    const { lines } = normalizeEquipment(rows);
    const small = new Set(selectEquipment(lines, 8).map((l) => l.text));
    const large = new Set(selectEquipment(lines, 16).map((l) => l.text));
    for (const t of small) expect(large.has(t)).toBe(true);
  });

  it("states the selected-equipment pointer verbatim", () => {
    expect(SELECTED_EQUIPMENT_NOTE).toBe("Selected standard equipment shown. Scan for complete vehicle specifications.");
  });
});
