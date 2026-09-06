import { describe, it, expect } from "vitest";
import {
  buildFactSnapshot, buildDescriptionPacket, validateContentV3, decideEligibility,
  type Finding,
} from "../../../supabase/functions/_shared/description-core.ts";
import { resolveVoiceProfile } from "../../../supabase/functions/_shared/description-voice.ts";
import { runGates, vehicleClassOf } from "../../../supabase/functions/_shared/description-gates.ts";

// Regression for a real incident on 2026-09-06.
//
// The first description this platform ever generated claimed wireless Apple
// CarPlay, Android Auto, heated front seats, a heated steering wheel and
// premium audio on a Jeep Wrangler whose fact snapshot contained none of them.
// It published to a live vehicle, because the QA gates existed in the repo but
// not in the deployed build.
//
// The evidence audit caught it. Nothing acted on the audit. This pins the
// chain that now does: gate finding -> merged into findings -> decideEligibility
// refuses to publish.

const WRANGLER = {
  id: "v1", vin: "1C4HJXDN4PW657311", ymm: "2023 Jeep Wrangler 4-Door",
  trim: "Altitude", condition: "used", mileage: 36087,
  features: ["Backup Camera"],
  mc_attributes: {
    year: 2023, make: "Jeep", model: "Wrangler 4-Door",
    engine: "2.0L I4 DOHC DI Turbo", transmission: "8-Speed Automatic",
    drivetrain: "4WD", exterior_color: "Blue Pearl", interior_color: "Black",
    options: ["Backup Camera"],
  },
};

const SETTINGS = {
  review_mode: "AUTO_PUBLISH_CLEAN", quality_threshold: 70,
  min_length: 3000, max_length: 3879,
};

// The five ids the model actually returned, none of which were supplied.
const FABRICATED = [
  "wireless_apple_carplay", "android_auto", "heated_front_seats",
  "heated_steering_wheel", "premium_audio_system",
];

function runChain(claimed: string[], content: string) {
  const snap = buildFactSnapshot(WRANGLER, SETTINGS, null);
  const voice = resolveVoiceProfile("t1",
    { profile_json: {}, version: "vp_test", status: "approved" }, SETTINGS,
    { dealer_name: "Harte Jeep", city: "Hartford", state: "CT" });
  const packet = buildDescriptionPacket(snap, SETTINGS, voice);
  const validator: Finding[] = validateContentV3(content, snap, SETTINGS, packet);
  const report = runGates({
    content, snapshot: snap, validatorFindings: validator,
    output: { used_fact_ids: claimed, hero_fact_ids: [], warranty_fact_ids: [], history_fact_ids: [] },
    lengthBand: { min: 1800, max: 3800 },
    vehicleClass: vehicleClassOf({ isTruck: false, isLuxuryOrPerformance: false, msrp: null }),
  });
  const merged: Finding[] = [...validator, ...report.findings
    .filter((g) => g.origin === "gate")
    .map((g) => ({
      validator_code: g.code,
      severity: (g.blocking ? "blocking" : "warning") as Finding["severity"],
      message: g.message, blocking: g.blocking,
    }))];
  return { snap, report, ...decideEligibility(merged, SETTINGS, "used", 85) };
}

const CLEAN_COPY = Array.from({ length: 8 }, (_, p) =>
  Array.from({ length: 5 }, (_, i) =>
    `Paragraph ${p} sentence ${i} explains a verified feature and why it matters.`)
    .join(" ")).join("\n\n");

