// ── Buyer Recommendation ───────────────────────────────────────────────────
//
// An explainable synthesis for USED vehicles (master build section 33).
// Hard gates run first: an unresolved title brand, an odometer conflict, a
// non-exact identity, an open safety recall, do-not-drive language, a major
// open condition finding or a material conflict forbids any favorable state
// and lands on REVIEW_BEFORE_PURCHASE with the gates named. With no gate, a
// null score or limited Data Confidence is NOT_ENOUGH_VERIFIED_INFORMATION.
// Only then does the score band set a ceiling that confidence, title,
// condition and price can lower and nothing can raise: a good vehicle with a
// bad deal is CONSIDER with the price reason, and a weak vehicle with a great
// deal never rises above CONSIDER.

import { isExactIdentity, type IdentityMatchLevel } from "../market/identityMatch.ts";
import type {
  BuyerRecommendationResult, ConditionSummary, DataConfidenceResult, DealRatingResult, HardGate,
  ProvenanceSummary, RecallSummary, RecommendationState, TitleOdometerSummary, VehicleScoreResult,
} from "./contracts.ts";

export const BUYER_RECOMMENDATION_VERSION = "buyer-recommendation-v1.0.0-shadow";

export interface RecommendationBands {
  highlyRecommendedMinScore: number;
  recommendedMinScore: number;
  considerMinScore: number;
}

/** Starting calibration; configuration, not UI constants. */
export const DEFAULT_RECOMMENDATION_BANDS: RecommendationBands = {
  highlyRecommendedMinScore: 85,
  recommendedMinScore: 70,
  considerMinScore: 55,
};

export interface BuyerRecommendationInput {
  vehicleType?: "new" | "used";
  identityLevel: IdentityMatchLevel;
  vehicleScore: VehicleScoreResult | null;
  dataConfidence: DataConfidenceResult | null;
  titleOdometer: TitleOdometerSummary | null;
  condition: ConditionSummary | null;
  provenance: ProvenanceSummary | null;
  recall: RecallSummary | null;
  dealRating: DealRatingResult | null;
  /** Unresolved contradictions between sources, beyond what Data Confidence already lists. */
  materialConflicts?: string[];
}

export interface BuyerRecommendationOptions {
  bands?: Partial<RecommendationBands>;
  /** HIGHLY_RECOMMENDED needs high Data Confidence; moderate caps at RECOMMENDED. */
  requireHighConfidenceForHighly?: boolean;
  /** Where an unverified title caps the state. */
  titleNotVerifiedCap?: RecommendationState;
  /** Where an unverified condition caps the state. */
  conditionNotVerifiedCap?: RecommendationState;
}

const ORDER: RecommendationState[] = [
  "HIGHLY_RECOMMENDED", "RECOMMENDED", "CONSIDER", "REVIEW_BEFORE_PURCHASE", "NOT_ENOUGH_VERIFIED_INFORMATION",
];
const rank = (s: RecommendationState) => ORDER.indexOf(s);
/** The less favorable of two states. */
const lower = (a: RecommendationState, b: RecommendationState): RecommendationState => (rank(a) >= rank(b) ? a : b);

export const HARD_GATE_REASONS: Record<HardGate, string> = {
  unresolved_title_brand: "Title history needs resolution before this vehicle can be recommended",
  odometer_conflict: "Odometer readings conflict and need resolution",
  identity_not_exact: "The vehicle's exact build could not be verified",
  open_safety_recall: "An open safety recall is reported on this VIN",
  do_not_drive: "A do-not-drive or stop-sale campaign is reported",
  major_condition_issue: "A major condition finding is still open",
  material_conflict: "Sources disagree on a material fact",
};

export function evaluateHardGates(input: BuyerRecommendationInput): HardGate[] {
  const gates: HardGate[] = [];
  const t = input.titleOdometer;
  if (t && (t.state === "ADVERSE" || t.state === "REVIEW_REQUIRED")) gates.push("unresolved_title_brand");
  if (t && (t.odometerStatus === "conflict" || t.odometerStatus === "rollback_indicated")) gates.push("odometer_conflict");
  if (!isExactIdentity(input.identityLevel)) gates.push("identity_not_exact");
  const r = input.recall;
  if (r && (r.vinState === "OPEN" || (r.openCount ?? 0) > 0)) gates.push("open_safety_recall");
  if (r?.doNotDrive) gates.push("do_not_drive");
  const c = input.condition;
  if (c && c.findings.some((f) => f.severity === "major" && !f.resolved)) gates.push("major_condition_issue");
  const conflicts = [...(input.materialConflicts ?? []), ...(input.dataConfidence?.conflicts ?? [])];
  if (conflicts.length) gates.push("material_conflict");
  return gates;
}

const scoreBand = (score: number, b: RecommendationBands): RecommendationState => {
  if (score >= b.highlyRecommendedMinScore) return "HIGHLY_RECOMMENDED";
  if (score >= b.recommendedMinScore) return "RECOMMENDED";
  if (score >= b.considerMinScore) return "CONSIDER";
  return "REVIEW_BEFORE_PURCHASE";
};

const pct = (n: number) => `${Math.abs(n)}%`;

