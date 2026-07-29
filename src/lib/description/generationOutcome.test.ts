import { describe, it, expect } from "vitest";
import { describeGenerationOutcome } from "./generationOutcome";

// A run that produced nothing is not automatically a run that needed to do
// nothing. These tests pin that every refusal reads as a refusal.

describe("a produced version", () => {
  it("reports success", () => {
    const o = describeGenerationOutcome({ generated: true });
    expect(o.tone).toBe("success");
    expect(o.codes).toEqual([]);
  });
});

describe("refusals never read as success", () => {
  it("does not call a preflight rejection an unchanged input", () => {
    const o = describeGenerationOutcome({
      generated: false, skipped: "preflight_rejected",
      blocking_codes: ["VOICE_PROFILE_UNAPPROVED"],
      reason: "The dealership voice profile is still a draft.",
      cost_incurred: false,
    });
    expect(o.tone).toBe("error");
    expect(o.message).not.toMatch(/unchanged/i);
    expect(o.message).toContain("voice profile is still a draft");
  });

  it("keeps the blocking codes so they match the audit record", () => {
    const o = describeGenerationOutcome({
      skipped: "preflight_rejected",
      blocking_codes: ["DEALER_IDENTITY_INCOMPLETE", "REQUIRED_DISCLOSURE_UNAVAILABLE"],
    });
    expect(o.codes).toEqual(["DEALER_IDENTITY_INCOMPLETE", "REQUIRED_DISCLOSURE_UNAVAILABLE"]);
  });

  it("treats an archived vehicle and a missing record as errors", () => {
    expect(describeGenerationOutcome({ skipped: "archived" }).tone).toBe("error");
    expect(describeGenerationOutcome({ skipped: "case_not_initialized" }).tone).toBe("error");
  });

  it("reports an unrecognized skip reason instead of smoothing it away", () => {
    // A refusal the client has never heard of must not be reported as a
    // no-op; that is how a new server-side block goes unnoticed.
    const o = describeGenerationOutcome({ skipped: "some_future_guard" });
    expect(o.tone).toBe("error");
    expect(o.message).toContain("some_future_guard");
  });

  it("does not leak that a cross-tenant VIN exists elsewhere", () => {
    expect(describeGenerationOutcome({ skipped: "tenant_mismatch" }).message)
      .toBe(describeGenerationOutcome({ skipped: "listing_not_found" }).message);
  });
});

describe("genuine no-ops stay informational", () => {
  it("reports unchanged inputs without alarm, and says no request was made", () => {
    const o = describeGenerationOutcome({ skipped: "unchanged" });
    expect(o.tone).toBe("info");
    expect(o.message).toMatch(/no ai request/i);
  });

  it("reports a reused paid-for output", () => {
    expect(describeGenerationOutcome({ skipped: "equivalent_output_reused" }).tone).toBe("info");
  });

  it("reports an in-flight run as informational, not failure", () => {
    expect(describeGenerationOutcome({ skipped: "already_claimed" }).tone).toBe("info");
  });
});

describe("the remedy link", () => {
  it("points a voice-profile block at the screen that clears it", () => {
    for (const code of ["VOICE_PROFILE_UNAPPROVED", "DEALER_IDENTITY_INCOMPLETE",
                        "REQUIRED_DISCLOSURE_UNAVAILABLE"]) {
      const o = describeGenerationOutcome({ skipped: "preflight_rejected", blocking_codes: [code] });
      expect(o.remedy?.href).toBe("/admin/description-voice");
    }
  });

  it("offers no link for a block that screen cannot fix", () => {
    // Sending an operator to a page that cannot resolve their problem is
    // worse than sending them nowhere.
    const o = describeGenerationOutcome({
      skipped: "preflight_rejected", blocking_codes: ["TRUTH_SNAPSHOT_MISSING"],
    });
    expect(o.remedy).toBeUndefined();
  });

  it("picks the fixable code when a run is blocked by several", () => {
    const o = describeGenerationOutcome({
      skipped: "preflight_rejected",
      blocking_codes: ["TRUTH_SNAPSHOT_MISSING", "VOICE_PROFILE_UNAPPROVED"],
    });
    expect(o.remedy?.href).toBe("/admin/description-voice");
  });

  it("never attaches a remedy to a successful run", () => {
    expect(describeGenerationOutcome({ generated: true }).remedy).toBeUndefined();
  });
});

describe("the no-charge reassurance", () => {
  it("is asserted for a refusal that happens before any provider call", () => {
    expect(describeGenerationOutcome({
      skipped: "preflight_rejected", cost_incurred: false,
    }).costFree).toBe(true);
    expect(describeGenerationOutcome({ skipped: "archived" }).costFree).toBe(true);
  });

  it("is withheld for a refusal we do not recognize", () => {
    // Telling an operator nothing was charged is a claim about their bill.
    // An unknown skip reason may well have happened after inference.
    expect(describeGenerationOutcome({ skipped: "some_future_guard" }).costFree).toBe(false);
  });

  it("honours an explicit cost_incurred flag over the skip category", () => {
    expect(describeGenerationOutcome({
      skipped: "some_future_guard", cost_incurred: false,
    }).costFree).toBe(true);
  });

  it("is never claimed for a run that produced a version", () => {
    expect(describeGenerationOutcome({ generated: true }).costFree).toBe(false);
  });
});

describe("defensive input", () => {
  it("handles a null result without throwing", () => {
    const o = describeGenerationOutcome(null);
    expect(o.tone).toBe("info");
    expect(o.codes).toEqual([]);
  });
});
