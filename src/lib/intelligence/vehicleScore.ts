// ── Used Vehicle Score ─────────────────────────────────────────────────────
//
// Master build section 30. Four domains, starting weights 35/30/20/15, each
// scored from its own evidence and nothing else. The score describes the
// vehicle; it has no input for the market, the asking price, demand or a deal
// rating, so none of them can move it. Absence of evidence is not a finding:
// a domain nobody has assessed is null and drops out of the weighted total,
// and Data Confidence (dataConfidence.ts) is where that absence shows.
//
// Only an actual adverse finding lowers a domain: a title brand, an odometer
// conflict, an open recall, a major condition item. New vehicles get no used
// score, and a vehicle whose identity is not exact cannot carry one, because
// vehicle_score_evidence is an exact-only claim.

import { mayClaim } from "../market/identityMatch.ts";
import {
  SCORE_DOMAINS, SCORE_LABELS, SCORE_WEIGHTS,
  type ConditionSummary, type IdentitySummary, type ProvenanceSummary, type RecallSummary,
  type ScoreDomainKey, type ScoreDomainResult, type ScoreLabel, type TitleOdometerSummary, type VehicleScoreResult,
} from "./contracts.ts";

export const VEHICLE_SCORE_VERSION = "vehicle-score-v1.0.0-shadow";

export interface DocumentationFacts {
  serviceRecordCount: number | null;
  inspectionEvidenceOnFile: boolean | null;
  warrantyDocumented: boolean | null;
  windowStickerOnFile: boolean | null;
}

/** The whole input. There is deliberately no price, market or demand field. */
export interface VehicleScoreInput {
  vehicleType: "new" | "used";
  identity: IdentitySummary;
  titleOdometer: TitleOdometerSummary;
  condition: ConditionSummary;
  provenance: ProvenanceSummary;
  recall: RecallSummary;
  documentation: DocumentationFacts;
}

/** Lower bound of each label band, inclusive. Below `fair` is Caution. */
export interface ScoreLabelBands { outstanding: number; excellent: number; good: number; fair: number }

export const DEFAULT_SCORE_LABEL_BANDS: ScoreLabelBands = { outstanding: 90, excellent: 80, good: 70, fair: 60 };

/** Starting deductions and ceilings. Calibrate before public lock; every entry is an adverse finding or a weaker authority, never an absence. */
export const SCORE_DEDUCTIONS = {
  integrity: {
    junkSalvageTotalLoss: 70,
    titleBrand: 35,
    titleBrandCap: 70,
    odometerRollback: 60,
    odometerConflict: 30,
    reviewRequired: 15,
  },
  condition: {
    majorFinding: 35, majorCap: 70,
    moderateFinding: 15, moderateCap: 45,
    minorFinding: 5, minorCap: 20,
    openItem: 8, openItemCap: 40,
    tireWorn32nds: 4, tireWorn: 15,
    tireCritical32nds: 3, tireCritical: 25,
    brakeWornMm: 3, brakeWorn: 15,
    brakeCriticalMm: 2, brakeCritical: 25,
    partialInspectionCeiling: 85,
    selfReportCeiling: 70,
  },
  provenance: {
    base: {
      known_since_new: 100, serviced_here: 85, direct_trade: 85,
      dealer_buyback: 75, previous_dealer_sale: 70, first_seen: 55,
    } as Record<string, number>,
    servicedHereOnly: 80,
    soldHereOnly: 75,
  },
  documentation_safety: {
    openRecall: 40, openRecallCap: 70,
    doNotDrive: 100,
    oemServiceCampaign: 10,
  },
} as const;

