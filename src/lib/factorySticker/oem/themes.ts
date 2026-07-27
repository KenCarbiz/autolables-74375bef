// Explicit .ts extensions keep this module importable from the Deno edge
// renderer (supabase/functions/_shared/factorySticker/render.ts).
import type { OemId } from "./identity.ts";
import { OEM_REGISTRY } from "./identity.ts";

export type TemplateFamilyId =
  | "KOREAN_PREMIUM"
  | "KOREAN_MAINSTREAM"
  | "PREMIUM_LUXURY"
  | "MODERN_LUXURY"
  | "AMERICAN_MAINSTREAM"
  | "EUROPEAN_TECHNICAL"
  | "JAPANESE_MAINSTREAM"
  | "JAPANESE_FACTORY"
  | "PREMIUM_FACTORY"
  | "LUXURY_FACTORY"
  | "GERMAN_FACTORY"
  | "PERFORMANCE"
  | "EV_TECHNICAL"
  | "COMMERCIAL"
  | "AUTOLABELS_FALLBACK";

export const TEMPLATE_FAMILY_IDS: TemplateFamilyId[] = [
  "KOREAN_PREMIUM",
  "KOREAN_MAINSTREAM",
  "PREMIUM_LUXURY",
  "MODERN_LUXURY",
  "AMERICAN_MAINSTREAM",
  "EUROPEAN_TECHNICAL",
  "JAPANESE_MAINSTREAM",
  "JAPANESE_FACTORY",
  "PREMIUM_FACTORY",
  "LUXURY_FACTORY",
  "GERMAN_FACTORY",
  "PERFORMANCE",
  "EV_TECHNICAL",
  "COMMERCIAL",
  "AUTOLABELS_FALLBACK",
];

export type LogoPlacement = "TOP_LEFT" | "TOP_CENTER" | "TOP_RIGHT";
export type LogoAlignment = "LEFT" | "CENTER" | "RIGHT";

export interface OemLogoSpec {
  assetId?: string;
  usageAuthorized: boolean;
  placement: LogoPlacement;
  maxWidthPx: number;
  maxHeightPx: number;
  alignment: LogoAlignment;
  wordmarkText: string;
  wordmarkLetterSpacing: string;
}

export interface OemColorSpec {
  headerBackground: string;
  headerText: string;
  background: string;
  bodyText: string;
  mutedText: string;
  accent: string;
  divider: string;
  sectionHeadingText: string;
  totalMsrpBackground: string;
  totalMsrpText: string;
}

export interface OemTypographySpec {
  headingFont: string;
  bodyFont: string;
  numericFont: string;
  headingWeight: number;
  bodyWeight: number;
  labelWeight: number;
  letterSpacing: string;
  headingLetterSpacing: string;
  uppercaseSectionHeadings: boolean;
}

export type HeaderVariant = "BANDED" | "RULED" | "MINIMAL" | "BLOCK";
export type PricingVariant = "BOXED" | "BANDED" | "RIGHT_RAIL" | "UNDERLINED";
export type BarcodeVariant = "CODE39" | "CODE128" | "NONE";
export type QrVariant = "SQUARE" | "ROUNDED" | "BRANDED_FRAME";
export type FooterVariant = "LEGAL_STRIP" | "SPLIT" | "MINIMAL";
export type CornerTreatment = "SQUARE" | "ROUNDED_SM" | "ROUNDED_MD";

export interface OemLayoutSpec {
  headerVariant: HeaderVariant;
  pricingVariant: PricingVariant;
  barcodeVariant: BarcodeVariant;
  qrVariant: QrVariant;
  footerVariant: FooterVariant;
  columnGap: string;
  borderWeight: string;
  cornerTreatment: CornerTreatment;
}

export interface OemStickerTheme {
  oemId: OemId;
  version: string;
  templateFamilyId: TemplateFamilyId;
  logo: OemLogoSpec;
  colors: OemColorSpec;
  typography: OemTypographySpec;
  layout: OemLayoutSpec;
  /** Verified brand wording for the NEW-vehicle total band; the engine
   *  default is TOTAL FACTORY MSRP. Used documents always read
   *  TOTAL ORIGINAL MSRP. */
  totalLabel?: string;
}

