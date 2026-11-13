// GENERATED — do not edit.
// Mirror of src/lib/intelligence/marketPass/vehicleConfidence.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Vehicle Confidence (PROPOSED) ──────────────────────────────────────────
//
// What the evidence on record says about the vehicle itself. The input type
// has no price, market or demand field, so nothing about the deal can move
// it. An adverse finding sets the adverse state, and nothing else in the
// input can lift it. A conflict sets review. Thin evidence is qualified,
// never a favorable default.

import { buildBuyerRecommendation, evaluateHardGates } from "../buyerRecommendation.ts";
import { buildVehicleScore, type DocumentationFacts } from "../vehicleScore.ts";
import { TITLE_EVIDENCE_GAP_REASONS, titleReviewIsEvidenceGapOnly } from "../titleOdometer.ts";
import { isExactIdentity } from "../../market/identityMatch.ts";
import type {
  ConditionSummary, DataConfidenceResult, IdentitySummary, ProvenanceSummary, RecallSummary, TitleOdometerSummary,
} from "../contracts.ts";
import {
  NEW_VEHICLE_CONFIDENCE_SEGMENTS, USED_VEHICLE_CONFIDENCE_SEGMENTS, VEHICLE_CONFIDENCE_VERSION,
  type EvidenceProvenance, type VehicleConfidenceAssessment, type VehicleType,
} from "./contracts.ts";
import type { FeedHistoryFlags } from "./rowEvidence.ts";

/** Everything the indicator may read. Deliberately no price, value, demand or page-view field. */
export interface VehicleConfidenceInput {
  vehicleType: VehicleType;
  identity: IdentitySummary;
  titleOdometer: TitleOdometerSummary;
  feedFlags: FeedHistoryFlags;
  condition: ConditionSummary;
  provenance: ProvenanceSummary;
  recall: RecallSummary;
  documentation: DocumentationFacts;
  dataConfidence: DataConfidenceResult;
  evidence: EvidenceProvenance[];
}

/** Used segment from an eligible Vehicle Score; same lower bounds as the score labels. */
export const USED_SCORE_SEGMENT_FLOORS = [
  { min: 90, index: 4 }, { min: 80, index: 3 }, { min: 70, index: 2 }, { min: 60, index: 1 }, { min: 0, index: 0 },
] as const;

export const usedSegmentForScore = (score: number): number =>
  (USED_SCORE_SEGMENT_FLOORS.find((b) => score >= b.min) ?? USED_SCORE_SEGMENT_FLOORS[4]).index;


const recallAnswered = (r: RecallSummary) => ["OPEN", "NO_OPEN", "CLOSED_CAMPAIGN_ONLY", "OEM_SERVICE_CAMPAIGN"].includes(r.vinState);

interface Collected { adverse: string[]; review: string[]; gaps: string[]; findings: string[] }

function collect(input: VehicleConfidenceInput): Collected {
  const { titleOdometer: t, recall: r, condition: c, feedFlags: f, identity } = input;
  const out: Collected = { adverse: [], review: [], gaps: [], findings: [] };

  if (r.doNotDrive) out.adverse.push("A recall campaign on record carries do-not-drive language.");
  if (r.vinState === "OPEN" || (r.openCount ?? 0) > 0) out.adverse.push(r.publicStatement);
  if (c.findings.some((x) => x.severity === "major" && !x.resolved)) out.adverse.push("A major condition finding is still open.");

  if (input.vehicleType === "used") {
    if (t.state === "ADVERSE") out.adverse.push(t.publicStatement);
    if (f.titleBrand) out.adverse.push(`The listing feed reports a title brand (${f.titleBrand}); this has not been verified against NMVTIS.`);
    if (f.accidentCount != null && f.accidentCount > 0) {
      out.adverse.push(`The listing feed reports ${f.accidentCount} accident${f.accidentCount === 1 ? "" : "s"}; this has not been verified.`);
    }
    if (t.odometerStatus === "conflict") out.review.push(t.publicStatement);
    if (f.carfaxCleanTitleFalse && !f.titleBrand) out.review.push("The listing feed does not confirm a clean title; this has not been verified against NMVTIS.");
    if (t.state === "NOT_VERIFIED") out.gaps.push("Title history has not been verified against NMVTIS.");
    else if (titleReviewIsEvidenceGapOnly(t)) {
      const gap = t.reasons.filter((x) => (TITLE_EVIDENCE_GAP_REASONS as readonly string[]).includes(x));
      if (gap.includes("report_older_than_ttl")) out.gaps.push("The title check on record is out of date.");
      if (gap.includes("report_missing_odometer")) out.gaps.push("The title check on record carries no odometer reading.");
      if (gap.includes("report_incomplete")) out.gaps.push("The title check on record is incomplete.");
    } else if (t.state === "REVIEW_REQUIRED" && t.odometerStatus !== "conflict") out.review.push(t.publicStatement); else if (t.state === "VERIFIED_NO_ADVERSE_REPORTED") out.findings.push(t.publicStatement);
    if (c.state !== "verified") out.gaps.push("Current condition has not been verified by an inspection.");
  }

  for (const conflict of input.dataConfidence.conflicts) {
    if (conflict === "odometer_conflict" || conflict === "odometer_rollback_indicated") continue;
    out.review.push(CONFLICT_SENTENCES[conflict] ?? `Sources disagree: ${conflict.replace(/_/g, " ")}.`);
  }
  if (!r.doNotDrive && r.vinState !== "OPEN") {
    if (recallAnswered(r) && r.publicState !== "stale") out.findings.push(r.publicStatement);
    else out.gaps.push(r.publicStatement);
  }
  if (identity.factoryVerified) out.findings.push("Factory build record matched to this VIN.");
  else if (!isExactIdentity(identity.matchLevel)) out.gaps.push("The exact factory build for this VIN has not been verified.");
  else out.gaps.push("The VIN decode is not from factory build data.");
  return out;
}

