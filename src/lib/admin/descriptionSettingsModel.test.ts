import { describe, expect, it } from "vitest";
import { decideEligibility } from "../../../supabase/functions/_shared/description-core";
import { resolveReviewMode } from "../../../supabase/functions/_shared/description-review-mode";
import { countText } from "../../../supabase/functions/_shared/description-exact-fit";
import { FIXTURE_SAMPLE_NARRATIVE } from "./descriptionSample";
import { automationRows, buildSample, descriptionPayload, destinationRows, outputProfile, phraseMatches, validateProfileEdit, profileProblems, displayRange, changedProfileNumbers, profileValues, readDescriptionDraft, summarizeDeliveries, validateDescription, DEFAULT_DESCRIPTION_DRAFT } from "./descriptionSettingsModel";

const cfg = { cta_template: "Call or visit Example Honda to schedule a test drive.", required_legal_text: "Advertised price includes the documentation fee. Taxes and registration are additional.", prohibited_phrases: [] as string[] };

describe("review mode resolver", () => {
  it("is the function the server eligibility decision uses", () => {
    const settings = { review_mode: "AUTO_PUBLISH_CLEAN", review_mode_by_class: { used: "DRAFT_ONLY" } };
    expect(resolveReviewMode(settings, "Used").mode).toBe("DRAFT_ONLY");
    expect(resolveReviewMode(settings, "cpo")).toEqual({ mode: "AUTO_PUBLISH_CLEAN", source: "default" });
    expect(resolveReviewMode({}, "new")).toEqual({ mode: "EXCEPTION_REVIEW", source: "fallback" });
    expect(decideEligibility([], settings, "used").eligibility).toBe("review_required");
    expect(decideEligibility([], settings, "cpo").eligibility).toBe("eligible");
  });
  it("does not fall back from CPO to the used rule", () => {
    const rows = automationRows({ review_mode: "AUTO_PUBLISH_CLEAN", review_mode_by_class: { used: "DRAFT_ONLY" } });
    expect(rows.find((r) => r.type === "cpo")).toMatchObject({ effective: "AUTO_PUBLISH_CLEAN", source: "inherited" });
    expect(rows.find((r) => r.type === "used")).toMatchObject({ effective: "DRAFT_ONLY", source: "custom" });
    expect(rows.map((r) => r.type)).toEqual(["new", "used", "cpo", "demo"]);
  });
});

describe("destinations", () => {
  it("offers automatic delivery only for the internal Passport", () => {
    const rows = destinationRows({ enabled_channels: ["vauto"], internal_publication_enabled: true });
    expect(rows.filter((r) => r.automaticDelivery.available).map((r) => r.key)).toEqual(["vehicle_passport"]);
    expect(rows.find((r) => r.key === "cars_com")?.delivery).toBe("connector_needed");
    expect(rows.find((r) => r.key === "vauto")?.delivery).toBe("manual_export");
    expect(rows.find((r) => r.key === "autotrader")?.generates).toBe(false);
  });
  it("reports delivery facts only from rows and says none otherwise", () => {
    expect(summarizeDeliveries([])).toEqual({});
    const s = summarizeDeliveries([
      { id: "1", destination: "a", status: "failed", delivery_mode: "export_only", attempt_count: 1, published_at: null, failed_at: "2026-01-02T00:00:00Z", created_at: "2026-01-02T00:00:00Z", response_metadata: { error: "boom" } },
      { id: "2", destination: "a", status: "delivered", delivery_mode: "export_only", attempt_count: 1, published_at: "2026-01-01T00:00:00Z", failed_at: null, created_at: "2026-01-01T00:00:00Z" },
    ]).a;
    expect(s.lastError?.message).toBe("boom");
    expect(s.lastSuccess).toBe("2026-01-01T00:00:00Z");
  });
});

