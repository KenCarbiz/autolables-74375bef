// ── Data Confidence ────────────────────────────────────────────────────────
//
// Master build section 31. How much of the vehicle's story is actually in
// evidence: coverage of the expected facts per domain, weighted by whether
// each fact is present, fresh and from an authority that can speak to it,
// then capped by how exactly the vehicle is identified, by unresolved
// conflicts between sources, and by a weak factory-decode confidence.
//
// This is the number that moves when evidence is missing. The Vehicle Score
// does not. A score of 91 at HIGH confidence and a score of 91 at LIMITED
// confidence are different conclusions, and the public surface shows the
// level, not a percentage that would read as false precision.

import { identityConfidenceCeiling, isExactIdentity as isExactLevel, type IdentityConfidenceCeiling } from "../market/identityMatch.ts";
import {
  SCORE_DOMAINS,
  type ConditionSummary, type DataConfidenceLevel, type DataConfidenceResult, type Freshness,
  type IdentitySummary, type ProvenanceSummary, type RecallSummary, type ScoreDomainKey, type TitleOdometerSummary,
} from "./contracts.ts";
import type { DocumentationFacts } from "./vehicleScore.ts";

export const DATA_CONFIDENCE_VERSION = "data-confidence-v1.0.0";

export interface DataConfidenceInput {
  vehicleType: "new" | "used";
  identity: IdentitySummary;
  titleOdometer: TitleOdometerSummary;
  condition: ConditionSummary;
  provenance: ProvenanceSummary;
  recall: RecallSummary;
  documentation: DocumentationFacts;
  /** Unresolved contradictions between sources, named by the caller. */
  conflicts?: string[];
}

/** Coverage percentage lower bounds for the public levels. */
export interface DataConfidenceBands { high: number; moderate: number }

export const DEFAULT_DATA_CONFIDENCE_BANDS: DataConfidenceBands = { high: 85, moderate: 60 };

export const DATA_CONFIDENCE_RULES = {
  /** Credit a present fact earns by freshness state. */
  freshnessCredit: { current: 1, unknown: 0.75, stale: 0.5 } as Record<Freshness["state"], number>,
  /** Credit multiplier for a fact from a source that cannot speak to it with authority. */
  weakAuthorityCredit: 0.7,
  /** Coverage points removed per unresolved conflict, and the most removed. */
  conflictPenalty: 10,
  conflictPenaltyCap: 30,
  /** Below this normalized (0-1) factory-decode confidence the identity evidence is discounted. */
  providerConfidenceFloor: 0.7,
  providerConfidencePenalty: 5,
} as const;

export interface DataConfidenceOptions {
  bands?: Partial<DataConfidenceBands>;
}

/** `freshness` is null for a dealer-held document fact, which has no TTL and earns full credit. */
interface ExpectedFact { key: string; present: boolean; freshness: Freshness["state"] | null; authoritative: boolean }

const levelRank: Record<DataConfidenceLevel, number> = { limited: 0, moderate: 1, high: 2 };
const capLevel = (level: DataConfidenceLevel, cap: DataConfidenceLevel): DataConfidenceLevel =>
  levelRank[level] > levelRank[cap] ? cap : level;

const fresh = (f: Freshness | null | undefined): Freshness["state"] => f?.state ?? "unknown";

function expectedFacts(input: DataConfidenceInput): Record<ScoreDomainKey, ExpectedFact[] | null> {
  const { identity, titleOdometer: t, condition: c, provenance: p, recall, documentation: d } = input;
  const titleAnswered = !t.entitlementBlocked && !t.providerFailed && t.state !== "NOT_VERIFIED";
  const recallAnswered = ["OPEN", "NO_OPEN", "CLOSED_CAMPAIGN_ONLY", "OEM_SERVICE_CAMPAIGN"].includes(recall.vinState);
  const integrity: ExpectedFact[] = [
    { key: "identity_exact", present: identity.factoryVerified, freshness: fresh(identity.freshness), authoritative: identity.decodeSource === "neovin" },
    { key: "factory_decode_confidence", present: identity.providerConfidence != null, freshness: fresh(identity.freshness), authoritative: true },
  ];
  const documentation: ExpectedFact[] = [
    { key: "vin_recall_answered", present: recallAnswered, freshness: fresh(recall.freshness), authoritative: true },
    { key: "warranty_documented", present: d.warrantyDocumented != null, freshness: null, authoritative: true },
    { key: "window_sticker_on_file", present: d.windowStickerOnFile != null, freshness: null, authoritative: true },
  ];
  if (input.vehicleType === "new") {
    // New inventory is a factory configuration and compliance question; the
    // used title, condition and provenance facts are not expected of it.
    return { integrity, condition: null, provenance: null, documentation_safety: documentation };
  }
  integrity.push(
    { key: "title_checked", present: titleAnswered, freshness: fresh(t.freshness), authoritative: true },
    { key: "odometer_checked", present: t.odometerStatus !== "not_checked", freshness: fresh(t.freshness), authoritative: true },
  );
  const inspected = c.state === "verified" || c.state === "partial";
  const conditionFacts: ExpectedFact[] = [
    { key: "inspection_on_file", present: inspected || c.state === "self_reported", freshness: fresh(c.freshness), authoritative: inspected },
    { key: "tires_measured", present: c.tires32nds.length > 0, freshness: fresh(c.freshness), authoritative: inspected },
    { key: "brakes_measured", present: c.brakesMm.length > 0, freshness: fresh(c.freshness), authoritative: inspected },
    { key: "open_items_reviewed", present: c.openItems != null, freshness: fresh(c.freshness), authoritative: inspected },
  ];
  const provenanceFacts: ExpectedFact[] = [
    { key: "relationship_known", present: p.designation !== "unknown", freshness: fresh(p.freshness), authoritative: p.source === "dms" },
    { key: "service_history_known", present: p.serviceVisits != null, freshness: fresh(p.freshness), authoritative: p.source === "dms" },
    { key: "sold_here_known", present: p.soldHere != null, freshness: fresh(p.freshness), authoritative: p.source === "dms" },
    { key: "inspection_count_known", present: p.autofilmInspections != null, freshness: fresh(p.freshness), authoritative: true },
  ];
  documentation.push(
    { key: "service_records_known", present: d.serviceRecordCount != null, freshness: null, authoritative: true },
    { key: "inspection_evidence_known", present: d.inspectionEvidenceOnFile != null, freshness: null, authoritative: true },
  );
  return { integrity, condition: conditionFacts, provenance: provenanceFacts, documentation_safety: documentation };
}

