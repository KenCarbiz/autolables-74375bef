import { describe, it, expect } from "vitest";
import {
  resolveVoiceProfile, voiceInstruction, checkLocalityUse,
} from "../../../supabase/functions/_shared/description-voice.ts";
import {
  buildFactSnapshot, buildDescriptionPacket, buildMasterPromptV3,
  buildChannelPromptV3, policyForChannel,
} from "../../../supabase/functions/_shared/description-core.ts";

// The 20 market areas resolved from the rooftop ZIP were an allowlist that
// checkLocalityUse validated against, but nothing ever told the model what was
// on it. Any place it guessed came back UNAPPROVED_SERVICE_AREA, and the
// master prompt separately said "do not list nearby towns" — so local
// relevance was permitted, unstated and forbidden at the same time.

const AREAS = [
  "Hartford, CT", "East Hartford, CT", "West Hartford, CT", "Manchester, CT",
  "New Britain, CT", "Middletown, CT", "Springfield, MA", "New Haven, CT",
];

const SETTINGS = {
  primary_city: "Hartford", state: "CT", selling_areas: AREAS,
  min_length: 1800, max_length: 3800,
};

const voiceOf = (areas: string[] = AREAS) =>
  resolveVoiceProfile("t1", { profile_json: {}, version: "vp", status: "approved" },
    { ...SETTINGS, selling_areas: areas },
    { dealer_name: "Harte Jeep", city: "Hartford", state: "CT" });

describe("the model is told which places it may name", () => {
  it("lists the approved localities in the voice instruction", () => {
    const text = voiceInstruction(voiceOf());
    expect(text).toContain("Approved localities");
    expect(text).toContain("Hartford, CT");
    expect(text).toContain("Springfield, MA");
  });

  it("caps how many may be used", () => {
    expect(voiceInstruction(voiceOf())).toMatch(/AT MOST TWO/);
  });

  it("forbids enumeration in the same breath as permitting use", () => {
    const text = voiceInstruction(voiceOf());
    expect(text).toMatch(/Never enumerate them/);
    expect(text).toMatch(/serving/i);
  });

  it("says nothing about localities when none are approved", () => {
    // Absence is denial: a dealership that configured no areas gets silence,
    // not a licence to invent a service area.
    expect(voiceInstruction(voiceOf([]))).not.toContain("Approved localities");
  });

  it("does not dump all twenty into the prompt", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Town${i}, CT`);
    const text = voiceInstruction(voiceOf(many));
    expect(text).toContain("Town0, CT");
    expect(text).not.toContain("Town15, CT");
  });
});

const LISTING = {
  id: "v1", vin: "1C4HJXDN4PW657311", ymm: "2023 Jeep Wrangler 4-Door",
  trim: "Altitude", condition: "used", mileage: 36087,
  mc_attributes: { year: 2023, make: "Jeep", model: "Wrangler 4-Door",
                   options: ["Backup Camera"] },
};

const promptFor = (areas: string[]) => {
  const snap = buildFactSnapshot(LISTING, SETTINGS, null);
  return buildMasterPromptV3(
    buildDescriptionPacket(snap, SETTINGS, voiceOf(areas)), SETTINGS);
};

describe("the master prompt stops contradicting the allowlist", () => {
  it("no longer bans nearby towns outright", () => {
    expect(promptFor(AREAS)).not.toMatch(/do not list nearby towns/i);
  });

  it("permits a measured amount of local relevance", () => {
    const p = promptFor(AREAS);
    expect(p).toMatch(/Local relevance/);
    expect(p).toMatch(/at most two of the approved localities/);
  });

  it("still forbids a serving list", () => {
    expect(promptFor(AREAS)).toMatch(/never write a "serving \.\.\." list/i);
  });

  it("falls back to silence when the dealership has no approved areas", () => {
    const p = promptFor([]);
    expect(p).toMatch(/Do not name towns or regions/);
    expect(p).not.toMatch(/at most two of the approved localities/);
  });

  it("asks for identity naturally rather than repetition", () => {
    // Section 20: the exact year/make/model/trim should appear naturally and
    // then vary, not be mechanically repeated.
    expect(promptFor(AREAS)).toMatch(/vary wording afterwards rather than repeating/);
  });
});

describe("the guardrail that makes permission safe still holds", () => {
  const v = voiceOf();

  it("blocks a place the dealership never approved", () => {
    const f = checkLocalityUse("Proudly serving Boston shoppers every day.", v);
    expect(f.some((x) => x.code === "UNAPPROVED_SERVICE_AREA" && x.severity === "blocking")).toBe(true);
  });

  it("blocks an enumerated city list even of approved places", () => {
    const f = checkLocalityUse(
      "Serving Hartford, Manchester, New Britain and Middletown drivers.", v);
    expect(f.some((x) => x.code === "LOCALITY_STUFFING")).toBe(true);
  });

  it("allows one natural mention", () => {
    const f = checkLocalityUse(
      "This Wrangler is ready for a Hartford commute and weekend trails.", v);
    expect(f).toHaveLength(0);
  });
});

// ── Channel ceilings ─────────────────────────────────────────────────

describe("a channel ceiling is not a floor", () => {
  const snap = buildFactSnapshot(LISTING, SETTINGS, null);
  const packet = buildDescriptionPacket(snap, SETTINGS, voiceOf(AREAS));
  const master = "An approved master description of moderate length.";

  it("gives vAuto a ceiling and no minimum", () => {
    // 3,879 is the export limit. Printing "0-3879" would read as a range and
    // invite padding toward the top of it.
    const vauto = policyForChannel("vauto")!;
    expect(vauto.recommendedMin).toBe(0);
    expect(vauto.characterLimit).toBe(3879);
    const prompt = buildChannelPromptV3(master, vauto, packet);
    expect(prompt).toMatch(/at most 3879 characters/);
    expect(prompt).toMatch(/There is no minimum/);
    expect(prompt).not.toMatch(/0-3879/);
  });

  it("still states a range for a channel that has a floor", () => {
    const at = policyForChannel("autotrader")!;
    expect(at.recommendedMin).toBeGreaterThan(0);
    expect(buildChannelPromptV3(master, at, packet))
      .toMatch(new RegExp(`Length: ${at.recommendedMin}-${at.recommendedMax} characters`));
  });

  it("never pins the master to a channel's limit", () => {
    // The master follows the verified information; the channel caps what it
    // exports. A master written to vAuto's ceiling is a master written for
    // one destination.
    expect(SETTINGS.max_length).toBeLessThan(policyForChannel("vauto")!.characterLimit);
  });
});