export interface VehicleScoreOptions {
  weights?: Partial<Record<ScoreDomainKey, number>>;
  labelBands?: Partial<ScoreLabelBands>;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export function scoreLabel(score: number | null, bands: ScoreLabelBands = DEFAULT_SCORE_LABEL_BANDS): ScoreLabel | null {
  if (score == null) return null;
  if (score >= bands.outstanding) return SCORE_LABELS[0];
  if (score >= bands.excellent) return SCORE_LABELS[1];
  if (score >= bands.good) return SCORE_LABELS[2];
  if (score >= bands.fair) return SCORE_LABELS[3];
  return SCORE_LABELS[4];
}

interface DomainDraft { score: number | null; evidence: string[]; adverse: string[]; missing: string[] }

const draft = (): DomainDraft => ({ score: null, evidence: [], adverse: [], missing: [] });

function integrityDomain(identity: IdentitySummary, title: TitleOdometerSummary): DomainDraft {
  const d = draft();
  const r = SCORE_DEDUCTIONS.integrity;
  let deduction = 0;
  d.evidence.push(`identity_${identity.matchLevel.toLowerCase()}`);
  if (identity.decodeSource === "neovin") d.evidence.push("factory_build_decoded");

  if (title.entitlementBlocked || title.providerFailed || title.state === "NOT_VERIFIED") {
    d.missing.push("title_not_verified");
  } else {
    const jstl = title.junkSalvageTotalLossReported;
    const brands = title.titleBrandsReported.filter((b) => !jstl.includes(b));
    if (jstl.length) {
      deduction += r.junkSalvageTotalLoss;
      d.adverse.push(...jstl.map((b) => `junk_salvage_total_loss:${b}`));
    }
    if (brands.length) {
      deduction += Math.min(r.titleBrandCap, brands.length * r.titleBrand);
      d.adverse.push(...brands.map((b) => `title_brand:${b}`));
    }
    if (title.state === "VERIFIED_NO_ADVERSE_REPORTED") d.evidence.push("title_no_adverse_reported");
    if (title.state === "REVIEW_REQUIRED") {
      deduction += r.reviewRequired;
      d.adverse.push("title_review_required");
    }
  }

  switch (title.odometerStatus) {
    case "consistent": d.evidence.push("odometer_consistent"); break;
    case "conflict": deduction += r.odometerConflict; d.adverse.push("odometer_conflict"); break;
    case "rollback_indicated": deduction += r.odometerRollback; d.adverse.push("odometer_rollback_indicated"); break;
    default: d.missing.push("odometer_not_checked");
  }

  d.score = clamp(100 - deduction);
  return d;
}

function conditionDomain(c: ConditionSummary): DomainDraft {
  const d = draft();
  const r = SCORE_DEDUCTIONS.condition;
  if (c.state === "unknown" || c.source === "none") {
    d.missing.push("no_inspection_on_file");
    return d;
  }
  d.evidence.push(`inspection_${c.source}${c.inspectionDate ? `:${c.inspectionDate}` : ""}`);
  let deduction = 0;
  const open = c.findings.filter((f) => !f.resolved);
  const count = (s: string) => open.filter((f) => f.severity === s).length;
  const major = count("major"), moderate = count("moderate"), minor = count("minor");
  if (major) { deduction += Math.min(r.majorCap, major * r.majorFinding); d.adverse.push(`major_findings_open:${major}`); }
  if (moderate) { deduction += Math.min(r.moderateCap, moderate * r.moderateFinding); d.adverse.push(`moderate_findings_open:${moderate}`); }
  if (minor) { deduction += Math.min(r.minorCap, minor * r.minorFinding); d.adverse.push(`minor_findings_open:${minor}`); }
  if (!open.length && c.openItems != null && c.openItems > 0) {
    deduction += Math.min(r.openItemCap, c.openItems * r.openItem);
    d.adverse.push(`open_items:${c.openItems}`);
  }
  if (c.openItems === 0 && !open.length) d.evidence.push("no_open_items");
  const resolved = c.findings.filter((f) => f.resolved).length;
  if (resolved) d.evidence.push(`findings_resolved:${resolved}`);
  if (c.completedRecon != null && c.completedRecon > 0) d.evidence.push(`recon_completed:${c.completedRecon}`);

  if (c.tires32nds.length) {
    const worst = Math.min(...c.tires32nds);
    if (worst < r.tireCritical32nds) { deduction += r.tireCritical; d.adverse.push(`tire_critical:${worst}/32`); }
    else if (worst < r.tireWorn32nds) { deduction += r.tireWorn; d.adverse.push(`tire_worn:${worst}/32`); }
    else d.evidence.push(`tires_measured:${worst}/32_min`);
  } else d.missing.push("tires_not_measured");
  if (c.brakesMm.length) {
    const worst = Math.min(...c.brakesMm);
    if (worst < r.brakeCriticalMm) { deduction += r.brakeCritical; d.adverse.push(`brake_critical:${worst}mm`); }
    else if (worst < r.brakeWornMm) { deduction += r.brakeWorn; d.adverse.push(`brake_worn:${worst}mm`); }
    else d.evidence.push(`brakes_measured:${worst}mm_min`);
  } else d.missing.push("brakes_not_measured");

  // A weaker authority caps what the domain can say; it is not a finding.
  const ceiling = c.source === "seller_report" || c.state === "self_reported"
    ? r.selfReportCeiling
    : c.state === "partial" ? r.partialInspectionCeiling : 100;
  if (ceiling < 100) d.evidence.push(`authority_ceiling:${ceiling}`);
  d.score = clamp(Math.min(ceiling, 100 - deduction));
  return d;
}

function provenanceDomain(p: ProvenanceSummary): DomainDraft {
  const d = draft();
  const r = SCORE_DEDUCTIONS.provenance;
  let base: number | null = r.base[p.designation] ?? null;
  if (base == null) {
    if (p.servicedHere) base = r.servicedHereOnly;
    else if (p.soldHere) base = r.soldHereOnly;
  }
  if (base == null || p.source === "none") {
    d.missing.push("provenance_unknown");
    return d;
  }
  d.evidence.push(`designation_${p.designation}`, `source_${p.source}`);
  if (p.serviceVisits != null) d.evidence.push(`service_visits:${p.serviceVisits}`); else d.missing.push("service_history_unknown");
  if (p.autofilmInspections != null) d.evidence.push(`autofilm_inspections:${p.autofilmInspections}`);
  if (p.yearsKnown != null) d.evidence.push(`years_known:${p.yearsKnown}`);
  if (p.directTrade) d.evidence.push("direct_customer_trade");
  d.score = clamp(base);
  return d;
}

function documentationSafetyDomain(recall: RecallSummary, docs: DocumentationFacts): DomainDraft {
  const d = draft();
  const r = SCORE_DEDUCTIONS.documentation_safety;
  let deduction = 0;
  let assessed = false;
  switch (recall.vinState) {
    case "NO_OPEN": assessed = true; d.evidence.push("vin_recall_no_open"); break;
    case "CLOSED_CAMPAIGN_ONLY": assessed = true; d.evidence.push("vin_recall_campaigns_closed"); break;
    case "OEM_SERVICE_CAMPAIGN": assessed = true; deduction += r.oemServiceCampaign; d.adverse.push("oem_service_campaign_open"); break;
    case "OPEN": {
      assessed = true;
      const n = Math.max(1, recall.openCount ?? 1);
      deduction += Math.min(r.openRecallCap, n * r.openRecall);
      d.adverse.push(`vin_recall_open:${n}`);
      break;
    }
    default: d.missing.push(`vin_recall_${recall.vinState.toLowerCase()}`);
  }
  if (recall.doNotDrive) { assessed = true; deduction += r.doNotDrive; d.adverse.push("do_not_drive"); }

  const doc = (present: boolean | null, key: string) => {
    if (present == null) { d.missing.push(`${key}_unknown`); return; }
    assessed = true;
    d.evidence.push(present ? key : `${key}_absent`);
  };
  if (docs.serviceRecordCount == null) d.missing.push("service_records_unknown");
  else { assessed = true; d.evidence.push(`service_records:${docs.serviceRecordCount}`); }
  doc(docs.inspectionEvidenceOnFile, "inspection_evidence_on_file");
  doc(docs.warrantyDocumented, "warranty_documented");
  doc(docs.windowStickerOnFile, "window_sticker_on_file");

  if (!assessed) return d;
  d.score = clamp(100 - deduction);
  return d;
}

export function buildVehicleScore(input: VehicleScoreInput, options: VehicleScoreOptions = {}): VehicleScoreResult {
  const bands = { ...DEFAULT_SCORE_LABEL_BANDS, ...(options.labelBands ?? {}) };
  const weights: Record<ScoreDomainKey, number> = { ...SCORE_WEIGHTS, ...(options.weights ?? {}) };

  if (input.vehicleType === "new") {
    return { version: VEHICLE_SCORE_VERSION, score: null, label: null, domains: [], applicable: false, reasons: ["vehicle_type_new_no_used_score"] };
  }
  if (!mayClaim("vehicle_score_evidence", input.identity.matchLevel)) {
    return {
      version: VEHICLE_SCORE_VERSION, score: null, label: null, domains: [], applicable: true,
      reasons: [`identity_not_exact:${input.identity.matchLevel}`],
    };
  }

  const drafts: Record<ScoreDomainKey, DomainDraft> = {
    integrity: integrityDomain(input.identity, input.titleOdometer),
    condition: conditionDomain(input.condition),
    provenance: provenanceDomain(input.provenance),
    documentation_safety: documentationSafetyDomain(input.recall, input.documentation),
  };
  const domains: ScoreDomainResult[] = SCORE_DOMAINS.map((key) => ({
    key, weight: weights[key], score: drafts[key].score,
    evidence: drafts[key].evidence, adverse: drafts[key].adverse, missing: drafts[key].missing,
  }));

  const assessed = domains.filter((d) => d.score != null);
  const reasons: string[] = [];
  if (!assessed.length) {
    return { version: VEHICLE_SCORE_VERSION, score: null, label: null, domains, applicable: true, reasons: ["no_assessable_evidence"] };
  }
  const weightSum = assessed.reduce((a, d) => a + d.weight, 0);
  const score = weightSum > 0
    ? clamp(assessed.reduce((a, d) => a + d.weight * (d.score as number), 0) / weightSum)
    : null;
  if (assessed.length < domains.length) {
    reasons.push(`weights_renormalized_over_assessed_domains:${assessed.map((d) => d.key).join(",")}`);
    reasons.push(`domains_not_assessed:${domains.filter((d) => d.score == null).map((d) => d.key).join(",")}`);
  } else {
    reasons.push("all_domains_assessed");
  }
  const adverse = domains.flatMap((d) => d.adverse);
  if (adverse.length) reasons.push(`adverse_findings:${adverse.length}`);

  return { version: VEHICLE_SCORE_VERSION, score, label: scoreLabel(score, bands), domains, applicable: true, reasons };
}
