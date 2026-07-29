import { describe, it, expect } from "vitest";
import { preflight, preflightSummary, type PreflightInput } from "../../../supabase/functions/_shared/description-preflight";
import { buildFactSnapshot } from "../../../supabase/functions/_shared/description-core";
import { resolveChannelPolicy } from "../../../supabase/functions/_shared/description-channel-policy";
import { resolveVoiceProfile } from "../../../supabase/functions/_shared/description-voice";

// Preflight exists to make a doomed request free. These tests pin the two
// things that matter: it blocks before any provider call, and every rejection
// names the fix rather than just the failure.

const SETTINGS = {
  accessory_language_allowed: true, default_tone: "professional",
  primary_city: "Manchester", state: "Connecticut", dealer_name_format: "Harte INFINITI",
  min_length: 100, max_length: 2400,
};

const LISTING = {
  id: "v1", tenant_id: "t1", status: "active", vin: "JN8AZ2NE1J9190000",
  ymm: "2025 INFINITI QX80", trim: "Sensory AWD", condition: "used", mileage: 13127,
  features: ["Navigation System", "Heated Seats"],
  mc_attributes: {
    engine: "5.6L V8", transmission: "9-Speed Automatic", drivetrain: "AWD",
    body_type: "SUV", fuel_type: "Gasoline", specs_source: "neovin",
    options: ["Navigation System", "Heated Seats"], stock_no: "IN12567",
  },
};

const voice = (over: Record<string, unknown> = {}, status: "draft" | "approved" = "approved") =>
  ({ ...resolveVoiceProfile("t1", { profile_json: over, version: "vp_1", status }, SETTINGS, null), status });

const base = (over: Partial<PreflightInput> = {}): PreflightInput => ({
  authenticated: true,
  canGenerate: true,
  listing: LISTING,
  tenantId: "t1",
  snapshot: buildFactSnapshot(LISTING, SETTINGS, null),
  policy: resolveChannelPolicy("autotrader"),
  channelEnabled: true,
  voice: voice(),
  targeting: {
    primaryKeyword: "2025 INFINITI QX80 for sale", secondaryKeywords: [],
    city: "Manchester", state: "Connecticut", marketArea: "",
    dealerName: "Harte INFINITI", searchIntent: "inventory",
  },
  providerConfigured: true,
  ...over,
});

const codes = (i: PreflightInput) => preflight(i).blockingCodes;

describe("preflight passes a well-formed request", () => {
  it("allows generation when every input resolves", () => {
    const r = preflight(base());
    expect(r.ok).toBe(true);
    expect(r.blockingCodes).toHaveLength(0);
    expect(preflightSummary(r)).toBe("preflight passed");
  });
});

describe("preflight blocks before any provider call", () => {
  it("blocks an unauthenticated or unauthorized caller first", () => {
    expect(codes(base({ authenticated: false }))).toEqual(["NOT_AUTHENTICATED"]);
    expect(codes(base({ canGenerate: false }))).toEqual(["INSUFFICIENT_PERMISSION"]);
  });

  it("does not reveal that a cross-tenant VIN exists elsewhere", () => {
    const mismatch = preflight(base({ listing: { ...LISTING, tenant_id: "other" } }));
    const missing = preflight(base({ listing: null }));
    // Same operator-visible wording, so a probe learns nothing from the text.
    expect(mismatch.findings[0].message).toBe(missing.findings[0].message);
    expect(mismatch.ok).toBe(false);
  });

  it("blocks an archived vehicle", () => {
    expect(codes(base({ listing: { ...LISTING, status: "archived" } }))).toContain("VEHICLE_ARCHIVED");
  });

  it("blocks when no truth snapshot exists", () => {
    expect(codes(base({ snapshot: null }))).toContain("TRUTH_SNAPSHOT_MISSING");
  });

  it("blocks incomplete vehicle identity", () => {
    const thin = buildFactSnapshot({ ...LISTING, vin: null, ymm: null }, SETTINGS, null);
    expect(codes(base({ snapshot: thin }))).toContain("VEHICLE_IDENTITY_INCOMPLETE");
  });

  it("blocks a disabled channel and a missing policy", () => {
    expect(codes(base({ channelEnabled: false }))).toContain("CHANNEL_DISABLED");
    expect(codes(base({ policy: undefined }))).toContain("CHANNEL_POLICY_MISSING");
    expect(codes(base({ policy: { ...resolveChannelPolicy("autotrader")!, active: false } })))
      .toContain("CHANNEL_POLICY_MISSING");
  });

  it("blocks a draft voice profile from producing customer-facing copy", () => {
    expect(codes(base({ voice: voice({}, "draft") }))).toContain("VOICE_PROFILE_UNAPPROVED");
  });

  it("blocks when the dealership name is not configured", () => {
    const anon = resolveVoiceProfile("t1", { profile_json: {}, version: "v", status: "approved" },
      { ...SETTINGS, dealer_name_format: "" }, null);
    expect(codes(base({ voice: { ...anon, status: "approved" } }))).toContain("DEALER_IDENTITY_INCOMPLETE");
  });

  it("blocks a feature the truth snapshot does not carry", () => {
    // The browser asserting equipment is the exact bypass the truth layer exists
    // to prevent, so it must fail before it can reach a prompt.
    const r = preflight(base({ requestedFeatureIds: ["massaging_seats"] }));
    expect(r.blockingCodes).toContain("INVALID_SELECTED_FEATURE");
    expect(r.findings.find((x) => x.code === "INVALID_SELECTED_FEATURE")?.remedy)
      .toMatch(/dealer correction/i);
  });

  it("accepts a feature the snapshot does carry", () => {
    expect(codes(base({ requestedFeatureIds: ["navigation"] })))
      .not.toContain("INVALID_SELECTED_FEATURE");
  });
});