const CONFLICT_SENTENCES: Record<string, string> = {
  trim_decode_conflict: "The advertised trim does not match the factory build record for this VIN.",
};

export function buildVehicleConfidence(input: VehicleConfidenceInput): VehicleConfidenceAssessment {
  const used = input.vehicleType === "used";
  const segments = used ? USED_VEHICLE_CONFIDENCE_SEGMENTS : NEW_VEHICLE_CONFIDENCE_SEGMENTS;
  const score = buildVehicleScore({
    vehicleType: input.vehicleType, identity: input.identity, titleOdometer: input.titleOdometer,
    condition: input.condition, provenance: input.provenance, recall: input.recall, documentation: input.documentation,
  });
  const gateInput = {
    vehicleType: input.vehicleType, identityLevel: input.identity.matchLevel, vehicleScore: score,
    dataConfidence: input.dataConfidence, titleOdometer: input.titleOdometer, condition: input.condition,
    provenance: input.provenance, recall: input.recall,
    // Price is withheld on purpose: the deal has no say in this indicator.
    dealRating: null,
  };
  const gates = used ? evaluateHardGates(gateInput) : [];
  const rec = used ? buildBuyerRecommendation(gateInput) : null;
  const c = collect(input);
  const reasons: string[] = [...score.reasons, ...gates.map((g) => `hard_gate:${g}`)];

  let state: VehicleConfidenceAssessment["state"];
  let segmentIndex: number | null = null;
  let label: string;
  let explanation: string;

  if (c.adverse.length) {
    state = "adverse";
    segmentIndex = 0;
    label = segments[0].label;
    explanation = `${c.adverse[0]} Review the history before relying on any other information about this vehicle.`;
  } else if (c.review.length) {
    state = "review";
    segmentIndex = 1;
    label = segments[1].label;
    explanation = `${c.review[0]} This needs to be resolved before the vehicle evidence can be rated.`;
  } else if (used) {
    const eligible = score.publication === "eligible" && score.score != null;
    const dc = input.dataConfidence.level;
    if (eligible && dc !== "limited" && isExactIdentity(input.identity.matchLevel)) {
      state = "assessed";
      segmentIndex = usedSegmentForScore(score.score as number);
      if (dc === "moderate" && segmentIndex > 3) { segmentIndex = 3; reasons.push("data_confidence_moderate_caps_segment_3"); }
      label = segments[segmentIndex].label;
      explanation = `Based on verified title, condition and recall evidence for this VIN. ${c.findings.slice(0, 2).join(" ")}`.trim();
    } else if (score.assessedWeightPct > 0 || recallAnswered(input.recall) || input.identity.factoryVerified) {
      state = "qualified";
      label = "Limited vehicle evidence";
      explanation = `Some vehicle evidence is on record, but not enough to rate it. ${c.gaps[0] ?? ""}`.trim();
    } else {
      state = "unavailable";
      label = "Vehicle evidence not available";
      explanation = "No verified title, condition or recall evidence is on record for this vehicle yet.";
    }
  } else {
    const recallClear = recallAnswered(input.recall) && input.recall.publicState === "verified";
    if (input.identity.factoryVerified && recallClear) {
      state = "assessed";
      segmentIndex = 2;
      label = segments[2].label;
      explanation = `The factory build record matches this VIN. ${input.recall.publicStatement}`;
    } else if (input.identity.factoryVerified || isExactIdentity(input.identity.matchLevel) || recallAnswered(input.recall)) {
      state = "qualified";
      label = "Partially verified";
      explanation = `Some factory evidence is on record, but not all of it is verified. ${c.gaps[0] ?? ""}`.trim();
    } else {
      state = "unavailable";
      label = "Vehicle evidence not available";
      explanation = "No factory build record or VIN recall answer is on record for this vehicle yet.";
    }
  }

  return {
    indicator: "vehicle_confidence",
    version: VEHICLE_CONFIDENCE_VERSION,
    vehicleType: input.vehicleType,
    state,
    label,
    explanation,
    segments,
    segmentIndex,
    findings: [...c.adverse, ...c.review, ...c.findings],
    gaps: c.gaps,
    reasons,
    evidence: input.evidence.filter((e) => ["title", "recall", "factory_decode"].includes(e.key)),
    internal: {
      vehicleScore: score.score,
      vehicleScoreVersion: score.version,
      publication: score.publication,
      hardGates: gates,
      recommendationState: rec?.state ?? null,
      recommendationVersion: rec?.version ?? null,
    },
  };
}
