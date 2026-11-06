import { describe, it, expect } from "vitest";
import fixture from "./factorySticker/__acceptance__/harteNewInventory.fixture.json";
import { buildCompleteFactoryEquipment, isNonEquipmentRow } from "./equipmentPanel";
import { readBuildSheet } from "./buildSheet";
import type { VehicleListing } from "@/hooks/useVehicleListing";

interface FxVehicle { v: string; mc: Record<string, unknown>; bs: Record<string, unknown> | null; sh: string | null; kh: string | null }
const fx = fixture as unknown as { dict: string[]; lists: Record<string, Record<string, number[]>>; vehicles: FxVehicle[] };

const expand = (key: string | null) => key && fx.lists[key]
  ? Object.fromEntries(Object.entries(fx.lists[key]).map(([c, ix]) => [c, ix.map((i) => fx.dict[i])]))
  : undefined;

const listingFor = (v: FxVehicle): VehicleListing => ({
  vin: v.v,
  mc_attributes: { ...v.mc, build_sheet: { ...v.bs, standard: expand(v.sh ? `S${v.sh}` : null), key_features: expand(v.kh ? `K${v.kh}` : null) } },
} as unknown as VehicleListing);

const withSheet = fx.vehicles.filter((v) => v.bs && (v.sh || v.kh));
const pick = [withSheet[0], withSheet[Math.floor(withSheet.length / 2)], withSheet[withSheet.length - 1]];

const BANNED = [
  "Frontal Crash Rating-4", "Rollover Rating-4", "Side Impact-5", "Side Impact-Good", "Overall-5", "Headlights-Good",
  "Latch-Good", "Seat Belt Reminder-Good", "Moderate Overlap Front Test-Good", "Small Overlap Front - Driver-Good",
  "Small Overlap Front - Passenger-Good", "Top Safety Pick Status-TSP Plus", "Standard-IIHS", "Standard-NHTSA",
  "Test Revision-Updated", "Test Revision-Test Revision", "Anti-Corrosion Warranty", "Executive SUV", "Full Size SUV",
  "Compact SUV", "Upper Medium SUV", "Paint-Gloss", "Paint-Metallic", "Paint-Pearl", "V",
];

const spellKey = (s: string) => s.toLowerCase().replace(/centre/g, "center").replace(/colour/g, "color")
  .replace(/litre/g, "liter").replace(/levelling/g, "leveling").replace(/grey/g, "gray").replace(/[^a-z0-9]+/g, "");

describe("buildCompleteFactoryEquipment on real Harte INFINITI build data", () => {
  it("has fixture vehicles to test", () => expect(withSheet.length).toBeGreaterThan(10));

  for (const v of pick) {
    it(`${v.v}: every shown item traces to the source, none invented, metadata excluded`, () => {
      const listing = listingFor(v);
      const src = readBuildSheet(listing)!.completeEquipment;
      const out = buildCompleteFactoryEquipment(listing);
      const shown = out.groups.flatMap((g) => g.items);
      const srcSet = new Set(src);
      expect(out.available).toBe(true);
      expect(shown.every((i) => srcSet.has(i))).toBe(true);
      expect(new Set(shown).size).toBe(shown.length);
      for (const b of BANNED) expect(shown).not.toContain(b);
      expect(out.total).toBe(shown.length);

      const kept = src.filter((i) => !isNonEquipmentRow(i));
      expect(shown.length).toBeLessThanOrEqual(new Set(kept.map(spellKey)).size);
    });
  }

  it("count equals unique source items minus excluded rows minus spelling duplicates", () => {
    for (const v of pick) {
      const listing = listingFor(v);
      const src = readBuildSheet(listing)!.completeEquipment;
      const excluded = src.filter((i) => isNonEquipmentRow(i));
      const kept = src.filter((i) => !isNonEquipmentRow(i));
      const interior = String(v.mc.interior_color ?? "").toLowerCase();
      const out = buildCompleteFactoryEquipment(listing);
      const shown = out.groups.flatMap((g) => g.items);
      const dropped = kept.filter((i) => !shown.includes(i));
      const mismatched = dropped.filter((i) => !kept.some((k) => k !== i && spellKey(k) === spellKey(i)));
      const spellDupes = dropped.length - mismatched.length;
      expect(src.length - excluded.length - mismatched.length - spellDupes).toBe(out.total);
      for (const m of mismatched) {
        expect(/leather|cloth|upholstery|semi.?aniline|nappa|suede|vinyl/i.test(m)).toBe(true);
        expect(interior.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps real equipment that ends in a digit", () => {
    const all = new Set<string>();
    for (const v of withSheet) buildCompleteFactoryEquipment(listingFor(v)).groups.forEach((g) => g.items.forEach((i) => all.add(i)));
    for (const keep of ["Disc Brakes-4", "Audio Zones-2", "Rear Seats Head Restraints-3", "Front Seats Head Restraints-2"]) {
      expect(all.has(keep)).toBe(true);
      expect(isNonEquipmentRow(keep)).toBe(false);
    }
  });

  it("across the whole fixture no banned row ever appears", () => {
    for (const v of withSheet) {
      const shown = buildCompleteFactoryEquipment(listingFor(v)).groups.flatMap((g) => g.items);
      for (const b of BANNED) expect(shown).not.toContain(b);
    }
  });

  it("collapses spelling variants but keeps distinct items", () => {
    const listing = {
      mc_attributes: { build_sheet: { standard: { a: [
        "Dashboard Centre 1-Fixed", "Dashboard Center 1-Fixed", "Body Colour Exterior Door Handles", "Body Color Exterior Door Handles",
        "Apple Carplay", "Apple CarPlay", "3.0 Litres Engine", "3.0 Liters Engine", "Sliding Sunroof-Front", "Power Sunroof-Front",
      ] }, key_features: { b: ["Apple CarPlay"] }, generic: false } },
    } as unknown as VehicleListing;
    const shown = buildCompleteFactoryEquipment(listing).groups.flatMap((g) => g.items);
    expect([...shown].sort()).toEqual([
      "Dashboard Center 1-Fixed", "Body Color Exterior Door Handles", "Apple Carplay", "3.0 Liters Engine", "Sliding Sunroof-Front", "Power Sunroof-Front",
    ].sort());
    expect(shown).not.toContain("Dashboard Centre 1-Fixed");
    expect(shown).not.toContain("Body Colour Exterior Door Handles");
    expect(shown).not.toContain("3.0 Litres Engine");
  });

  it("drops upholstery naming a color that does not match the interior", () => {
    const listing = {
      mc_attributes: { interior_color: "Graphite", build_sheet: { standard: { a: ["Leather Seats Graphite", "Leather Seats Stone", "Leather Seats"] } } },
    } as unknown as VehicleListing;
    const shown = buildCompleteFactoryEquipment(listing).groups.flatMap((g) => g.items);
    expect(shown).toContain("Leather Seats Graphite");
    expect(shown).toContain("Leather Seats");
    expect(shown).not.toContain("Leather Seats Stone");
  });

  it("marks generic sheets and reports unavailable without a build sheet", () => {
    const g = buildCompleteFactoryEquipment({ mc_attributes: { build_sheet: { standard: { a: ["Cruise Control"] }, generic: true } } } as unknown as VehicleListing);
    expect(g.generic).toBe(true);
    expect(g.available).toBe(true);
    const none = buildCompleteFactoryEquipment({ mc_attributes: {} } as unknown as VehicleListing);
    expect(none).toEqual({ groups: [], total: 0, generic: false, available: false });
  });
});
