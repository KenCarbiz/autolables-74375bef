// ── The cohort refuses by default ──────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  buildCohortKey, cohortKeyHash, cohortsMatch, mayShareMarketEvidence,
  normalizeDrivetrain, normalizeTrim, equipmentSignature,
  EQUIPMENT_UNKNOWN, COHORT_RULES_VERSION,
} from "./cohort.ts";

const QX60 = {
  year: 2023, make: "INFINITI", model: "QX60", trim: "LUXE",
  drivetrain: "AWD", powertrain: "3.5L V6", bodyType: "SUV",
  condition: "cpo", certified: true,
  equipment: ["Premium Package", "Cold Weather Package"],
  zip: "06120", radiusMiles: 100,
};

const key = (over: Record<string, unknown> = {}) => buildCohortKey({ ...QX60, ...over });

describe("normalization", () => {
  it("reads drivetrain across the spellings a feed emits", () => {
    for (const [input, expected] of [
      ["AWD", "awd"], ["awd", "awd"], ["All Wheel Drive", "awd"],
      ["FWD", "fwd"], ["Front Wheel Drive", "fwd"],
      ["RWD", "rwd"], ["4WD", "4wd"], ["4x4", "4wd"],
    ] as const) {
      expect(normalizeDrivetrain(input), input).toBe(expected);
    }
  });

  it("treats an unreadable drivetrain as unknown, never as a wildcard", () => {
    for (const v of [null, undefined, "", "  ", "hybrid", 4, {}, []]) {
      expect(normalizeDrivetrain(v), JSON.stringify(v)).toBe("unknown");
    }
  });

  it("normalizes trim spelling only", () => {
    expect(normalizeTrim("LUXE")).toBe("luxe");
    expect(normalizeTrim(" Luxe ")).toBe("luxe");
    expect(normalizeTrim("A-Spec Package")).toBe("a spec package");
    // And does NOT collapse meaning.
    expect(normalizeTrim("LUXE")).not.toBe(normalizeTrim("SENSORY"));
    expect(normalizeTrim("Sport")).not.toBe(normalizeTrim("Sport Touring"));
  });

  it("hashes an equipment set independent of order and case", () => {
    const a = equipmentSignature(["Premium Package", "Cold Weather Package"]);
    const b = equipmentSignature(["cold weather package", "PREMIUM PACKAGE"]);
    expect(a).toBe(b);
    expect(a).not.toBe(EQUIPMENT_UNKNOWN);
  });

  it("calls an absent or empty equipment set unknown", () => {
    for (const v of [null, undefined, [], "loaded", {}, [""], ["  "]]) {
      expect(equipmentSignature(v), JSON.stringify(v)).toBe(EQUIPMENT_UNKNOWN);
    }
  });
});

