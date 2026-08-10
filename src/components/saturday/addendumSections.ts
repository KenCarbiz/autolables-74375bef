// ──────────────────────────────────────────────────────────────────────
// What actually prints on an addendum, decided once.
//
// The preview, the browser print path and the PDF renderer all read this, so a
// section cannot be visible in one and absent in another.
//
// The rule the template kept getting wrong: a section is conditional, its ROWS
// are not. "Included Benefits" rendered its heading, border, icon badge and a
// "No configured benefits." placeholder whenever the dealer had none — a box
// that says nothing, occupying vertical space on a page with a hard 11-inch
// ceiling. On a tall promotional image that stolen space is what pushed real
// content past the edge.
// ──────────────────────────────────────────────────────────────────────

import type { SaturdayValueProp } from "./types";

export type AddendumLine = { name: string; price: string; description?: string; iconKey?: string };

/**
 * How a benefit that ALSO has promotional artwork should be presented.
 *
 * A dealer who selects the Lifetime Powertrain image and also stores "Lifetime
 * Powertrain Warranty" as a benefit is describing one thing twice. Deleting
 * either automatically would be destroying dealer data to fix a layout
 * problem, so this is a presentation choice and the stored benefit survives
 * whichever way it is set.
 */
export type BenefitDisplayMode = "list_and_image" | "image_only" | "list_only";

export const DEFAULT_BENEFIT_DISPLAY_MODE: BenefitDisplayMode = "list_and_image";

/** A line prints when it names something. A zero price is legitimate — plenty
 *  of included equipment carries no separate charge — so price is not a gate. */
export const isPrintableLine = (l: AddendumLine | null | undefined): l is AddendumLine =>
  !!l && typeof l.name === "string" && l.name.trim().length > 0;

/** A benefit prints when it carries text. */
export const isPrintableBenefit = (b: string | null | undefined): b is string =>
  typeof b === "string" && b.trim().length > 0;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * True when a value proposition's artwork already says what this benefit says.
 *
 * Used only under `image_only`, and only to decide PRESENTATION.
 */
const coveredByArtwork = (benefit: string, valueProps: SaturdayValueProp[]): boolean => {
  const b = norm(benefit);
  if (!b) return false;
  return valueProps.some((vp) => {
    if (!vp.imageUrl) return false;
    const hay = norm(`${vp.headline ?? ""} ${vp.supportingLine ?? ""}`);
    return !!hay && (hay.includes(b) || b.includes(hay));
  });
};

export interface AddendumSectionInput {
  installed?: AddendumLine[];
  upgrades?: AddendumLine[];
  benefits?: string[];
  valueProps?: SaturdayValueProp[];
  benefitDisplayMode?: BenefitDisplayMode;
}

export interface ResolvedAddendumSections {
  installed: AddendumLine[];
  upgrades: AddendumLine[];
  benefits: string[];
  valueProps: SaturdayValueProp[];
  /** Render the section — heading, border, badge and all — only when true. */
  hasInstalled: boolean;
  hasBenefits: boolean;
  hasUpgrades: boolean;
  hasValueProps: boolean;
  /** Benefits suppressed from the list because the artwork carries them. */
  benefitsShownAsImage: string[];
}

/**
 * Resolve every conditional section for one printed addendum.
 *
 * Nothing here infers a benefit from a selected image: choosing artwork is not
 * evidence that the dealer sells the thing it depicts. Rows come from stored
 * data or they do not exist.
 */
export function resolveAddendumSections(input: AddendumSectionInput): ResolvedAddendumSections {
  const mode = input.benefitDisplayMode ?? DEFAULT_BENEFIT_DISPLAY_MODE;
  const valueProps = (input.valueProps ?? []).filter((vp) => vp && (vp.imageUrl || vp.headline));
  const installed = (input.installed ?? []).filter(isPrintableLine);
  const upgrades = (input.upgrades ?? []).filter(isPrintableLine);

  const stored = (input.benefits ?? []).filter(isPrintableBenefit).map((b) => b.trim());
  const benefitsShownAsImage = mode === "image_only"
    ? stored.filter((b) => coveredByArtwork(b, valueProps))
    : [];
  const benefits = mode === "image_only"
    ? stored.filter((b) => !benefitsShownAsImage.includes(b))
    : stored;

  return {
    installed,
    upgrades,
    benefits,
    valueProps,
    hasInstalled: installed.length > 0,
    hasBenefits: benefits.length > 0,
    hasUpgrades: upgrades.length > 0,
    hasValueProps: valueProps.length > 0,
    benefitsShownAsImage,
  };
}

