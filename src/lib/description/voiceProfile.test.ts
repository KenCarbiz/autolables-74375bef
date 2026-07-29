import { describe, it, expect } from "vitest";
import {
  GATED_DEALER_CLAIMS,
  TONE_OPTIONS,
  draftFromProfile,
  draftToProfileJson,
  draftAsProfile,
  validateVoiceProfile,
  diffVoiceProfiles,
  newlyApprovedClaims,
  computeVoiceProfileVersion,
  checkDealerClaims,
  resolveVoiceProfile,
  type VoiceProfileDraft,
} from "./voiceProfile";

// The voice screen is the only place a dealer can widen what the store is
// allowed to say about itself. These tests pin the two properties that make
// that safe: an unchecked claim stays denied, and the version the page shows
// is the version the orchestrator will compute.

const SETTINGS = {
  dealer_name_format: "Harte INFINITI", primary_city: "Manchester",
  state: "Connecticut", default_tone: "professional",
};

const profile = (over: Record<string, unknown> = {}, status: "draft" | "approved" = "approved") =>
  resolveVoiceProfile("t1", { profile_json: over, version: "vp_1", status }, SETTINGS, null);

const draft = (over: Partial<VoiceProfileDraft> = {}): VoiceProfileDraft => ({
  ...draftFromProfile(profile()),
  ...over,
});

describe("draft round-trip", () => {
  it("carries every editable field out of a stored profile and back", () => {
    const d = draft({ approvedClaims: ["family_owned"], differentiators: ["Free loaners"] });
    const json = draftToProfileJson(d);
    expect(json.dealerName).toBe("Harte INFINITI");
    expect(json.approvedClaims).toEqual(["family_owned"]);
    // Re-resolving the saved json reproduces the same draft.
    expect(draftFromProfile(resolveVoiceProfile("t1", { profile_json: json, version: "v", status: "draft" }, SETTINGS, null)))
      .toMatchObject({ dealerName: "Harte INFINITI", approvedClaims: ["family_owned"] });
  });

  it("trims text and drops blank list rows before saving", () => {
    const json = draftToProfileJson(draft({
      dealerName: "  Harte INFINITI  ",
      differentiators: ["Free loaners", "   ", ""],
    }));
    expect(json.dealerName).toBe("Harte INFINITI");
    expect(json.differentiators).toEqual(["Free loaners"]);
  });

  it("offers exactly the tones the engine defines", () => {
    expect(TONE_OPTIONS.map((t) => t.key).sort())
      .toEqual(["family", "luxury", "professional", "sporty", "value"]);
    for (const t of TONE_OPTIONS) expect(t.blurb.length).toBeGreaterThan(20);
  });
});

describe("the page computes the version the orchestrator will", () => {
  it("agrees with computeVoiceProfileVersion on the edited draft", async () => {
    const base = profile();
    const edited = draft({ approvedClaims: ["family_owned"], city: "Hartford" });
    const asProfile = draftAsProfile(edited, base);

    const shown = await computeVoiceProfileVersion(asProfile);
    // What the server would compute from the row it just stored.
    const stored = resolveVoiceProfile("t1",
      { profile_json: draftToProfileJson(edited), version: "ignored", status: "draft" },
      SETTINGS, null);
    expect(await computeVoiceProfileVersion(stored)).toBe(shown);
  });

  it("moves the version when an approved claim is added", async () => {
    const base = profile();
    const before = await computeVoiceProfileVersion(draftAsProfile(draft(), base));
    const after = await computeVoiceProfileVersion(
      draftAsProfile(draft({ approvedClaims: ["free_delivery"] }), base));
    expect(after).not.toBe(before);
  });
});

