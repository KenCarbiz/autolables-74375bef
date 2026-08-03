import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAddendumSections, valuePropImageCeiling, VP_IMAGE_MAX_HEIGHT } from "./addendumSections";
import type { SaturdayValueProp } from "./types";

// The addendum prints at a fixed 4.25 x 11 inches with `overflow: hidden`, so
// anything that does not fit is cropped in silence. A section that rendered a
// heading, a border and a "No configured benefits." placeholder when the
// dealer had none was therefore not merely untidy: it spent inches that a
// priced row needed, and the row came off the bottom of the sheet.

const vp = (over: Partial<SaturdayValueProp> = {}): SaturdayValueProp => ({
  id: "vp1",
  headline: "Lifetime Powertrain Warranty",
  supportingLine: "Ask for details",
  disclosure: "See dealer.",
  imageUrl: "https://example.test/lifetime.png",
  displayStyle: "image",
  showAskForDetails: true,
  ...over,
});

const line = (name: string, price = "100") => ({ name, price });

describe("a section with nothing in it does not exist", () => {
  it("reports no benefits when the dealer configured none", () => {
    const r = resolveAddendumSections({ benefits: [] });
    expect(r.hasBenefits).toBe(false);
    expect(r.benefits).toEqual([]);
  });

  it("treats blank and whitespace-only benefits as absent", () => {
    const r = resolveAddendumSections({ benefits: ["", "   ", "\n"] });
    expect(r.hasBenefits).toBe(false);
  });

  it("reports no upgrades when none are configured", () => {
    expect(resolveAddendumSections({ upgrades: [] }).hasUpgrades).toBe(false);
    expect(resolveAddendumSections({ upgrades: [{ name: " ", price: "0" }] }).hasUpgrades).toBe(false);
  });

  it("reports no installed equipment when none is configured", () => {
    expect(resolveAddendumSections({ installed: [] }).hasInstalled).toBe(false);
  });

  it("keeps a real row whose price is zero", () => {
    // Plenty of included equipment carries no separate charge; price is not
    // evidence of whether the row is real.
    const r = resolveAddendumSections({ installed: [line("Nitrogen Fill", "0")] });
    expect(r.hasInstalled).toBe(true);
  });
});

describe("artwork is never mistaken for evidence of a benefit", () => {
  it("does not invent a benefit because a promotional image was selected", () => {
    const r = resolveAddendumSections({ benefits: [], valueProps: [vp()] });
    expect(r.hasBenefits).toBe(false);
    expect(r.benefits).toEqual([]);
  });

  it("keeps the stored benefit in list_and_image, the default", () => {
    const r = resolveAddendumSections({ benefits: ["Lifetime Powertrain Warranty"], valueProps: [vp()] });
    expect(r.hasBenefits).toBe(true);
    expect(r.benefitsShownAsImage).toEqual([]);
  });

  it("suppresses only the presentation under image_only, never the data", () => {
    const input = { benefits: ["Lifetime Powertrain Warranty", "Free Car Washes"], valueProps: [vp()], benefitDisplayMode: "image_only" as const };
    const r = resolveAddendumSections(input);
    expect(r.benefits).toEqual(["Free Car Washes"]);
    expect(r.benefitsShownAsImage).toEqual(["Lifetime Powertrain Warranty"]);
    // The stored data is untouched — a layout choice must not destroy it.
    expect(input.benefits).toContain("Lifetime Powertrain Warranty");
  });

  it("does not suppress a benefit the artwork says nothing about", () => {
    const r = resolveAddendumSections({
      benefits: ["Free State Inspections"], valueProps: [vp()], benefitDisplayMode: "image_only",
    });
    expect(r.benefits).toEqual(["Free State Inspections"]);
  });

  it("hides the whole section when image_only covers every benefit", () => {
    const r = resolveAddendumSections({
      benefits: ["Lifetime Powertrain Warranty"], valueProps: [vp()], benefitDisplayMode: "image_only",
    });
    expect(r.hasBenefits).toBe(false);
  });
});

describe("the artwork yields space, the priced rows do not", () => {
  it("honours the requested ceiling when there is room", () => {
    const r = resolveAddendumSections({ valueProps: [vp()] });
    expect(valuePropImageCeiling("xl", r)).toBe(VP_IMAGE_MAX_HEIGHT.xl);
  });

  it("steps the largest artwork down when all three sections are present", () => {
    const r = resolveAddendumSections({
      installed: [line("Ceramic")], upgrades: [line("ValueShield")], benefits: ["Lifetime Powertrain"],
    });
    expect(r.hasInstalled && r.hasBenefits && r.hasUpgrades).toBe(true);
    expect(valuePropImageCeiling("xl", r)).toBe(VP_IMAGE_MAX_HEIGHT.lg);
  });

  it("gives artwork its full ceiling when the structured sections are empty", () => {
    const r = resolveAddendumSections({ benefits: [], upgrades: [], installed: [] });
    expect(valuePropImageCeiling("xl", r)).toBe(VP_IMAGE_MAX_HEIGHT.xl);
  });
});

// ── The template itself ────────────────────────────────────────────────
const tpl = readFileSync(join(__dirname, "SaturdayPremiumAddendum.tsx"), "utf8");

describe("the template renders the section, not just its rows", () => {
  it("gates all three conditional sections on resolved data", () => {
    expect(tpl).toMatch(/\{sections\.hasInstalled && \(/);
    expect(tpl).toMatch(/\{sections\.hasBenefits && \(/);
    expect(tpl).toMatch(/\{sections\.hasUpgrades && \(/);
  });

  it("has no empty-state placeholder left to print", () => {
    expect(tpl).not.toMatch(/No configured benefits/);
    expect(tpl).not.toMatch(/No installed equipment configured/);
  });

  it("no longer truncates the benefit list", () => {
    // slice(0, 6) silently dropped a seventh benefit the dealer had sold.
    expect(tpl).not.toMatch(/benefits\.slice\(/);
  });

  it("reads its data from the one shared resolver", () => {
    expect(tpl).toMatch(/const sections = resolveAddendumSections\(data\);/);
    expect(tpl).toMatch(/const \{ installed, upgrades, benefits, valueProps \} = sections;/);
  });
});

describe("required content cannot be squeezed by the artwork", () => {
  it("makes the artwork block the only flexible track", () => {
    // justify-start, not center: with little content the artwork used to float
    // with dead space above AND below it. Anchoring it consolidates the slack
    // into one gap above the totals.
    expect(tpl).toMatch(/flex-1 min-h-0 flex flex-col justify-start/);
  });

  it("pins every structured block against shrinking", () => {
    // Flex children shrink by default, so without this the adjusted total and
    // the disclosure would compress before the image did.
    expect(tpl.match(/shrink-0/g)?.length ?? 0).toBeGreaterThanOrEqual(11);
  });

  it("sizes the image by ceiling, not by fixed height", () => {
    expect(tpl).toMatch(/maxHeight: valuePropImageCeiling\(vp\.imageScale, sections\)/);
    expect(tpl).toMatch(/h-auto w-auto object-contain/);
    // The old fixed-height classes are gone.
    expect(tpl).not.toMatch(/VP_IMAGE_SIZE/);
    expect(tpl).not.toMatch(/h-\[0\.42in\]/);
  });
});
