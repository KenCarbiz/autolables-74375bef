// ── Last-good value and transient failure ─────────────────────────────────
//
// A provider that times out has told us nothing. It has not told us the car is
// worth nothing, and it has not told us yesterday's answer was wrong.
//
// The rule this module exists to enforce: a FAILED ATTEMPT never overwrites a
// still-valid answer, and it is never presented as a successful one. Both
// halves matter. Dropping to "unavailable" on a 429 makes the product flicker
// and teaches dealers to ignore it; silently showing yesterday's number as
// today's check is the recall defect wearing a different hat.
//
//   0–7 days    fresh          — use it, red is reachable
//   8–14 days   stale          — keep it as limited context, warn, never red
//   over 14     expired        — nothing is claimed until a refresh succeeds
//
// Three things override the age rules entirely, because they mean the stored
// answer is about a different car or a different price: a subject/spec
// mismatch, a certification mismatch, and an invalid price basis.

export const PROVIDER_FRESH_DAYS = 7;
export const PROVIDER_HARD_EXPIRY_DAYS = 14;

export type FreshnessTier = "fresh" | "stale" | "expired" | "none";

/** Why a refresh did not produce a new answer. */
export type ProviderAttemptOutcome =
  | "succeeded"
  | "timeout"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "not_attempted";

export const TRANSIENT_OUTCOMES: ProviderAttemptOutcome[] = [
  "timeout", "rate_limited", "server_error", "network_error",
];

export const isTransientFailure = (o: ProviderAttemptOutcome): boolean =>
  TRANSIENT_OUTCOMES.includes(o);

export interface FreshnessInput {
  /** Age of the stored provider answer, in days. Null when there is none. */
  lastGoodAgeDays: number | null;
  /** What the most recent refresh attempt did. */
  attemptOutcome: ProviderAttemptOutcome;
  /** Hard overrides. Any of these voids the stored answer whatever its age. */
  certificationMismatch: boolean;
  subjectMismatch: boolean;
  priceBasisInvalid: boolean;
}

export interface FreshnessDecision {
  tier: FreshnessTier;
  /** May the stored answer be used to say anything at all? */
  useLastGood: boolean;
  /** May a red verdict be reached from it? */
  allowRed: boolean;
  /** Should the surface disclose that the market check is ageing? */
  showStaleWarning: boolean;
  /** Should the writer try to refresh, budget permitting? */
  refreshRecommended: boolean;
  reasons: string[];
}

export function resolveProviderFreshness(input: FreshnessInput): FreshnessDecision {
  const reasons: string[] = [];

  // Every attempt is auditable, including the ones that failed.
  if (isTransientFailure(input.attemptOutcome)) {
    reasons.push(`provider_attempt_${input.attemptOutcome}`);
    reasons.push("failed_attempt_did_not_replace_last_good");
  }

  // Hard overrides first. These are not staleness; the stored answer is about
  // something other than this vehicle at this price.
  if (input.certificationMismatch) reasons.push("certification_mismatch_voids_last_good");
  if (input.subjectMismatch) reasons.push("subject_mismatch_voids_last_good");
  if (input.priceBasisInvalid) reasons.push("price_basis_invalid_voids_last_good");
  if (input.certificationMismatch || input.subjectMismatch || input.priceBasisInvalid) {
    return {
      tier: "none", useLastGood: false, allowRed: false,
      showStaleWarning: false, refreshRecommended: true, reasons,
    };
  }

  const age = input.lastGoodAgeDays;
  if (age == null) {
    reasons.push("no_stored_provider_answer");
    return { tier: "none", useLastGood: false, allowRed: false, showStaleWarning: false, refreshRecommended: true, reasons };
  }

  if (age <= PROVIDER_FRESH_DAYS) {
    return {
      tier: "fresh", useLastGood: true, allowRed: true, showStaleWarning: false,
      refreshRecommended: false, reasons,
    };
  }

  if (age <= PROVIDER_HARD_EXPIRY_DAYS) {
    reasons.push("provider_answer_older_than_seven_days");
    return {
      tier: "stale", useLastGood: true, allowRed: false, showStaleWarning: true,
      refreshRecommended: true, reasons,
    };
  }

  reasons.push("provider_answer_expired");
  return {
    tier: "expired", useLastGood: false, allowRed: false, showStaleWarning: true,
    refreshRecommended: true, reasons,
  };
}
