// ── What counts as the same market ─────────────────────────────────────────
//
// A dealer ingests a 2023 QX60 LUXE and we buy market evidence for it. Three
// more 2023 QX60 LUXEs are already on the lot. Buying the same evidence four
// times is waste; ASSUMING the four cars are interchangeable is worse — it is
// how a FWD base car gets priced against AWD Sensory stock.
//
// So the cohort key answers exactly one question: may these two vehicles be
// judged against the SAME MARKET EVIDENCE? It never answers "are these worth
// the same", which is a per-VIN question the engine keeps answering per VIN.
//
// The bias throughout is REFUSAL. Every unknown is a mismatch, never a wildcard:
//
//   • exact year, make and model. Not "same generation", not "close enough".
//   • trim normalized for punctuation and case, never collapsed by meaning.
//     LUXE and Luxe are one trim; LUXE and SENSORY are two, and no amount of
//     string similarity may merge them.
//   • drivetrain is part of the key. AWD and FWD are different cars at
//     different prices and may not silently share a market.
//   • CPO is part of the key. A certified car carries a manufacturer warranty
//     the uncertified one beside it does not.
//   • a material equipment signature is part of the key, and UNKNOWN equipment
//     is its own value — never equal to another unknown, and never equal to a
//     known signature. Two cars we know nothing about are not a match; they are
//     two cars we know nothing about.
//   • adjacent model years are CONTEXT ONLY. They are recorded as a weaker
//     relationship and never as the same cohort, until a gate says otherwise.
//
// The key carries no VIN, no asking price, no tenant secret and no customer
// data — it is a market description, and it ends up in evidence rows and logs.
// The VIN stays where it belongs: in the vehicle's own valuation fingerprint.

import { digest } from "./hash.ts";
import { classifyEquipment } from "./equipmentClass.ts";

/** Bump when the MEANING of a cohort changes, so old keys cannot silently match new ones. */
export const COHORT_RULES_VERSION = "cohort-v1.0.0";

export type VehicleClass = "new" | "used" | "cpo";

/** Drivetrain, in the four spellings a feed actually uses plus unknown. */
export type Drivetrain = "awd" | "fwd" | "rwd" | "4wd" | "unknown";

export interface CohortSubject {
  year?: unknown;
  make?: unknown;
  model?: unknown;
  trim?: unknown;
  drivetrain?: unknown;
  /** Engine or powertrain description, when the feed or sticker supplies one. */
  powertrain?: unknown;
  /** Body configuration — sedan, SUV, crew cab. */
  bodyType?: unknown;
  condition?: unknown;
  /** The resolved certification truth, not a provider echo. */
  certified?: unknown;
  /**
   * Material factory equipment, from window-sticker or build truth.
   *
   * Marketing copy is NOT a source: a description that says "loaded" is a
   * sentence, not a package code.
   */
  equipment?: unknown;
  zip?: unknown;
  radiusMiles?: unknown;
}

export interface MarketCohortKey {
  cohortRulesVersion: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  drivetrain: Drivetrain;
  powertrain: string | null;
  bodyType: string | null;
  vehicleClass: VehicleClass | null;
  /** True, false, or unknown — three states, because a guess is a warranty claim. */
  certifiedClass: "certified" | "not_certified" | "unknown";
  /** A digest of the material equipment set, or the literal "unknown". */
  equipmentSignature: string;
  zip: string | null;
  radiusMiles: number | null;
  /** Whether this key is complete enough to share evidence at all. */
  usable: boolean;
  reasons: string[];
}

export const EQUIPMENT_UNKNOWN = "equipment_unknown";

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
};

const year = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
};

/**
 * Drivetrain, normalized across the spellings a feed emits.
 *
 * Anything unrecognised is `unknown`, which is deliberately NOT a wildcard:
 * two unknowns do not match each other.
 */
