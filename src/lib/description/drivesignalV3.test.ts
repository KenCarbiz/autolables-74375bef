import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  DRIVESIGNAL_V3_SYSTEM, DRIVESIGNAL_V3_SYSTEM_VERSION,
} from "../../../supabase/functions/_shared/prompts/drivesignal-v3-system.ts";

// The owner's instruction was explicit: do not casually rewrite, summarize,
// optimize or simplify the V3 prompt. First objective is behavioural parity.
//
// A prompt is the easiest thing in a codebase to "improve" by accident — one
// tightened sentence while chasing a description someone disliked, and every
// vehicle on every rooftop is now written to different rules, with every
// earlier description misattributed to text that no longer exists.
//
// So the text is pinned. If this test fails, the question is not "update the
// hash" — it is whether the change was authorised. A genuine revision is a NEW
// version registered beside this one, with this one retained as superseded.

const SHA256 = "e9b1d526e6724cde393891ec7e2d91a2c9a0950ce6b9f579b93777e11380268e";

describe("the DriveSignal V3 system prompt is pinned", () => {
  it("matches the approved text exactly", () => {
    const actual = createHash("sha256").update(DRIVESIGNAL_V3_SYSTEM).digest("hex");
    expect(actual, [
      "The V3 system prompt has changed.",
      "This is not a hash to update. Behavioural parity with the owner-approved",
      "writer is the requirement. If the change is authorised, register a NEW",
      "version in description-prompt-registry.ts and mark 3.0.0 superseded.",
    ].join(" ")).toBe(SHA256);
  });

  it("carries its version", () => {
    expect(DRIVESIGNAL_V3_SYSTEM_VERSION).toBe("3.0.0");
  });
});

// Structural checks, so a truncated or partially-pasted prompt fails loudly
// rather than silently generating copy under half a ruleset.

describe("the prompt arrived whole", () => {
  it("carries all thirty-one numbered sections", () => {
    for (let n = 1; n <= 31; n++) {
      expect(DRIVESIGNAL_V3_SYSTEM, `section ${n} missing`)
        .toMatch(new RegExp(`\\n${n}\\. [A-Z]`));
    }
  });

  it("opens and closes on the accuracy rule", () => {
    expect(DRIVESIGNAL_V3_SYSTEM.startsWith("DRIVESIGNAL AI DESCRIPTION ENGINE")).toBe(true);
    expect(DRIVESIGNAL_V3_SYSTEM.trimEnd().endsWith("Accuracy always comes first.")).toBe(true);
  });

  it("keeps the ten-level evidence hierarchy", () => {
    expect(DRIVESIGNAL_V3_SYSTEM).toContain("1. OEM Window Sticker / Monroney");
    expect(DRIVESIGNAL_V3_SYSTEM).toContain("10. General Automotive Industry Knowledge");
  });

  it("keeps the clause that separates product knowledge from VIN evidence", () => {
    // The single most important sentence in the document for our architecture.
    expect(DRIVESIGNAL_V3_SYSTEM).toContain(
      "It must not be used to establish that the individual vehicle actually has that feature.");
  });

  it("keeps the five fact-confidence levels", () => {
    for (const level of ["VERIFIED", "CONFIRMED", "PROBABLE", "UNVERIFIED", "CONTRADICTED"]) {
      expect(DRIVESIGNAL_V3_SYSTEM).toContain(level);
    }
  });

  it("keeps the word-count bands rather than a character window", () => {
    expect(DRIVESIGNAL_V3_SYSTEM).toContain("250–400 words");
    expect(DRIVESIGNAL_V3_SYSTEM).toContain("600–900 words");
    expect(DRIVESIGNAL_V3_SYSTEM).toContain("Quality takes priority over word count.");
  });

  it("keeps the conservative ADAS language and its prohibitions", () => {
    expect(DRIVESIGNAL_V3_SYSTEM).toContain("Helps support driver awareness");
    for (const banned of ["Prevents accidents", "Self-driving", "Fully autonomous"]) {
      expect(DRIVESIGNAL_V3_SYSTEM).toContain(banned);
    }
  });

  it("keeps the instruction not to contradict a Buyers Guide", () => {
    // This is the rule the warranty ladder enforces in software.
    expect(DRIVESIGNAL_V3_SYSTEM).toMatch(/Do not contradict dealership disclosures, Buyers Guides/);
  });

  it("keeps the typographic quotes the source uses", () => {
    // Straight quotes here mean the text was retyped rather than reproduced.
    expect(DRIVESIGNAL_V3_SYSTEM).toContain("“Heated seats.”");
    expect(DRIVESIGNAL_V3_SYSTEM).not.toMatch(/["']/);
  });
});

describe("nothing interpolates into it", () => {
  it("contains no template placeholders", () => {
    // A ${...} in a stored prompt is a silent injection point and would also
    // break the checksum's meaning: the text sent would differ from the text
    // pinned. Vehicle data reaches the model in the fact snapshot, not here.
    expect(DRIVESIGNAL_V3_SYSTEM).not.toMatch(/\$\{/);
  });

  it("is a stable prefix — no dates, ids or per-vehicle text", () => {
    // The whole prompt is identical on every request, which is what makes
    // provider-side prompt caching possible and measurable.
    expect(DRIVESIGNAL_V3_SYSTEM).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(DRIVESIGNAL_V3_SYSTEM).not.toMatch(/\b[0-9A-HJ-NPR-Z]{17}\b/);
  });
});
