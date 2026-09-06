// The DriveSignal QA framework as software gates.
//
// The manual defines a multi-stage review and states that no description
// bypasses it. This runs those stages over the generated copy and returns a
// publication decision. It does NOT ask the model whether its own work is
// good: a writer that fabricates a Bose system will also report
// requires_review false, so the model's self-assessment is recorded as
// testimony and never consulted here.
//
// Gates 1, 5 and 6 mostly ORGANISE validators that already exist rather than
// re-implementing them — validateContent reads the prose, auditEvidence reads
// the citations, and the warranty ladder reads the paperwork. A second
// implementation of any of those would drift from the first within a month.
// Gates 2, 3 and 4 add what nothing else checked.

import type { Finding, FactSnapshot } from "./description-core.ts";
import { auditEvidence, type EvidenceAudit, type DescriptionModelOutput } from "./description-evidence.ts";

export type GateId =
  | "evidence" | "completeness" | "editorial"
  | "seo" | "compliance" | "marketplace" | "publication";

export const GATE_ORDER: readonly GateId[] = [
  "evidence", "completeness", "editorial", "seo", "compliance", "marketplace", "publication",
];

export interface GateFinding {
  gate: GateId;
  code: string;
  blocking: boolean;
  message: string;
  /** "validator" findings were produced by validateContent and merely routed
   *  to a gate for legibility. Only "gate" findings are new information, and
   *  merging the routed ones back into the validator's list would double-count
   *  every one of them. */
  origin: "gate" | "validator";
}

export interface GateReport {
  decision: "PASS" | "REVIEW" | "REJECT";
  findings: GateFinding[];
  byGate: Record<GateId, { blocking: number; warnings: number }>;
  evidence: EvidenceAudit | null;
  characterCount: number;
  wordCount: number;
}

// Which existing validator belongs to which gate. A code absent from this map
// still counts — it lands on the gate its severity implies — but naming it
// here is what makes the report legible to a human reviewer.
const VALIDATOR_GATE: Record<string, GateId> = {
  EXCLUDED_CLAIM_PRESENT: "evidence",
  UNSUPPORTED_FEATURE_CLAIM: "evidence",
  SOURCE_CONFLICT_UNRESOLVED: "evidence",
  LOW_FACT_CONFIDENCE: "evidence",
  DEALER_ADDED_AS_FACTORY: "evidence",
  REQUIRED_DATA_MISSING: "evidence",
  IDENTITY_YEAR_CONFLICT: "evidence",
  LENGTH_BELOW_MINIMUM: "completeness",
  DUPLICATE_CONTENT_RISK: "editorial",
  IDENTITY_YEAR_MISSING: "seo",
  KEYWORD_STUFFING: "seo",
  PROHIBITED_PHRASE: "compliance",
  REQUIRED_DISCLOSURE_MISSING: "compliance",
  HIDDEN_TEXT_DETECTED: "compliance",
  CTA_MISSING: "editorial",
  CHANNEL_LENGTH_EXCEEDED: "marketplace",
  CHANNEL_FORMAT_INVALID: "marketplace",
};

// ── Length band ──────────────────────────────────────────────────────
//
// Length is measured in TOTAL CHARACTERS INCLUDING SPACES, by owner decision,
// and every vehicle targets the same band: 3,200 to 3,879. That is also the
// unit every downstream limit uses — the tenant row's min_length and
// max_length, LENGTH_POLICY, and the marketplace field caps — so counting
// words here left two units able to disagree about one description.
//
// This deliberately overrides the manual's per-class word guidance (section
// 24: economy 250-400 words, luxury 600-900). The owner wants one consistent
// length across the lot for marketplace parity. The class is still resolved
// and still recorded, so restoring a per-class ladder later is a data change
// rather than a rewrite.
//
// The floor is a TARGET, not a gate: a vehicle with too little verified data
// to reach 3,000 characters honestly is flagged for review, never padded.
// Section 24 is explicit that quality outranks length and that padding is
// forbidden, and a writer told to hit a floor at any cost produces exactly the
// boilerplate this system exists to avoid.

export type VehicleClass = "economy" | "mainstream" | "luxury" | "performance" | "heavy_duty";

export const TARGET_BAND = { min: 3200, max: 3879 } as const;

export const CHAR_BANDS: Record<VehicleClass, { min: number; max: number }> = {
  economy: { ...TARGET_BAND },
  mainstream: { ...TARGET_BAND },
  luxury: { ...TARGET_BAND },
  performance: { ...TARGET_BAND },
  heavy_duty: { ...TARGET_BAND },
};

// ── Language the manual forbids outright ─────────────────────────────

const HYPE = [
  "amazing", "incredible", "stunning", "perfect", "must see", "dream car",
  "fully loaded", "mint condition", "like new", "better hurry", "won't last",
  "priced to sell", "act now", "buy today", "lowest price guaranteed",
  "don't miss out",
];

const ADAS_OVERCLAIM = [
  "prevents accidents", "guarantees safety", "eliminates collisions",
  "eliminates blind spots", "crash-proof", "crash proof",
  "self-driving", "fully autonomous",
];

const norm = (s: string) => s.toLowerCase().replace(/[’]/g, "'");

function phraseHits(text: string, phrases: string[]): string[] {
  const lc = norm(text);
  return phrases.filter((p) => lc.includes(norm(p)));
}

/** Total characters including spaces — the unit every length limit uses. */
export function countCharacters(text: string): number {
  return (text || "").length;
}

/** Words are still counted, but only for readability: the manual's 15-25 word
 *  sentence standard is a legibility measure, not a length target. */