function coverage(facts: ExpectedFact[]): { pct: number; stale: string[] } {
  const credit = DATA_CONFIDENCE_RULES.freshnessCredit;
  let earned = 0;
  const stale: string[] = [];
  for (const f of facts) {
    if (!f.present) continue;
    if (f.freshness === "stale") stale.push(f.key);
    const timeCredit = f.freshness == null ? 1 : credit[f.freshness];
    earned += timeCredit * (f.authoritative ? 1 : DATA_CONFIDENCE_RULES.weakAuthorityCredit);
  }
  return { pct: facts.length ? (earned / facts.length) * 100 : 0, stale };
}

export function buildDataConfidence(input: DataConfidenceInput, options: DataConfidenceOptions = {}): DataConfidenceResult {
  const bands = { ...DEFAULT_DATA_CONFIDENCE_BANDS, ...(options.bands ?? {}) };
  const rules = DATA_CONFIDENCE_RULES;
  const reasons: string[] = [];
  const expected = expectedFacts(input);

  const domainCoverage = {} as Record<ScoreDomainKey, number | null>;
  const staleFacts: string[] = [];
  let sum = 0;
  let counted = 0;
  for (const key of SCORE_DOMAINS) {
    const facts = expected[key];
    if (!facts) { domainCoverage[key] = null; continue; }
    const { pct, stale } = coverage(facts);
    domainCoverage[key] = Math.round(pct);
    staleFacts.push(...stale);
    sum += pct;
    counted++;
  }
  let pct = counted ? sum / counted : 0;

  const conflicts = [...new Set([
    ...(input.conflicts ?? []),
    ...(input.titleOdometer.odometerStatus === "conflict" ? ["odometer_conflict"] : []),
    ...(input.titleOdometer.odometerStatus === "rollback_indicated" ? ["odometer_rollback_indicated"] : []),
  ])];
  if (conflicts.length) {
    pct -= Math.min(rules.conflictPenaltyCap, conflicts.length * rules.conflictPenalty);
    reasons.push(`unresolved_conflicts:${conflicts.length}`);
  }
  // providerConfidence is already normalized to 0-1 by the identity adapter;
  // a raw value of unknown scale is never compared with the floor.
  const idc = input.identity;
  if (idc.providerConfidence != null && idc.providerConfidenceScale !== "unknown" && idc.providerConfidence < rules.providerConfidenceFloor) {
    pct -= rules.providerConfidencePenalty;
    reasons.push(`factory_decode_confidence_low:${idc.providerConfidence}`);
  } else if (idc.providerConfidenceRaw != null && idc.providerConfidenceScale === "unknown") {
    reasons.push("factory_decode_confidence_scale_unknown");
  }
  if (input.vehicleType === "used" && isExactLevel(idc.matchLevel) && idc.decodeAuthority !== "factory_build") {
    reasons.push(`decode_not_factory_build:${idc.decodeAuthority}`);
  }
  if (staleFacts.length) reasons.push(`stale_facts:${staleFacts.length}`);
  pct = Math.max(0, Math.min(100, pct));

  let level: DataConfidenceLevel = pct >= bands.high ? "high" : pct >= bands.moderate ? "moderate" : "limited";
  const ceiling: IdentityConfidenceCeiling = identityConfidenceCeiling(input.identity.matchLevel);
  if (ceiling === "none") {
    level = "limited";
    reasons.push("identity_unknown_confidence_limited");
  } else if (ceiling !== "high") {
    const before = level;
    level = capLevel(level, ceiling);
    if (before !== level) reasons.push(`identity_ceiling_${ceiling}:${input.identity.matchLevel}`);
  }
  if (conflicts.length && level === "high") {
    level = "moderate";
    reasons.push("conflicts_cap_confidence_at_moderate");
  }
  const missing = SCORE_DOMAINS.flatMap((key) => (expected[key] ?? []).filter((f) => !f.present).map((f) => `${key}.${f.key}`));
  if (missing.length) reasons.push(`missing_facts:${missing.length}`);
  reasons.push(`coverage_pct:${Math.round(pct)}`);

  return {
    version: DATA_CONFIDENCE_VERSION,
    level,
    coveragePct: Math.round(pct),
    ceiling,
    domainCoverage,
    conflicts,
    staleFacts,
    reasons,
  };
}