describe("keyword governance happens before cost", () => {
  const withKeyword = (primaryKeyword: string) =>
    codes(base({ targeting: { ...base().targeting, primaryKeyword } }));

  it("blocks a keyword that asserts an unsupportable claim", () => {
    for (const kw of ["accident-free QX80", "one-owner QX80", "certified QX80",
                      "cheapest QX80 in Connecticut", "QX80 with warranty",
                      "guaranteed approval QX80", "mint condition QX80"]) {
      expect(withKeyword(kw)).toContain("UNSUPPORTED_KEYWORD_CLAIM");
    }
  });

  it("allows a keyword that merely describes the vehicle", () => {
    expect(withKeyword("2025 INFINITI QX80 Sensory AWD for sale"))
      .not.toContain("UNSUPPORTED_KEYWORD_CLAIM");
    expect(withKeyword("three-row luxury SUV")).toHaveLength(0);
  });

  it("blocks markup and control characters in the keyword", () => {
    expect(withKeyword('<script>alert(1)</script>')).toContain("INVALID_PRIMARY_KEYWORD");
    expect(withKeyword("a".repeat(200))).toContain("INVALID_PRIMARY_KEYWORD");
  });
});

describe("cost and concurrency guards", () => {
  it("blocks a second run while one is already in flight", () => {
    expect(codes(base({ jobInFlight: true }))).toContain("GENERATION_IN_PROGRESS");
  });

  it("blocks when the tenant is over budget, before spending anything", () => {
    const r = preflight(base({ budget: { withinBudget: false, reason: "Monthly budget reached" } }));
    expect(r.blockingCodes).toContain("BUDGET_EXCEEDED");
    expect(r.findings.find((x) => x.code === "BUDGET_EXCEEDED")?.message)
      .toBe("Monthly budget reached");
  });

  it("blocks when no provider is configured", () => {
    expect(codes(base({ providerConfigured: false }))).toContain("PROVIDER_UNAVAILABLE");
  });
});

describe("warnings inform without blocking", () => {
  it("warns about an unresolved conflict but still allows generation", () => {
    // Feed and decode disagree on premium equipment; the packet already excludes
    // it, so the copy is safe and the run should proceed.
    const conflicted = buildFactSnapshot({
      ...LISTING, features: ["Navigation System"],
      mc_attributes: { ...LISTING.mc_attributes, options: ["Navigation System", "Bose Premium Audio"] },
    }, SETTINGS, null);
    const r = preflight(base({ snapshot: conflicted }));
    expect(r.ok).toBe(true);
    expect(r.findings.some((x) => x.code === "UNRESOLVED_MATERIAL_CONFLICT" && !x.blocking)).toBe(true);
  });

  it("warns when the market area is unset rather than refusing to write", () => {
    const noCity = resolveVoiceProfile("t1", { profile_json: {}, version: "v", status: "approved" },
      { ...SETTINGS, primary_city: "", state: "" }, null);
    const r = preflight(base({ voice: { ...noCity, status: "approved" } }));
    expect(r.ok).toBe(true);
    expect(r.findings.some((x) => x.code === "DEALER_IDENTITY_INCOMPLETE" && !x.blocking)).toBe(true);
  });
});

describe("rejections are actionable", () => {
  it("gives every blocking finding a message an operator can act on", () => {
    const r = preflight(base({ snapshot: null }));
    for (const f of r.findings.filter((x) => x.blocking)) {
      expect(f.message.length).toBeGreaterThan(10);
      expect(f.message).not.toMatch(/^error/i);
    }
    expect(preflightSummary(r)).toContain("truth snapshot");
  });
});