const FAMILY_TYPOGRAPHY: Record<TemplateFamilyId, OemTypographySpec> = {
  // Production-safe substitute for Genesis' proprietary type, recorded per
  // the theme registry rules (no decorative approximation of brand fonts).
  KOREAN_PREMIUM: {
    headingFont: '"Helvetica Neue", "Segoe UI", Helvetica, Arial, sans-serif',
    bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    numericFont: '"Helvetica Neue", Arial, sans-serif',
    headingWeight: 500,
    bodyWeight: 400,
    labelWeight: 600,
    letterSpacing: "0.02em",
    headingLetterSpacing: "0.18em",
    uppercaseSectionHeadings: true,
  },
  // Kia's dense black-and-white factory treatment: neutral grotesque set,
  // heavy heading weight, modest tracking — density over ornament.
  KOREAN_MAINSTREAM: {
    headingFont: '"Helvetica Neue", "Segoe UI", Helvetica, Arial, sans-serif',
    bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    numericFont: '"Helvetica Neue", "Arial Narrow", Arial, sans-serif',
    headingWeight: 700,
    bodyWeight: 400,
    labelWeight: 700,
    letterSpacing: "0.01em",
    headingLetterSpacing: "0.06em",
    uppercaseSectionHeadings: true,
  },
  PREMIUM_LUXURY: {
    headingFont: '"Avenir Next", "Century Gothic", "Segoe UI", Helvetica, Arial, sans-serif',
    bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    numericFont: '"Helvetica Neue", Arial, sans-serif',
    headingWeight: 500,
    bodyWeight: 400,
    labelWeight: 600,
    letterSpacing: "0.02em",
    headingLetterSpacing: "0.14em",
    uppercaseSectionHeadings: true,
  },
  MODERN_LUXURY: {
    headingFont: 'Optima, Candara, "Segoe UI", Helvetica, sans-serif',
    bodyFont: '"Segoe UI", Helvetica, Arial, sans-serif',
    numericFont: '"Segoe UI", Arial, sans-serif',
    headingWeight: 500,
    bodyWeight: 400,
    labelWeight: 600,
    letterSpacing: "0.01em",
    headingLetterSpacing: "0.1em",
    uppercaseSectionHeadings: true,
  },
  AMERICAN_MAINSTREAM: {
    headingFont: '"Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif',
    bodyFont: "Arial, Helvetica, sans-serif",
    numericFont: '"Arial Narrow", Arial, sans-serif',
    headingWeight: 700,
    bodyWeight: 400,
    labelWeight: 700,
    letterSpacing: "0em",
    headingLetterSpacing: "0.04em",
    uppercaseSectionHeadings: true,
  },
  EUROPEAN_TECHNICAL: {
    headingFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    numericFont: '"Roboto Condensed", "Arial Narrow", Arial, sans-serif',
    headingWeight: 700,
    bodyWeight: 400,
    labelWeight: 500,
    letterSpacing: "0em",
    headingLetterSpacing: "0.02em",
    uppercaseSectionHeadings: false,
  },
  JAPANESE_MAINSTREAM: {
    headingFont: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    bodyFont: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    numericFont: '"Segoe UI", Arial, sans-serif',
    headingWeight: 600,
    bodyWeight: 400,
    labelWeight: 600,
    letterSpacing: "0.01em",
    headingLetterSpacing: "0.06em",
    uppercaseSectionHeadings: true,
  },
  // Mazda's factory allocation-label voice: neutral grotesque, strong
  // uppercase hierarchy, restrained tracking — technical, not promotional.
  JAPANESE_FACTORY: {
    headingFont: '"Helvetica Neue", "Segoe UI", Helvetica, Arial, sans-serif',
    bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    numericFont: '"Helvetica Neue", "Arial Narrow", Arial, sans-serif',
    headingWeight: 700,
    bodyWeight: 400,
    labelWeight: 700,
    letterSpacing: "0.01em",
    headingLetterSpacing: "0.05em",
    uppercaseSectionHeadings: true,
  },
  // Acura's condensed industrial factory voice: narrow grotesque, strong
  // uppercase hierarchy, tabular pricing.
  PREMIUM_FACTORY: {
    headingFont: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
    bodyFont: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif',
    numericFont: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif',
    headingWeight: 700,
    bodyWeight: 400,
    labelWeight: 700,
    letterSpacing: "0.01em",
    headingLetterSpacing: "0.05em",
    uppercaseSectionHeadings: true,
  },
  // INFINITI's premium factory voice: condensed grotesque with generous
  // tracking on headings — technical restraint over luxury ornament.
  LUXURY_FACTORY: {
    headingFont: '"Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif',
    bodyFont: '"Roboto Condensed", "Arial Narrow", Arial, sans-serif',
    numericFont: '"Roboto Condensed", "Arial Narrow", Arial, sans-serif',
    headingWeight: 700,
    bodyWeight: 400,
    labelWeight: 700,
    letterSpacing: "0.01em",
    headingLetterSpacing: "0.1em",
    uppercaseSectionHeadings: true,
  },
  // Audi's factory allocation voice: neutral grotesque, tight bold
  // headings, monochrome hierarchy — technical, never promotional.
  GERMAN_FACTORY: {
    headingFont: '"Helvetica Neue", "Segoe UI", Helvetica, Arial, sans-serif',
    bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    numericFont: '"Helvetica Neue", "Arial Narrow", Arial, sans-serif',
    headingWeight: 700,
    bodyWeight: 400,
    labelWeight: 700,
    letterSpacing: "0em",
    headingLetterSpacing: "0.04em",
    uppercaseSectionHeadings: true,
  },
  PERFORMANCE: {
    headingFont: '"Arial Black", "Franklin Gothic Heavy", Arial, sans-serif',
    bodyFont: "Arial, Helvetica, sans-serif",
    numericFont: '"Arial Narrow", Arial, sans-serif',
    headingWeight: 800,
    bodyWeight: 400,
    labelWeight: 700,
    letterSpacing: "-0.01em",
    headingLetterSpacing: "0.02em",
    uppercaseSectionHeadings: true,
  },
  EV_TECHNICAL: {
    headingFont: 'Montserrat, "Century Gothic", "Segoe UI", sans-serif',
    bodyFont: '"Segoe UI", Helvetica, Arial, sans-serif',
    numericFont: '"Segoe UI", Arial, sans-serif',
    headingWeight: 600,
    bodyWeight: 400,
    labelWeight: 500,
    letterSpacing: "0.01em",
    headingLetterSpacing: "0.12em",
    uppercaseSectionHeadings: true,
  },
  COMMERCIAL: {
    headingFont: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif',
    bodyFont: "Arial, Helvetica, sans-serif",
    numericFont: '"Arial Narrow", Arial, sans-serif',
    headingWeight: 700,
    bodyWeight: 400,
    labelWeight: 700,
    letterSpacing: "0em",
    headingLetterSpacing: "0.03em",
    uppercaseSectionHeadings: true,
  },
  AUTOLABELS_FALLBACK: {
    headingFont: '"Palatino Linotype", Palatino, Georgia, serif',
    bodyFont: '"Segoe UI", Helvetica, Arial, sans-serif',
    numericFont: '"Segoe UI", Arial, sans-serif',
    headingWeight: 600,
    bodyWeight: 400,
    labelWeight: 600,
    letterSpacing: "0.01em",
    headingLetterSpacing: "0.08em",
    uppercaseSectionHeadings: true,
  },
};

