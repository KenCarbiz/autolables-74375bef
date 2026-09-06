import { describe, it, expect } from "vitest";
import {
  runGates, countWords, vehicleClassOf, WORD_BANDS, GATE_ORDER,
} from "../../../supabase/functions/_shared/description-gates.ts";
import { DRIVESIGNAL_V3_SYSTEM } from "../../../supabase/functions/_shared/prompts/drivesignal-v3-system.ts";

// The manual states that no description bypasses QA. These are those stages as
// software. The one thing they never consult is the model's opinion of its own
// work: a writer that fabricates a Bose system also reports requires_review
// false.

const SNAP = {
  facts: {
    equipment: { usable_in_copy: true },
    mileage: { usable_in_copy: true },
    warranty_eligible: { usable_in_copy: true },
    one_owner: { usable_in_copy: false },
  },
} as never;

const output = (o: Record<string, string[]> = {}) => ({
  used_fact_ids: [], hero_fact_ids: [], warranty_fact_ids: [], history_fact_ids: [], ...o,
});

// Eight paragraphs of five sentences, about 520 words: inside the mainstream
// band and inside the paragraph standard, so a PASS means the gates found
// nothing rather than that the fixture dodged them.
const CLEAN = Array.from({ length: 8 }, (_, p) =>
  Array.from({ length: 5 }, (_, i) =>
    `Paragraph ${p} sentence ${i} explains a verified feature and why it matters to an owner.`)
    .join(" ")).join("\n\n");

const base = {
  content: CLEAN, snapshot: SNAP, validatorFindings: [],
  vehicleClass: "mainstream" as const,
};

describe("gate 1 — evidence", () => {
  it("rejects a citation of a fact never supplied", () => {
    const r = runGates({ ...base, output: output({ used_fact_ids: ["bose_audio"] }) });
    expect(r.decision).toBe("REJECT");
    expect(r.findings.some((f) => f.code === "FABRICATED_FACT_CITATION" && f.blocking)).toBe(true);
  });

  it("rejects a citation of a fact withheld from copy", () => {
    const r = runGates({ ...base, output: output({ history_fact_ids: ["one_owner"] }) });
    expect(r.findings.some((f) => f.code === "EXCLUDED_FACT_CITATION" && f.blocking)).toBe(true);
  });

  it("routes the prose validator's blocking findings to the evidence gate", () => {
    const r = runGates({ ...base, validatorFindings: [
      { validator_code: "EXCLUDED_CLAIM_PRESENT", blocking: true, severity: "blocking",
        message: "excluded claim present" } as never] });
    expect(r.byGate.evidence.blocking).toBe(1);
    expect(r.decision).toBe("REJECT");
  });
});

describe("gate 2 — completeness", () => {
  it("flags copy below the class word band without blocking it", () => {
    // A sparse vehicle honestly described short is a review item, not a defect.
    const r = runGates({ ...base, content: "Short copy about a car. Contact us." });
    const f = r.findings.find((x) => x.code === "BELOW_CLASS_WORD_BAND");
    expect(f?.blocking).toBe(false);
    expect(r.decision).toBe("REVIEW");
  });

  it("flags padding above the band", () => {
    const long = Array.from({ length: 400 }, () => "padding words repeated here.").join(" ");
    expect(runGates({ ...base, content: long }).findings.some(
      (f) => f.code === "ABOVE_CLASS_WORD_BAND")).toBe(true);
  });

  it("notices short copy that ignored supplied facts", () => {
    const r = runGates({ ...base, content: "Short copy about a car. Contact us.",
      output: output({ used_fact_ids: ["equipment"] }) });
    expect(r.findings.some((f) => f.code === "SUPPLIED_FACTS_UNUSED")).toBe(true);
  });

  it("uses the manual's own bands", () => {
    expect(WORD_BANDS.economy).toEqual({ min: 250, max: 400 });
    expect(WORD_BANDS.luxury).toEqual({ min: 600, max: 900 });
    expect(WORD_BANDS.heavy_duty).toEqual({ min: 600, max: 850 });
  });
});

