import { describe, it, expect } from "vitest";
import { matchEpa, storedEpaConflict, listingPowertrain, litersOf, driveOf, transOf, cylindersOf, type EpaClient, type EpaVehicle, type ListingFacts } from "./epaMatch.ts";

type Menu = Record<string, { option: string; id: string; v: Partial<EpaVehicle> }[]>;

const gas = (c: number, h: number, comb: number) => ({ atvType: null, fuelType: "Regular", fuelType1: "Regular Gasoline", city08: c, highway08: h, comb08: comb });

// Shapes and names follow fueleconomy.gov's menus; the stored production
// matches ("F-150 Lightning 4WD", "Grand Cherokee 2WD", "Fusion AWD",
// "QX80 2WD") come from the same service.
const MENUS: Record<string, Menu> = {
  "2022 Ford": {
    "F150 Pickup 2WD": [{ option: "Auto 10-spd, 6 cyl, 2.7 L, Turbo", id: "f1", v: gas(20, 26, 22) }, { option: "Auto 10-spd, 8 cyl, 5.0 L", id: "f2", v: gas(17, 24, 19) }],
    "F150 Pickup 4WD": [{ option: "Auto 10-spd, 6 cyl, 2.7 L, Turbo", id: "f3", v: gas(19, 24, 21) }, { option: "Auto 10-spd, 6 cyl, 3.5 L, Turbo", id: "f4", v: gas(18, 23, 20) }, { option: "Auto 10-spd, 8 cyl, 5.0 L", id: "f5", v: gas(16, 22, 18) }],
    "F-150 Lightning 4WD": [{ option: "Auto (A1)", id: "f6", v: { atvType: "EV", fuelType: "Electricity", fuelType1: "Electricity", city08: 76, highway08: 61, comb08: 68 } }],
    "Transit Connect USPS": [{ option: "Auto (S6), 4 cyl, 2.5 L", id: "t1", v: gas(20, 27, 23) }],
  },
  "2024 Jeep": {
    "Grand Cherokee 2WD": [{ option: "Auto 8-spd, 6 cyl, 3.6 L", id: "j1", v: gas(19, 26, 22) }],
    "Grand Cherokee 4WD": [{ option: "Auto 8-spd, 6 cyl, 3.6 L", id: "j2", v: gas(19, 26, 21) }, { option: "Auto 8-spd, 8 cyl, 5.7 L", id: "j3", v: gas(14, 22, 17) }],
    "Grand Cherokee 4xe": [{ option: "Auto 8-spd, 4 cyl, 2.0 L, Turbo", id: "j4", v: { atvType: "Plug-in Hybrid", fuelType: "Premium Gas or Electricity", fuelType1: "Premium Gasoline", city08: 23, highway08: 24, comb08: 23 } }],
  },
  "2010 Ford": {
    "Fusion AWD": [{ option: "Auto (S6), 6 cyl, 3.5 L", id: "u1", v: gas(17, 24, 19) }],
    "Fusion FWD": [{ option: "Auto (S6), 4 cyl, 2.5 L", id: "u2", v: gas(22, 29, 25) }, { option: "Auto (S6), 6 cyl, 3.0 L", id: "u3", v: gas(18, 27, 21) }],
    "Fusion Hybrid FWD": [{ option: "Auto (variable gear ratios), 4 cyl, 2.5 L", id: "u4", v: { atvType: "Hybrid", fuelType: "Regular", fuelType1: "Regular Gasoline", city08: 41, highway08: 36, comb08: 39 } }],
  },
  "2026 INFINITI": {
    "QX80 2WD": [{ option: "Auto (S9), 6 cyl, 3.5 L, Turbo", id: "q1", v: gas(16, 21, 18) }],
    "QX80 4WD": [{ option: "Auto (S9), 6 cyl, 3.5 L, Turbo", id: "q2", v: gas(16, 20, 17) }],
  },
  "2024 Volkswagen": {
    "Jetta": [{ option: "Auto (S8), 4 cyl, 1.5 L, Turbo", id: "v1", v: gas(29, 40, 33) }, { option: "Man 6-spd, 4 cyl, 1.5 L, Turbo", id: "v2", v: gas(28, 39, 32) }],
  },
  "2023 Jeep": {
    "Wrangler 2dr 4WD": [{ option: "Auto 8-spd, 4 cyl, 2.0 L, Turbo", id: "w1", v: gas(21, 24, 22) }],
    "Wrangler 4dr 4WD": [{ option: "Auto 8-spd, 4 cyl, 2.0 L, Turbo", id: "w2", v: gas(20, 24, 22) }, { option: "Auto 8-spd, 6 cyl, 3.6 L", id: "w3", v: gas(17, 23, 19) }],
  },
  "2025 Honda": {
    "Accord": [{ option: "Auto (variable gear ratios), 4 cyl, 1.5 L, Turbo", id: "a1", v: gas(29, 37, 32) }],
    "Accord Hybrid": [{ option: "Auto (variable gear ratios), 4 cyl, 2.0 L", id: "a2", v: { atvType: "Hybrid", fuelType: "Regular", fuelType1: "Regular Gasoline", city08: 46, highway08: 41, comb08: 44 } }],
  },
};