describe("validation names the preflight code it clears", () => {
  it("blocks a missing dealership name with the code the Studio shows", () => {
    const f = validateVoiceProfile(draft({ dealerName: "" }));
    const hit = f.find((x) => x.code === "DEALER_IDENTITY_INCOMPLETE" && x.blocking);
    expect(hit?.field).toBe("dealerName");
  });

  it("warns rather than blocks on a missing city", () => {
    const f = validateVoiceProfile(draft({ city: "", state: "" }));
    const hit = f.find((x) => x.code === "DEALER_IDENTITY_INCOMPLETE");
    expect(hit?.blocking).toBe(false);
  });

  it("blocks a disclosure row with no text", () => {
    // A blank disclosure is a hard stop server-side; the screen has to catch
    // it here or the dealer only finds out when a generation fails.
    const f = validateVoiceProfile(draft({ requiredDisclosures: ["Price excludes tax.", "  "] }));
    expect(f.some((x) => x.code === "REQUIRED_DISCLOSURE_UNAVAILABLE" && x.blocking)).toBe(true);
  });

  it("blocks a claim key the registry does not define", () => {
    const f = validateVoiceProfile(draft({ approvedClaims: ["free_puppies"] }));
    expect(f.some((x) => x.code === "UNKNOWN_APPROVED_CLAIM" && x.blocking)).toBe(true);
  });

  it("blocks a banned phrase that contradicts an approved differentiator", () => {
    const f = validateVoiceProfile(draft({
      prohibitedPhrases: ["lifetime"], differentiators: ["Lifetime powertrain coverage"],
    }));
    expect(f.some((x) => x.code === "VOICE_RULE_CONFLICT" && x.blocking)).toBe(true);
  });

  it("passes a fully configured profile", () => {
    expect(validateVoiceProfile(draft({ approvedClaims: ["family_owned"] }))).toHaveLength(0);
  });
});

describe("absence is denial", () => {
  it("leaves every gated claim unapproved on a fresh profile", () => {
    expect(draft().approvedClaims).toEqual([]);
  });

  it("keeps an unchecked claim blocking in generated copy", () => {
    const v = profile({ ...draftToProfileJson(draft()), dealerName: "Harte INFINITI" });
    const findings = checkDealerClaims("We are a family-owned dealership.", v);
    expect(findings[0]?.code).toBe("UNAPPROVED_DEALER_CLAIM");
    expect(findings[0]?.severity).toBe("blocking");
  });

  it("clears that same claim once it is approved here", () => {
    const v = profile({ ...draftToProfileJson(draft({ approvedClaims: ["family_owned"] })) });
    expect(checkDealerClaims("We are a family-owned dealership.", v)).toHaveLength(0);
  });

  it("covers every registry claim with a stable key and label", () => {
    for (const c of GATED_DEALER_CLAIMS) {
      expect(c.key).toMatch(/^[a-z_]+$/);
      expect(c.label.length).toBeGreaterThan(3);
    }
    expect(new Set(GATED_DEALER_CLAIMS.map((c) => c.key)).size).toBe(GATED_DEALER_CLAIMS.length);
  });
});

describe("the change summary shown before approval", () => {
  it("lists only what actually changed", () => {
    const before = draft();
    const after = draft({ city: "Hartford" });
    expect(diffVoiceProfiles(before, after).map((c) => c.field)).toEqual(["city"]);
  });

  it("ignores list reordering", () => {
    const before = draft({ differentiators: ["a", "b"] });
    const after = draft({ differentiators: ["b", "a"] });
    expect(diffVoiceProfiles(before, after)).toHaveLength(0);
  });

  it("flags a change that widens what the store may claim", () => {
    const c = diffVoiceProfiles(draft(), draft({ approvedClaims: ["price_match"] }));
    expect(c[0].widensClaims).toBe(true);
    expect(newlyApprovedClaims(draft(), draft({ approvedClaims: ["price_match"] })))
      .toEqual(["price_match"]);
  });

  it("does not flag removing a claim as widening", () => {
    const before = draft({ approvedClaims: ["price_match"] });
    const after = draft({ approvedClaims: [] });
    expect(diffVoiceProfiles(before, after)[0].widensClaims).toBe(false);
    expect(newlyApprovedClaims(before, after)).toEqual([]);
  });

  it("gives every changed field a human label", () => {
    const c = diffVoiceProfiles(draft(), draft({ ctaTemplate: "Call us", marketArea: "Greater Hartford" }));
    for (const x of c) expect(x.label).not.toBe(x.field);
  });
});
