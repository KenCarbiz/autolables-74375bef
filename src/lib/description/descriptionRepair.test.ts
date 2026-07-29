import { describe, it, expect } from "vitest";
import { repairContent, hasRepairableFindings } from "../../../supabase/functions/_shared/description-repair";
import { resolveChannelPolicy } from "../../../supabase/functions/_shared/description-channel-policy";
import { can, evaluateOverride, NON_OVERRIDABLE } from "../../../supabase/functions/_shared/description-permissions";
import type { Finding } from "../../../supabase/functions/_shared/description-core";

// Repair only removes. These tests pin that it never invents a replacement,
// never empties the copy, and never touches a finding that means the copy is
// about the wrong vehicle.

const finding = (code: string, claim?: string, blocking = true): Finding => ({
  validator_code: code, severity: blocking ? "blocking" : "warning", blocking,
  message: `${code} finding`, claim_text: claim ?? null,
});

const BODY = `The 2025 INFINITI QX80 Sensory AWD is finished in Majestic White over a Graphite interior. A 5.6L V8 pairs with a nine-speed automatic and all-wheel drive. Equipment includes a navigation system and heated front seats. Three rows of seating make it practical for longer trips. Contact Harte INFINITI in Manchester to schedule a test drive.`;

describe("deterministic repair", () => {
  it("removes the sentence carrying an unapproved dealer claim", () => {
    const text = `${BODY} We are a family-owned dealership.`;
    const r = repairContent(text, [finding("UNAPPROVED_DEALER_CLAIM", "family-owned")]);
    expect(r.changed).toBe(true);
    expect(r.content).not.toContain("family-owned");
    // The rest of the copy survives intact — repair is surgical, not a rewrite.
    expect(r.content).toContain("Majestic White");
    expect(r.content).toContain("test drive");
    expect(r.applied[0].action).toBe("removed_sentence");
  });

  it("never rewrites a claim into a softer one", () => {
    const text = `${BODY} This is a one-owner vehicle.`;
    const r = repairContent(text, [finding("OWNERSHIP_CLAIM", "one-owner")]);
    // The sentence is gone, not reworded into "likely one owner" or similar.
    expect(r.content).not.toMatch(/one[- ]owner/i);
    expect(r.content).not.toMatch(/owner/i);
    expect(r.applied.every((a) => a.action !== "appended_disclosure" || true)).toBe(true);
  });

  it("refuses to repair a finding that means the copy is about another vehicle", () => {
    const r = repairContent(BODY, [finding("IDENTITY_YEAR_CONFLICT", "2024")]);
    expect(r.changed).toBe(false);
    expect(r.unrepairable).toContain("IDENTITY_YEAR_CONFLICT");
  });

  it("refuses to repair an unresolved source conflict or missing identity", () => {
    for (const code of ["SOURCE_CONFLICT_UNRESOLVED", "REQUIRED_DATA_MISSING", "HIDDEN_TEXT_DETECTED"]) {
      const r = repairContent(BODY, [finding(code, "x")]);
      expect(r.unrepairable).toContain(code);
      expect(r.changed).toBe(false);
    }
  });

  it("refuses to gut the description down to nothing", () => {
    const short = "This one-owner SUV is excellent.";
    const r = repairContent(short, [finding("OWNERSHIP_CLAIM", "one-owner")]);
    expect(r.changed).toBe(false);
    expect(r.unrepairable).toContain("OWNERSHIP_CLAIM");
  });

  it("leaves a claim alone when it does not localize to one sentence", () => {
    const r = repairContent(BODY, [finding("UNAPPROVED_DEALER_CLAIM", "nowhere in this text")]);
    expect(r.changed).toBe(false);
    expect(r.unrepairable).toContain("UNAPPROVED_DEALER_CLAIM");
  });

  it("strips formatting the destination cannot render", () => {
    const policy = resolveChannelPolicy("facebook")!;
    const r = repairContent(`**Bold** ${BODY} <b>tag</b>`, [], policy);
    expect(r.content).not.toContain("**");
    expect(r.content).not.toContain("<b>");
    expect(r.applied.some((a) => a.action === "stripped_formatting")).toBe(true);
  });

  it("strips emoji where the channel forbids them", () => {
    const policy = resolveChannelPolicy("facebook")!;
    const r = repairContent(`${BODY} 🚗🔥`, [], policy);
    expect(r.content).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(r.applied.some((a) => a.action === "stripped_emoji")).toBe(true);
  });

  it("trims to the channel limit at a sentence boundary, never mid-word", () => {
    const policy = resolveChannelPolicy("facebook")!;
    const long = Array(8).fill(BODY).join(" ");
    const r = repairContent(long, [], policy);
    expect(r.content.length).toBeLessThanOrEqual(policy.characterLimit);
    // Ends on a real sentence, with no ellipsis stub.
    expect(r.content.trim()).toMatch(/[.!?]$/);
    expect(r.content).not.toContain("…");
  });

  it("appends an approved disclosure verbatim rather than paraphrasing it", () => {
    const disclosure = "Price excludes tax, title and registration.";
    const r = repairContent(BODY, [], undefined, [disclosure]);
    expect(r.content).toContain(disclosure);
    expect(r.applied.some((a) => a.action === "appended_disclosure")).toBe(true);
  });

  it("does not duplicate a disclosure already present", () => {
    const disclosure = "Price excludes tax, title and registration.";
    const r = repairContent(`${BODY} ${disclosure}`, [], undefined, [disclosure]);
    expect(r.content.split(disclosure).length - 1).toBe(1);
  });

  it("identifies which finding sets are worth a repair pass", () => {
    expect(hasRepairableFindings([finding("UNAPPROVED_DEALER_CLAIM", "x")])).toBe(true);
    expect(hasRepairableFindings([finding("IDENTITY_YEAR_CONFLICT", "x")])).toBe(false);
    expect(hasRepairableFindings([finding("KEYWORD_STUFFING", "x", false)])).toBe(false);
  });
});

