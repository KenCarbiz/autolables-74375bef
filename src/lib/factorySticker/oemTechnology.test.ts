import { describe, it, expect } from "vitest";
import {
  findTechnology, findForeignTechnology, officialTechnologyName, technologiesFor,
  isKnownTechnology, TECHNOLOGY_COUNT,
} from "./oemTechnology";
import { curateEquipment } from "./equipmentNoise";
import { brandForMake } from "./oemTerminology";

const B = brandForMake;

describe("recognition", () => {
  it("knows each manufacturer's own systems", () => {
    expect(findTechnology("Super Cruise", B("GMC"))?.name).toBe("Super Cruise");
    expect(findTechnology("ProPILOT Assist", B("Nissan"))?.name).toBe("ProPILOT Assist");
    expect(findTechnology("EyeSight Driver Assist Technology", B("Subaru"))?.name)
      .toBe("EyeSight Driver Assist Technology");
    expect(findTechnology("PARKTRONIC", B("Mercedes-Benz"))?.name).toBe("PARKTRONIC");
    expect(findTechnology("Terrain Response 2", B("Land Rover"))?.name).toBe("Terrain Response");
  });

  it("tolerates the separator drift a feed introduces", () => {
    for (const row of ["Pre-Collision System", "Pre Collision System", "PRE COLLISION SYSTEM"]) {
      expect(findTechnology(row, B("Toyota"))?.name).toBe("Pre-Collision System");
    }
    expect(findTechnology("e 4ORCE", B("Nissan"))?.name).toBe("e-4ORCE");
  });

  it("matches a system named inside a longer row", () => {
    expect(findTechnology("Bose Performance Audio - 24 Speakers", B("Infiniti"))?.name).toBe("Bose");
    expect(findTechnology("Available BlueCruise Hands-Free Highway Driving", B("Ford"))?.name)
      .toBe("BlueCruise");
  });

  it("prefers the more specific system when several could match", () => {
    // "Super Handling All-Wheel Drive" must not resolve to a shorter entry.
    expect(findTechnology("Super Handling All-Wheel Drive", B("Acura"))?.name)
      .toBe("Super Handling All-Wheel Drive");
  });

  it("does not fire on ordinary words", () => {
    for (const row of ["Cargo Net", "Floor Mats", "Heated Front Seats", "All Season Tires"]) {
      expect(isKnownTechnology(row, B("GMC"))).toBe(false);
    }
  });
});

describe("ownership", () => {
  it("gives a marque its corporate family's systems", () => {
    // OnStar is GM's, so every GM marque carries it.
    for (const make of ["Chevrolet", "GMC", "Buick", "Cadillac"]) {
      expect(findTechnology("OnStar", B(make))?.name).toBe("OnStar");
    }
  });

  it("does not give a marque-only system to its siblings", () => {
    // AKG Studio Reference is Cadillac's, not GMC's.
    expect(findTechnology("AKG Studio Reference", B("Cadillac"))?.name).toBe("AKG Studio Reference");
    expect(findTechnology("AKG Studio Reference", B("GMC"))).toBeUndefined();
    // MultiPro Tailgate is GMC's, not Chevrolet's.
    expect(findTechnology("MultiPro Tailgate", B("Chevrolet"))).toBeUndefined();
  });

  it("lets every make carry a cross-make supplier", () => {
    for (const make of ["Chevrolet", "Nissan", "Mazda", "Hyundai", "Porsche"]) {
      expect(findTechnology("Bose Premium Audio", B(make)), make).toBeDefined();
      expect(findForeignTechnology("Bose Premium Audio", B(make)), make).toBeUndefined();
    }
    // A make with its own catalogued pairing keeps the more specific entry.
    expect(findTechnology("Bose Premium Audio", B("Mazda"))?.name).toBe("Bose Premium Audio");
    expect(findTechnology("Bose Premium Audio", B("Porsche"))?.name).toBe("Bose");
  });

  // This is the hole the old flat pattern list had: it knew the NAME but not
  // the OWNER, so a crossed feed printed another maker's system as fact.
  it("flags a system that belongs to a different manufacturer", () => {
    const onPorsche = findForeignTechnology("quattro all-wheel drive", B("Porsche"));
    expect(onPorsche?.technology.name).toBe("quattro");
    expect(onPorsche?.owner).toBe("audi");

    const onFord = findForeignTechnology("Mark Levinson Premium Audio", B("Ford"));
    expect(onFord?.technology.name).toBe("Mark Levinson");
    expect(onFord?.owner).toBe("lexus");

    const onToyota = findForeignTechnology("Super Cruise", B("Toyota"));
    expect(onToyota?.owner).toBe("gm");
  });

  it("does not flag a system the make legitimately sells", () => {
    expect(findForeignTechnology("quattro", B("Audi"))).toBeUndefined();
    expect(findForeignTechnology("Mark Levinson", B("Lexus"))).toBeUndefined();
    expect(findForeignTechnology("Bose", B("Chevrolet"))).toBeUndefined();
  });
});

