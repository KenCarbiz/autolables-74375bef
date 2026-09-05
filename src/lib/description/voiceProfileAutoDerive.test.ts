import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveVoiceProfile } from "../../../supabase/functions/_shared/description-voice.ts";

// Harte sat at zero descriptions across 130 vehicles. The pipeline built every
// case, every fact snapshot and every job, then refused at the gate:
// "Generation refused before any AI cost — the dealership voice profile is
// still a draft." 116 times, for a draft nobody had ever created.
//
// resolveVoiceProfile already read the whole profile out of description_settings.
// The only thing making it a draft was the absence of a stored row.

const orchestrate = readFileSync(
  join(__dirname, "../../../supabase/functions/description-orchestrate/index.ts"),
  "utf8",
);

const SETTINGS = {
  brand_voice: "Harte INFINITI writes with confidence, clarity, and genuine care.",
  default_tone: "professional",
  primary_city: "Hartford",
  state: "CT",
  dealer_name_format: "Harte INFINITI",
  cta_template: "Call us today.",
  prohibited_phrases: ["blowout"],
  required_legal_text: "Plus tax, title and registration.",
};

describe("a dealership that configured its voice can generate", () => {
  it("resolves a complete profile from settings alone, with no stored row", () => {
    const v = resolveVoiceProfile("t1", null, SETTINGS, null);
    expect(v.dealerName).toBe("Harte INFINITI");
    expect(v.city).toBe("Hartford");
    expect(v.state).toBe("CT");
    expect(v.brandPositioning).toContain("confidence, clarity");
    expect(v.defaultTone).toBe("professional");
    expect(v.ctaTemplate).toBe("Call us today.");
    expect(v.prohibitedPhrases).toContain("blowout");
    expect(v.requiredDisclosures).toContain("Plus tax, title and registration.");
  });

  it("only called it a draft because nothing was stored", () => {
    // The single field that blocked 130 vehicles.
    expect(resolveVoiceProfile("t1", null, SETTINGS, null).status).toBe("draft");
    expect(resolveVoiceProfile("t1", { status: "approved" }, SETTINGS, null).status).toBe("approved");
  });

  it("materializes and approves that profile instead of blocking", () => {
    expect(orchestrate).toMatch(/voice\.status = "approved"/);
    expect(orchestrate).toMatch(/from\("description_voice_profiles"\)\.insert\(/);
    expect(orchestrate).toMatch(/Derived automatically from the dealership's description settings/);
  });

  it("adopts a concurrent run's row rather than failing a generation", () => {
    // One approved profile per tenant is a partial unique index; two orchestrate
    // runs starting together must not turn that race into a failed job.
    expect(orchestrate).toMatch(/data = await read\(\);/);
    expect(orchestrate).toMatch(/if \(!data\) throw error;/);
  });
});

describe("what auto-approval must never unlock", () => {
  it("derives an EMPTY approved-claims list", () => {
    // "Absence is denial" — a tenant that never configured approved claims can
    // state no dealership benefit at all. Auto-approving the voice must not
    // quietly become auto-approving dealer claims.
    expect(resolveVoiceProfile("t1", null, SETTINGS, null).approvedClaims).toEqual([]);
  });

  it("writes a literal empty claim list on insert", () => {
    const start = orchestrate.indexOf('from("description_voice_profiles").insert(');
    const block = orchestrate.slice(start, orchestrate.indexOf("if (error) {", start));
    expect(block.length).toBeGreaterThan(50);
    expect(block).toMatch(/approved_claims: \[\]/);
  });

  it("stays empty even when settings are full of claim-shaped text", () => {
    // The assertion that matters is behavioural, not textual: no amount of
    // dealer configuration may become an approved claim by itself.
    const loud = {
      ...SETTINGS,
      brand_voice: "Lowest prices guaranteed. Free lifetime oil changes. Best service in CT.",
      selling_areas: ["Hartford", "New Haven"],
      cta_template: "Nobody beats our deals.",
    };
    const v = resolveVoiceProfile("t1", null, loud, null);
    expect(v.approvedClaims).toEqual([]);
    expect(v.differentiators).toEqual([]);
    // Those areas are approved SELLING areas, which is a different permission
    // from a dealership benefit claim.
    expect(v.approvedAreas).toEqual(["Hartford", "New Haven"]);
  });

  it("does not seed differentiators either", () => {
    expect(resolveVoiceProfile("t1", null, SETTINGS, null).differentiators).toEqual([]);
  });

  it("marks the row as derived so a human can tell", () => {
    expect(orchestrate).toMatch(/derivedFromSettings: true/);
  });
});

describe("a human's profile still wins", () => {
  it("a stored profile's own fields override settings", () => {
    const stored = { status: "approved", profile_json: { city: "New Haven", defaultTone: "warm" } };
    const v = resolveVoiceProfile("t1", stored, SETTINGS, null);
    expect(v.city).toBe("New Haven");
    expect(v.defaultTone).toBe("warm");
    // Unset fields still fall through to settings.
    expect(v.state).toBe("CT");
  });

  it("only derives when no approved profile exists", () => {
    const block = orchestrate.slice(orchestrate.indexOf("let data = await read();"));
    expect(block.slice(0, 400)).toMatch(/if \(!data\) \{/);
  });
});