function client(menus = MENUS, reverse = false): EpaClient & { fetched: string[] } {
  const fetched: string[] = [];
  const order = <T,>(a: T[]) => (reverse ? [...a].reverse() : a);
  const byId = new Map<string, Partial<EpaVehicle>>();
  for (const m of Object.values(menus)) for (const opts of Object.values(m)) for (const o of opts) byId.set(o.id, o.v);
  return {
    fetched,
    models: async (y, mk) => order(Object.keys(menus[`${y} ${mk}`] ?? {}).map((t) => ({ text: t, value: t }))),
    options: async (y, mk, md) => order((menus[`${y} ${mk}`]?.[md] ?? []).map((o) => ({ text: o.option, value: o.id }))),
    vehicle: async (id) => { fetched.push(id); const v = byId.get(id); return v ? ({ id, ...v } as EpaVehicle) : null; },
  };
}

const facts = (o: Partial<ListingFacts> & Pick<ListingFacts, "year" | "make" | "model">): ListingFacts =>
  ({ trim: null, liters: null, drive: null, powertrain: null, ...o });

describe("EPA matching is powertrain-aware", () => {
  it("never puts a gas F-150 on the F-150 Lightning", async () => {
    const r = await matchEpa(facts({ year: "2022", make: "Ford", model: "F-150", trim: "XLT", liters: "2.7", drive: "4", powertrain: "gas" }), client());
    expect("refused" in r).toBe(false);
    if ("refused" in r) return;
    expect(r.model).toBe("F150 Pickup 4WD");
    expect(r.option).toContain("2.7 L");
    expect(r.basis.record_powertrain).toBe("gas");
  });

  it("refuses an F-150 whose powertrain the decode does not state", async () => {
    const r = await matchEpa(facts({ year: "2022", make: "Ford", model: "F-150", trim: "Lariat" }), client());
    expect(r).toEqual({ refused: "ambiguous_powertrain" });
  });

  it("puts a Grand Cherokee 4xe on the plug-in record", async () => {
    const r = await matchEpa(facts({ year: "2024", make: "Jeep", model: "Grand Cherokee", trim: "4xe", liters: "2.0", drive: "4", powertrain: "phev" }), client());
    if ("refused" in r) throw new Error(r.refused);
    expect(r.model).toBe("Grand Cherokee 4xe");
    expect(r.basis.record_powertrain).toBe("phev");
  });

  it("keeps a 4WD gas Grand Cherokee off the 2WD and 4xe records", async () => {
    const r = await matchEpa(facts({ year: "2024", make: "Jeep", model: "Grand Cherokee", trim: "Altitude", liters: "3.6", drive: "4", powertrain: "gas" }), client());
    if ("refused" in r) throw new Error(r.refused);
    expect(r.model).toBe("Grand Cherokee 4WD");
    expect(r.vehicle.id).toBe("j2");
  });

  it("puts a Fusion Hybrid on the hybrid record, not the 3.5 L AWD gas car", async () => {
    const r = await matchEpa(facts({ year: "2010", make: "Ford", model: "Fusion", trim: "Hybrid", liters: "2.5", drive: "2", powertrain: "hybrid" }), client());
    if ("refused" in r) throw new Error(r.refused);
    expect(r.model).toBe("Fusion Hybrid FWD");
    expect(r.basis.record_powertrain).toBe("hybrid");
  });

  it("puts a 4WD QX80 on the 4WD record", async () => {
    const r = await matchEpa(facts({ year: "2026", make: "INFINITI", model: "QX80", liters: "3.5", drive: "4", powertrain: "gas" }), client());
    if ("refused" in r) throw new Error(r.refused);
    expect(r.model).toBe("QX80 4WD");
  });

  it("puts an Accord Hybrid on the hybrid record", async () => {
    const r = await matchEpa(facts({ year: "2025", make: "Honda", model: "Accord", trim: "Hybrid Sport", liters: "2.0", powertrain: "hybrid" }), client());
    if ("refused" in r) throw new Error(r.refused);
    expect(r.model).toBe("Accord Hybrid");
  });

  it("refuses rather than borrowing a different vehicle's engine", async () => {
    const r = await matchEpa(facts({ year: "2022", make: "Ford", model: "Transit Van", liters: "3.7", powertrain: "gas" }), client());
    expect("refused" in r).toBe(true);
  });

  it("refuses when tied candidates disagree on MPG", async () => {
    const r = await matchEpa(facts({ year: "2022", make: "Ford", model: "F-150", drive: "4", powertrain: "gas" }), client());
    expect(r).toEqual({ refused: "ambiguous_option" });
  });

  it("refuses a record whose own powertrain contradicts the listing", async () => {
    const menus: Record<string, Menu> = { "2025 Honda": { "Accord": [{ option: "Auto (variable gear ratios), 4 cyl, 2.0 L", id: "x", v: gas(29, 37, 32) }] } };
    const r = await matchEpa(facts({ year: "2025", make: "Honda", model: "Accord", liters: "2.0", powertrain: "hybrid" }), client(menus));
    expect(r).toEqual({ refused: "powertrain_unverified" });
  });

  it("does not depend on the order the service lists things in", async () => {
    const cases: ListingFacts[] = [
      facts({ year: "2022", make: "Ford", model: "F-150", trim: "XLT", liters: "2.7", drive: "4", powertrain: "gas" }),
      facts({ year: "2024", make: "Jeep", model: "Grand Cherokee", liters: "3.6", drive: "4", powertrain: "gas" }),
      facts({ year: "2010", make: "Ford", model: "Fusion", trim: "Hybrid", liters: "2.5", powertrain: "hybrid" }),
    ];
    for (const c of cases) {
      const a = await matchEpa(c, client());
      const b = await matchEpa(c, client(MENUS, true));
      expect(b).toEqual(a);
    }
  });
});