export function normalizeDrivetrain(v: unknown): Drivetrain {
  const s = text(v);
  if (!s) return "unknown";
  const c = s.replace(/\s/g, "");
  if (/^(awd|allwheeldrive|all)$/.test(c)) return "awd";
  if (/^(fwd|frontwheeldrive|front)$/.test(c)) return "fwd";
  if (/^(rwd|rearwheeldrive|rear)$/.test(c)) return "rwd";
  if (/^(4wd|4x4|fourwheeldrive|four)$/.test(c)) return "4wd";
  return "unknown";
}

/**
 * Trim, normalized for SPELLING only.
 *
 * `LUXE`, `Luxe` and ` luxe ` are one trim. `LUXE` and `SENSORY` are two, and
 * this function has no opinion about whether they are similar — that is the
 * fuzzy upgrade the cohort contract forbids.
 */
export function normalizeTrim(v: unknown): string | null {
  return text(v);
}

/**
 * The equipment signature — COHORT-DEFINING items only.
 *
 * This used to hash every entry in the list, which meant a set of floor mats
 * fractured two otherwise identical cars. It now runs the list through
 * `classifyEquipment`, so port-installed accessories, paint and trim-level
 * cosmetics fall out and only factory codes and material packages remain.
 *
 * An absent or unreadable list is `equipment_unknown`, a sentinel that never
 * equals another signature — including another `equipment_unknown`. A list
 * that DECODED to no material options is not unknown: "this car has no
 * material factory options" is an answer, and it hashes like one.
 */
export function equipmentSignature(v: unknown): string {
  const classified = classifyEquipment(v);
  if (classified.unknown) return EQUIPMENT_UNKNOWN;
  return digest({ kind: "equipment", items: classified.cohortDefining });
}

/**
 * What actually differs between two equipment sets.
 *
 * Only cohort-defining items are compared, so the answer names packages and
 * option codes rather than accessories. Used to explain an
 * `adjustment_required` relationship without inventing a dollar figure.
 */
export function equipmentDifference(a: unknown, b: unknown): {
  known: boolean;
  onlyInA: string[];
  onlyInB: string[];
  shared: string[];
} {
  const ca = classifyEquipment(a);
  const cb = classifyEquipment(b);
  if (ca.unknown || cb.unknown) return { known: false, onlyInA: [], onlyInB: [], shared: [] };
  const setA = new Set(ca.cohortDefining);
  const setB = new Set(cb.cohortDefining);
  return {
    known: true,
    onlyInA: ca.cohortDefining.filter((i) => !setB.has(i)),
    onlyInB: cb.cohortDefining.filter((i) => !setA.has(i)),
    shared: ca.cohortDefining.filter((i) => setB.has(i)),
  };
}

const vehicleClass = (condition: unknown, certified: unknown): VehicleClass | null => {
  const c = text(condition);
  if (c === "new") return "new";
  if (certified === true || c === "cpo") return "cpo";
  if (c === "used") return "used";
  return null;
};

