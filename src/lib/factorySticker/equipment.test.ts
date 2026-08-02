import { describe, expect, it } from "vitest";
import {
  buildEquipment,
  categorizeEquipmentItem,
  categoryFromHint,
  CATEGORY_ORDER,
  dedupeKey,
  normalizeEquipmentName,
} from "./equipment";

describe("normalizeEquipmentName", () => {
  it("collapses repeated whitespace and trims", () => {
    expect(normalizeEquipmentName("  Heated   Front  Seats ")).toBe("Heated Front Seats");
  });

  it("collapses repeated punctuation", () => {
    expect(normalizeEquipmentName("BOSE PERFORMANCE AUDIO -- 24 SPEAKERS")).toBe(
      "Bose Performance Audio - 24 Speakers",
    );
  });

  it("strips trailing separator punctuation", () => {
    expect(normalizeEquipmentName("HEATED FRONT SEATS,,")).toBe("Heated Front Seats");
  });

  it("title-cases shout-case feed strings", () => {
    expect(normalizeEquipmentName("FORWARD COLLISION WARNING")).toBe("Forward Collision Warning");
  });

  it("keeps small words lowercase except in first position", () => {
    expect(normalizeEquipmentName("HEATED SEATS W/ MEMORY AND LUMBAR")).toBe("Heated Seats w/ Memory and Lumbar");
  });

  it("restores known acronym marks from shout case", () => {
    expect(normalizeEquipmentName("LED HEADLIGHTS")).toBe("LED Headlights");
    expect(normalizeEquipmentName("A/C CONTROLS")).toBe("A/C Controls");
    expect(normalizeEquipmentName("IPOD INTERFACE")).toBe("iPod Interface");
    expect(normalizeEquipmentName("WIRELESS CARPLAY")).toBe("Wireless CarPlay");
    expect(normalizeEquipmentName("PROPILOT ASSIST 2.1")).toBe("ProPILOT Assist 2.1");
  });

  it("restores marks inside hyphenated tokens", () => {
    expect(normalizeEquipmentName("USB-C CHARGE PORTS")).toBe("USB-C Charge Ports");
  });

  it("preserves digit-bearing model-style tokens in shout case", () => {
    expect(normalizeEquipmentName("LARIAT EQUIPMENT GROUP 501A")).toBe("Lariat Equipment Group 501A");
    expect(normalizeEquipmentName("22-INCH DARK FORGED WHEELS")).toBe("22-Inch Dark Forged Wheels");
  });

  it("leaves deliberate mixed-case input intact", () => {
    expect(normalizeEquipmentName("eTorque Mild Hybrid")).toBe("eTorque Mild Hybrid");
    expect(normalizeEquipmentName("Premium LED Headlights")).toBe("Premium LED Headlights");
  });

  it("preserves short all-caps tokens in mixed-case input", () => {
    expect(normalizeEquipmentName("Intelligent AWD System")).toBe("Intelligent AWD System");
    expect(normalizeEquipmentName("Dual DOHC Cams")).toBe("Dual DOHC Cams");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeEquipmentName("   ")).toBe("");
  });
});

describe("categorizeEquipmentItem", () => {
  const cases: Array<[string, string]> = [
    ["LED Headlights", "EXTERIOR"],
    ["Roof Rail Crossbars", "EXTERIOR"],
    ["Semi-Aniline Leather Seats", "INTERIOR"],
    ["Heated Front Seats", "COMFORT_CONVENIENCE"],
    ["Panoramic Moonroof", "COMFORT_CONVENIENCE"],
    ["Cruise Control", "COMFORT_CONVENIENCE"],
    ["Tow Hitch Receiver", "FUNCTIONAL"],
    ["Cargo Net", "FUNCTIONAL"],
    ["Electronic Air Suspension", "FUNCTIONAL"],
    ["9-Speed Automatic Transmission", "POWERTRAIN"],
    ["3.5L V6 Twin-Turbo Engine", "POWERTRAIN"],
    ["Adaptive Cruise Control", "SAFETY_SECURITY"],
    ["Forward Collision Warning", "SAFETY_SECURITY"],
    ["10 Airbags", "SAFETY_SECURITY"],
    ["Blind Spot Monitor", "SAFETY_SECURITY"],
    ["Wireless CarPlay", "TECHNOLOGY"],
    ["Bose Performance Audio - 24 Speakers", "TECHNOLOGY"],
    ["Navigation System", "TECHNOLOGY"],
    ["Owner Welcome Kit", "OTHER"],
  ];
  it.each(cases)("%s -> %s", (name, category) => {
    expect(categorizeEquipmentItem(name)).toBe(category);
  });
});

