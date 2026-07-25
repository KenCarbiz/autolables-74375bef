import { describe, it, expect } from "vitest";
import {
  buildFactSnapshot, validateContent, decideEligibility, computeSourceDataVersion,
  computeConfigVersion, qualityScore, CHANNELS, channelByKey,
} from "../../../supabase/functions/_shared/description-core";

// These tests pin the rules that protect the dealer: what may be claimed, what
// is excluded, and when a description is allowed to publish automatically.

const SETTINGS = {
  review_mode: "EXCEPTION_REVIEW", review_mode_by_class: {},
  enabled_channels: ["vehicle_passport"], min_length: 100, max_length: 2400,
  prohibited_phrases: [], cpo_language_allowed: false, warranty_language_allowed: false,
  accessory_language_allowed: false, market_context_allowed: false, price_in_description: false,
  default_tone: "professional",
};

const LISTING = {
  id: "v1", vin: "JN8AZ2NE1J9190000", ymm: "2025 INFINITI QX80", trim: "Sensory AWD",
  condition: "used", mileage: 13127, features: ["Heated Seats", "Navigation"],
  mc_attributes: {
    engine: "5.6L V8", transmission: "7-Speed Automatic", drivetrain: "AWD",
    exterior_color: "Majestic White", options: ["Heated Seats", "Navigation"], stock_no: "IN12567",
  },
};

describe("source data fingerprint", () => {
  it("is deterministic for identical inputs", async () => {
    const a = await computeSourceDataVersion(LISTING, "cfg_1", false);
    const b = await computeSourceDataVersion(LISTING, "cfg_1", false);
    expect(a).toBe(b);
  });

  it("changes when a description-relevant fact changes", async () => {
    const a = await computeSourceDataVersion(LISTING, "cfg_1", false);
    const b = await computeSourceDataVersion({ ...LISTING, mileage: 20000 }, "cfg_1", false);
    expect(a).not.toBe(b);
  });

  it("ignores price when the dealer does not permit price language", async () => {
    const a = await computeSourceDataVersion({ ...LISTING, price: 60000 }, "cfg_1", false);
    const b = await computeSourceDataVersion({ ...LISTING, price: 55000 }, "cfg_1", false);
    expect(a).toBe(b);
  });

  it("tracks price when the dealer does permit price language", async () => {
    const a = await computeSourceDataVersion({ ...LISTING, price: 60000 }, "cfg_1", true);
    const b = await computeSourceDataVersion({ ...LISTING, price: 55000 }, "cfg_1", true);
    expect(a).not.toBe(b);
  });

  it("changes when the dealer configuration changes", async () => {
    const cfgA = await computeConfigVersion(SETTINGS);
    const cfgB = await computeConfigVersion({ ...SETTINGS, default_tone: "luxury" });
    expect(cfgA).not.toBe(cfgB);
  });
});

describe("fact snapshot", () => {
  it("keeps market intelligence out of vehicle facts", () => {
    const snap = buildFactSnapshot(
      { ...LISTING, market_value: 61000, market_position: "great_deal" },
      { ...SETTINGS, market_context_allowed: true }, null,
    );
    expect(snap.market_context.market_value).toBe(61000);
    // never promoted into a usable vehicle fact
    expect(Object.keys(snap.facts)).not.toContain("market_value");
    expect(Object.keys(snap.facts)).not.toContain("market_position");
  });

  it("excludes CPO when the feed claims it but no approved source confirms it", () => {
    const snap = buildFactSnapshot({ ...LISTING, condition: "cpo" }, SETTINGS, null);
    expect(snap.excluded_claims.some((e) => e.reason === "cpo_unconfirmed")).toBe(true);
    expect(snap.conflicts.some((c) => c.field === "cpo_status" && c.material)).toBe(true);
  });

  it("raises a material conflict when only one source lists premium equipment", () => {
    const snap = buildFactSnapshot({
      ...LISTING,
      features: ["Heated Seats"],
      mc_attributes: { ...LISTING.mc_attributes, options: ["Heated Seats", "Bose Performance Series Audio"] },
    }, SETTINGS, null);
    const conflict = snap.conflicts.find((c) => c.field.includes("Bose"));
    expect(conflict?.material).toBe(true);
    expect(snap.excluded_claims.some((e) => /bose/i.test(String(e.claim)))).toBe(true);
  });

  it("never claims one owner without a history report", () => {
    const snap = buildFactSnapshot({
      ...LISTING, mc_attributes: { ...LISTING.mc_attributes, carfax_1_owner: true },
    }, SETTINGS, null);
    expect(snap.facts.one_owner).toBeUndefined();
    expect(snap.excluded_claims.some((e) => e.reason === "no_history_report")).toBe(true);
  });

  it("accepts one owner when a history report backs it", () => {
    const snap = buildFactSnapshot({
      ...LISTING, history_report_url: "https://www.carfax.com/vehicle/X",
      mc_attributes: { ...LISTING.mc_attributes, carfax_1_owner: true },
    }, SETTINGS, null);
    expect(snap.facts.one_owner?.status).toBe("verified");
  });

  it("never treats a pending accessory as installed", () => {
    const snap = buildFactSnapshot({
      ...LISTING,
      available_accessories: [{ name: "Ceramic Coating", status: "PENDING_INSTALLATION" }],
    }, { ...SETTINGS, accessory_language_allowed: true }, null);
    expect(snap.facts.installed_accessories).toBeUndefined();
    expect(snap.excluded_claims.some((e) => e.reason === "install_not_verified")).toBe(true);
  });
});

