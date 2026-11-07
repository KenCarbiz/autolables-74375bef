import { describe, expect, it } from "vitest";
import { curateEquipment, curationProfileFor } from "./catalogCuration";
import { equipmentBase } from "./contract";
import { withCatalogEquipment } from "./catalogEquipment";
import { tucsonListings, tucsonRenderData } from "./__fixtures__/tucson";
import { HYUNDAI_TUCSON_GAS_ID } from "./variants/hyundaiTucsonGas";
import { selectEquipment } from "../equipmentSelection";

const sel = tucsonRenderData(tucsonListings()[0]);

describe("printed-equipment curation for catalog templates", () => {
  it("applies only to a template with a profile; masters and other templates keep the significance ranking", () => {
    expect(curationProfileFor(HYUNDAI_TUCSON_GAS_ID)).toBe(HYUNDAI_TUCSON_GAS_ID);
    expect(curationProfileFor("jeep_2026_wrangler_sport")).toBeUndefined();
    expect(curationProfileFor(undefined)).toBeUndefined();
    expect(withCatalogEquipment(sel).equipmentCuration).toBeUndefined();
    const plain = equipmentBase(sel);
    expect(curateEquipment(plain, undefined)).toBe(plain);
  });

  it("never changes the line set, text or sources, only rank, order and section", () => {
    const data = withCatalogEquipment(sel, HYUNDAI_TUCSON_GAS_ID);
    const plain = equipmentBase({ ...data, equipmentCuration: undefined });
    const curated = equipmentBase(data);
    const key = (l: { text: string; sources: string[] }) => `${l.text}|${l.sources.join("|")}`;
    expect(curated.total).toBe(plain.total);
    expect(curated.lines.map(key).sort()).toEqual(plain.lines.map(key).sort());
  });

  it("puts Hyundai's core features first and spreads the rest across sections", () => {
    const curated = equipmentBase(withCatalogEquipment(sel, HYUNDAI_TUCSON_GAS_ID));
    const top = selectEquipment(curated.lines, 25).map((l) => l.text);
    for (const t of ["8 Airbags", "Engine Displacement (2.5 Liters)", "8 Speed Transmission", "AWD", "Spacesaver Spare Wheel", "Smart Card / Smart Key", "Satellite Radio"]) {
      expect(top).toContain(t);
    }
    const sections = new Set(selectEquipment(curated.lines, 32).map((l) => l.category));
    expect(sections).toEqual(new Set(["SAFETY_SECURITY", "POWERTRAIN", "EXTERIOR", "COMFORT_CONVENIENCE", "TECHNOLOGY"]));
  });

  it("prints nothing a VIN lacks", () => {
    const data = withCatalogEquipment({ ...sel, standardEquipment: { STANDARD: ["8 Airbags", "AWD"] }, keyFeatures: {} }, HYUNDAI_TUCSON_GAS_ID);
    expect(equipmentBase(data).lines.map((l) => l.text).sort()).toEqual(["8 Airbags", "AWD"]);
  });
});