export function buildCohortKey(subject: CohortSubject): MarketCohortKey {
  const reasons: string[] = [];
  const y = year(subject.year);
  const make = text(subject.make);
  const model = text(subject.model);
  const trim = normalizeTrim(subject.trim);
  const drivetrain = normalizeDrivetrain(subject.drivetrain);
  const cls = vehicleClass(subject.condition, subject.certified);
  const equipment = equipmentSignature(subject.equipment);
  const zip = typeof subject.zip === "string" && /^\d{5}$/.test(subject.zip.trim())
    ? subject.zip.trim() : null;
  const radius = typeof subject.radiusMiles === "number" && Number.isFinite(subject.radiusMiles)
    && subject.radiusMiles > 0 ? subject.radiusMiles : null;

  const certifiedClass = subject.certified === true ? "certified"
    : subject.certified === false ? "not_certified" : "unknown";

  if (y == null) reasons.push("cohort_year_unknown");
  if (!make) reasons.push("cohort_make_unknown");
  if (!model) reasons.push("cohort_model_unknown");
  if (!trim) reasons.push("cohort_trim_unknown");
  if (drivetrain === "unknown") reasons.push("cohort_drivetrain_unknown");
  if (!cls) reasons.push("cohort_class_unknown");
  if (equipment === EQUIPMENT_UNKNOWN) reasons.push("cohort_equipment_unknown");
  if (!zip) reasons.push("cohort_zip_unknown");
  if (radius == null) reasons.push("cohort_radius_unknown");

  // Everything the engine needs to say "same market". Equipment may be unknown
  // and the key still FORMS — it simply cannot match another key, which
  // `cohortsMatch` enforces.
  const usable = y != null && !!make && !!model && !!trim
    && drivetrain !== "unknown" && !!cls && !!zip && radius != null;
  if (usable) reasons.push("cohort_key_usable");

  return {
    cohortRulesVersion: COHORT_RULES_VERSION,
    year: y, make, model, trim, drivetrain,
    powertrain: text(subject.powertrain),
    bodyType: text(subject.bodyType),
    vehicleClass: cls,
    certifiedClass,
    equipmentSignature: equipment,
    zip, radiusMiles: radius,
    usable, reasons,
  };
}

/**
 * The MARKET's identifier — equipment deliberately excluded.
 *
 * This is what a shared snapshot is keyed on, and the exclusion is the whole
 * reason sharing works. Equipment decides a car's position WITHIN a market, not
 * which market it is in; keying the snapshot on it would give Ken's two QX60s
 * two separate snapshots of one market, and they would never share anything.
 *
 * Contains no VIN, no price and no tenant secret.
 */
export function marketCohortHash(key: MarketCohortKey): string {
  return digest({
    kind: "market_cohort",
    rules: key.cohortRulesVersion,
    year: key.year, make: key.make, model: key.model, trim: key.trim,
    drivetrain: key.drivetrain, powertrain: key.powertrain, body: key.bodyType,
    class: key.vehicleClass, certified: key.certifiedClass,
    zip: key.zip, radius: key.radiusMiles,
  });
}

/**
 * The market identifier PLUS equipment — a build, not a market.
 *
 * Used where an exact configuration matters: comparable-level identity and the
 * valuation fingerprint. Never used to key a shared snapshot.
 */
export function cohortKeyHash(key: MarketCohortKey): string {
  return digest({
    kind: "market_cohort",
    rules: key.cohortRulesVersion,
    year: key.year, make: key.make, model: key.model, trim: key.trim,
    drivetrain: key.drivetrain, powertrain: key.powertrain, body: key.bodyType,
    class: key.vehicleClass, certified: key.certifiedClass,
    equipment: key.equipmentSignature,
    zip: key.zip, radius: key.radiusMiles,
  });
}

/**
 * Four relations, because "not compatible" hides two different situations.
 *
 *   exact          proven compatible; may share market evidence
 *   context_only   a real but weaker relationship (adjacent model year)
 *   indeterminate  NOT ENOUGH EVIDENCE to prove either way
 *   incompatible   proven to differ on a cohort-defining dimension
 *
 * The distinction that matters is the middle one. Gate 14F-C collapsed
 * "unknown equipment" into `incompatible`, which was safe but dishonest: it
 * told an operator two cars were proven different when nobody had decoded
 * either. `indeterminate` says what is true — the evidence is missing — and it
 * is a WORK ITEM, because a car can be enriched out of it. `incompatible`
 * cannot; a FWD car will never become AWD.
 *
 * Only `exact` may share market evidence. That has not changed.
 */
export type CohortRelation = "exact" | "context_only" | "indeterminate" | "incompatible";

export interface CohortMatch {
  relation: CohortRelation;
  reasons: string[];
}

