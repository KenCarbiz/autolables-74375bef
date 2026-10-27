// GENERATED — do not edit.
// Mirror of src/lib/market/identityMatch.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── How exactly do we know which vehicle this is ───────────────────────────
//
// MarketCheck Price can answer for a VIN it cannot decode by falling back to
// generic candidate definitions (`fallback_to_generic=true`). That answer is
// useful — it is a price for something like this car — and it is not the same
// fact as a price for THIS car. The change order (§2) draws the line: a
// generic fallback is never exact vehicle verification.
//
// So identity resolution is a declared level, highest first, and every claim
// that depends on exactness asks the level rather than the presence of data.
// The levels never mix: a response is one of these, and a GENERIC_CANDIDATE
// answer cannot be promoted by having a VIN attached to it.

export const IDENTITY_MATCH_LEVELS = [
  "EXACT_VIN",
  "EXACT_BUILD",
  "YMMT",
  "YMM",
  "GENERIC_CANDIDATE",
  "UNKNOWN",
] as const;

export type IdentityMatchLevel = (typeof IDENTITY_MATCH_LEVELS)[number];

const RANK: Record<IdentityMatchLevel, number> = {
  EXACT_VIN: 0, EXACT_BUILD: 1, YMMT: 2, YMM: 3, GENERIC_CANDIDATE: 4, UNKNOWN: 5,
};

export const isIdentityMatchLevel = (v: unknown): v is IdentityMatchLevel =>
  typeof v === "string" && (IDENTITY_MATCH_LEVELS as readonly string[]).includes(v);

/** The two levels that describe THIS vehicle rather than vehicles like it. */
export const EXACT_LEVELS: IdentityMatchLevel[] = ["EXACT_VIN", "EXACT_BUILD"];

export const isExactIdentity = (level: IdentityMatchLevel): boolean => EXACT_LEVELS.includes(level);

/**
 * Claims that require exact identity. Each is a public assertion about the
 * subject vehicle; none may rest on a generic, YMMT or YMM match.
 */
export const EXACT_ONLY_CLAIMS = [
  "factory_verified",
  "exact_configuration",
  "exact_installed_equipment",
  "exact_trim_version_identity",
  "exact_msrp",
  "vehicle_score_evidence",
] as const;

export type ExactOnlyClaim = (typeof EXACT_ONLY_CLAIMS)[number];

/** May this claim be made at this identity level. Exact claims need exact identity; nothing is claimable at UNKNOWN. */
export function mayClaim(claim: ExactOnlyClaim | "market_context" | "price_estimate", level: IdentityMatchLevel): boolean {
  if (level === "UNKNOWN") return false;
  if ((EXACT_ONLY_CLAIMS as readonly string[]).includes(claim)) return isExactIdentity(level);
  return true;
}

/** Data Confidence ceiling implied by how the vehicle was identified. */
export type IdentityConfidenceCeiling = "high" | "moderate" | "limited" | "none";

export function identityConfidenceCeiling(level: IdentityMatchLevel): IdentityConfidenceCeiling {
  switch (level) {
    case "EXACT_VIN":
    case "EXACT_BUILD":
      return "high";
    case "YMMT":
      return "moderate";
    case "YMM":
    case "GENERIC_CANDIDATE":
      return "limited";
    default:
      return "none";
  }
}

export interface IdentityResolution {
  level: IdentityMatchLevel;
  /** True when the provider was asked to fall back and did. */
  fallbackUsed: boolean;
  /** The provider's own tier label, when it sends one; never interpreted. */
  providerTier: string | null;
  /** Candidate generic definitions the provider returned, kept verbatim. */
  candidates: unknown[];
  /** Why exact identity was not reached, for internal diagnostics. */
  diagnostics: string[];
}

/**
 * Read the identity level off a MarketCheck Price response.
 *
 * The contract for the generic fallback has not been read from the live docs
 * (ENTITLEMENT_AND_TERMS_REPORT.md §4), so the reader is deliberately
 * conservative: an answer is EXACT_VIN only when the request did NOT ask for
 * a fallback and the body carries no generic marker; any generic marker, any
 * candidate list, or a fallback that was requested and not denied resolves to
 * GENERIC_CANDIDATE; a body that says nothing either way after a fallback
 * request is UNKNOWN rather than exact.
 */
export function readIdentityResolution(args: { body: unknown; fallbackRequested: boolean }): IdentityResolution {
  const body = (args.body && typeof args.body === "object" && !Array.isArray(args.body)
    ? args.body : {}) as Record<string, unknown>;
  const diagnostics: string[] = [];

  const genericMarkers = [body.is_generic, body.generic, body.fallback_used, body.used_generic_fallback];
  const genericFlag = genericMarkers.some((v) => v === true || v === "true" || v === 1);
  const candidates = Array.isArray(body.candidates) ? body.candidates
    : Array.isArray(body.generic_candidates) ? body.generic_candidates
    : Array.isArray(body.generic_vehicles) ? body.generic_vehicles
    : [];
  const providerTier = typeof body.match_tier === "string" ? body.match_tier
    : typeof body.match_level === "string" ? body.match_level
    : typeof body.decode_mode === "string" ? body.decode_mode
    : null;
  const exactDenied = genericMarkers.some((v) => v === false || v === "false" || v === 0);

  if (genericFlag || candidates.length > 0) {
    diagnostics.push(genericFlag ? "provider_marked_generic" : "provider_returned_candidates");
    if (!args.fallbackRequested) diagnostics.push("generic_answer_without_fallback_request");
    return { level: "GENERIC_CANDIDATE", fallbackUsed: true, providerTier, candidates, diagnostics };
  }
  if (args.fallbackRequested) {
    if (exactDenied) {
      diagnostics.push("fallback_requested_provider_says_exact");
      return { level: "EXACT_VIN", fallbackUsed: false, providerTier, candidates: [], diagnostics };
    }
    diagnostics.push("fallback_requested_no_marker_in_body");
    return { level: "UNKNOWN", fallbackUsed: false, providerTier, candidates: [], diagnostics };
  }
  return { level: "EXACT_VIN", fallbackUsed: false, providerTier, candidates: [], diagnostics };
}

/**
 * Merge a newly resolved fact over a held one by identity level.
 *
 * A generic or broader-cohort answer never overwrites a fact that came from
 * an exact VIN resolution. It may fill a gap. Equal levels: the newer wins,
 * which is what a refresh is for.
 */
export function mergeByIdentity<T>(
  held: { value: T; level: IdentityMatchLevel } | null,
  incoming: { value: T; level: IdentityMatchLevel } | null,
): { value: T; level: IdentityMatchLevel; reason: string } | null {
  if (!incoming) return held ? { ...held, reason: "held_only" } : null;
  if (!held) return { ...incoming, reason: "incoming_fills_gap" };
  if (RANK[incoming.level] > RANK[held.level]) return { ...held, reason: "incoming_less_exact_than_held" };
  return { ...incoming, reason: RANK[incoming.level] < RANK[held.level] ? "incoming_more_exact" : "same_level_newer_wins" };
}
