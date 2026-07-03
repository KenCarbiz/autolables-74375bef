import { describe, expect, it } from "vitest";
import { getEquipmentIcon, EQUIPMENT_ICON_REGISTRY } from "./equipmentIcons";

describe("getEquipmentIcon", () => {
  const num = (input: Parameters<typeof getEquipmentIcon>[0]) => getEquipmentIcon(input).num;

  it("maps the locked QA examples to their numbered icons", () => {
    expect(num("3.0L V6")).toBe(1);
    expect(num("4WD")).toBe(5);
    expect(num("Automatic With Manual Mode Trans")).toBe(8);
    expect(num("19/27 MPG")).toBe(10);
    expect(num({ name: "Majestic", category: "Exterior" })).toBe(13);
    expect(num("Essential Package (3.0t LUXE)")).toBe(55);
    expect(num("Premium Paint")).toBe(14);
    expect(num("Premium Brand Audio")).toBe(43);
  });

  it("maps common features", () => {
    expect(num("Navigation")).toBe(27);
    expect(num("Blind Spot Monitor")).toBe(34);
    expect(num("Panoramic Roof")).toBe(51);
    expect(num("Heated Seats")).toBe(23);
    expect(num("Heated Steering Wheel")).toBe(49);
    expect(num("Front Seat Power Lumbar Adjust")).toBe(21);
    expect(num("Folding Rear Seats")).toBe(21);
    expect(num("Apple CarPlay")).toBe(29);
    expect(num("SiriusXM Satellite Radio")).toBe(44);
    expect(num("Adaptive Cruise Control")).toBe(39);
    expect(num("Power Liftgate")).toBe(53);
    expect(num("Technology Package")).toBe(57);
    expect(num("Extended Warranty (VSC)")).toBe(62);
  });

  it("normalizes spelling variants", () => {
    expect(num("Four Wheel Drive")).toBe(5);
    expect(num("All Wheel Drive")).toBe(5);
    expect(num("All-Wheel Drive")).toBe(5);
    expect(num("Moon Roof")).toBe(50);
    expect(num("Blind-Spot Warning")).toBe(34);
    expect(num("Bluetooth Hands Free")).toBe(28);
  });

  it("prefers compound matches over generic parents", () => {
    expect(num("Heated Steering Wheel")).not.toBe(23);
    expect(num("Panoramic Sunroof")).toBe(51);
    expect(num("Twin Turbo V6")).toBe(2);
    expect(num("Premium Package")).toBe(56);
  });

  it("falls back by category, then to the generic icon only when unclassifiable", () => {
    expect(num({ name: "Zorblat 9000", category: "Safety" })).toBe(41);
    expect(num({ name: "Zorblat 9000" })).toBe(65);
    expect(num("")).toBe(65);
  });

  it("registry holds all 65 equipment icons", () => {
    for (let i = 1; i <= 65; i++) expect(EQUIPMENT_ICON_REGISTRY[i]).toBeDefined();
  });
});
