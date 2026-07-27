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
  // v2 supersedes the approved 2025 wordmark-led treatment per the owner's
  // 2026-07-27 Infiniti factory-template directive; documents stamped with
  // infiniti-us-2025-v1 keep their recorded version.
  {
    oemId: "INFINITI",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "infiniti-us-2026-v2",
    layoutFamily: "luxury-factory-technical",
    status: "draft",
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
  {
    oemId: "JEEP",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "jeep-us-2025-v1",
    layoutFamily: "adventure-performance",
    status: "approved",
    logoAuthorized: false,
  },
  {
    oemId: "TOYOTA",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "toyota-us-2025-v1",
    layoutFamily: "mainstream-structured",
    status: "reviewed",
    logoAuthorized: false,
  },
  {
    oemId: "LEXUS",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "lexus-us-2025-v1",
    layoutFamily: "premium-minimalist",
    status: "reviewed",
    logoAuthorized: false,
  },
  {
    oemId: "CHEVROLET",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "chevrolet-us-2025-v1",
    layoutFamily: "american-utility",
    status: "reviewed",
    logoAuthorized: false,
  },
  // v2 supersedes the reviewed 2025 mainstream treatment per the owner's
  // 2026-07-27 Hyundai factory-template directive.
  {
    oemId: "HYUNDAI",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "hyundai-us-2026-v2",
    layoutFamily: "luxury-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "FORD",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "ford-us-2025-v1",
    layoutFamily: "american-utility",
    status: "reviewed",
    logoAuthorized: false,
  },
  {
    oemId: "GENESIS",
    market: "US",
    modelYearStart: 2023,
    modelYearEnd: 2026,
    themeVersion: "genesis-us-2025-v1",
    layoutFamily: "korean-premium-factory",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "BMW",
    market: "US",
    modelYearStart: 2020,
    modelYearEnd: null,
    themeVersion: "bmw-us-2025-v1",
    layoutFamily: "german-technical",
    status: "reviewed",
    logoAuthorized: false,
  },
  {
    oemId: "KIA",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "kia-us-2026-v1",
    layoutFamily: "korean-mainstream-factory",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "MAZDA",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "mazda-us-2026-v1",
    layoutFamily: "japanese-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "SUBARU",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "subaru-us-2026-v1",
    layoutFamily: "japanese-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "HONDA",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "honda-us-2026-v1",
    layoutFamily: "japanese-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "ACURA",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "acura-us-2026-v1",
    layoutFamily: "premium-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "LINCOLN",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "lincoln-us-2026-v1",
    layoutFamily: "luxury-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "MERCEDES_BENZ",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "mercedes-benz-us-2026-v1",
    layoutFamily: "luxury-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "GMC",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "gmc-us-2026-v1",
    layoutFamily: "american-utility",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "CADILLAC",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "cadillac-us-2026-v2",
    layoutFamily: "luxury-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "RAM",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "ram-us-2026-v2",
    layoutFamily: "commercial-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "VOLKSWAGEN",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "volkswagen-us-2026-v1",
    layoutFamily: "german-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "PORSCHE",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "porsche-us-2026-v1",
    layoutFamily: "sport-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "TESLA",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "tesla-us-2026-v1",
    layoutFamily: "minimal-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  {
    oemId: "VOLVO",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "volvo-us-2026-v1",
    layoutFamily: "scandinavian-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
  // v2 supersedes the same-day v1 draft per the owner's 2026-07-27 formal
  // Audi factory-template directive (white monochrome factory treatment).
  {
    oemId: "AUDI",
    market: "US",
    modelYearStart: 2022,
    modelYearEnd: 2027,
    themeVersion: "audi-us-2026-v2",
    layoutFamily: "german-factory-technical",
    status: "draft",
    logoAuthorized: false,
  },
];

const FAMILY_BY_TEMPLATE: Record<string, string> = {
  PREMIUM_LUXURY: "premium-minimalist",
  EUROPEAN_TECHNICAL: "german-technical",
  JAPANESE_MAINSTREAM: "mainstream-structured",
  JAPANESE_FACTORY: "japanese-factory-technical",
  PREMIUM_FACTORY: "premium-factory-technical",
  LUXURY_FACTORY: "luxury-factory-technical",
  GERMAN_FACTORY: "german-factory-technical",
  SCANDINAVIAN_FACTORY: "scandinavian-factory-technical",
  COMMERCIAL_FACTORY: "commercial-factory-technical",
  SPORT_FACTORY: "sport-factory-technical",
  MINIMAL_FACTORY: "minimal-factory-technical",
  AMERICAN_MAINSTREAM: "american-utility",
  PERFORMANCE: "adventure-performance",
  KOREAN_PREMIUM: "korean-premium-factory",
  KOREAN_MAINSTREAM: "korean-mainstream-factory",
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
  // Model year participates in make resolution, not just profile selection:
  // a pre-2011 "Ram" is a Dodge nameplate and must never reach the Ram
  // template.
  const resolved = resolveOem(make || "", modelYear ?? undefined);
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