describe("categoryFromHint", () => {
  it("maps feed category names onto sticker categories", () => {
    expect(categoryFromHint("adas")).toBe("SAFETY_SECURITY");
    expect(categoryFromHint("safety_features")).toBe("SAFETY_SECURITY");
    expect(categoryFromHint("infotainment")).toBe("TECHNOLOGY");
    expect(categoryFromHint("mechanical")).toBe("POWERTRAIN");
    expect(categoryFromHint("interior")).toBe("INTERIOR");
    expect(categoryFromHint("exterior")).toBe("EXTERIOR");
    expect(categoryFromHint("comfort_convenience")).toBe("COMFORT_CONVENIENCE");
  });

  it("returns undefined for unknown hints", () => {
    expect(categoryFromHint("miscellaneous")).toBeUndefined();
  });
});

describe("buildEquipment", () => {
  it("drops exact duplicates and records them", () => {
    const res = buildEquipment({
      standard: ["Power Liftgate", "Power Liftgate"],
      packages: [],
      options: [],
    });
    expect(res.standard.flatMap((g) => g.items)).toEqual(["Power Liftgate"]);
    expect(res.debug.droppedDuplicates).toEqual(["Power Liftgate"]);
    expect(res.debug.dedupeDecisions).toEqual([
      { item: "Power Liftgate", action: "DROPPED_DUPLICATE", keptIn: "standard:power_liftgate" },
    ]);
  });

  it("treats case/punctuation variants as the same item (conservative near-dupe)", () => {
    const res = buildEquipment({
      standard: ["HEATED FRONT SEATS", "Heated Front Seats."],
      packages: [],
      options: [],
    });
    expect(res.standard.flatMap((g) => g.items)).toEqual(["Heated Front Seats"]);
    expect(res.debug.droppedDuplicates.length).toBe(1);
  });

  it("does not merge genuinely different items", () => {
    const res = buildEquipment({
      standard: ["Heated Front Seats", "Heated Rear Seats"],
      packages: [],
      options: [],
    });
    expect(res.standard.flatMap((g) => g.items)).toHaveLength(2);
    expect(res.debug.droppedDuplicates).toEqual([]);
  });

  it("drops an option that duplicates a package feature and records the decision", () => {
    const res = buildEquipment({
      standard: [],
      packages: [
        { name: "Premium Package", priceStatus: "PRICED", price: 2500, features: ["Massaging Front Seats"] },
      ],
      options: [{ name: "MASSAGING FRONT SEATS", priceStatus: "UNAVAILABLE" }],
    });
    expect(res.options).toEqual([]);
    expect(res.debug.dedupeDecisions).toEqual([
      { item: "Massaging Front Seats", action: "DROPPED_PACKAGE_CONTENT", keptIn: "package:Premium Package" },
    ]);
  });

  it("drops an option whose name matches a package name", () => {
    const res = buildEquipment({
      standard: [],
      packages: [{ name: "Trailer Tow Package", priceStatus: "PRICED", price: 2200, features: [] }],
      options: [{ name: "Trailer Tow Package", priceStatus: "UNAVAILABLE" }],
    });
    expect(res.options).toEqual([]);
    expect(res.debug.dedupeDecisions[0].action).toBe("DROPPED_PACKAGE_CONTENT");
  });

  it("keeps options that do not overlap package contents", () => {
    const res = buildEquipment({
      standard: [],
      packages: [{ name: "Premium Package", priceStatus: "UNAVAILABLE", features: ["Rear Seat Entertainment"] }],
      options: [{ name: "Roof Rail Crossbars", priceStatus: "PRICED", price: 375 }],
    });
    expect(res.options.map((o) => o.name)).toEqual(["Roof Rail Crossbars"]);
  });

  it("dedupes features inside a package", () => {
    const res = buildEquipment({
      standard: [],
      packages: [
        { name: "Cold Weather Package", priceStatus: "UNAVAILABLE", features: ["Heated Steering Wheel", "HEATED STEERING WHEEL"] },
      ],
      options: [],
    });
    expect(res.packages[0].features).toEqual(["Heated Steering Wheel"]);
  });

  it("dedupes duplicate packages keeping the first", () => {
    const res = buildEquipment({
      standard: [],
      packages: [
        { name: "Premium Package", priceStatus: "PRICED", price: 2500, features: [] },
        { name: "PREMIUM PACKAGE", priceStatus: "UNAVAILABLE", features: [] },
      ],
      options: [],
    });
    expect(res.packages).toHaveLength(1);
    expect(res.packages[0].price).toBe(2500);
  });

  it("uses category hints when provided, name rules otherwise", () => {
    const res = buildEquipment({
      standard: [
        { name: "Tri-Zone Climate Control", categoryHint: "interior" },
        "Tri-Zone Climate Rear Vents",
      ],
      packages: [],
      options: [],
    });
    const byCat = Object.fromEntries(res.standard.map((g) => [g.category, g.items]));
    expect(byCat.INTERIOR).toEqual(["Tri-Zone Climate Control"]);
    expect(byCat.COMFORT_CONVENIENCE).toEqual(["Tri-Zone Climate Rear Vents"]);
  });

  it("emits groups in stable category order with no empty groups", () => {
    const res = buildEquipment({
      standard: ["Navigation System", "LED Headlights", "10 Airbags"],
      packages: [],
      options: [],
    });
    expect(res.standard.map((g) => g.category)).toEqual(["EXTERIOR", "SAFETY_SECURITY", "TECHNOLOGY"]);
    const order = res.standard.map((g) => CATEGORY_ORDER.indexOf(g.category));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const g of res.standard) expect(g.items.length).toBeGreaterThan(0);
  });

  it("never invents codes or prices", () => {
    const res = buildEquipment({
      standard: [],
      packages: [{ name: "Mystery Package", priceStatus: "UNAVAILABLE", features: [] }],
      options: [{ name: "Mystery Option", priceStatus: "UNAVAILABLE" }],
    });
    expect(res.packages[0].price).toBeUndefined();
    expect(res.packages[0].code).toBeUndefined();
    expect(res.options[0].price).toBeUndefined();
    expect(res.options[0].code).toBeUndefined();
    expect("price" in res.options[0]).toBe(false);
  });

  it("preserves provided codes, prices and descriptions", () => {
    const res = buildEquipment({
      standard: [],
      packages: [],
      options: [{ code: "K01", name: "Convenience Option", description: "Dealer note", priceStatus: "PRICED", price: 995 }],
    });
    expect(res.options[0]).toEqual({
      code: "K01",
      name: "Convenience Option",
      description: "Dealer note",
      priceStatus: "PRICED",
      price: 995,
    });
  });

  it("skips blank names entirely", () => {
    const res = buildEquipment({
      standard: ["  "],
      packages: [{ name: "", priceStatus: "UNAVAILABLE", features: [] }],
      options: [{ name: " ", priceStatus: "UNAVAILABLE" }],
    });
    expect(res.standard).toEqual([]);
    expect(res.packages).toEqual([]);
    expect(res.options).toEqual([]);
  });
});

describe("dedupeKey", () => {
  it("is case and punctuation insensitive", () => {
    expect(dedupeKey("Heated Front Seats")).toBe(dedupeKey("HEATED-FRONT SEATS."));
  });

  it("distinguishes different words", () => {
    expect(dedupeKey("Heated Front Seats")).not.toBe(dedupeKey("Heated Rear Seats"));
  });
});
