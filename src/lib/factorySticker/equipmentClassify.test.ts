import { describe, expect, it } from "vitest";
import { classifyStandardItem } from "./equipment";
import { adaptRenderData } from "./render/contract";
import { qx55ClassFixture } from "./render/__fixtures__/renderData";

describe("classifyStandardItem", () => {
  const cases: Array<[string, string]> = [
    ["Driver Airbag", "SAFETY_SECURITY"],
    ["Front Seat Belts Pre-Tensioners", "SAFETY_SECURITY"],
    ["Lane Departure Warning", "SAFETY_SECURITY"],
    ["Brake Assist", "SAFETY_SECURITY"],
    ["Pedestrian & Cyclist Avoidance System", "SAFETY_SECURITY"],
    ["Premium Brand Speakers", "TECHNOLOGY"],
    ["Navigational Systems", "TECHNOLOGY"],
    ["Apple Carplay", "TECHNOLOGY"],
    ["Front Stabilizer Bar", "POWERTRAIN"],
    ["Selectable Driver Modes", "POWERTRAIN"],
    ["Engine Displacement (3.5 Liters)", "POWERTRAIN"],
    ["Heated Front Seats", "COMFORT_CONVENIENCE"],
    ["Dual-Zone Automatic Climate Control", "COMFORT_CONVENIENCE"],
    ["Roof Rails", "EXTERIOR"],
    ["LED Headlights", "EXTERIOR"],
    ["Leather Seats", "INTERIOR"],
    ["Executive SUV", "OTHER"],
  ];
  it.each(cases)("%s -> %s", (item, category) => {
    expect(classifyStandardItem(item)).toBe(category);
  });

  it("is deterministic", () => {
    for (const [item] of cases) expect(classifyStandardItem(item)).toBe(classifyStandardItem(item));
  });
});

describe("standard equipment grouping from a single flat source group", () => {
  const flat = () => {
    const base = qx55ClassFixture();
    return { ...base, standardEquipment: { STANDARD: Object.values(base.standardEquipment).flat() } };
  };

  it("regroups items without changing, dropping or duplicating any", () => {
    const data = flat();
    const groups = adaptRenderData(data).data.equipment.standard;
    expect(groups.flatMap((g) => g.items).sort()).toEqual([...data.standardEquipment.STANDARD].sort());
    expect(groups.length).toBeGreaterThan(3);
  });

  it("orders categories as the OEM reference and keeps source order inside each", () => {
    const data = flat();
    const groups = adaptRenderData(data).data.equipment.standard;
    const order = ["POWERTRAIN", "FUNCTIONAL", "COMFORT_CONVENIENCE", "SAFETY_SECURITY", "TECHNOLOGY", "EXTERIOR", "INTERIOR", "OTHER"];
    const idx = groups.map((g) => order.indexOf(g.category));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    for (const g of groups) {
      const positions = g.items.map((i) => data.standardEquipment.STANDARD.indexOf(i));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });
});
