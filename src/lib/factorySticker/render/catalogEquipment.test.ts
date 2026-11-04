import { describe, expect, it } from "vitest";
import { isCatalogNonEquipment, withCatalogEquipment } from "./catalogEquipment.ts";
import type { FactoryStickerRenderData } from "./contract.ts";

const FRAGMENTS = [
  "Rear Crash Protect/Head Restraint Rating-Poor",
  "Operates Above 130 Kph/78 Mph",
  "Operates Above 50 Kph/30 Mph",
  "Operates Below 50 Kph/30 Mph",
  "Includes Oncoming Collision Avoidance",
  "Activates Brake Lights",
  "Level 2-Partial Automation",
  "Autonomous Drive",
  "Autonomous Drive - Level 2",
  "Autonomous Drive Functions",
  "Brakes At Low Speed",
  "Disc Brakes-2",
  "Disc Brakes-4",
  "Large SUV",
  "Small SUV",
  "Lower Medium SUV",
  "Paint-Metallic",
  "Front Seats Head Restraints-2",
  "Rear Seats Head Restraints-3",
];
const REAL = ["Heated Door Mirrors", "Forward Collision-Avoidance Assist", "Apple CarPlay", "Disc Brakes"];

describe("catalog equipment filter", () => {
  it.each(FRAGMENTS)("drops %s", (s) => expect(isCatalogNonEquipment(s)).toBe(true));
  it.each(REAL)("keeps %s", (s) => expect(isCatalogNonEquipment(s)).toBe(false));
  it("removes fragments from standard equipment and key features", () => {
    const data = { standardEquipment: { Safety: [...FRAGMENTS, ...REAL] }, keyFeatures: { Tech: ["Autonomous Drive", "Apple CarPlay"] } } as unknown as FactoryStickerRenderData;
    const out = withCatalogEquipment(data);
    expect(out.standardEquipment.Safety).toEqual(REAL);
    expect(out.keyFeatures.Tech).toEqual(["Apple CarPlay"]);
    expect(JSON.stringify(out)).not.toMatch(/Poor|Kph|Mph/);
  });
});