const FAMILY_LAYOUT: Record<TemplateFamilyId, OemLayoutSpec> = {
  KOREAN_PREMIUM: {
    headerVariant: "BANDED",
    pricingVariant: "UNDERLINED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "14pt",
    borderWeight: "0.5pt",
    cornerTreatment: "SQUARE",
  },
  KOREAN_MAINSTREAM: {
    headerVariant: "RULED",
    pricingVariant: "UNDERLINED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "12pt",
    borderWeight: "1pt",
    cornerTreatment: "SQUARE",
  },
  PREMIUM_LUXURY: {
    headerVariant: "BANDED",
    pricingVariant: "BOXED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "18pt",
    borderWeight: "0.5pt",
    cornerTreatment: "SQUARE",
  },
  MODERN_LUXURY: {
    headerVariant: "RULED",
    pricingVariant: "BOXED",
    barcodeVariant: "CODE128",
    qrVariant: "ROUNDED",
    footerVariant: "SPLIT",
    columnGap: "16pt",
    borderWeight: "0.5pt",
    cornerTreatment: "ROUNDED_SM",
  },
  AMERICAN_MAINSTREAM: {
    headerVariant: "BLOCK",
    pricingVariant: "BANDED",
    barcodeVariant: "CODE39",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "14pt",
    borderWeight: "1pt",
    cornerTreatment: "SQUARE",
  },
  EUROPEAN_TECHNICAL: {
    headerVariant: "RULED",
    pricingVariant: "UNDERLINED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "SPLIT",
    columnGap: "16pt",
    borderWeight: "0.75pt",
    cornerTreatment: "SQUARE",
  },
  JAPANESE_MAINSTREAM: {
    headerVariant: "BANDED",
    pricingVariant: "BANDED",
    barcodeVariant: "CODE39",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "14pt",
    borderWeight: "1pt",
    cornerTreatment: "SQUARE",
  },
  JAPANESE_FACTORY: {
    headerVariant: "BANDED",
    pricingVariant: "UNDERLINED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "14pt",
    borderWeight: "1pt",
    cornerTreatment: "SQUARE",
  },
  PREMIUM_FACTORY: {
    headerVariant: "BANDED",
    pricingVariant: "UNDERLINED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "13pt",
    borderWeight: "1pt",
    cornerTreatment: "SQUARE",
  },
  LUXURY_FACTORY: {
    headerVariant: "BANDED",
    pricingVariant: "UNDERLINED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "14pt",
    borderWeight: "0.75pt",
    cornerTreatment: "SQUARE",
  },
  GERMAN_FACTORY: {
    headerVariant: "BANDED",
    pricingVariant: "UNDERLINED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "13pt",
    borderWeight: "1pt",
    cornerTreatment: "SQUARE",
  },
  PERFORMANCE: {
    headerVariant: "BLOCK",
    pricingVariant: "BANDED",
    barcodeVariant: "CODE39",
    qrVariant: "SQUARE",
    footerVariant: "SPLIT",
    columnGap: "14pt",
    borderWeight: "1.5pt",
    cornerTreatment: "SQUARE",
  },
  EV_TECHNICAL: {
    headerVariant: "MINIMAL",
    pricingVariant: "RIGHT_RAIL",
    barcodeVariant: "NONE",
    qrVariant: "ROUNDED",
    footerVariant: "MINIMAL",
    columnGap: "20pt",
    borderWeight: "0.5pt",
    cornerTreatment: "ROUNDED_MD",
  },
  COMMERCIAL: {
    headerVariant: "BLOCK",
    pricingVariant: "BANDED",
    barcodeVariant: "CODE39",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "12pt",
    borderWeight: "1pt",
    cornerTreatment: "SQUARE",
  },
  AUTOLABELS_FALLBACK: {
    headerVariant: "BANDED",
    pricingVariant: "BOXED",
    barcodeVariant: "CODE128",
    qrVariant: "SQUARE",
    footerVariant: "LEGAL_STRIP",
    columnGap: "16pt",
    borderWeight: "0.75pt",
    cornerTreatment: "ROUNDED_SM",
  },
};

