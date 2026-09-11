// ── What the engine knows, and how it knows it ─────────────────────────────
//
// Self-aware does not mean it guesses well. It means that for every field the
// comparison depends on, the engine can say: what the value is, where it came
// from, when, and whether two sources disagree.
//
// The reason this matters is narrow and concrete. The cohort key is built from
// trim, drivetrain, certification and equipment. If a feed says AWD and a build
// sheet says FWD, the cohort key silently takes whichever the code happened to
// read — and a FWD car quietly joins an AWD market. There is no error, no log
// line, and a wrong number on a page.
//
// So a disagreement is a STATE, not a tiebreak. `conflicting` is a first-class
// answer, and a conflicted dimension makes the vehicle unsafe to compare
// rather than making it compare wrongly.
//
// Nothing here is probabilistic. There are no percentages and no scores —
// every status is reached by a rule you can read.

import { classifyEquipment, isMarketingCopy, type EquipmentClassification } from "./equipmentClass.ts";
import { digest } from "./hash.ts";

/** Bump when the meaning of an awareness state changes. */
export const AWARENESS_RULES_VERSION = "awareness-v1.0.0";

/**
 * Where a value came from, strongest first.
 *
 * `marketing_description` exists so it can be REFUSED by name. It is never a
 * source of truth for anything the cohort depends on.
 */
export type IdentitySource =
  | "window_sticker"
  | "build_sheet"
  | "dealer_confirmed"
  | "listing_feed"
  | "derived"
  | "marketing_description"
  | "none";

/** Sources that may establish a cohort-defining fact. */
export const AUTHORITATIVE_SOURCES: IdentitySource[] = [
  "window_sticker", "build_sheet", "dealer_confirmed",
];

/** Sources that may corroborate but never establish equipment truth. */
export const NON_EQUIPMENT_SOURCES: IdentitySource[] = [
  "listing_feed", "derived", "marketing_description", "none",
];

export type IdentityStatus = "verified" | "derived" | "conflicting" | "missing" | "stale";

export interface IdentityField<T = string> {
  value: T | null;
  normalized: string | null;
  source: IdentitySource;
  sourceTimestamp: string | null;
  status: IdentityStatus;
  /** Every value that was offered, so a conflict can be inspected. */
  candidates: Array<{ value: string; source: IdentitySource }>;
  reasons: string[];
}

export interface IdentityClaim {
  value?: unknown;
  source?: IdentitySource;
  timestamp?: unknown;
}

const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
};

const rank = (s: IdentitySource): number =>
  s === "window_sticker" ? 5 : s === "build_sheet" ? 4 : s === "dealer_confirmed" ? 3
  : s === "listing_feed" ? 2 : s === "derived" ? 1 : 0;

/** How long a source may stand before its value is called stale. */
export const IDENTITY_STALE_DAYS = 30;

/**
 * Resolve one identity dimension from every source that offered a value.
 *
 * Two authoritative sources that disagree produce `conflicting` — the engine
 * does NOT pick the higher-ranked one, because the point of the state is to
 * stop, not to break a tie quietly. A weaker source that disagrees with an
 * authoritative one is recorded as a candidate and loses without conflict:
 * a feed contradicting a window sticker is the ordinary case.
 */
export function resolveIdentityField(
  claims: IdentityClaim[],
  options: { now?: number; allowedSources?: IdentitySource[] } = {},
): IdentityField {
  const reasons: string[] = [];
  const now = options.now ?? Date.now();

  const usable = claims
    .map((c) => ({
      raw: c.value,
      normalized: norm(c.value),
      source: c.source ?? "none",
      timestamp: typeof c.timestamp === "string" ? c.timestamp : null,
    }))
    .filter((c) => {
      if (c.normalized == null) return false;
      if (options.allowedSources && !options.allowedSources.includes(c.source)) {
        reasons.push(`identity_source_not_allowed_${c.source}`);
        return false;
      }
      if (c.source === "marketing_description" || isMarketingCopy(c.raw)) {
        reasons.push("identity_marketing_copy_refused");
        return false;
      }
      return true;
    });

  const candidates = usable.map((c) => ({ value: c.normalized as string, source: c.source }));

  if (usable.length === 0) {
    return {
      value: null, normalized: null, source: "none", sourceTimestamp: null,
      status: "missing", candidates, reasons: [...reasons, "identity_missing"],
    };
  }

  const distinct = [...new Set(usable.map((c) => c.normalized))];
  const authoritative = usable.filter((c) => AUTHORITATIVE_SOURCES.includes(c.source));
  const authoritativeDistinct = [...new Set(authoritative.map((c) => c.normalized))];

  if (authoritativeDistinct.length > 1) {
    // Two sources that are each entitled to be believed. Refusing is the only
    // honest answer.
    return {
      value: null, normalized: null,
      source: "none", sourceTimestamp: null,
      status: "conflicting", candidates,
      reasons: [...reasons, "identity_conflict_between_authoritative_sources"],
    };
  }

  const winner = [...usable].sort((a, b) => rank(b.source) - rank(a.source))[0];

  if (authoritativeDistinct.length === 0 && distinct.length > 1) {
    // Nothing authoritative, and the weak sources disagree with each other.
    return {
      value: null, normalized: null, source: "none", sourceTimestamp: null,
      status: "conflicting", candidates,
      reasons: [...reasons, "identity_conflict_between_non_authoritative_sources"],
    };
  }
  if (distinct.length > 1) reasons.push("identity_non_authoritative_source_disagrees");

  const isAuthoritative = AUTHORITATIVE_SOURCES.includes(winner.source);
  let status: IdentityStatus = isAuthoritative ? "verified" : "derived";

  if (winner.timestamp) {
    const t = Date.parse(winner.timestamp);
    if (Number.isFinite(t) && (now - t) / 86_400_000 > IDENTITY_STALE_DAYS) {
      status = "stale";
      reasons.push("identity_source_stale");
    }
  }
  reasons.push(`identity_from_${winner.source}`);

  return {
    value: winner.normalized,
    normalized: winner.normalized,
    source: winner.source,
    sourceTimestamp: winner.timestamp,
    status,
    candidates,
    reasons,
  };
}