describe("validation engine", () => {
  const snap = buildFactSnapshot(LISTING, SETTINGS, null);

  it("blocks an unsupported CPO claim", () => {
    const f = validateContent("This certified pre-owned 2025 INFINITI QX80 is ready. Contact us.", snap, SETTINGS);
    expect(f.some((x) => x.validator_code === "CPO_CLAIM" && x.blocking)).toBe(true);
  });

  it("blocks unsupported market and price claims", () => {
    const f = validateContent("Priced below market — the best price around. Contact us.", snap, SETTINGS);
    expect(f.some((x) => x.validator_code === "MARKET_CLAIM" && x.blocking)).toBe(true);
  });

  it("blocks service claims outright", () => {
    const f = validateContent("New tires and fully inspected by our team. Contact us.", snap, SETTINGS);
    expect(f.some((x) => x.validator_code === "SERVICE_CLAIM" && x.blocking)).toBe(true);
  });

  it("blocks a claim excluded by an unresolved conflict", () => {
    const conflicted = buildFactSnapshot({
      ...LISTING, features: ["Heated Seats"],
      mc_attributes: { ...LISTING.mc_attributes, options: ["Bose Performance Series Audio"] },
    }, SETTINGS, null);
    const f = validateContent("Features Bose Performance Series Audio for immersive sound. Contact us.", conflicted, SETTINGS);
    expect(f.some((x) => x.validator_code === "EXCLUDED_CLAIM_PRESENT" && x.blocking)).toBe(true);
  });

  it("blocks a wrong model year", () => {
    const f = validateContent("This 2019 INFINITI QX80 is available now. Contact us today.", snap, SETTINGS);
    expect(f.some((x) => x.validator_code === "IDENTITY_YEAR_CONFLICT" && x.blocking)).toBe(true);
  });

  it("blocks a dealer-prohibited phrase", () => {
    const f = validateContent("A steal of a deal on this 2025 INFINITI QX80. Contact us.", snap,
      { ...SETTINGS, prohibited_phrases: ["steal of a deal"] });
    expect(f.some((x) => x.validator_code === "PROHIBITED_PHRASE" && x.blocking)).toBe(true);
  });

  it("blocks channel copy over the destination limit", () => {
    const fb = channelByKey("facebook")!;
    const f = validateContent("x".repeat(fb.characterLimit + 200), snap, SETTINGS, fb);
    expect(f.some((x) => x.validator_code === "CHANNEL_LENGTH_EXCEEDED" && x.blocking)).toBe(true);
  });

  it("passes clean copy with no blocking findings", () => {
    const text = "The 2025 INFINITI QX80 Sensory AWD pairs a 5.6L V8 with all-wheel drive. " +
      "Heated Seats and Navigation are included, and the cabin is finished in Majestic White. " +
      "With 13,127 miles on the odometer it is ready for daily driving. Contact us to schedule a test drive.";
    const f = validateContent(text, snap, SETTINGS);
    expect(f.filter((x) => x.blocking)).toHaveLength(0);
  });
});

describe("publication eligibility", () => {
  it("blocks whenever a blocking finding exists", () => {
    const r = decideEligibility(
      [{ validator_code: "CPO_CLAIM", severity: "blocking", message: "", blocking: true }],
      SETTINGS, "used");
    expect(r.eligibility).toBe("blocked");
  });

  it("routes FACT-level warnings to review in exception-review mode", () => {
    const r = decideEligibility(
      [{ validator_code: "LOW_FACT_CONFIDENCE", severity: "warning", message: "", blocking: false }],
      SETTINGS, "used");
    expect(r.eligibility).toBe("review_required");
  });

  it("does not escalate cosmetic warnings — otherwise everything reaches a person", () => {
    const r = decideEligibility(
      [{ validator_code: "CTA_MISSING", severity: "warning", message: "", blocking: false },
       { validator_code: "LENGTH_BELOW_MINIMUM", severity: "warning", message: "", blocking: false }],
      SETTINGS, "used");
    expect(r.eligibility).toBe("eligible");
  });

  it("auto-publishes a clean vehicle in exception-review mode", () => {
    expect(decideEligibility([], SETTINGS, "used").eligibility).toBe("eligible");
  });

  it("always requires approval when the dealer chose approval-required", () => {
    const r = decideEligibility([], { ...SETTINGS, review_mode: "REQUIRE_APPROVAL_ALL" }, "used");
    expect(r.eligibility).toBe("review_required");
  });

  it("honors a per-inventory-class override", () => {
    const r = decideEligibility([], {
      ...SETTINGS, review_mode: "AUTO_PUBLISH_CLEAN",
      review_mode_by_class: { cpo: "REQUIRE_APPROVAL_ALL" },
    }, "cpo");
    expect(r.eligibility).toBe("review_required");
  });
});