describe("the key itself", () => {
  it("carries no VIN, no price and no tenant secret", () => {
    const k = key();
    const serialized = JSON.stringify(k);
    for (const forbidden of ["vin", "price", "tenant", "secret", "customer", "api_key"]) {
      expect(serialized.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(k)).not.toContain("vin");
  });

  it("is usable only when every required dimension is known", () => {
    expect(key().usable).toBe(true);
    for (const missing of [
      { year: null }, { make: null }, { model: null }, { trim: null },
      { drivetrain: "hybrid" }, { condition: "unknown", certified: null }, { zip: null }, { radiusMiles: null },
    ]) {
      expect(key(missing).usable, JSON.stringify(missing)).toBe(false);
    }
  });

  it("forms with unknown equipment but records it", () => {
    const k = key({ equipment: null });
    expect(k.equipmentSignature).toBe(EQUIPMENT_UNKNOWN);
    expect(k.reasons).toContain("cohort_equipment_unknown");
  });

  it("hashes stably and changes on every material dimension", () => {
    const base = cohortKeyHash(key());
    expect(cohortKeyHash(key())).toBe(base);
    for (const change of [
      { year: 2024 }, { make: "Acura" }, { model: "QX55" }, { trim: "SENSORY" },
      { drivetrain: "FWD" }, { powertrain: "2.0L I4" }, { bodyType: "Sedan" },
      { condition: "used", certified: false }, { certified: false },
      { equipment: ["Premium Package"] }, { zip: "06106" }, { radiusMiles: 50 },
    ]) {
      expect(cohortKeyHash(key(change)), JSON.stringify(change)).not.toBe(base);
    }
  });

  it("carries the rules version so old keys cannot match new meanings", () => {
    expect(key().cohortRulesVersion).toBe(COHORT_RULES_VERSION);
  });
});

describe("cohortsMatch", () => {
  it("matches an identical cohort", () => {
    const m = cohortsMatch(key(), key());
    expect(m.relation).toBe("exact");
    expect(mayShareMarketEvidence(m)).toBe(true);
  });

  it("refuses a different drivetrain — AWD and FWD are different cars", () => {
    const m = cohortsMatch(key(), key({ drivetrain: "FWD" }));
    expect(m.relation).toBe("incompatible");
    expect(m.reasons).toContain("cohort_drivetrain_differs");
    expect(mayShareMarketEvidence(m)).toBe(false);
  });

  it("refuses a different certification class", () => {
    const m = cohortsMatch(key(), key({ condition: "used", certified: false }));
    expect(m.relation).toBe("incompatible");
    expect(m.reasons.some((r) => r.startsWith("cohort_"))).toBe(true);
  });

  it("refuses a different trim, however similar the strings", () => {
    for (const trim of ["SENSORY", "Sport", "LUXE PLUS", "Luxe Package"]) {
      const m = cohortsMatch(key(), key({ trim }));
      expect(m.relation, trim).toBe("incompatible");
    }
  });

  it("refuses a different powertrain and a different body", () => {
    expect(cohortsMatch(key(), key({ powertrain: "2.0L I4" })).reasons)
      .toContain("cohort_powertrain_differs");
    expect(cohortsMatch(key(), key({ bodyType: "Sedan" })).reasons)
      .toContain("cohort_body_differs");
  });

  it("refuses a different material package", () => {
    const m = cohortsMatch(key(), key({ equipment: ["Premium Package"] }));
    expect(m.relation).toBe("incompatible");
    expect(m.reasons).toContain("cohort_equipment_differs");
  });

  it("NEVER matches two unknown equipment sets to each other", () => {
    // Two cars nobody has decoded are two cars nobody has decoded.
    const unknown = key({ equipment: null });
    const m = cohortsMatch(unknown, key({ equipment: undefined }));
    expect(m.relation).toBe("incompatible");
    expect(m.reasons).toContain("cohort_equipment_unknown_never_matches");
  });

  it("never treats unknown equipment as matching a known signature", () => {
    expect(cohortsMatch(key(), key({ equipment: null })).relation).toBe("incompatible");
    expect(cohortsMatch(key({ equipment: null }), key()).relation).toBe("incompatible");
  });

  it("records an adjacent model year as context only, never as the same market", () => {
    const m = cohortsMatch(key(), key({ year: 2024 }));
    expect(m.relation).toBe("context_only");
    expect(m.reasons).toContain("cohort_adjacent_model_year");
    expect(m.reasons).toContain("cohort_same_generation_not_approved");
    expect(mayShareMarketEvidence(m)).toBe(false);
  });

  it("does not treat a two-year gap as adjacent", () => {
    expect(cohortsMatch(key(), key({ year: 2025 })).relation).toBe("incompatible");
  });

  it("refuses an unusable key on either side", () => {
    const m = cohortsMatch(key(), key({ trim: null }));
    expect(m.relation).toBe("incompatible");
    expect(m.reasons).toContain("cohort_key_not_usable");
  });

  it("refuses across rules versions", () => {
    const stale = { ...key(), cohortRulesVersion: "cohort-v0.9.0" };
    expect(cohortsMatch(stale, key()).reasons).toContain("cohort_rules_version_differs");
  });

  it("gives every match and refusal a reason", () => {
    for (const other of [key(), key({ trim: "SENSORY" }), key({ year: 2024 }), key({ equipment: null })]) {
      expect(cohortsMatch(key(), other).reasons.length).toBeGreaterThan(0);
    }
  });

  it("performs no fuzzy or similarity upgrade", () => {
    // Comments stripped: the module's header rules these out BY NAME, and a
    // guard that fires on its own documentation teaches people to delete the
    // documentation.
    const src: string = require("node:fs")
      .readFileSync("src/lib/market/cohort.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .toLowerCase();
    for (const fuzzy of [
      "levenshtein", "similarity", "fuzzy", "jaro", "embedding",
      "startswith(", "includes(", "indexof(",
    ]) {
      expect(src, fuzzy).not.toContain(fuzzy);
    }
    // And the only comparison it makes is equality.
    expect(src).toContain("!==");
  });
});