// ── The whole vehicle ──────────────────────────────────────────────────────

export type IdentityDimension =
  | "year" | "make" | "model" | "trim" | "drivetrain" | "powertrain"
  | "bodyType" | "vehicleClass" | "certification" | "mileage" | "equipment" | "zip";

/** Dimensions the cohort key is built from. A conflict here is disqualifying. */
export const COHORT_DEFINING_DIMENSIONS: IdentityDimension[] = [
  "year", "make", "model", "trim", "drivetrain", "powertrain",
  "bodyType", "vehicleClass", "certification", "equipment",
];

export interface MarketAwarenessState {
  awarenessRulesVersion: string;
  fields: Record<IdentityDimension, IdentityField>;
  equipment: EquipmentClassification;
  /** A digest of the cohort-defining equipment only, or null when unknown. */
  equipmentSignature: string | null;
  /** Geography the evidence was or would be gathered for. */
  geography: { zip: string | null; radiusMiles: number | null; source: IdentitySource };
  known: IdentityDimension[];
  unknown: IdentityDimension[];
  conflicts: IdentityDimension[];
  stale: IdentityDimension[];
  /** Safe to place in an exact comparable cohort at all. */
  safeToCompare: boolean;
  reasons: string[];
}

export interface AwarenessInput {
  claims: Partial<Record<IdentityDimension, IdentityClaim[]>>;
  /** Raw equipment list. Only an authoritative source may establish it. */
  equipment?: { entries?: unknown; source?: IdentitySource; timestamp?: unknown };
  radiusMiles?: unknown;
  now?: number;
}

export function buildAwarenessState(input: AwarenessInput): MarketAwarenessState {
  const now = input.now ?? Date.now();
  const reasons: string[] = [];
  const fields = {} as Record<IdentityDimension, IdentityField>;

  const dimensions: IdentityDimension[] = [
    "year", "make", "model", "trim", "drivetrain", "powertrain",
    "bodyType", "vehicleClass", "certification", "mileage", "equipment", "zip",
  ];

  for (const dimension of dimensions) {
    if (dimension === "equipment") continue;
    fields[dimension] = resolveIdentityField(input.claims[dimension] ?? [], { now });
  }

  // Equipment is the one dimension with a source allow-list: only a window
  // sticker, a build sheet or the dealer may establish what a car was built
  // with. A listing feed's free text and marketing copy may not.
  const equipmentSource = input.equipment?.source ?? "none";
  const equipmentAuthoritative = AUTHORITATIVE_SOURCES.includes(equipmentSource);
  const equipment = equipmentAuthoritative
    ? classifyEquipment(input.equipment?.entries)
    : { cohortDefining: [], descriptive: [], unknown: true, reasons: [`equipment_source_${equipmentSource}_not_authoritative`] };

  fields.equipment = {
    value: equipment.unknown ? null : equipment.cohortDefining.join(","),
    normalized: equipment.unknown ? null : equipment.cohortDefining.join(","),
    source: equipmentAuthoritative ? equipmentSource : "none",
    sourceTimestamp: typeof input.equipment?.timestamp === "string" ? input.equipment.timestamp : null,
    status: equipment.unknown ? "missing" : "verified",
    candidates: [],
    reasons: equipment.reasons,
  };

  const equipmentSignature = equipment.unknown
    ? null
    : digest({ kind: "equipment_cohort", items: equipment.cohortDefining });

  const known = dimensions.filter((d) => fields[d].status === "verified" || fields[d].status === "derived");
  const unknown = dimensions.filter((d) => fields[d].status === "missing");
  const conflicts = dimensions.filter((d) => fields[d].status === "conflicting");
  const stale = dimensions.filter((d) => fields[d].status === "stale");

  // A conflict on any cohort-defining dimension makes the vehicle unsafe to
  // compare. Not "lower confidence" — unsafe, because the cohort key would be
  // built from a value we have reason to disbelieve.
  const conflictedCohortDimension = conflicts.some((d) => COHORT_DEFINING_DIMENSIONS.includes(d));
  if (conflictedCohortDimension) reasons.push("awareness_cohort_dimension_conflicted");
  for (const d of conflicts) reasons.push(`${d}_conflict`);
  for (const d of unknown) reasons.push(`${d}_unknown`);

  const safeToCompare = !conflictedCohortDimension;
  if (safeToCompare) reasons.push("awareness_safe_to_compare");

  return {
    awarenessRulesVersion: AWARENESS_RULES_VERSION,
    fields, equipment, equipmentSignature,
    geography: {
      zip: fields.zip.normalized,
      radiusMiles: typeof input.radiusMiles === "number" && input.radiusMiles > 0 ? input.radiusMiles : null,
      source: fields.zip.source,
    },
    known, unknown, conflicts, stale, safeToCompare, reasons,
  };
}