describe("transmission, cylinders and body style narrow the match", () => {
  it("picks the automatic Jetta when the decode says automatic", async () => {
    const r = await matchEpa(facts({ year: "2024", make: "Volkswagen", model: "Jetta", liters: "1.5", drive: "2", powertrain: "gas", trans: "auto", cylinders: 4 }), client());
    if ("refused" in r) throw new Error(r.refused);
    expect(r.vehicle.id).toBe("v1");
  });

  it("still refuses when the transmission is unknown and the two disagree", async () => {
    expect(await matchEpa(facts({ year: "2024", make: "Volkswagen", model: "Jetta", liters: "1.5", powertrain: "gas" }), client())).toEqual({ refused: "ambiguous_option" });
  });

  it("matches a 4-Door Wrangler to the 4dr record", async () => {
    const r = await matchEpa(facts({ year: "2023", make: "Jeep", model: "Wrangler 4-Door", liters: "2.0", drive: "4", powertrain: "gas", trans: "auto", cylinders: 4 }), client());
    if ("refused" in r) throw new Error(r.refused);
    expect(r.model).toBe("Wrangler 4dr 4WD");
  });

  it("reads transmission and cylinders", () => {
    expect(transOf("Automatic")).toBe("auto");
    expect(transOf("Automatic With Manual Mode Trans")).toBe("auto");
    expect(transOf("Manual")).toBe("manual");
    expect(transOf("Man 6-spd, 4 cyl, 1.5 L, Turbo")).toBe("manual");
    expect(transOf("Auto (AV-S7), 4 cyl, 1.5 L, Turbo")).toBe("auto");
    expect(transOf("")).toBeNull();
    expect(cylindersOf("2.7L V6")).toBe(6);
    expect(cylindersOf("Auto 8-spd, 4 cyl, 2.0 L, Turbo")).toBe(4);
    expect(cylindersOf("Electric")).toBeNull();
  });
});