// ── Promotional image sizing ──────────────────────────────────────────
//
// The artwork is the ONE flexible element on the page. Everything else —
// equipment, benefits, upgrades, the adjusted total, the disclosure, the
// footer — is required structured content that must stay legible, so when the
// page runs short the image gives up its space first and keeps its aspect
// ratio while doing it.
//
// These are CEILINGS, not heights. The image is laid out inside a flex track
// that may hand it less.
export const VP_IMAGE_MAX_HEIGHT: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "0.42in",
  md: "0.62in",
  lg: "0.85in",
  xl: "1.15in",
};

/**
 * How much vertical room the artwork may claim, given how much structured
 * content is on the page.
 *
 * More real sections means less room for artwork — the opposite of the old
 * behaviour, where a fixed image height pushed structured rows off the sheet.
 */
export function valuePropImageCeiling(
  scale: "sm" | "md" | "lg" | "xl" | undefined,
  sections: Pick<ResolvedAddendumSections, "hasInstalled" | "hasBenefits" | "hasUpgrades" | "installed" | "benefits" | "upgrades">,
): string {
  const order: Array<"sm" | "md" | "lg" | "xl"> = ["sm", "md", "lg", "xl"];
  let idx = order.indexOf(scale ?? "sm");
  const structuredSections =
    (sections.hasInstalled ? 1 : 0) + (sections.hasBenefits ? 1 : 0) + (sections.hasUpgrades ? 1 : 0);
  // Each pressure signal costs the artwork one size step. Measured against the
  // printed sheet: at 12 structured rows an xl image is what pushes the footer
  // off the page, and stepping it down is the correct trade — the artwork is
  // decoration, the footer is required content.
  if (structuredSections >= 3) idx -= 1;
  const rows = structuredRowCount(sections);
  if (rows > 9) idx -= 1;
  if (rows > 12) idx -= 1;
  // The inverse of the pressure rules: a light page has height going spare, and
  // the artwork is the one element that can absorb it without stretching type.
  if (structuredSections <= 2 && rows <= 7) idx += 1;
  return VP_IMAGE_MAX_HEIGHT[order[Math.max(0, Math.min(order.length - 1, idx))]];
}

// ── Deterministic content fit ─────────────────────────────────────────
//
// The page is a hard 4.25 x 11 inches. When a dealer configures a lot of rows
// AND picks large artwork, something has to give, and the order matters: empty
// sections vanish first (they already do), then the artwork shrinks, then the
// spacing tightens. Type size is the last thing touched and never goes below a
// legible print size — a sticker nobody can read is not a fix.

export interface AddendumDensity {
  /** Vertical gap class between sections. */
  sectionGap: string;
  /** True when the configured content leaves the sheet with room to spare, so
   *  the sections breathe instead of pooling the slack in one gap. */
  roomy: boolean;
  /**
   * True when the promotional artwork still has a track to live in.
   *
   * Past this point the flex track collapses to nothing while the panel inside
   * keeps its own height, so the artwork paints straight over the adjusted
   * total. Dropping decoration is the correct trade — a shopper losing the
   * promo panel is a smaller failure than a shopper reading a price with a
   * warranty stamp across it — and overflowRisk still flags the page.
   */
  artworkFits: boolean;
  /** Gap between benefit rows. */
  benefitGap: string;
  /** True when the row count is beyond what normal spacing fits. */
  compact: boolean;
  /**
   * True when even compact spacing cannot fit the configured content. The
   * caller surfaces this for review rather than letting the page crop in
   * silence.
   */
  overflowRisk: boolean;
}

/** Rows the page must find room for, artwork excluded. */
export function structuredRowCount(s: Pick<ResolvedAddendumSections, "installed" | "benefits" | "upgrades">): number {
  return s.installed.length + s.benefits.length + s.upgrades.length;
}

export function addendumDensity(s: ResolvedAddendumSections): AddendumDensity {
  const rows = structuredRowCount(s);
  // Thresholds come from the printed sheet: ~9 rows fit at normal spacing
  // alongside artwork, ~13 at compact spacing.
  const compact = rows > 9;
  // Below ~7 rows an 11-inch sheet has real slack. Left alone it pools into one
  // gap above the totals and reads as an unfinished page, so the gap between
  // every section widens instead — the slack is spread rather than parked.
  const roomy = !compact && rows <= 7;
  // Measured on the printed sheet: past ~10 priced rows the structured content
  // plus the totals, trust band and footer consume the full 11 inches.
  const artworkFits = rows <= 10;
  return {
    compact,
    roomy,
    artworkFits,
    sectionGap: compact ? "mt-1.5" : roomy ? "mt-3.5" : "mt-2.5",
    benefitGap: compact ? "gap-[2px]" : "gap-[5px]",
    overflowRisk: rows > 13,
  };
}