const FAMILY_LOGO: Record<TemplateFamilyId, Omit<OemLogoSpec, "wordmarkText">> = {
  KOREAN_PREMIUM: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 200, maxHeightPx: 50, alignment: "LEFT", wordmarkLetterSpacing: "0.26em" },
  KOREAN_MAINSTREAM: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 170, maxHeightPx: 44, alignment: "LEFT", wordmarkLetterSpacing: "0.22em" },
  JAPANESE_FACTORY: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 160, maxHeightPx: 48, alignment: "LEFT", wordmarkLetterSpacing: "0.24em" },
  PREMIUM_FACTORY: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 160, maxHeightPx: 48, alignment: "LEFT", wordmarkLetterSpacing: "0.2em" },
  LUXURY_FACTORY: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 170, maxHeightPx: 48, alignment: "LEFT", wordmarkLetterSpacing: "0.28em" },
  GERMAN_FACTORY: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 160, maxHeightPx: 48, alignment: "LEFT", wordmarkLetterSpacing: "0.18em" },
  PREMIUM_LUXURY: { usageAuthorized: false, placement: "TOP_CENTER", maxWidthPx: 200, maxHeightPx: 56, alignment: "CENTER", wordmarkLetterSpacing: "0.3em" },
  MODERN_LUXURY: { usageAuthorized: false, placement: "TOP_CENTER", maxWidthPx: 190, maxHeightPx: 52, alignment: "CENTER", wordmarkLetterSpacing: "0.22em" },
  AMERICAN_MAINSTREAM: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 180, maxHeightPx: 48, alignment: "LEFT", wordmarkLetterSpacing: "0.08em" },
  EUROPEAN_TECHNICAL: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 170, maxHeightPx: 44, alignment: "LEFT", wordmarkLetterSpacing: "0.1em" },
  JAPANESE_MAINSTREAM: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 180, maxHeightPx: 48, alignment: "LEFT", wordmarkLetterSpacing: "0.1em" },
  PERFORMANCE: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 190, maxHeightPx: 50, alignment: "LEFT", wordmarkLetterSpacing: "0.04em" },
  EV_TECHNICAL: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 160, maxHeightPx: 40, alignment: "LEFT", wordmarkLetterSpacing: "0.2em" },
  COMMERCIAL: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 170, maxHeightPx: 44, alignment: "LEFT", wordmarkLetterSpacing: "0.06em" },
  AUTOLABELS_FALLBACK: { usageAuthorized: false, placement: "TOP_LEFT", maxWidthPx: 180, maxHeightPx: 44, alignment: "LEFT", wordmarkLetterSpacing: "0.12em" },
};