export function buildBuyerRecommendation(
  input: BuyerRecommendationInput,
  options: BuyerRecommendationOptions = {},
): BuyerRecommendationResult {
  const bands: RecommendationBands = { ...DEFAULT_RECOMMENDATION_BANDS, ...(options.bands ?? {}) };
  const requireHigh = options.requireHighConfidenceForHighly ?? true;
  const titleCap = options.titleNotVerifiedCap ?? "CONSIDER";
  const conditionCap = options.conditionNotVerifiedCap ?? "CONSIDER";
  const inputsUsed: string[] = ["identity"];
  const reasons: string[] = [];

  if (input.vehicleType === "new") {
    return {
      version: BUYER_RECOMMENDATION_VERSION,
      state: "NOT_ENOUGH_VERIFIED_INFORMATION",
      reasons: ["New vehicles receive verified states, not a used-vehicle recommendation"],
      hardGates: [],
      inputsUsed,
      applicable: false,
    };
  }

  const consulted: Array<[string, unknown]> = [
    ["vehicle_score", input.vehicleScore], ["data_confidence", input.dataConfidence],
    ["title_odometer", input.titleOdometer], ["condition", input.condition], ["provenance", input.provenance],
    ["recall", input.recall], ["deal_rating", input.dealRating],
  ];
  for (const [key, present] of consulted) if (present) inputsUsed.push(key);

  const gates = evaluateHardGates(input);
  if (gates.length) {
    return {
      version: BUYER_RECOMMENDATION_VERSION,
      state: "REVIEW_BEFORE_PURCHASE",
      reasons: gates.map((g) => HARD_GATE_REASONS[g]),
      hardGates: gates,
      inputsUsed,
      applicable: true,
    };
  }

  // Only a score that meets the public evidence minimum can carry a
  // recommendation; a provisional partial-file score is internal.
  const vs = input.vehicleScore;
  const score = vs?.applicable && vs.publication === "eligible" ? vs.score : null;
  const confidence = input.dataConfidence?.level ?? null;
  if (score == null || confidence == null || confidence === "limited") {
    const r: string[] = [];
    if (score == null && vs?.applicable && vs.publication === "provisional") r.push("The Vehicle Score is provisional: required evidence is missing");
    else if (score == null) r.push("The Vehicle Score could not be assessed from verified evidence");
    if (confidence == null) r.push("Data Confidence has not been assessed");
    else if (confidence === "limited") r.push("Data Confidence is limited");
    for (const reason of input.dataConfidence?.reasons ?? []) r.push(reason);
    return {
      version: BUYER_RECOMMENDATION_VERSION,
      state: "NOT_ENOUGH_VERIFIED_INFORMATION",
      reasons: r,
      hardGates: [],
      inputsUsed,
      applicable: true,
    };
  }

  let state = scoreBand(score, bands);
  reasons.push(`Vehicle Score ${score}${input.vehicleScore?.label ? `, ${input.vehicleScore.label}` : ""}`);
  reasons.push(`Data Confidence ${confidence}`);

  if (requireHigh && confidence === "moderate" && state === "HIGHLY_RECOMMENDED") {
    state = "RECOMMENDED";
    reasons.push("Data Confidence is moderate, so the recommendation stops at Recommended");
  }

  const t = input.titleOdometer;
  if (!t || t.state === "NOT_VERIFIED") {
    state = lower(state, titleCap);
    reasons.push("Title and odometer have not been verified against NMVTIS");
  } else {
    reasons.push(t.publicStatement || "No NMVTIS title brands reported");
  }

  const c = input.condition;
  if (!c || c.state === "unknown" || c.state === "self_reported") {
    state = lower(state, conditionCap);
    reasons.push("Current condition has not been verified by an inspection");
  } else if (c.state === "verified") {
    reasons.push(c.inspectionDate ? `Condition verified by inspection on ${c.inspectionDate}` : "Condition verified by inspection");
  } else {
    reasons.push("Condition partially verified");
  }
  if (c && c.findings.some((f) => f.severity === "moderate" && !f.resolved)) {
    state = lower(state, "CONSIDER");
    reasons.push("A moderate condition finding is still open");
  }

  const p = input.provenance;
  if (p) {
    if (p.designation === "known_since_new") reasons.push("Dealer has known this vehicle since new");
    else if (p.designation === "serviced_here") reasons.push("Dealer has serviced this vehicle");
    else if (p.designation === "direct_trade") reasons.push("Direct customer trade");
    else if (p.designation === "dealer_buyback") reasons.push("Dealer buyback");
    else if (p.designation === "unknown") reasons.push("Dealer provenance is not documented");
  }

  const d = input.dealRating;
  if (!d || !d.applicable || d.label === "unavailable") {
    state = lower(state, "RECOMMENDED");
    reasons.push("Price position against market value is not available");
  } else if (d.label === "well_above_market") {
    state = lower(state, "CONSIDER");
    reasons.push(`Price is well above estimated market value${d.deltaPct != null ? ` by ${pct(d.deltaPct)}` : ""}`);
  } else if (d.label === "above_market") {
    state = lower(state, "RECOMMENDED");
    reasons.push(`Price is above estimated market value${d.deltaPct != null ? ` by ${pct(d.deltaPct)}` : ""}`);
  } else if (d.label === "great_value" || d.label === "good_value") {
    reasons.push(`Price is below estimated market value${d.deltaPct != null ? ` by ${pct(d.deltaPct)}` : ""}`);
  } else {
    reasons.push("Price is in line with estimated market value");
  }

  const r = input.recall;
  if (r?.vinState === "NO_OPEN") reasons.push("No open VIN recall reported");
  else if (r && r.vinState !== "CLOSED_CAMPAIGN_ONLY") reasons.push("VIN recall status is not verified");

  return {
    version: BUYER_RECOMMENDATION_VERSION,
    state,
    reasons,
    hardGates: [],
    inputsUsed,
    applicable: true,
  };
}
