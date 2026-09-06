import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideWarrantyLanguage, buyersGuideDisposition,
} from "../../../supabase/functions/_shared/description-warranty-policy.ts";
import { buildFactSnapshot } from "../../../supabase/functions/_shared/description-core.ts";

// A boolean could not express this. Copy implying coverage beside an AS-IS
// Buyers Guide puts the dealership in contradiction with the document the
// customer signs — and a tenant flag set to false silenced a CPO car with 44
// verified months remaining. The vehicle's own paperwork decides.

const COVERAGE = { program: "INFINITI Limited", months_remaining: 44, miles_remaining: 48000 };

describe("the Buyers Guide is the ceiling", () => {
  it("prohibits coverage language when the filed Guide is AS-IS", () => {
    const d = decideWarrantyLanguage({ buyersGuideDecision: "as_is", warranty: COVERAGE });
    expect(d.disposition).toBe("PROHIBITED");
    expect(d.statement).toBeNull();
    expect(d.evidence).toContain("buyers_guide:as_is");
  });

  it("prohibits it even for a verified CPO car", () => {
    // If both are true the Guide is wrong, and that is fixed on the Guide.
    const d = decideWarrantyLanguage({
      buyersGuideDecision: "as_is", cpoVerified: true, cpoProgram: "INFINITI Certified",
      warranty: COVERAGE });
    expect(d.disposition).toBe("PROHIBITED");
  });

  it("reads the box whichever template version filed it", () => {
    expect(buyersGuideDisposition({ box: "as-is" })).toBe("as_is");
    expect(buyersGuideDisposition({ default_ftc_warranty: "as_is" })).toBe("as_is");
    expect(buyersGuideDisposition({ box: "implied_warranties_only" })).toBe("implied_warranties_only");
    expect(buyersGuideDisposition(null)).toBeNull();
    expect(buyersGuideDisposition({})).toBeNull();
  });

  it("does not prohibit when the Guide is not AS-IS", () => {
    expect(decideWarrantyLanguage({
      buyersGuideDecision: "implied_warranties_only", warranty: COVERAGE,
    }).disposition).toBe("FACTORY_PERMITTED");
  });
});

describe("the rungs below it", () => {
  it("permits CPO language for verified certification", () => {
    const d = decideWarrantyLanguage({
      cpoVerified: true, cpoProgram: "INFINITI Certified", warranty: COVERAGE });
    expect(d.disposition).toBe("CPO_PERMITTED");
    expect(d.statement).toContain("INFINITI Certified");
    expect(d.statement).toContain("44 months remaining");
  });

  it("falls back to factory terms when CPO language is switched off", () => {
    // Otherwise the warranty line leaks the certification the dealer disabled.
    const d = decideWarrantyLanguage({
      cpoVerified: true, cpoProgram: "INFINITI Certified",
      cpoLanguageAllowed: false, warranty: COVERAGE });
    expect(d.disposition).toBe("FACTORY_PERMITTED");
    expect(d.statement).not.toContain("Certified");
  });

  it("states factory coverage only as precisely as it is known", () => {
    const d = decideWarrantyLanguage({ warranty: { program: "INFINITI Limited" } });
    expect(d.statement).toBe("INFINITI Limited");
    expect(d.statement).not.toMatch(/month|mile/i);
  });

  it("omits silently when nothing is documented", () => {
    const d = decideWarrantyLanguage({ warranty: {} });
    expect(d.disposition).toBe("OMIT");
    expect(d.statement).toBeNull();
  });

  it("honours an explicit dealership suppression above everything", () => {
    const d = decideWarrantyLanguage({
      suppressedExplicitly: true, cpoVerified: true, warranty: COVERAGE });
    expect(d.disposition).toBe("PROHIBITED");
  });

  it("carries a reason an auditor can follow", () => {
    for (const d of [
      decideWarrantyLanguage({ buyersGuideDecision: "as_is" }),
      decideWarrantyLanguage({ warranty: COVERAGE }),
      decideWarrantyLanguage({ warranty: {} }),
    ]) expect(d.reason.length).toBeGreaterThan(20);
  });
});

// ── wired, not merely written ────────────────────────────────────────

const LISTING = {
  vin: "JN8AZ3CC5T9624253", ymm: "2027 INFINITI QX80", condition: "used", mileage: 12408,
  mc_attributes: { year: 2027, make: "INFINITI", model: "QX80" },
  warranty_info: COVERAGE,
};
const warrantyFact = (s: ReturnType<typeof buildFactSnapshot>) =>
  (s.facts as Record<string, { value?: unknown } | undefined>).warranty_eligible;

describe("the snapshot builder uses the ladder", () => {
  it("states verified coverage for an ordinary used car", () => {
    expect(String(warrantyFact(buildFactSnapshot(LISTING, {}, null))?.value ?? ""))
      .toContain("44 months remaining");
  });

  it("says nothing when the filed Buyers Guide is AS-IS", () => {
    const snap = buildFactSnapshot(
      { ...LISTING, buyers_guide_disposition: "as_is" }, {}, null);
    expect(warrantyFact(snap)).toBeFalsy();
    expect((snap.excluded_claims || []).some((e: { field?: string }) =>
      e.field === "warranty_eligible")).toBe(true);
  });

  it("still says nothing for a vehicle with no coverage on file", () => {
    const snap = buildFactSnapshot({ ...LISTING, warranty_info: {} }, {}, null);
    expect(warrantyFact(snap)).toBeFalsy();
  });
});

describe("the orchestrator supplies the disposition", () => {
  const src = readFileSync(join(__dirname,
    "../../../supabase/functions/description-orchestrate/index.ts"), "utf8");

  it("reads the latest filed, non-superseded Buyers Guide", () => {
    expect(src).toMatch(/document_type", "buyers_guide"/);
    expect(src).toMatch(/is\("superseded_at", null\)/);
    expect(src).toMatch(/buyers_guide_disposition =/);
  });
});