describe("output counts", () => {
  it("lands the vAuto sample on exactly 3,921 including the call to action and disclosure once", () => {
    const r = buildSample(outputProfile("vauto")!, FIXTURE_SAMPLE_NARRATIVE, cfg);
    expect(r.ok).toBe(true);
    expect(r.counts?.codePoints).toBe(3921);
    expect(r.text!.split(cfg.cta_template).length).toBe(2);
    expect(r.text!.split(cfg.required_legal_text).length).toBe(2);
    expect(r.text!.endsWith(cfg.required_legal_text)).toBe(true);
    expect(r.text).not.toContain("\n");
  });
  it("blocks rather than truncates when the required wording cannot fit or is not ASCII", () => {
    const r = buildSample(outputProfile("vauto")!, FIXTURE_SAMPLE_NARRATIVE, { ...cfg, required_legal_text: "Price includes the fee — taxes extra." });
    expect(r.ok).toBe(false);
    expect(r.blocker?.code).toBe("NON_ASCII_REVIEW");
  });
  it("counts code points, UTF-16 units and bytes separately", () => {
    expect(countText("a\u{1F600}\n")).toEqual({ codePoints: 3, utf16: 4, utf8Bytes: 6 });
  });
  it("keeps the website profile readable instead of padding to the vAuto size", () => {
    const r = buildSample(outputProfile("dealer_website")!, FIXTURE_SAMPLE_NARRATIVE, cfg);
    expect(r.counts!.utf16).toBeLessThanOrEqual(3300);
    expect(outputProfile("dealer_website")!.target).toBeNull();
  });
  it("flags a prohibited phrase in the call to action", () => {
    const r = buildSample(outputProfile("autotrader")!, FIXTURE_SAMPLE_NARRATIVE, { ...cfg, cta_template: "Hurry before it is gone, call us." });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === "CHANNEL_PROHIBITED_PHRASE")).toBe(true);
  });
});

describe("description draft", () => {
  it("validates lengths, duplicate phrases and required wording that contains a prohibited phrase", () => {
    const e = validateDescription({ ...DEFAULT_DESCRIPTION_DRAFT, min_length: 3000, max_length: 2000, quality_threshold: 140, prohibited_phrases: ["Lowest price", "lowest price"], required_legal_text: "The lowest price." });
    expect(e.max_length).toBeTruthy();
    expect(e.quality_threshold).toBeTruthy();
    expect(e.prohibited_phrases).toMatch(/twice/);
    expect(e.required_legal_text).toMatch(/lowest price/i);
    expect(validateDescription(DEFAULT_DESCRIPTION_DRAFT)).toEqual({});
  });
  it("matches phrases as case-insensitive substrings", () => {
    expect(phraseMatches("The Lowest Price and lowest priced", "lowest price")).toEqual([4, 21]);
  });
  it("sends the whole draft with blank text as null and drops empty class rules", () => {
    const p = descriptionPayload({ ...readDescriptionDraft(null), brand_voice: " ", review_mode_by_class: { used: "", new: "DRAFT_ONLY" } });
    expect(p.brand_voice).toBeNull();
    expect(p.review_mode_by_class).toEqual({ new: "DRAFT_ONLY" });
    expect(p.claims).toBeUndefined();
    expect(p.warranty_language_allowed).toBe(false);
  });
});

describe("output profile edits", () => {
  const vauto = { recommendedMin: 3500, recommendedMax: 4300, characterLimit: 4000 };
  it("never allows the vAuto limit below the fixed 3,921 target", () => {
    expect(validateProfileEdit("vauto", { ...vauto, characterLimit: 3900 }).characterLimit).toMatch(/3,921/);
    expect(validateProfileEdit("vauto", { ...vauto, characterLimit: 3921 }).characterLimit).toBeUndefined();
    expect(validateProfileEdit("vauto", { ...vauto, characterLimit: 4001 }).characterLimit).toMatch(/raised/);
  });
  it("keeps min <= target <= readable max for a fixed target", () => {
    expect(validateProfileEdit("vauto", { ...vauto, recommendedMin: 3922 }).recommendedMin).toMatch(/above the fixed/);
    expect(validateProfileEdit("vauto", { ...vauto, recommendedMax: 3900 }).recommendedMax).toMatch(/below the fixed/);
    expect(validateProfileEdit("vauto", { ...vauto, recommendedMax: 3400 }).recommendedMax).toBeDefined();
  });
  it("accepts the unedited vAuto defaults and rejects non-integers", () => {
    expect(validateProfileEdit("vauto", vauto)).toEqual({});
    expect(profileProblems(outputProfile("vauto")!)).toEqual([]);
    expect(validateProfileEdit("vauto", { ...vauto, recommendedMin: 3500.5 }).recommendedMin).toBeDefined();
  });
  it("shows the 4,300 readable max clamped to the 4,000 limit", () => {
    expect(displayRange(outputProfile("vauto")!)).toMatchObject({ max: 4000, clamped: true, registryMax: 4300 });
  });
  it("caps the readable max at the limit when there is no fixed target", () => {
    const w = profileValues(outputProfile("dealer_website")!);
    expect(validateProfileEdit("dealer_website", { ...w, recommendedMax: w.characterLimit + 1 }).recommendedMax).toBeDefined();
  });
  it("reports only the numbers that changed", () => {
    expect(changedProfileNumbers(vauto, { ...vauto, characterLimit: 3950 })).toEqual({ characterLimit: 3950 });
    expect(changedProfileNumbers(vauto, vauto)).toEqual({});
  });
});
