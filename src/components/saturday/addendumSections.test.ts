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
  it("gates its conditional sections on resolved data", () => {
    expect(tpl).toMatch(/\{sections\.hasInstalled && \(/);
    expect(tpl).toMatch(/\{sections\.hasUpgrades && \(/);
  });

  // V2 removed the standalone Included Benefits panel. The resolver still
  // computes benefits — other templates render them, and the dealer's stored
  // data is untouched — but this sheet must not budget space for rows it does
  // not print, or the artwork and spacing shrink for content that is not there.
  it("does not render a benefits panel, and does not count benefits toward density", () => {
    expect(tpl).not.toMatch(/\{sections\.hasBenefits && \(/);
    expect(tpl).not.toMatch(/title="Included Benefits"/);
    expect(tpl).toMatch(/const v2Sections = \{ \.\.\.sections, benefits: \[\], hasBenefits: false \};/);
    expect(tpl).toMatch(/addendumDensity\(v2Sections\)/);
    expect(tpl).toMatch(/valuePropImageCeiling\(vp\.imageScale, v2Sections\)/);
    // v2Sections has to exist before the density call that reads it.
    expect(tpl.indexOf("const v2Sections")).toBeLessThan(tpl.indexOf("addendumDensity(v2Sections)"));
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
    expect(tpl).toMatch(/const \{ installed, upgrades, valueProps \} = sections;/);
  });
});

describe("the new-car sheet is the same sheet", () => {
  // These two had already drifted once: the premium sheet got the content-fit
  // fix while the new-car copy kept the fixed image height and the empty-state
  // placeholders, so the same dealer data printed two different pages. The
  // files are now kept identical below their header comment, and this is what
  // catches an edit to one of them.
  const newcar = readFileSync(join(__dirname, "NewCarSaasAddendum.tsx"), "utf8");
  const body = (src: string, name: string) =>
    src.slice(src.indexOf("import { QRCodeSVG }")).split(name).join("Addendum");

  it("differs from the premium sheet only by name and header", () => {
    expect(body(newcar, "NewCarSaasAddendum")).toBe(body(tpl, "SaturdayPremiumAddendum"));
  });

  it("carries the content-fit behaviour, not the old fixed sizing", () => {
    expect(newcar).toMatch(/maxHeight: valuePropImageCeiling\(vp\.imageScale, v2Sections\)/);
    expect(newcar).not.toMatch(/VP_IMAGE_SIZE/);
    expect(newcar).not.toMatch(/No configured benefits/);
    expect(newcar).not.toMatch(/benefits\.slice\(/);
  });
});

describe("required content cannot be squeezed by the artwork", () => {
  it("makes the artwork block the only flexible track", () => {
    // justify-center: V2 removed the benefits panel, which freed roughly an
    // inch. Top-anchored, that inch became one dead band above the totals and
    // read as an unfinished page; centred, it splits above and below the
    // artwork. addendumDensity spreads the rest across the section gaps.
    expect(tpl).toMatch(/flex-1 min-h-0 overflow-hidden flex flex-col justify-center/);
    // overflow-hidden matters: min-h-0 lets the track collapse, but the panel
    // inside keeps its own height and painted straight over the adjusted total.
    // artworkFits drops it before that happens; this is the backstop.
    expect(tpl).toMatch(/density\.artworkFits/);
  });

  it("pins every structured block against shrinking", () => {
    // Flex children shrink by default, so without this the adjusted total and
    // the disclosure would compress before the image did.
    expect(tpl.match(/shrink-0/g)?.length ?? 0).toBeGreaterThanOrEqual(11);
  });

  it("sizes the image by ceiling, not by fixed height", () => {
    expect(tpl).toMatch(/maxHeight: valuePropImageCeiling\(vp\.imageScale, v2Sections\)/);
    expect(tpl).toMatch(/h-auto w-auto object-contain/);
    // The old fixed-height classes are gone.
    expect(tpl).not.toMatch(/VP_IMAGE_SIZE/);
    expect(tpl).not.toMatch(/h-\[0\.42in\]/);
  });
});


describe("the sheet is the size the registry says it is", () => {
  // config.size is "4.5x11" and config.widthIn is 4.5, but both components
  // hardcoded 4.25in — a quarter inch narrower than the page they are placed
  // on. Pinned here because the number lives in two files that cannot see
  // each other.
  const newcar = readFileSync(join(__dirname, "NewCarSaasAddendum.tsx"), "utf8");
  for (const [name, src] of [["premium", tpl], ["new-car", newcar]] as const) {
    it(`${name} draws 4.5in x 11in`, () => {
      expect(src).toMatch(/width: "4\.5in", height: "11in"/);
      expect(src).not.toMatch(/4\.25in/);
    });
  }
});
