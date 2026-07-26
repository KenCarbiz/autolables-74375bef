import { describe, expect, it } from "vitest";
import { OEM_REGISTRY, resolveOem, type OemId } from "./identity";

describe("OEM registry", () => {
  it("contains every required canonical id", () => {
    const required: OemId[] = [
      "INFINITI", "NISSAN", "HYUNDAI", "GENESIS", "TOYOTA", "LEXUS", "HONDA", "ACURA",
      "FORD", "LINCOLN", "CHEVROLET", "GMC", "BUICK", "CADILLAC", "JEEP", "DODGE",
      "RAM", "CHRYSLER", "VOLKSWAGEN", "AUDI", "BMW", "MERCEDES_BENZ", "SUBARU",
      "MAZDA", "KIA", "VOLVO", "LAND_ROVER", "PORSCHE", "TESLA",
    ];
    for (const id of required) {
      expect(OEM_REGISTRY[id], id).toBeDefined();
      expect(OEM_REGISTRY[id].id).toBe(id);
    }
    expect(OEM_REGISTRY.AUTOLABELS_FALLBACK).toBeDefined();
  });
});

describe("resolveOem — exact matches", () => {
  it("resolves each registry display name EXACT", () => {
    for (const identity of Object.values(OEM_REGISTRY)) {
      if (identity.id === "AUTOLABELS_FALLBACK") continue;
      const res = resolveOem(identity.displayName);
      expect(res.identity.id, identity.displayName).toBe(identity.id);
      expect(res.confidence, identity.displayName).toBe("EXACT");
    }
  });

  it("is case insensitive", () => {
    expect(resolveOem("cHeVrOlEt").identity.id).toBe("CHEVROLET");
    expect(resolveOem("iNfInItI").confidence).toBe("EXACT");
  });

  it("is punctuation and whitespace insensitive", () => {
    expect(resolveOem("  Mercedes-Benz. ").identity.id).toBe("MERCEDES_BENZ");
    expect(resolveOem("LAND-ROVER").identity.id).toBe("LAND_ROVER");
    expect(resolveOem("land rover").confidence).toBe("EXACT");
  });
});

describe("resolveOem — aliases", () => {
  const cases: Array<[string, OemId]> = [
    ["Chevy", "CHEVROLET"],
    ["VW", "VOLKSWAGEN"],
    ["Mercedes", "MERCEDES_BENZ"],
    ["MERCEDES BENZ", "MERCEDES_BENZ"],
    ["Benz", "MERCEDES_BENZ"],
    ["Range Rover", "LAND_ROVER"],
    ["Dodge Ram", "RAM"],
    ["Ram Trucks", "RAM"],
    ["Infinity", "INFINITI"],
    ["Datsun", "NISSAN"],
    ["Tesla Motors", "TESLA"],
  ];
  it.each(cases)("%s -> %s", (raw, id) => {
    const res = resolveOem(raw);
    expect(res.identity.id).toBe(id);
    expect(["EXACT", "ALIAS"]).toContain(res.confidence);
  });

  it("Ram before the 2011 brand split resolves to DODGE", () => {
    expect(resolveOem("Ram", 2009).identity.id).toBe("DODGE");
    expect(resolveOem("Ram", 2010).identity.id).toBe("DODGE");
    expect(resolveOem("Ram", 2011).identity.id).toBe("RAM");
    expect(resolveOem("Ram").identity.id).toBe("RAM");
  });
});

describe("resolveOem — brand distinctions stay distinct", () => {
  it("Genesis is not Hyundai", () => {
    expect(resolveOem("Genesis").identity.id).toBe("GENESIS");
    expect(resolveOem("Hyundai").identity.id).toBe("HYUNDAI");
  });

  it("Lincoln is not Ford", () => {
    expect(resolveOem("Lincoln").identity.id).toBe("LINCOLN");
    expect(resolveOem("Ford").identity.id).toBe("FORD");
  });

  it("Acura is not Honda", () => {
    expect(resolveOem("Acura").identity.id).toBe("ACURA");
    expect(resolveOem("Honda").identity.id).toBe("HONDA");
  });

  it("Lexus is not Toyota", () => {
    expect(resolveOem("Lexus").identity.id).toBe("LEXUS");
    expect(resolveOem("Toyota").identity.id).toBe("TOYOTA");
  });

  it("INFINITI is not Nissan", () => {
    expect(resolveOem("INFINITI").identity.id).toBe("INFINITI");
    expect(resolveOem("Nissan").identity.id).toBe("NISSAN");
  });

  it("GM brands resolve individually", () => {
    expect(resolveOem("Chevrolet").identity.id).toBe("CHEVROLET");
    expect(resolveOem("GMC").identity.id).toBe("GMC");
    expect(resolveOem("Buick").identity.id).toBe("BUICK");
    expect(resolveOem("Cadillac").identity.id).toBe("CADILLAC");
    const ids = new Set(["Chevrolet", "GMC", "Buick", "Cadillac"].map((m) => resolveOem(m).identity.id));
    expect(ids.size).toBe(4);
  });
});

describe("resolveOem — fuzzy and unresolved", () => {
  it("fuzzy-matches corporate suffixes", () => {
    const res = resolveOem("Kia Motors America");
    expect(res.identity.id).toBe("KIA");
    expect(res.confidence).toBe("FUZZY");
  });

  it("fuzzy-matches Range Rover sub-models to LAND_ROVER", () => {
    const res = resolveOem("Range Rover Sport");
    expect(res.identity.id).toBe("LAND_ROVER");
    expect(res.confidence).toBe("FUZZY");
  });

  it("unknown makes fall back to AUTOLABELS_FALLBACK with a reason", () => {
    const res = resolveOem("Yugo");
    expect(res.identity.id).toBe("AUTOLABELS_FALLBACK");
    expect(res.confidence).toBe("UNRESOLVED");
    expect(res.fallbackReason).toMatch(/Yugo/);
  });

  it("empty make is UNRESOLVED", () => {
    const res = resolveOem("   ");
    expect(res.confidence).toBe("UNRESOLVED");
    expect(res.identity.id).toBe("AUTOLABELS_FALLBACK");
    expect(res.fallbackReason).toBeDefined();
  });

  it("ambiguous input is UNRESOLVED rather than guessed", () => {
    const res = resolveOem("Genesis Hyundai");
    expect(res.confidence).toBe("UNRESOLVED");
    expect(res.fallbackReason).toMatch(/multiple/);
  });
});