interface PaletteInput {
  header: string;
  accent: string;
  headerText?: string;
  body?: string;
  muted?: string;
  divider?: string;
  background?: string;
  sectionHeading?: string;
  totalBg?: string;
  totalText?: string;
}

const palette = (p: PaletteInput): OemColorSpec => ({
  headerBackground: p.header,
  headerText: p.headerText ?? "#ffffff",
  background: p.background ?? "#ffffff",
  bodyText: p.body ?? "#1f2328",
  mutedText: p.muted ?? "#5f6570",
  accent: p.accent,
  divider: p.divider ?? "#d9dce1",
  sectionHeadingText: p.sectionHeading ?? p.accent,
  totalMsrpBackground: p.totalBg ?? p.header,
  totalMsrpText: p.totalText ?? p.headerText ?? "#ffffff",
});

const theme = (
  oemId: OemId,
  family: TemplateFamilyId,
  colors: OemColorSpec,
  overrides?: {
    typography?: Partial<OemTypographySpec>;
    layout?: Partial<OemLayoutSpec>;
    logo?: Partial<Omit<OemLogoSpec, "assetId">>;
    totalLabel?: string;
  },
): OemStickerTheme => ({
  oemId,
  version: "1.0.0",
  templateFamilyId: family,
  logo: {
    ...FAMILY_LOGO[family],
    wordmarkText: OEM_REGISTRY[oemId].displayName.toUpperCase(),
    ...overrides?.logo,
    usageAuthorized: false,
  },
  colors,
  typography: { ...FAMILY_TYPOGRAPHY[family], ...overrides?.typography },
  layout: { ...FAMILY_LAYOUT[family], ...overrides?.layout },
  ...(overrides?.totalLabel ? { totalLabel: overrides.totalLabel } : {}),
});