describe("gate 3 — editorial", () => {
  it("flags sentences that run long", () => {
    const runOn = Array.from({ length: 5 }, () =>
      Array.from({ length: 45 }, () => "word").join(" ") + ".").join(" ");
    expect(runGates({ ...base, content: runOn }).findings.some(
      (f) => f.code === "SENTENCES_TOO_LONG")).toBe(true);
  });

  it("flags a wall-of-text paragraph", () => {
    const wall = Array.from({ length: 12 }, (_, i) => `Sentence ${i} is here.`).join(" ");
    expect(runGates({ ...base, content: wall }).findings.some(
      (f) => f.code === "PARAGRAPH_TOO_LONG")).toBe(true);
  });
});

describe("gate 4 — SEO", () => {
  it("flags identity the copy never states", () => {
    const r = runGates({ ...base, identity: { year: 2027, make: "INFINITI", model: "QX80" } });
    const missing = r.findings.filter((f) => f.code === "IDENTITY_PART_MISSING");
    expect(missing).toHaveLength(3);
    expect(missing.every((f) => !f.blocking)).toBe(true);
  });

  it("passes when identity is present", () => {
    const r = runGates({ ...base, content: `2027 INFINITI QX80. ${CLEAN}`,
      identity: { year: 2027, make: "INFINITI", model: "QX80" } });
    expect(r.findings.some((f) => f.code === "IDENTITY_PART_MISSING")).toBe(false);
  });
});

describe("gate 5 — compliance", () => {
  it("rejects a safety overclaim outright", () => {
    // The one claim that can endanger a shopper rather than merely mislead.
    const r = runGates({ ...base, content: `${CLEAN} This system prevents accidents.` });
    expect(r.decision).toBe("REJECT");
    expect(r.findings.some((f) => f.code === "ADAS_OVERCLAIM" && f.blocking)).toBe(true);
  });

  it("rejects prohibited sales language", () => {
    const r = runGates({ ...base, content: `${CLEAN} This mint condition truck won't last.` });
    expect(r.decision).toBe("REJECT");
    expect(r.findings.filter((f) => f.code === "PROHIBITED_SALES_LANGUAGE").length)
      .toBeGreaterThanOrEqual(2);
  });

  it("matches a curly apostrophe the writer is likely to produce", () => {
    expect(runGates({ ...base, content: `${CLEAN} It won’t last.` }).findings.some(
      (f) => f.code === "PROHIBITED_SALES_LANGUAGE")).toBe(true);
  });

  it("covers every phrase the pinned V3 prompt forbids", () => {
    // If the prompt's list grows, this fails until the gate grows with it —
    // the prompt asking for something the software never checks is the drift
    // that matters.
    const forbidden = ["Prevents accidents", "Guarantees safety", "Eliminates collisions",
      "Eliminates blind spots", "Crash-proof", "Self-driving", "Fully autonomous",
      "Amazing", "Incredible", "Stunning", "Must see", "Dream car", "Fully loaded",
      "Mint condition", "Like new", "Priced to sell", "Act now", "Buy today",
      "Lowest price guaranteed"];
    for (const phrase of forbidden) {
      expect(DRIVESIGNAL_V3_SYSTEM, `${phrase} not in prompt`).toContain(phrase);
      const r = runGates({ ...base, content: `${CLEAN} ${phrase} here.` });
      expect(r.decision, `gate missed "${phrase}"`).toBe("REJECT");
    }
  });
});

describe("gate 7 — publication", () => {
  it("passes only clean copy", () => {
    expect(runGates({ ...base, output: output({ used_fact_ids: ["equipment"] }) }).decision)
      .toBe("PASS");
  });

  it("never publishes merely because text came back", () => {
    const r = runGates({ ...base, content: "Amazing dream car, act now.", output: output() });
    expect(r.decision).toBe("REJECT");
  });

  it("reports every gate, including the ones that found nothing", () => {
    expect(Object.keys(runGates(base).byGate).sort()).toEqual([...GATE_ORDER].sort());
  });
});

describe("class comes from the vehicle, not the copy", () => {
  it("reads truck, luxury and economy off resolved truth", () => {
    expect(vehicleClassOf({ isTruck: true })).toBe("heavy_duty");
    expect(vehicleClassOf({ isLuxuryOrPerformance: true })).toBe("luxury");
    expect(vehicleClassOf({ msrp: 21000 })).toBe("economy");
    expect(vehicleClassOf({ msrp: 41000 })).toBe("mainstream");
  });

  it("counts words the way the manual does", () => {
    expect(countWords("  one two   three ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});
