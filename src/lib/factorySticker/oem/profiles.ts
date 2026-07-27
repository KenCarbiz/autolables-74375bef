// Versioned, model-year-aware OEM theme profiles.
//
// Architecture: ONE document engine (render/layout.ts) + a small set of
// layout FAMILIES (behavioral differences) + per-brand THEME PROFILES
// (versioned visual identity). A profile never carries its own arithmetic,
// barcode logic, or publication behavior — it only selects presentation.
//
// Logos are governed assets: until a brand's artwork is explicitly
// authorized (logo.usageAuthorized on the theme), the engine renders the
// approved text-only wordmark treatment. No profile may inject fetched or
// recreated logo artwork.

import type { OemId } from "./identity.ts";
import { resolveOem } from "./identity.ts";
import { getTheme, THEME_REGISTRY, type OemStickerTheme } from "./themes.ts";

export type ProfileStatus = "approved" | "reviewed" | "draft" | "fallback" | "retired";

export interface OemThemeProfile {
  oemId: OemId | "AUTOLABELS_FALLBACK";
  market: "US";
  modelYearStart: number;
  modelYearEnd: number | null;
  themeVersion: string;
  layoutFamily: string;
  status: ProfileStatus;
  /** Text-only wordmark until brand artwork is explicitly authorized. */
  logoAuthorized: boolean;
}

// Explicitly authored profiles. Every other registered theme is served as a
// generated "fallback" profile so the engine always resolves, while the
// approval workflow stays honest about what has actually been reviewed.
const AUTHORED_PROFILES: OemThemeProfile[] = [
  {
    oemId: "INFINITI",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "infiniti-us-2025-v1",
    layoutFamily: "premium-minimalist",
    status: "approved",
    logoAuthorized: false,
  },
  {
    oemId: "NISSAN",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "nissan-us-2025-v1",
    layoutFamily: "mainstream-structured",
    status: "reviewed",
    logoAuthorized: false,
  },
];

const FAMILY_BY_TEMPLATE: Record<string, string> = {
  PREMIUM_LUXURY: "premium-minimalist",
  MODERN_LUXURY: "premium-minimalist",
  EUROPEAN_TECHNICAL: "german-technical",
  JAPANESE_MAINSTREAM: "mainstream-structured",
  KOREAN_MODERN: "mainstream-structured",
  AMERICAN_MAINSTREAM: "american-utility",
  PERFORMANCE: "adventure-performance",
  COMMERCIAL: "adventure-performance",
  EV_TECHNICAL: "ev-forward",
  AUTOLABELS_FALLBACK: "premium-minimalist",
};

function fallbackProfile(oemId: OemId | "AUTOLABELS_FALLBACK"): OemThemeProfile {
  const theme = getTheme(oemId);
  return {
    oemId,
    market: "US",
    modelYearStart: 1990,
    modelYearEnd: null,
    themeVersion: `${oemId.toLowerCase()}-us-fallback-v${theme.version}`,
    layoutFamily: FAMILY_BY_TEMPLATE[theme.templateFamilyId] ?? "premium-minimalist",
    status: "fallback",
    logoAuthorized: false,
  };
}

export interface ResolvedThemeProfile {
  theme: OemStickerTheme;
  profile: OemThemeProfile;
  /** How the brand was resolved: EXACT match, or engine fallback. */
  resolution: "EXACT" | "FALLBACK";
}

/**
 * Resolve make + model year (+ market) to the governing theme profile.
 * Model-year awareness keeps historical documents stable: a profile with a
 * closed year range never silently restyles an older record.
 */
export function resolveThemeProfile(
  make: string | undefined | null,
  modelYear: number | undefined | null,
  market: "US" = "US",
): ResolvedThemeProfile {
  const resolved = resolveOem(make || "");
  if (resolved.confidence === "UNRESOLVED") {
    return {
      theme: getTheme("AUTOLABELS_FALLBACK"),
      profile: fallbackProfile("AUTOLABELS_FALLBACK"),
      resolution: "FALLBACK",
    };
  }
  const oemId = resolved.identity.id as OemId;
  const year = modelYear ?? new Date(0).getFullYear();
  const authored = AUTHORED_PROFILES.find(
    (p) =>
      p.oemId === oemId &&
      p.market === market &&
      p.status !== "retired" &&
      year >= p.modelYearStart &&
      (p.modelYearEnd === null || year <= p.modelYearEnd),
  );
  return {
    theme: getTheme(oemId),
    profile: authored ?? fallbackProfile(oemId),
    resolution: "EXACT",
  };
}

export function listProfiles(): OemThemeProfile[] {
  const authoredIds = new Set(AUTHORED_PROFILES.map((p) => p.oemId));
  const rest = (Object.keys(THEME_REGISTRY) as OemId[])
    .filter((id) => !authoredIds.has(id))
    .map((id) => fallbackProfile(id));
  return [...AUTHORED_PROFILES, ...rest];
}
