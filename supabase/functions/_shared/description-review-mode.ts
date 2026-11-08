// The automation mode that governs a vehicle's description publication.
// One resolver for the server (decideEligibility) and for the Administration
// screens, so the rule an administrator reads is the rule that is enforced.
// The SQL twin is description_publish_allowed: a class entry wins, otherwise
// the default mode, otherwise EXCEPTION_REVIEW. The class key is the
// lower-cased listing condition exactly as stored.

export const REVIEW_MODES = ["AUTO_PUBLISH_CLEAN", "EXCEPTION_REVIEW", "REQUIRE_APPROVAL_ALL", "DRAFT_ONLY"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const DEFAULT_REVIEW_MODE: ReviewMode = "EXCEPTION_REVIEW";

export interface ReviewModeSettings {
  review_mode?: string | null;
  review_mode_by_class?: Record<string, string | null | undefined> | null;
}

export interface ResolvedReviewMode {
  mode: string;
  source: "class" | "default" | "fallback";
}

export function resolveReviewMode(settings: ReviewModeSettings | null | undefined, condition: string | null | undefined): ResolvedReviewMode {
  const cls = String(condition || "used").toLowerCase();
  const byClass = (settings?.review_mode_by_class || {}) as Record<string, string | null | undefined>;
  if (byClass[cls]) return { mode: byClass[cls] as string, source: "class" };
  if (settings?.review_mode) return { mode: settings.review_mode, source: "default" };
  return { mode: DEFAULT_REVIEW_MODE, source: "fallback" };
}