describe("equipment the vehicle does not have cannot be published", () => {
  // The second Wrangler incident, 2026-09-06 18:34. The copy claimed Apple
  // CarPlay and Android Auto; the decode contained neither. The evidence audit
  // PASSED, because the model asserted them in prose without citing a fact id
  // and a citation audit can only judge citations. The feature check was a
  // denylist — it caught equipment the packet excluded, and equipment that was
  // never in the data at all is in no list to be excluded from.
  const withCarPlay = `${CLEAN_COPY}\n\nApple CarPlay and Android Auto keep phones connected.`;

  it("blocks a catalogued feature no verified fact supports", () => {
    const snap = buildFactSnapshot(WRANGLER, SETTINGS, null);
    const voice = resolveVoiceProfile("t1",
      { profile_json: {}, version: "vp_test", status: "approved" }, SETTINGS,
      { dealer_name: "Harte Jeep", city: "Hartford", state: "CT" });
    const packet = buildDescriptionPacket(snap, SETTINGS, voice);
    const findings = validateContentV3(withCarPlay, snap, SETTINGS, packet);
    const unsupported = findings.filter((f) => f.validator_code === "UNSUPPORTED_FEATURE_CLAIM");
    expect(unsupported.length).toBeGreaterThanOrEqual(2);
    expect(unsupported.every((f) => f.blocking)).toBe(true);
    expect(unsupported.map((f) => f.claim_text?.toLowerCase()).join(" "))
      .toMatch(/carplay/);
  });

  it("refuses publication for it", () => {
    const snap = buildFactSnapshot(WRANGLER, SETTINGS, null);
    const voice = resolveVoiceProfile("t1",
      { profile_json: {}, version: "vp_test", status: "approved" }, SETTINGS,
      { dealer_name: "Harte Jeep", city: "Hartford", state: "CT" });
    const packet = buildDescriptionPacket(snap, SETTINGS, voice);
    const findings = validateContentV3(withCarPlay, snap, SETTINGS, packet);
    expect(decideEligibility(findings, SETTINGS, "used", 85).eligibility).toBe("blocked");
  });

  it("does not flag equipment a non-equipment fact supports", () => {
    // All-wheel drive is a drivetrain fact, not an equipment list entry.
    // Checking equipment alone flagged it on a vehicle that plainly has it.
    const awd = { ...WRANGLER, mc_attributes: { ...WRANGLER.mc_attributes, drivetrain: "4WD" } };
    const snap = buildFactSnapshot(awd, SETTINGS, null);
    const voice = resolveVoiceProfile("t1",
      { profile_json: {}, version: "vp_test", status: "approved" }, SETTINGS,
      { dealer_name: "Harte Jeep", city: "Hartford", state: "CT" });
    const packet = buildDescriptionPacket(snap, SETTINGS, voice);
    const findings = validateContentV3(
      `${CLEAN_COPY}\n\nFour-wheel drive suits the season.`, snap, SETTINGS, packet);
    expect(findings.filter((f) => f.validator_code === "UNSUPPORTED_FEATURE_CLAIM")).toHaveLength(0);
  });
});

describe("the Wrangler incident cannot publish again", () => {
  it("the snapshot never contained the five claimed features", () => {
    const snap = buildFactSnapshot(WRANGLER, SETTINGS, null);
    for (const id of FABRICATED) {
      expect(Object.keys(snap.facts), id).not.toContain(id);
    }
  });

  it("flags every fabricated citation as blocking", () => {
    const { report } = runChain(FABRICATED, CLEAN_COPY);
    expect(report.evidence?.ok).toBe(false);
    expect(report.evidence?.fabricated_ids.sort()).toEqual([...FABRICATED].sort());
    const blocking = report.findings.filter((f) => f.code === "FABRICATED_FACT_CITATION");
    expect(blocking).toHaveLength(5);
    expect(blocking.every((f) => f.blocking)).toBe(true);
  });

  it("refuses publication outright", () => {
    // The whole point. On the day, this returned eligible and published.
    expect(runChain(FABRICATED, CLEAN_COPY).eligibility).toBe("blocked");
  });

  it("still publishes a description that only cites what it was given", () => {
    // The guard must not block everything; a writer citing real facts passes.
    const { eligibility } = runChain(["equipment", "mileage"], CLEAN_COPY);
    expect(eligibility).toBe("eligible");
  });

  it("blocks even one fabricated citation among several real ones", () => {
    const { eligibility } = runChain(["equipment", "mileage", "heated_front_seats"], CLEAN_COPY);
    expect(eligibility).toBe("blocked");
  });

  it("does not depend on the prose mentioning the feature", () => {
    // The prose validator can miss a claim it has no fact key for. The
    // citation audit is a separate net, and it catches this one.
    const { eligibility } = runChain(FABRICATED, CLEAN_COPY);
    expect(eligibility).toBe("blocked");
  });
});