export function countWords(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
}

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export interface GateInput {
  content: string;
  snapshot: FactSnapshot;
  /** Findings from validateContent, which stays the authority on the prose. */
  validatorFindings: Finding[];
  /** The model's structured output, if the call was structured. */
  output?: Pick<DescriptionModelOutput,
    "used_fact_ids" | "hero_fact_ids" | "warranty_fact_ids" | "history_fact_ids"> | null;
  vehicleClass: VehicleClass;
  /** Identity the copy must carry, for the SEO gate. */
  identity?: { year?: number | string | null; make?: string | null; model?: string | null };
}

export function runGates(input: GateInput): GateReport {
  const findings: GateFinding[] = [];
  const add = (gate: GateId, code: string, blocking: boolean, message: string,
               origin: GateFinding["origin"] = "gate") =>
    findings.push({ gate, code, blocking, message, origin });

  const text = input.content || "";
  const characters = countCharacters(text);
  const words = countWords(text);

  // Gate 1 — Evidence.
  const evidence = input.output ? auditEvidence(input.output, input.snapshot) : null;
  if (evidence && !evidence.ok) {
    for (const id of evidence.fabricated_ids) {
      add("evidence", "FABRICATED_FACT_CITATION", true,
        `The writer cited "${id}", which was never supplied in the fact snapshot.`);
    }
    for (const id of evidence.unusable_ids) {
      add("evidence", "EXCLUDED_FACT_CITATION", true,
        `The writer cited "${id}", which was withheld from customer copy.`);
    }
  }

  // Existing validators, routed to their gate.
  for (const f of input.validatorFindings || []) {
    const gate = VALIDATOR_GATE[f.validator_code] || (f.blocking ? "evidence" : "editorial");
    add(gate, f.validator_code, !!f.blocking, f.message || f.validator_code, "validator");
  }

  // Gate 2 — Completeness. Enough story for this vehicle, no padding.
  const band = CHAR_BANDS[input.vehicleClass];
  if (characters < band.min) {
    add("completeness", "BELOW_CLASS_CHAR_BAND", false,
      `${characters} characters; a ${input.vehicleClass} vehicle typically supports ${band.min}-${band.max}.`);
  } else if (characters > band.max) {
    add("completeness", "ABOVE_CLASS_CHAR_BAND", false,
      `${characters} characters; above the ${band.max}-character guidance for a ${input.vehicleClass} vehicle.`);
  }
  if (evidence && evidence.unclaimed_supplied.length > 0 && characters < band.min) {
    // Short AND ignoring supplied facts is the shape of a lazy generation,
    // as opposed to a sparse vehicle honestly described.
    add("completeness", "SUPPLIED_FACTS_UNUSED", false,
      `Short copy left ${evidence.unclaimed_supplied.length} supplied fact(s) unused.`);
  }

  // Gate 3 — Editorial.
  const sents = sentences(text);
  if (sents.length) {
    const avg = words / sents.length;
    if (avg > 30) add("editorial", "SENTENCES_TOO_LONG", false,
      `Average sentence is ${avg.toFixed(0)} words; the standard is 15-25.`);
    const longest = Math.max(...paragraphs(text).map((p) => sentences(p).length), 0);
    if (longest > 8) add("editorial", "PARAGRAPH_TOO_LONG", false,
      `A paragraph runs ${longest} sentences; the standard is 3-6.`);
  }

  // Gate 4 — SEO.
  const lc = norm(text);
  for (const [part, value] of Object.entries(input.identity || {})) {
    const v = String(value ?? "").trim();
    if (v && !lc.includes(norm(v))) {
      add("seo", "IDENTITY_PART_MISSING", false,
        `The ${part} "${v}" does not appear in the copy.`);
    }
  }

  // Gate 5 — Compliance.
  for (const p of phraseHits(text, ADAS_OVERCLAIM)) {
    // Driver assistance assists. Saying otherwise is the one safety claim that
    // can put a shopper in danger rather than merely misleading them.
    add("compliance", "ADAS_OVERCLAIM", true,
      `"${p}" overstates a driver-assistance system.`);
  }
  for (const p of phraseHits(text, HYPE)) {
    add("compliance", "PROHIBITED_SALES_LANGUAGE", true,
      `"${p}" is prohibited sales language.`);
  }

  // Gate 6 — Marketplace: covered by the channel validators routed above.

  // Gate 7 — Publication.
  const byGate = Object.fromEntries(GATE_ORDER.map((g) => [g, { blocking: 0, warnings: 0 }])) as
    GateReport["byGate"];
  for (const f of findings) {
    const bucket = byGate[f.gate];
    if (f.blocking) bucket.blocking++; else bucket.warnings++;
  }
  const blocking = findings.filter((f) => f.blocking).length;
  const warnings = findings.length - blocking;

  // A model returning text is not a reason to publish it.
  const decision: GateReport["decision"] =
    blocking > 0 ? "REJECT" : warnings > 0 ? "REVIEW" : "PASS";

  return { decision, findings, byGate, evidence, characterCount: characters, wordCount: words };
}

/** Vehicle class from resolved truth, never from the copy. */
export function vehicleClassOf(input: {
  isTruck?: boolean; isLuxuryOrPerformance?: boolean; bodyStyle?: string | null;
  msrp?: number | null;
}): VehicleClass {
  if (input.isTruck) return "heavy_duty";
  if (input.isLuxuryOrPerformance) return "luxury";
  if (Number(input.msrp) > 0 && Number(input.msrp) < 25000) return "economy";
  return "mainstream";
}
