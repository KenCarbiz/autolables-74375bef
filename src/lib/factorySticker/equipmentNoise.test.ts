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
  // A 2021 GMC Yukon Denali, so GM's own terminology applies.
  const result = curateEquipment(YUKON_RAW, { make: "GMC" });
  const names = result.items.map((i) => i.name);

  it("collapses seven sunroof rows into one", () => {
    const sunroofRows = names.filter((n) => /sunroof|roof/i.test(n));
    expect(sunroofRows).toHaveLength(1);
    // "Panoramic" is present in the source, so the upgraded label is earned.
    expect(sunroofRows[0]).toBe("Panoramic Sunroof");
    expect(result.collapsed.sunroof.length).toBeGreaterThanOrEqual(6);
  });

  it("collapses the braking fragments into GM's own term", () => {
    const braking = names.filter((n) => /brak/i.test(n));
    expect(braking).toHaveLength(1);
    expect(braking[0]).toBe("Automatic Emergency Braking");
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
    expect(curateEquipment(YUKON_RAW, { make: "GMC" }).items.map((i) => i.name)).toEqual(names);
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
  const { items } = curateEquipment(YUKON_RAW, { make: "GMC" });

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

// The manufacturers spend heavily naming these systems. Printing one generic
// phrase across every brand is what makes a sticker read as generated.
describe("OEM terminology", () => {
  const AEB_ROWS = ["Automatic Braking", "Brakes At Low Speed"];

  it("uses each manufacturer's own term for the same hardware", () => {
    const term = (make: string) => curateEquipment(AEB_ROWS, { make }).items[0].name;
    expect(term("GMC")).toBe("Automatic Emergency Braking");
    expect(term("Nissan")).toBe("Intelligent Emergency Braking");
    expect(term("Toyota")).toBe("Pre-Collision System");
    expect(term("Honda")).toBe("Collision Mitigation Braking System");
    expect(term("Subaru")).toBe("EyeSight Pre-Collision Braking");
    expect(term("Mercedes-Benz")).toBe("Active Brake Assist");
    expect(term("Volvo")).toBe("City Safety");
  });

  it("inherits the corporate family when the marque has no term of its own", () => {
    // Infiniti is Nissan; Acura is Honda; Genesis and Kia are Hyundai;
    // Cadillac is GM. None of them rename this system, so they inherit.
    const term = (make: string) => curateEquipment(AEB_ROWS, { make }).items[0].name;
    expect(term("Infiniti")).toBe(term("Nissan"));
    expect(term("Acura")).toBe(term("Honda"));
    expect(term("Genesis")).toBe(term("Hyundai"));
    expect(term("Kia")).toBe(term("Hyundai"));
    expect(term("Cadillac")).toBe(term("GMC"));
    expect(term("Ram")).toBe(term("Jeep"));
    expect(term("Mini")).toBe(term("BMW"));
  });

  it("lets a marque override its family where the names genuinely differ", () => {
    // Honda badges this "Multi-View Camera System"; Acura, "Surround-View".
    const cam = (make: string) =>
      curateEquipment(["360-Degree Camera"], { make }).items[0].name;
    expect(cam("Honda")).toBe("Multi-View Camera System");
    expect(cam("Acura")).toBe("Surround-View Camera System");
  });

  it("covers the makes sold in the US, not just the big families", () => {
    const term = (make: string) => curateEquipment(AEB_ROWS, { make }).items[0].name;
    expect(term("Mitsubishi")).toBe("Forward Collision Mitigation");
    expect(term("Volkswagen")).toBe("Front Assist");
    expect(term("Audi")).toBe("Audi pre sense front");
    expect(term("Porsche")).toBe("Warn and Brake Assist");
    expect(term("Land Rover")).toBe("Emergency Braking");
    expect(term("Jaguar")).toBe("Emergency Braking");
    expect(term("Polestar")).toBe("City Safety");
    expect(term("Rivian")).toBe("Automatic Emergency Braking");
    expect(term("Lucid")).toBe("Automatic Emergency Braking");
  });

  it("does not promote a plain powered gate to hands-free", () => {
    // Hands-free is a separate option on every one of these lines.
    const gate = (make: string, rows: string[]) => curateEquipment(rows, { make }).items[0].name;
    expect(gate("Toyota", ["Power Liftgate"])).toBe("Power Back Door");
    expect(gate("GMC", ["Power Liftgate"])).toBe("Power Liftgate");
    // ...but when the source says hands-free, the maker's own name for THAT wins.
    expect(gate("Toyota", ["Power Liftgate", "Hands-Free Liftgate"])).toBe("Hands-Free Power Back Door");
    expect(gate("Nissan", ["Power Liftgate", "Motion Activated Liftgate"])).toBe("Motion Activated Liftgate");
  });

  it("uses the OEM name for high beams rather than a description", () => {
    const term = (make: string) =>
      curateEquipment(["Auto High Beam", "Dusk Sensor"], { make }).items[0].name;
    expect(term("Chevrolet")).toBe("IntelliBeam");        // GM's own name
    expect(term("Nissan")).toBe("High Beam Assist");
    expect(term("Mercedes-Benz")).toBe("Adaptive Highbeam Assist");
  });

  it("names a panoramic roof the way the maker does", () => {
    const rows = ["Front Panoramic Roof", "Glass Sunroof"];
    expect(curateEquipment(rows, { make: "Ford" }).items[0].name).toBe("Panoramic Vista Roof");
    expect(curateEquipment(rows, { make: "Jeep" }).items[0].name)
      .toBe("CommandView Dual-Pane Panoramic Sunroof");
    expect(curateEquipment(rows, { make: "GMC" }).items[0].name).toBe("Panoramic Sunroof");
  });

  it("never overrides a branded system name found in the source", () => {
    // Rule 1: what the decoder actually said outranks our table.
    const nissan = curateEquipment(["ProPILOT Assist 2.1", "Adaptive Cruise Control"], { make: "Nissan" });
    expect(nissan.items[0].name).toBe("ProPILOT Assist 2.1");
    expect(nissan.items[0].branded).toBe(true);

    const audio = curateEquipment(["Bose Performance Audio - 24 Speakers", "Subwoofer"], { make: "Infiniti" });
    expect(audio.items[0].name).toBe("Bose Performance Audio - 24 Speakers");
  });

  it("does not append explanatory tails to an OEM term", () => {
    // "w/ Pedestrian Detection" is our words, not the manufacturer's.
    for (const make of ["GMC", "Nissan", "Honda", "Hyundai"]) {
      const name = curateEquipment([...AEB_ROWS, "Pedestrian & Cyclist Avoidance System"], { make }).items[0].name;
      expect(name).not.toMatch(/\bw\//);
    }
  });

  // Everything below guards the same rule from a different angle: a printed
  // claim must be supported by a source row. A sticker that overstates the car
  // is worse than one that reads plainly.
  it("does not assert an audio brand or the word premium from a speaker count", () => {
    const plain = curateEquipment(["6 Speakers"], { make: "GMC" }).items[0].name;
    expect(plain).toBe("Audio System");
    // Earned two ways: a premium signal in the source...
    expect(curateEquipment(["14 Speakers", "Subwoofer"], { make: "GMC" }).items[0].name)
      .toBe("Premium Audio System");
    // ...or the brand itself, which then prints verbatim.
    expect(curateEquipment(["6 Speakers", "Bose Premium Audio"], { make: "GMC" }).items[0].name)
      .toBe("Bose Premium Audio");
  });

  it("does not turn Bluetooth into CarPlay", () => {
    expect(curateEquipment(["Bluetooth Connection"]).items[0].name).toBe("Smartphone Integration");
    // Naming one platform is not evidence of the other: this used to print
    // "Apple CarPlay and Android Auto" from a CarPlay-only row.
    const both = curateEquipment(["Bluetooth Connection", "Apple CarPlay"]).items.map((i) => i.name);
    expect(both).toContain("Apple CarPlay");
    expect(both.join(" | ")).not.toMatch(/android/i);
  });

  it("does not turn digital radio into a satellite subscription", () => {
    expect(curateEquipment(["Digital Radio", "RDS Audio"]).items[0].name).toBe("Digital Radio");
    expect(curateEquipment(["Digital Radio", "Satellite Radio"]).items[0].name).toBe("Satellite Radio");
  });

  it("never claims hands-free driving for a system that requires hands", () => {
    // Every one of these is hands-ON. Naming them here would print a
    // hands-free claim onto a car that cannot do it.
    const rows = ["Hands-Free Driving Assistance"];
    for (const make of ["Nissan", "Infiniti", "Hyundai", "Kia", "Genesis", "Volvo", "Tesla", "Toyota"]) {
      const name = curateEquipment(rows, { make }).items[0].name;
      expect(name).not.toMatch(/ProPILOT|Highway Driving Assist|Pilot Assist|Autopilot|Teammate/);
    }
  });

  it("does not append a bundled second feature we print on its own line", () => {
    // "BLIS with Cross-Traffic Alert" next to a Cross-Traffic Alert row states
    // the same equipment twice and asserts CTA on cars without it.
    const rows = ["Blind Spot Monitoring", "Rear Cross Traffic Alert"];
    for (const make of ["GMC", "Ford", "Jeep", "Subaru", "Mitsubishi"]) {
      const names = curateEquipment(rows, { make }).items.map((i) => i.name);
      expect(names).toHaveLength(2);
      expect(names[0]).not.toMatch(/ with /i);
    }
  });

  it("falls back to a neutral term when the make is unknown", () => {
    expect(curateEquipment(AEB_ROWS).items[0].name).toBe("Automatic Emergency Braking");
    expect(curateEquipment(AEB_ROWS, { make: "Koenigsegg" }).items[0].name)
      .toBe("Automatic Emergency Braking");
  });
});
