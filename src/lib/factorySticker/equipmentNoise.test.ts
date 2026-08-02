import { describe, it, expect } from "vitest";
import { curateEquipment, isDecoderNoise, selectForPageOne } from "./equipmentNoise";

// Verbatim rows from the 2021 GMC Yukon Denali fixture (VIN 1GKS2DKL7MR290552)
// that the current sticker prints raw. This is the regression corpus.
const YUKON_RAW = [
  "Power Retractable Running Boards",
  "Illuminated Step",
  "Front Sunroof",
  "Glass Sunroof",
  "Electric Sunroof-Front",
  "Tilting Sunroof-Front",
  "Sliding Sunroof-Front",
  "Sunshade",
  "One-Touch Opening Sunroof-Front",
  "Front Panoramic Roof",
  "Interior Monitoring Anti-Theft Protection",
  "Rear View Mirror/Camera",
  "Steering Wheel Mounted Cruise Controls",
  "Adaptive Cruise Control",
  "Stop Function Cruise Control",
  "Blue",
  "Front Wheel Diameter (22 in)",
  "Rear Wheel Diameter (22 in)",
  "Front Two-Tone Wheels",
  "Rear Two-Tone Wheels",
  "Locking Front Wheel Nuts",
  "Locking Rear Wheel Nuts",
  "All Season Tires",
  "Front Aluminum Alloy Wheels",
  "Rear Aluminum Alloy Wheels",
  "Front Wheel Width (9 in)",
  "Rear Wheel Width (9 in)",
  "Front Wheel Diameter (20 in)",
  "Rear Wheel Diameter (20 in)",
  "Anti-Theft Protection",
  "Auto Dimming Rear View Mirror/Camera",
  "Activates Brake Lights",
  "Automatic Braking",
  "Brakes At Low Speed",
  "Pedestrian & Cyclist Avoidance System",
  "Visual/Acoustic Warning",
  "Operates Above 130 Kph/78 Mph",
  "Operates Above 50 Kph/30 Mph",
  "Operates Below 50 Kph/30 Mph",
  "Cruise Control",
  "Speed Limiter",
  "Door Entry Light",
  "14 Speakers",
  "Premium Brand Speakers",
  "Subwoofer",
  "Surround Sound Speakers",
  "Complex Surface Headlights",
  "LED Headlights-Low Beam",
  "LED Headlights-High Beam",
  "Dusk Sensor",
  "Auto High Beam",
  "Daytime Running Lights",
  "Front Fog Lights",
  "RDS Audio",
  "Digital Radio",
  "Satellite Radio",
  "Color Screen Audio System",
  "Bluetooth Connection",
  "Built-in Apps",
];

describe("isDecoderNoise", () => {
  it("drops speed-threshold implementation fragments", () => {
    expect(isDecoderNoise("Operates Above 130 Kph/78 Mph")).toBe(true);
    expect(isDecoderNoise("Operates Below 50 Kph/30 Mph")).toBe(true);
  });

  it("drops standalone color words", () => {
    expect(isDecoderNoise("Blue")).toBe(true);
    expect(isDecoderNoise("Midnight Blue")).toBe(true);
    // But a real feature that merely contains a color word survives.
    expect(isDecoderNoise("Blue Tooth Hands-Free Calling")).toBe(false);
  });

  it("drops per-corner wheel dimension attributes", () => {
    for (const s of [
      "Front Wheel Diameter (22 in)", "Rear Wheel Diameter (20 in)",
      "Front Wheel Width (9 in)", "Rear Wheel Width (9 in)",
    ]) expect(isDecoderNoise(s)).toBe(true);
  });

  it("drops component-level flags and bare taxonomy labels", () => {
    expect(isDecoderNoise("Activates Brake Lights")).toBe(true);
    expect(isDecoderNoise("Visual/Acoustic Warning")).toBe(true);
    expect(isDecoderNoise("Standard")).toBe(true);
    expect(isDecoderNoise("Front")).toBe(true);
    expect(isDecoderNoise("")).toBe(true);
  });

  it("keeps genuine equipment", () => {
    for (const s of [
      "Power Retractable Running Boards", "Adaptive Cruise Control",
      "Daytime Running Lights", "All Season Tires", "Sunshade",
    ]) expect(isDecoderNoise(s)).toBe(false);
  });
});

describe("curateEquipment on the Yukon fixture", () => {
  const result = curateEquipment(YUKON_RAW);
  const names = result.items.map((i) => i.name);

  it("collapses seven sunroof rows into one", () => {
    const sunroofRows = names.filter((n) => /sunroof|roof/i.test(n));
    expect(sunroofRows).toHaveLength(1);
    // "Panoramic" is present in the source, so the upgraded label is earned.
    expect(sunroofRows[0]).toBe("Panoramic Sunroof");
    expect(result.collapsed.sunroof.length).toBeGreaterThanOrEqual(6);
  });

  it("collapses the braking fragments into one accurate entry", () => {
    const braking = names.filter((n) => /brak/i.test(n));
    expect(braking).toHaveLength(1);
    expect(braking[0]).toBe("Automatic Emergency Braking w/ Pedestrian Detection");
  });

  it("does not print contradictory wheel sizes", () => {
    expect(names.some((n) => /22 in|20 in|9 in/.test(n))).toBe(false);
  });

  it("prints no standalone color word", () => {
    expect(names).not.toContain("Blue");
  });

  it("keeps adaptive cruise distinct from plain cruise control", () => {
    // They are different features; collapsing them would understate the car.
    expect(names).toContain("Adaptive Cruise Control");
    expect(names.filter((n) => /cruise/i.test(n)).length).toBeLessThanOrEqual(2);
  });

  it("collapses the speaker rows into one audio entry", () => {
    const audio = names.filter((n) => /speaker|audio|subwoofer/i.test(n));
    expect(audio.length).toBeLessThanOrEqual(2);
  });

  it("cuts the list to roughly a third without inventing anything", () => {
    expect(result.items.length).toBeLessThan(YUKON_RAW.length / 2);
    // Every printed row traces to at least one source row.
    for (const item of result.items) {
      expect(item.sources.length).toBeGreaterThan(0);
      for (const src of item.sources) expect(YUKON_RAW).toContain(src);
    }
  });

  it("emits no duplicate printed labels", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("is deterministic", () => {
    expect(curateEquipment(YUKON_RAW).items.map((i) => i.name)).toEqual(names);
  });

  it("orders the most meaningful equipment first", () => {
    // Tier 1 safety/comfort features must lead so page 1 carries them.
    const firstFive = names.slice(0, 5);
    expect(firstFive.some((n) => /Emergency Braking/.test(n))).toBe(true);
    expect(result.items[0].tier).toBe(1);
    const tiers = result.items.map((i) => i.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });
});

describe("selectForPageOne", () => {
  const { items } = curateEquipment(YUKON_RAW);

  it("keeps everything when it fits", () => {
    const { pageOne, continuation } = selectForPageOne(items, 100);
    expect(pageOne).toHaveLength(items.length);
    expect(continuation).toHaveLength(0);
  });

  it("fills page one by priority and overflows the rest", () => {
    const { pageOne, continuation } = selectForPageOne(items, 8);
    expect(pageOne).toHaveLength(8);
    expect(continuation).toHaveLength(items.length - 8);
    // The highest tier present must be on page 1, never pushed to page 2.
    expect(Math.min(...pageOne.map((i) => i.tier))).toBe(1);
    expect(Math.min(...continuation.map((i) => i.tier)))
      .toBeGreaterThanOrEqual(Math.max(...pageOne.map((i) => i.tier)));
  });
});