describe("rendering", () => {
  it("corrects a feed's casing to the manufacturer's own", () => {
    expect(officialTechnologyName("propilot assist", B("Nissan"))).toBe("ProPILOT Assist");
    expect(officialTechnologyName("PARKTRONIC", B("Mercedes-Benz"))).toBeUndefined(); // already correct
    expect(officialTechnologyName("intellibeam", B("GMC"))).toBe("IntelliBeam");
    expect(officialTechnologyName("blind spot information system", B("Ford"))).toBe("BLIS");
  });

  it("leaves a row that carries more detail than the catalog name alone", () => {
    // The source is more specific than we are; truncating to "Bose" loses the
    // speaker count the dealer is entitled to advertise.
    expect(officialTechnologyName("Bose Performance Audio - 24 Speakers", B("Infiniti")))
      .toBeUndefined();
  });
});

describe("coverage", () => {
  it("carries a catalog for every major make we sell stickers for", () => {
    const makes = [
      "Chevrolet", "GMC", "Buick", "Cadillac", "Ford", "Lincoln", "Jeep", "Ram",
      "Dodge", "Chrysler", "Nissan", "Infiniti", "Toyota", "Lexus", "Honda",
      "Acura", "Hyundai", "Kia", "Genesis", "Subaru", "Mazda", "Mitsubishi",
      "Volkswagen", "Audi", "Porsche", "BMW", "MINI", "Mercedes-Benz", "Volvo",
      "Land Rover", "Jaguar", "Tesla", "Rivian", "Lucid",
    ];
    for (const make of makes) {
      expect(technologiesFor(B(make)).length, `${make} has no technologies`).toBeGreaterThan(4);
    }
    expect(TECHNOLOGY_COUNT).toBeGreaterThan(250);
  });

  it("never lists an optional system as lineup-standard by accident", () => {
    // Spot-check the ones that would be most damaging to over-claim.
    const optional = ["Super Cruise", "BlueCruise", "Night Vision", "DRIVE PILOT"];
    for (const name of optional) {
      const all = technologiesFor("cadillac").concat(technologiesFor("ford"), technologiesFor("mercedes"));
      const hit = all.find((t) => t.name === name);
      if (hit) expect(hit.fitment, name).toBe("optional");
    }
  });
});

describe("curateEquipment uses the catalog", () => {
  it("prints a recognised system in the manufacturer's own rendering", () => {
    const out = curateEquipment(["propilot assist", "Adaptive Cruise Control"], { make: "Nissan" });
    expect(out.items[0].name).toBe("ProPILOT Assist");
    expect(out.items[0].branded).toBe(true);
    expect(out.items[0].technology?.brand).toBe("nissan");
  });

  it("refuses to print another manufacturer's system, and reports it", () => {
    // A scraped description leaked a Lexus audio system onto a Ford.
    const out = curateEquipment(["Mark Levinson Premium Audio", "Subwoofer"], { make: "Ford" });
    expect(out.foreign).toEqual([
      { item: "Mark Levinson Premium Audio", technology: "Mark Levinson", owner: "lexus" },
    ]);
    // It did not become the label — the neutral concept name did.
    expect(out.items[0].name).toBe("Premium Audio System");
  });

  it("reports nothing when every row belongs to the make", () => {
    const out = curateEquipment(["Bose Premium Audio", "IntelliBeam"], { make: "GMC" });
    expect(out.foreign).toEqual([]);
  });
});
