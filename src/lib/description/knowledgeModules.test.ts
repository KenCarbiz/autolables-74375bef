import { describe, it, expect } from "vitest";
import {
  vehicleSignals, selectModuleKeys, selectModules, assembleKnowledge,
  generationModules, ALWAYS_ON, KNOWLEDGE_REVISION,
} from "../../../supabase/functions/_shared/description-knowledge.ts";
import {
  KNOWLEDGE_MODULES,
} from "../../../supabase/functions/_shared/knowledge/drivesignal-v3-modules.ts";

// The 200-page manual is reference knowledge, loaded selectively. A model must
// never pick its own reference material: one that believes a sedan is a pickup
// would load the towing module and start reasoning about payload, and the
// corpus would have quietly become an input to what is true about the car.

const base = {
  condition: "used", bodyStyle: "SUV", fuelType: "Gasoline", make: "Nissan",
  trim: "SV", equipment: "Bluetooth, Backup Camera", hasBuildSheet: false,
};

describe("the corpus arrived whole and partitioned", () => {
  it("carries every module the generator declares", () => {
    expect(KNOWLEDGE_MODULES.length).toBe(15);
    expect(generationModules().length).toBe(12);
  });

  it("keeps operational material out of the generation set", () => {
    // A writer does not need to be told how its own prompt is assembled, and
    // the QA gates are our software, not instructions a model self-applies.
    const opKeys = KNOWLEDGE_MODULES.filter((m) => m.kind === "operational").map((m) => m.key);
    expect(opKeys.sort()).toEqual(["governance", "prompt_architecture", "quality_assurance"]);
    for (const k of opKeys) expect(generationModules().map((m) => m.key)).not.toContain(k);
  });

  it("records which subsections each module was cut from", () => {
    for (const m of KNOWLEDGE_MODULES) {
      expect(m.sourceSections.length, m.key).toBeGreaterThan(0);
      expect(m.content.length, m.key).toBeGreaterThan(200);
      expect(m.checksum, m.key).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("kept the prohibited-language appendix, which is easy to lose", () => {
    // The appendices are not numbered like the sections and dropped out of the
    // corpus entirely on the first cut without any error.
    const compliance = KNOWLEDGE_MODULES.find((m) => m.key === "compliance")!;
    expect(compliance.sourceSections).toContain("AppF");
    expect(compliance.sourceSections).toContain("AppE");
  });

  it("is at the manual's own revision", () => {
    expect(KNOWLEDGE_REVISION).toBe("3.0");
  });

  it("carries no template interpolation into a prompt", () => {
    for (const m of KNOWLEDGE_MODULES) expect(m.content, m.key).not.toMatch(/\$\{/);
  });
});

describe("selection is driven by the vehicle, in a fixed order", () => {
  it("always loads the same four first", () => {
    expect(selectModuleKeys(vehicleSignals(base)).slice(0, 4)).toEqual([...ALWAYS_ON]);
  });

  it("gives a 2021 used Rogue used-vehicle and safety knowledge", () => {
    const keys = selectModuleKeys(vehicleSignals({
      ...base, equipment: "Blind Spot Warning, ProPILOT Assist, Heated Seats",
      warrantyDisposition: "FACTORY_PERMITTED",
    }));
    expect(keys).toContain("used_vehicle");
    expect(keys).toContain("adas_safety");
    expect(keys).toContain("cpo_warranty");
    expect(keys).not.toContain("truck_towing");
    expect(keys).not.toContain("ev_hybrid");
  });

  it("gives a new heavy-duty pickup OEM and towing knowledge", () => {
    const keys = selectModuleKeys(vehicleSignals({
      ...base, condition: "new", bodyStyle: "Crew Cab Pickup", make: "Ford",
      equipment: "Max Trailer Tow Package, Pro Trailer Backup Assist",
      hasBuildSheet: true,
    }));
    expect(keys).toContain("oem_terminology");
    expect(keys).toContain("truck_towing");
    expect(keys).not.toContain("used_vehicle");
  });

  it("gives an EV its powertrain knowledge", () => {
    const keys = selectModuleKeys(vehicleSignals({
      ...base, fuelType: "Electric", make: "Hyundai" }));
    expect(keys).toContain("ev_hybrid");
    expect(keys).not.toContain("truck_towing");
  });

  it("recognises a plug-in hybrid as electrified", () => {
    expect(selectModuleKeys(vehicleSignals({ ...base, fuelType: "Plug-In Hybrid" })))
      .toContain("ev_hybrid");
  });

  it("loads luxury knowledge by make and by performance trim", () => {
    expect(selectModuleKeys(vehicleSignals({ ...base, make: "INFINITI" }))).toContain("luxury");
    expect(selectModuleKeys(vehicleSignals({ ...base, trim: "Type R" }))).toContain("luxury");
    expect(selectModuleKeys(vehicleSignals(base))).not.toContain("luxury");
  });

  it("withholds marketplace profiles until derivatives are actually wanted", () => {
    expect(selectModuleKeys(vehicleSignals(base))).not.toContain("marketplace_profiles");
    expect(selectModuleKeys(vehicleSignals({ ...base, needsChannelDerivatives: true })))
      .toContain("marketplace_profiles");
  });

  it("produces the same order for two vehicles needing the same modules", () => {
    const a = selectModuleKeys(vehicleSignals({ ...base, make: "Lexus", fuelType: "Hybrid" }));
    const b = selectModuleKeys(vehicleSignals({ ...base, make: "Acura", fuelType: "Hybrid" }));
    expect(a).toEqual(b);
  });
});

describe("assembly keeps a stable prefix", () => {
  it("puts the invariant block first so it can be cached", () => {
    const lean = assembleKnowledge(vehicleSignals(base));
    const rich = assembleKnowledge(vehicleSignals({
      ...base, make: "INFINITI", fuelType: "Hybrid", needsChannelDerivatives: true }));
    expect(rich.text.startsWith(lean.text.slice(0, lean.stablePrefixLength))).toBe(true);
    expect(rich.stablePrefixLength).toBe(lean.stablePrefixLength);
  });

  it("loads a fraction of the corpus for an ordinary car", () => {
    const all = generationModules().reduce((n, m) => n + m.content.length, 0);
    expect(assembleKnowledge(vehicleSignals(base)).text.length).toBeLessThan(all * 0.8);
  });

  it("labels each block with its revision", () => {
    expect(assembleKnowledge(vehicleSignals(base)).text)
      .toContain("(revision 3.0)");
  });

  it("refuses to assemble an operational module", () => {
    expect(() => selectModules({ ...vehicleSignals(base), condition: "used" } as never))
      .not.toThrow();
  });
});