describe("channel registry", () => {
  it("marks only internal destinations as deliverable", () => {
    const internal = CHANNELS.filter((c) => c.deliveryMode === "internal_projection").map((c) => c.key);
    // only the shopper listing is genuinely written by AutoLabels
    expect(internal).toEqual(["vehicle_passport"]);
    for (const c of CHANNELS.filter((x) => x.deliveryMode !== "internal_projection")) {
      expect(["not_configured", "export_only"]).toContain(c.connectorStatus);
    }
  });
});

describe("quality score", () => {
  it("is independent of factual validity", () => {
    const snap = buildFactSnapshot(LISTING, SETTINGS, null);
    // copy that scores well but contains a blocking claim
    const text = "This certified 2025 INFINITI QX80 Sensory AWD is exceptional.\n\n" +
      "Heated Seats and Navigation come standard. Contact us to schedule a test drive today.";
    expect(qualityScore(text, snap, SETTINGS)).toBeGreaterThan(40);
    expect(validateContent(text, snap, SETTINGS).some((f) => f.blocking)).toBe(true);
  });
});

describe("resolved conflicts (the review loop must terminate)", () => {
  const conflicted = {
    ...LISTING, features: ["Heated Seats"],
    mc_attributes: { ...LISTING.mc_attributes, options: ["Heated Seats", "Bose Performance Series Audio"] },
  };

  it("blocks while the conflict is unresolved", () => {
    const snap = buildFactSnapshot(conflicted, SETTINGS, null, []);
    expect(snap.conflicts.some((c) => c.material)).toBe(true);
    const f = validateContent("Clean copy. Contact us to schedule a test drive.", snap, SETTINGS);
    expect(f.some((x) => x.validator_code === "SOURCE_CONFLICT_UNRESOLVED")).toBe(true);
  });

  it("stops blocking once a manager confirms the equipment IS present", () => {
    const snap = buildFactSnapshot(conflicted, SETTINGS, null,
      [{ field_key: "equipment:Bose Performance Series Audio", decision: "include" }]);
    expect(snap.conflicts.some((c) => c.material)).toBe(false);
    expect(String(snap.facts.equipment?.value)).toContain("Bose");
  });

  it("stops blocking once a manager confirms it is NOT present", () => {
    const snap = buildFactSnapshot(conflicted, SETTINGS, null,
      [{ field_key: "equipment:Bose Performance Series Audio", decision: "exclude" }]);
    expect(snap.conflicts.some((c) => c.material)).toBe(false);
    expect(String(snap.facts.equipment?.value ?? "")).not.toContain("Bose");
    // still withheld from copy, so asserting it remains a blocking finding
    const f = validateContent("Features Bose Performance Series Audio. Contact us.", snap, SETTINGS);
    expect(f.some((x) => x.validator_code === "EXCLUDED_CLAIM_PRESENT")).toBe(true);
  });
});

describe("fingerprint covers post-ingest facts", () => {
  it("changes when a history report arrives", async () => {
    const a = await computeSourceDataVersion(LISTING, "cfg_1", false);
    const b = await computeSourceDataVersion({ ...LISTING, history_report_url: "https://carfax.com/x" }, "cfg_1", false);
    expect(a).not.toBe(b);
  });

  it("changes when a CPO program is confirmed", async () => {
    const a = await computeSourceDataVersion(LISTING, "cfg_1", false);
    const b = await computeSourceDataVersion({ ...LISTING, certification: { program: "INFINITI CPO" } }, "cfg_1", false);
    expect(a).not.toBe(b);
  });

  it("ignores a pure re-ordering of the same option list", async () => {
    const a = await computeSourceDataVersion(LISTING, "cfg_1", false);
    const b = await computeSourceDataVersion({
      ...LISTING, mc_attributes: { ...LISTING.mc_attributes, options: ["Navigation", "Heated Seats"] },
    }, "cfg_1", false);
    expect(a).toBe(b);
  });
});

describe("year validator does not fire on incidental years", () => {
  const snap = buildFactSnapshot(LISTING, SETTINGS, null, []);
  it("allows a dealer tagline containing another year", () => {
    const f = validateContent(
      "The 2025 INFINITI QX80 Sensory AWD is here. Serving Manchester since 1998. Contact us to schedule a test drive.",
      snap, SETTINGS);
    expect(f.some((x) => x.validator_code === "IDENTITY_YEAR_CONFLICT")).toBe(false);
  });
  it("still blocks a contradictory model year", () => {
    const f = validateContent("This 2019 INFINITI QX80 is available. Contact us.", snap, SETTINGS);
    expect(f.some((x) => x.validator_code === "IDENTITY_YEAR_CONFLICT")).toBe(true);
  });
});
