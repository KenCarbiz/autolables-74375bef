import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LENGTH_POLICY, preferredLengthBand, lengthScore, buildFactSnapshot,
} from "../../../supabase/functions/_shared/description-core.ts";

// Harte was configured min_length 3750 / max_length 3922 — a 172-character
// window. The only ways to satisfy that are padding a finished description or
// truncating a detailed one, and both produce exactly the generic boilerplate
// the writer exists to avoid. Length is the LAST of six generation priorities,
// beneath factual accuracy, differentiation, readability, voice and SEO.

describe("length is a target, not a quota", () => {
  it("carries the platform band the owner set", () => {
    expect(LENGTH_POLICY).toEqual({
      softMin: 1800, preferredMin: 2400, preferredMax: 3200,
      softMax: 3800, absoluteMax: 4500,
    });
  });

  it("honours a dealer's own reasonable band", () => {
    expect(preferredLengthBand({ min_length: 2000, max_length: 3000 }))
      .toEqual({ min: 2000, max: 3000 });
  });

  it("refuses a window too tight to write in", () => {
    // 3750-3922 is a misconfiguration, not an instruction.
    expect(preferredLengthBand({ min_length: 3750, max_length: 3922 }))
      .toEqual({ min: 2400, max: 3200 });
  });

  it("refuses an inverted band", () => {
    expect(preferredLengthBand({ min_length: 3000, max_length: 2000 }))
      .toEqual({ min: 2400, max: 3200 });
  });

  it("falls back to the platform band when unset", () => {
    expect(preferredLengthBand({})).toEqual({ min: 2400, max: 3200 });
  });
});

describe("a sparse vehicle is not punished for being short", () => {
  const settings = {};

  it("scores a concise, honest description well", () => {
    // A lightly equipped car with little verified data legitimately produces
    // ~2,000 characters. Under the old rule that scored 12/30, the same as
    // a 9,000-character wall of filler.
    expect(lengthScore(2000, settings)).toBe(24);
  });

  it("scores inside the preferred band highest", () => {
    expect(lengthScore(2800, settings)).toBe(30);
  });

  it("does not cliff-edge just outside the band", () => {
    // 2,399 and 2,400 must not be a 60% scoring difference.
    expect(lengthScore(2399, settings)).toBeGreaterThanOrEqual(24);
    expect(lengthScore(3201, settings)).toBeGreaterThanOrEqual(24);
  });

  it("still marks down a bloated description", () => {
    expect(lengthScore(4400, settings)).toBe(16);
    expect(lengthScore(9000, settings)).toBe(6);
  });

  it("ranks a rich vehicle above a padded one", () => {
    // 3,100 of real equipment beats 4,600 of filler.
    expect(lengthScore(3100, settings)).toBeGreaterThan(lengthScore(4600, settings));
  });
});

describe("the prompt asks for a story, not a character count", () => {
  const core = readFileSync(
    join(__dirname, "../../../supabase/functions/_shared/description-core.ts"), "utf8");

  it("forbids padding in the instruction itself", () => {
    expect(core).toMatch(/Never pad, repeat a feature, restate a fact in different words/);
    expect(core).toMatch(/This is a target, not a quota/);
  });

  it("states the safety ceiling", () => {
    expect(core).toMatch(/never exceed \$\{LENGTH_POLICY\.absoluteMax\}/);
  });

  it("no longer instructs a hard range", () => {
    expect(core).not.toMatch(/Length: between \$\{settings\.min_length/);
  });
});

// ── Warranty ─────────────────────────────────────────────────────────
//
// warranty_language_allowed was a blanket veto defaulting off, so a dealership
// with genuine verified remaining coverage could not mention it while one with
// none was equally silent. The setting decided, not the vehicle.

const LISTING = {
  vin: "1C4HJXDN4PW657311",
  ymm: "2023 Jeep Wrangler 4-Door",
  condition: "used",
  mileage: 36087,
  mc_attributes: { year: 2023, make: "Jeep", model: "Wrangler 4-Door" },
};
const factOf = (snap: ReturnType<typeof buildFactSnapshot>, key: string) =>
  (snap.facts as Record<string, { value?: unknown } | undefined>)[key];
const excludedFor = (snap: ReturnType<typeof buildFactSnapshot>, field: string) =>
  (snap.excluded_claims || []).filter((e: { field?: string }) => e.field === field);

describe("warranty language is gated by facts, not by a switch", () => {
  it("states verified coverage even when the old flag is off", () => {
    const snap = buildFactSnapshot(
      { ...LISTING, warranty_info: { program: "Jeep Wave", months_remaining: 14, miles_remaining: 12000 } },
      { warranty_language_allowed: false }, null);
    expect(factOf(snap, "warranty_eligible")).toBeTruthy();
  });

  it("says nothing at all when the vehicle carries no coverage", () => {
    const snap = buildFactSnapshot({ ...LISTING, warranty_info: {} }, {}, null);
    expect(factOf(snap, "warranty_eligible")).toBeFalsy();
  });

  it("carries the exact terms when the exact terms are known", () => {
    // A writer handed "remaining factory coverage" cannot honestly produce
    // "5 years / 60,000 miles"; one handed the numbers can state them.
    const snap = buildFactSnapshot(
      { ...LISTING, warranty_info: { program: "Jeep Wave", months_remaining: 14, miles_remaining: 12000 } },
      {}, null);
    const v = String(factOf(snap, "warranty_eligible")?.value ?? "");
    expect(v).toContain("Jeep Wave");
    expect(v).toContain("14 months remaining");
    expect(v).toContain("12,000 miles remaining");
  });

  it("does not manufacture terms it was not given", () => {
    const snap = buildFactSnapshot(
      { ...LISTING, warranty_info: { program: "Jeep Wave" } }, {}, null);
    const v = String(factOf(snap, "warranty_eligible")?.value ?? "");
    expect(v).toContain("Jeep Wave");
    expect(v).not.toMatch(/month|mile/i);
  });

  it("ignores zero and blank coverage rather than reading it as verified", () => {
    const snap = buildFactSnapshot(
      { ...LISTING, warranty_info: { months_remaining: 0, miles_remaining: 0, program: "  " } }, {}, null);
    expect(factOf(snap, "warranty_eligible")).toBeFalsy();
  });

  it("still lets a dealership suppress warranty language deliberately", () => {
    // A legitimate legal preference — but it now takes an explicit choice,
    // not an unset default.
    const snap = buildFactSnapshot(
      { ...LISTING, warranty_info: { program: "Jeep Wave", months_remaining: 14 } },
      { warranty_language_allowed: false, warranty_language_suppressed_explicitly: true }, null);
    expect(factOf(snap, "warranty_eligible")).toBeFalsy();
    expect(excludedFor(snap, "warranty_eligible").length).toBeGreaterThan(0);
  });
});
