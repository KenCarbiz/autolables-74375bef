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

  describe("powertrain fragments for the Outlander Sport and Voyager templates only", () => {
    const POWERTRAIN = ["2", "V", "6-Cyl", "Unleaded", "FWD", "AWD", "Short Wheelbase", "Full Size MPV", "Four Wheel Drive Type-Full-Time", "In-Line"];
    const IDS = ["mitsubishi_2026_outlander_sport_s", "chrysler_2026_voyager_lx"];
    it.each(POWERTRAIN)("drops %s for those templates and keeps it elsewhere", (s) => {
      for (const id of IDS) expect(isCatalogNonEquipment(s, id)).toBe(true);
      expect(isCatalogNonEquipment(s)).toBe(false);
      expect(isCatalogNonEquipment(s, "jeep_2026_wrangler_willys_392")).toBe(false);
    });
    it("keeps LATCH-Ready child-seat anchors and drops the LATCH rating row", () => {
      expect(isCatalogNonEquipment("LATCH-Ready Child-Seat Anchor System", IDS[1])).toBe(false);
      expect(isCatalogNonEquipment("Latch-Good", IDS[1])).toBe(true);
      expect(isCatalogNonEquipment("6 Person Seating Capacity", IDS[1])).toBe(false);
    });
  });

  describe("fragments for the Sorento, Forester, GV80, Durango and Envista templates", () => {
    const IDS = ["kia_2026_sorento_lx", "subaru_2026_forester_wilderness", "genesis_2026_gv80_3.5t_prestige", "dodge_2026_durango_gt_blacktop", "buick_2026_envista_avenir"];
    it.each(["2", "6-Cyl", "Gasoline", "Regular Unleaded", "AWD", "Mid", "Upper Medium", "Turbo", "Horizontal"])("drops %s for those templates only", (s) => {
      for (const id of IDS) expect(isCatalogNonEquipment(s, id)).toBe(true);
      expect(isCatalogNonEquipment(s, "chrysler_2026_voyager_lx")).toBe(s !== "Mid" && s !== "Upper Medium" && s !== "Turbo" && s !== "Horizontal");
      expect(isCatalogNonEquipment(s)).toBe(false);
    });
    it("keeps real equipment", () => {
      for (const id of IDS) expect(isCatalogNonEquipment("Turbo Boost Gauge", id)).toBe(false);
    });
  });
});