export const THEME_REGISTRY: Record<OemId, OemStickerTheme> = {
  // INFINITI factory treatment (infiniti-us-2026-v2): white emblem block
  // carrying the governed horizon mark + wordmark, charcoal model band,
  // muted burgundy keyline — the only warm accent on the document.
  INFINITI: theme("INFINITI", "LUXURY_FACTORY", {
    headerBackground: "#171717",
    headerText: "#ffffff",
    background: "#ffffff",
    bodyText: "#2b2b2b",
    mutedText: "#6b6f76",
    accent: "#8a1538",
    divider: "#d6d8db",
    sectionHeadingText: "#1a1a1a",
    totalMsrpBackground: "#161616",
    totalMsrpText: "#ffffff",
  }),
  NISSAN: theme("NISSAN", "JAPANESE_MAINSTREAM", palette({ header: "#101010", accent: "#c3002f" })),
  TOYOTA: theme("TOYOTA", "JAPANESE_MAINSTREAM", palette({
    header: "#d3121a", accent: "#b30f16", totalBg: "#191c20", totalText: "#ffffff",
  })),
  LEXUS: theme("LEXUS", "PREMIUM_LUXURY", palette({ header: "#0c0c0c", accent: "#8a8d8f", sectionHeading: "#2b2b2b" })),
  // Honda factory treatment (honda-us-2026-v1): white header carrying the
  // black HONDA wordmark over a restrained Honda-red rule; red never fills
  // a background. Ink body, black total band.
  HONDA: theme("HONDA", "JAPANESE_FACTORY", {
    headerBackground: "#ffffff",
    headerText: "#111111",
    background: "#ffffff",
    bodyText: "#1a1a1a",
    mutedText: "#55595e",
    accent: "#cc0000",
    divider: "#c9ccd0",
    sectionHeadingText: "#141414",
    totalMsrpBackground: "#101010",
    totalMsrpText: "#ffffff",
  }, { totalLabel: "TOTAL VEHICLE PRICE" }),
  // Acura factory treatment (acura-us-2026-v1): black masthead block with
  // reversed wordmark, paper model band, black rules; color held to the
  // regulatory panels and the small AutoLabels provenance mark.
  ACURA: theme("ACURA", "PREMIUM_FACTORY", {
    headerBackground: "#000000",
    headerText: "#ffffff",
    background: "#ffffff",
    bodyText: "#111111",
    mutedText: "#55595e",
    accent: "#111111",
    divider: "#d7dce2",
    sectionHeadingText: "#141414",
    totalMsrpBackground: "#101010",
    totalMsrpText: "#ffffff",
  }, { totalLabel: "TOTAL VEHICLE PRICE" }),
  FORD: theme("FORD", "AMERICAN_MAINSTREAM", palette({ header: "#003478", accent: "#1e4f91" })),
  // Lincoln factory treatment (lincoln-us-2026-v1): white wordmark block,
  // dark-navy band and keyline as the only brand identifier — quiet
  // luxury, overwhelmingly black and white, distinct from Ford.
  LINCOLN: theme("LINCOLN", "LUXURY_FACTORY", {
    headerBackground: "#172536",
    headerText: "#ffffff",
    background: "#ffffff",
    bodyText: "#111111",
    mutedText: "#55595e",
    accent: "#172536",
    divider: "#d7dce2",
    sectionHeadingText: "#111111",
    totalMsrpBackground: "#101010",
    totalMsrpText: "#ffffff",
  }, { totalLabel: "TOTAL MSRP" }),
  CHEVROLET: theme("CHEVROLET", "AMERICAN_MAINSTREAM", palette({
    header: "#c9daea", headerText: "#101418", accent: "#1a2c47", sectionHeading: "#1a2c47",
    totalBg: "#1a2c47", totalText: "#ffffff",
  })),
  // GMC factory treatment (gmc-us-2026-v1): near-black band with the red
  // keyline, GM's TOTAL VEHICLE PRICE wording — distinct from Chevrolet's
  // steel-blue identity band.
  GMC: theme("GMC", "AMERICAN_MAINSTREAM", palette({
    header: "#1c1c1c", accent: "#c8102e", totalBg: "#1c1c1c", totalText: "#ffffff",
  }), { totalLabel: "TOTAL VEHICLE PRICE" }),
  BUICK: theme("BUICK", "AMERICAN_MAINSTREAM", palette({ header: "#3a4750", accent: "#b02a30" })),
  // Cadillac factory treatment (cadillac-us-2026-v1): white wordmark block,
  // near-black band, restrained gold keyline, GM's TOTAL VEHICLE PRICE.
  CADILLAC: theme("CADILLAC", "LUXURY_FACTORY", {
    headerBackground: "#101014",
    headerText: "#ffffff",
    background: "#ffffff",
    bodyText: "#111111",
    mutedText: "#55595e",
    accent: "#a37e2c",
    divider: "#d7dce2",
    sectionHeadingText: "#111111",
    totalMsrpBackground: "#101014",
    totalMsrpText: "#ffffff",
  }, { totalLabel: "TOTAL VEHICLE PRICE" }),
  JEEP: theme("JEEP", "PERFORMANCE", palette({
    header: "#101010", accent: "#5f6538", sectionHeading: "#3f432a",
    totalBg: "#565b33", totalText: "#ffffff",
  })),
  DODGE: theme("DODGE", "PERFORMANCE", palette({ header: "#000000", accent: "#ba0c2f" })),
  RAM: theme("RAM", "COMMERCIAL", palette({ header: "#4a4f54", accent: "#a6192e" })),
  CHRYSLER: theme("CHRYSLER", "AMERICAN_MAINSTREAM", palette({ header: "#003a70", accent: "#b9c0c7", sectionHeading: "#003a70" })),
  VOLKSWAGEN: theme("VOLKSWAGEN", "EUROPEAN_TECHNICAL", palette({ header: "#001e50", accent: "#00b1eb", sectionHeading: "#001e50" })),
  // Audi factory treatment (audi-us-2026-v2): white identity block and
  // band, fully monochrome black rules and keyline per the owner's
  // reference — Audi red is deliberately withheld until asked for.
  AUDI: theme("AUDI", "GERMAN_FACTORY", {
    headerBackground: "#ffffff",
    headerText: "#111111",
    background: "#ffffff",
    bodyText: "#111111",
    mutedText: "#55595e",
    accent: "#0d0d0d",
    divider: "#d7d7d7",
    sectionHeadingText: "#111111",
    totalMsrpBackground: "#101010",
    totalMsrpText: "#ffffff",
  }, { totalLabel: "TOTAL MSRP" }),
  BMW: theme("BMW", "EUROPEAN_TECHNICAL", palette({ header: "#262626", accent: "#0066b1" })),
  // Mercedes-Benz factory treatment (mercedes-benz-us-2026-v1): white
  // header with the auto-fit wordmark block, restrained silver keyline,
  // black TOTAL MSRP band — overwhelmingly black and white.
  MERCEDES_BENZ: theme("MERCEDES_BENZ", "LUXURY_FACTORY", {
    headerBackground: "#ffffff",
    headerText: "#111111",
    background: "#ffffff",
    bodyText: "#111111",
    mutedText: "#55595e",
    accent: "#6e7377",
    divider: "#d7d7d7",
    sectionHeadingText: "#111111",
    totalMsrpBackground: "#101010",
    totalMsrpText: "#ffffff",
  }, { totalLabel: "TOTAL MSRP" }),
  // Subaru factory treatment (subaru-us-2026-v1): white identity block,
  // Subaru-blue header band, blue used with restraint (band, keyline, total).
  SUBARU: theme("SUBARU", "JAPANESE_FACTORY", {
    headerBackground: "#003b70",
    headerText: "#ffffff",
    background: "#ffffff",
    bodyText: "#1a1a1a",
    mutedText: "#55595e",
    accent: "#003b70",
    divider: "#c9ccd0",
    sectionHeadingText: "#0f2c4c",
    totalMsrpBackground: "#003b70",
    totalMsrpText: "#ffffff",
  }),
  // Mazda factory treatment (mazda-us-2026-v1): white identity block, black
  // header band, restrained factory red used only for the accent keyline —
  // never for backgrounds, pricing, or promotional emphasis.
  MAZDA: theme("MAZDA", "JAPANESE_FACTORY", {
    headerBackground: "#0d0d0d",
    headerText: "#ffffff",
    background: "#ffffff",
    bodyText: "#1a1a1a",
    mutedText: "#55595e",
    accent: "#c8102e",
    divider: "#c9ccd0",
    sectionHeadingText: "#141414",
    totalMsrpBackground: "#101010",
    totalMsrpText: "#ffffff",
  }),
  // Hyundai factory treatment (hyundai-us-2026-v2): white emblem block,
  // Hyundai-blue band and keyline used sparingly, black total band —
  // predominantly black and white, distinct from Genesis and Kia.
  HYUNDAI: theme("HYUNDAI", "LUXURY_FACTORY", {
    headerBackground: "#002c5f",
    headerText: "#ffffff",
    background: "#ffffff",
    bodyText: "#111111",
    mutedText: "#55595e",
    accent: "#002c5f",
    divider: "#d7dce2",
    sectionHeadingText: "#111111",
    totalMsrpBackground: "#101010",
    totalMsrpText: "#ffffff",
  }, { totalLabel: "TOTAL SUGGESTED RETAIL PRICE" }),
  GENESIS: theme("GENESIS", "KOREAN_PREMIUM", palette({
    header: "#111111", accent: "#9a7448", sectionHeading: "#4b4b4b",
    totalBg: "#141414", totalText: "#ffffff",
  })),
  // Kia factory treatment (kia-us-2026-v1): white header carrying the black
  // KIA wordmark, ink #111111, strong black structural rules, subtle #f1f1f1
  // heading fills. Regulatory modules keep the engine's federal-neutral
  // styling — the OEM identity never restyles EPA/NHTSA content.
  KIA: theme("KIA", "KOREAN_MAINSTREAM", {
    headerBackground: "#ffffff",
    headerText: "#111111",
    background: "#ffffff",
    bodyText: "#111111",
    mutedText: "#5a5a5a",
    accent: "#111111",
    divider: "#5a5a5a",
    sectionHeadingText: "#111111",
    totalMsrpBackground: "#111111",
    totalMsrpText: "#ffffff",
  }),
  VOLVO: theme("VOLVO", "MODERN_LUXURY", palette({ header: "#003057", accent: "#7fa0bd", sectionHeading: "#003057" })),
  LAND_ROVER: theme("LAND_ROVER", "PREMIUM_LUXURY", palette({ header: "#0c3c26", accent: "#b49b57", sectionHeading: "#0c3c26" })),
  PORSCHE: theme("PORSCHE", "PERFORMANCE", palette({ header: "#000000", accent: "#d5001c" })),
  TESLA: theme("TESLA", "EV_TECHNICAL", palette({ header: "#171a20", accent: "#e82127" })),
  AUTOLABELS_FALLBACK: theme("AUTOLABELS_FALLBACK", "AUTOLABELS_FALLBACK", palette({
    header: "#14161a",
    accent: "#6e7681",
    sectionHeading: "#2c313a",
    totalBg: "#2c313a",
  })),
};

export function getTheme(oemId: OemId | string): OemStickerTheme {
  return THEME_REGISTRY[oemId as OemId] ?? THEME_REGISTRY.AUTOLABELS_FALLBACK;
}