/** The dimensions that must be identical for an exact match, in refusal order. */
const EXACT_DIMENSIONS = [
  ["year", "cohort_year_differs"],
  ["make", "cohort_make_differs"],
  ["model", "cohort_model_differs"],
  ["trim", "cohort_trim_differs"],
  ["drivetrain", "cohort_drivetrain_differs"],
  ["powertrain", "cohort_powertrain_differs"],
  ["bodyType", "cohort_body_differs"],
  ["vehicleClass", "cohort_class_differs"],
  ["certifiedClass", "cohort_certification_differs"],
  ["zip", "cohort_zip_differs"],
  ["radiusMiles", "cohort_radius_differs"],
] as const;

/**
 * May these two vehicles share market evidence?
 *
 * `exact` is the only relation that permits sharing. `context_only` records a
 * real but weaker relationship — an adjacent model year — so it can be counted
 * and reported without ever being used as the same market. `incompatible` is
 * everything else, and it is the default.
 */
export function cohortsMatch(a: MarketCohortKey, b: MarketCohortKey): CohortMatch {
  const reasons: string[] = [];

  if (a.cohortRulesVersion !== b.cohortRulesVersion) {
    return { relation: "incompatible", reasons: ["cohort_rules_version_differs"] };
  }
  if (!a.usable || !b.usable) {
    return { relation: "incompatible", reasons: ["cohort_key_not_usable"] };
  }

  for (const [dimension, reason] of EXACT_DIMENSIONS) {
    if (a[dimension] !== b[dimension]) {
      // Adjacent model year, everything else identical: a real relationship,
      // and still not the same market until a gate says so.
      if (dimension === "year" && a.year != null && b.year != null
        && Math.abs(a.year - b.year) === 1) {
        const rest = EXACT_DIMENSIONS.filter(([d]) => d !== "year")
          .every(([d]) => a[d] === b[d]);
        if (rest && a.equipmentSignature === b.equipmentSignature
          && a.equipmentSignature !== EQUIPMENT_UNKNOWN) {
          return {
            relation: "context_only",
            reasons: ["cohort_adjacent_model_year", "cohort_same_generation_not_approved"],
          };
        }
      }
      reasons.push(reason);
      return { relation: "incompatible", reasons };
    }
  }

  // Equipment last, because its answer is the subtle one.
  //
  // Missing equipment truth is not proof of difference and not proof of
  // sameness. `equipment_unknown === equipment_unknown` must never become a
  // match — two cars nobody has decoded are two cars nobody has decoded — and
  // it must not masquerade as a proven mismatch either.
  const aUnknown = a.equipmentSignature === EQUIPMENT_UNKNOWN;
  const bUnknown = b.equipmentSignature === EQUIPMENT_UNKNOWN;
  if (aUnknown || bUnknown) {
    return {
      relation: "indeterminate",
      reasons: [
        "cohort_equipment_indeterminate",
        aUnknown && bUnknown ? "cohort_equipment_unknown_both"
          : aUnknown ? "cohort_equipment_unknown_subject" : "cohort_equipment_unknown_candidate",
        "cohort_equipment_enrichment_would_resolve",
      ],
    };
  }
  if (a.equipmentSignature !== b.equipmentSignature) {
    return { relation: "incompatible", reasons: ["cohort_equipment_differs"] };
  }

  return { relation: "exact", reasons: ["cohort_exact_match"] };
}

/** Only an exact relation may share evidence. Unchanged, and the whole point. */
export const mayShareMarketEvidence = (m: CohortMatch): boolean => m.relation === "exact";

/**
 * A vehicle that could join the cohort if someone decoded it.
 *
 * Not a comparable. A work item — the list an operator uses to decide what to
 * enrich next, and the reason `indeterminate` is worth distinguishing from
 * `incompatible` at all.
 */
export const needsEnrichmentToDecide = (m: CohortMatch): boolean => m.relation === "indeterminate";

/** May be shown as context or diagnostics. Never as market evidence. */
export const isContextOnly = (m: CohortMatch): boolean =>
  m.relation === "context_only" || m.relation === "indeterminate";