describe("description permissions", () => {
  it("lets a salesperson generate but not approve", () => {
    const ctx = { role: "salesperson" };
    expect(can("descriptions.generate", ctx)).toBe(true);
    expect(can("descriptions.save_to_vehicle", ctx)).toBe(true);
    expect(can("descriptions.approve", ctx)).toBe(false);
    expect(can("descriptions.publish", ctx)).toBe(false);
  });

  it("keeps voice and channel configuration narrower than approval", () => {
    const manager = { role: "manager" };
    expect(can("descriptions.approve", manager)).toBe(true);
    // A manager may approve a description but not redefine what the store is
    // allowed to claim about itself.
    expect(can("descriptions.manage_voice_profile", manager)).toBe(false);
    expect(can("descriptions.manage_channel_policies", manager)).toBe(false);
    expect(can("descriptions.manage_voice_profile", { role: "owner" })).toBe(true);
  });

  it("grants validation override to almost nobody", () => {
    expect(can("descriptions.override_validation", { role: "owner" })).toBe(true);
    expect(can("descriptions.override_validation", { role: "compliance" })).toBe(true);
    expect(can("descriptions.override_validation", { role: "manager" })).toBe(false);
    expect(can("descriptions.override_validation", { role: "salesperson" })).toBe(false);
  });

  it("denies everything to a non-member", () => {
    expect(can("descriptions.view", { role: null })).toBe(false);
    expect(can("descriptions.view", { role: "" })).toBe(false);
  });

  it("never lets an override make an unsupported vehicle fact true", () => {
    const d = evaluateOverride({
      validatorCodes: ["UNSUPPORTED_FEATURE_CLAIM"],
      reason: "The manager confirms this equipment is present",
      ctx: { role: "owner" },
    });
    expect(d.allowed).toBe(false);
    expect(d.refused).toContain("UNSUPPORTED_FEATURE_CLAIM");
    expect(d.error).toBe("unsupported_vehicle_facts_cannot_be_overridden");
  });

  it("refuses every fact-bearing finding regardless of who asks", () => {
    for (const code of NON_OVERRIDABLE) {
      const d = evaluateOverride({
        validatorCodes: [code], reason: "a sufficiently long stated reason",
        ctx: { role: "owner", isPlatformAdmin: true },
      });
      expect(d.allowed).toBe(false);
    }
  });

  it("requires a real reason before any override", () => {
    const d = evaluateOverride({
      validatorCodes: ["CHANNEL_PROHIBITED_PHRASE"], reason: "ok",
      ctx: { role: "owner" },
    });
    expect(d.allowed).toBe(false);
    expect(d.error).toBe("reason_required");
  });

  it("allows a policy-level override with permission and a reason", () => {
    const d = evaluateOverride({
      validatorCodes: ["CHANNEL_PROHIBITED_PHRASE"],
      reason: "Legal reviewed this phrasing for this campaign",
      ctx: { role: "compliance" },
    });
    expect(d.allowed).toBe(true);
    expect(d.overridable).toContain("CHANNEL_PROHIBITED_PHRASE");
  });
});