describe("listing facts", () => {
  it("reads powertrain from the decode, then from trim words", () => {
    expect(listingPowertrain({ powertrainType: "Combustion" })).toBe("gas");
    expect(listingPowertrain({ powertrainType: "HEV" })).toBe("hybrid");
    expect(listingPowertrain({ powertrainType: "PHEV" })).toBe("phev");
    expect(listingPowertrain({ powertrainType: "BEV" })).toBe("ev");
    expect(listingPowertrain({ powertrainType: "MHEV" })).toBe("mild_hybrid");
    expect(listingPowertrain({ trim: "4xe" })).toBe("phev");
    expect(listingPowertrain({ trim: "Hybrid Sport" })).toBe("hybrid");
    expect(listingPowertrain({ trim: "Lariat" })).toBeNull();
  });

  it("reads liters and drive", () => {
    expect(litersOf("2.7L V6")).toBe("2.7");
    expect(litersOf("Auto 10-spd, 6 cyl, 2.7 L, Turbo")).toBe("2.7");
    expect(driveOf("4WD")).toBe("4");
    expect(driveOf("FWD")).toBe("2");
    expect(driveOf("Allroad quattro")).toBe("4");
    expect(driveOf(null)).toBeNull();
  });
});

describe("stored records that contradict the car are caught", () => {
  // Strings as stored in production by the earlier matcher.
  it.each([
    ["gas F-150 on the Lightning", { matchedOption: "2022 Ford F-150 Lightning 4WD — Auto (A1)", fuelType: "Electricity" }, { powertrain: "gas" as const, drive: "4" as const, liters: "2.7" }, "powertrain"],
    ["4xe on the gas 2WD", { matchedOption: "2024 Jeep Grand Cherokee 2WD — Auto 8-spd, 6 cyl, 3.6 L", fuelType: "Regular" }, { powertrain: "phev" as const, drive: "4" as const, liters: "2.0" }, "powertrain"],
    ["Fusion Hybrid on the AWD V6", { matchedOption: "2010 Ford Fusion AWD — Auto (S6), 6 cyl, 3.5 L", fuelType: "Regular" }, { powertrain: "hybrid" as const, drive: "2" as const, liters: "2.5" }, "drivetrain"],
    ["gas car on a hybrid record", { matchedOption: "2025 Honda Accord Hybrid — Auto (variable gear ratios), 4 cyl, 2.0 L", fuelType: "Regular" }, { powertrain: "gas" as const, drive: null, liters: null }, "powertrain"],
    ["4WD QX80 on the 2WD", { matchedOption: "2026 INFINITI QX80 2WD — Auto (S9), 6 cyl, 3.5 L, Turbo", fuelType: "Premium" }, { powertrain: "gas" as const, drive: "4" as const, liters: "3.5" }, "drivetrain"],
    ["Transit Van on the Transit Connect", { matchedOption: "2019 Ford Transit Connect USPS — Auto (S6), 4 cyl, 2.5 L", fuelType: "Regular" }, { powertrain: null, drive: null, liters: "3.7" }, "engine"],
  ])("%s", (_label, record, f, why) => {
    expect(storedEpaConflict(record, f)).toBe(why);
  });

  it("never shows electric figures on a car whose decode is silent unless its name says so", () => {
    const rec = { matchedOption: "2022 Ford F-150 Lightning 4WD — Auto (A1)", fuelType: "Electricity" };
    expect(storedEpaConflict(rec, { powertrain: null, drive: null, liters: null, text: "F-150 Lariat" })).toBe("powertrain");
    expect(storedEpaConflict(rec, { powertrain: null, drive: null, liters: null, text: "F-150 Lightning Lariat" })).toBeNull();
  });

  it("leaves a consistent record alone, and an unknown fact never conflicts", () => {
    expect(storedEpaConflict({ matchedOption: "2026 INFINITI QX80 4WD — Auto (S9), 6 cyl, 3.5 L, Turbo", fuelType: "Premium" }, { powertrain: "gas", drive: "4", liters: "3.5" })).toBeNull();
    expect(storedEpaConflict({ matchedOption: "2021 Jeep Grand Cherokee 2WD — Auto 8-spd, 6 cyl, 3.6 L", fuelType: "Regular" }, { powertrain: null, drive: null, liters: null })).toBeNull();
    expect(storedEpaConflict({ matchedOption: "2024 Toyota Venza AWD — Auto (AV-S6), 4 cyl, 2.5 L", fuelType: "Regular" }, { powertrain: "mild_hybrid", drive: "4", liters: "2.5" })).toBeNull();
    expect(storedEpaConflict({ matchedOption: "2024 Toyota Venza AWD — Auto (AV-S6), 4 cyl, 2.5 L", fuelType: "Regular" }, { powertrain: "hybrid", drive: "4", liters: "2.5" })).toBeNull();
  });
});
