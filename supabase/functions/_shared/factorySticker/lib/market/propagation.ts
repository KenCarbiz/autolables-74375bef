// GENERATED — do not edit.
// Mirror of src/lib/market/propagation.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Which cars a changed market reaches, and how far it may spread ─────────
//
// One ingested QX60 produces one snapshot event. That event may reach the
// three identical QX60s already on the lot. Those three must NOT each produce
// another snapshot event, or one car arriving becomes an inventory-wide storm
// that bills a dealer for evidence we already hold.
//
// So propagation is one hop, by construction. The planner is pure: it takes
// the cohort, the inventory, the pilot cohort and the evidence already on
// record, and returns a deterministic, deduplicated, capped list of VINs. It
// performs no I/O, schedules nothing, and — critically — a plan entry carries
// `providerPolicy: "disabled"` as a literal type, so an edit that tries to let
// propagation spend does not compile.
//
// What is NEVER copied to a sibling: the triggering vehicle's prediction,
// marketP50, confidence, verdict, difference or market position. The sibling
// gets the same EVIDENCE and computes its own answer, which may legitimately
// be a different answer — or no answer at all.

import type { MarketCohortKey } from "./cohort.ts";
import {
  marketAwarenessRelationship, mayReceiveMarketAwareness, valuationCompatibility,
  mayServeAsPrimaryComparable, isContextOnlyEvidence,
  type ValuationCompatibility,
} from "./relationship.ts";
import type { MarketAwarenessState } from "./awareness.ts";
import { MAX_SHADOW_COHORT } from "./shadowPipeline.ts";

/** One hop. A propagated evaluation may never originate another snapshot. */
export type PropagationDepth = 0 | 1;
export const MAX_PROPAGATION_DEPTH: PropagationDepth = 1;

/** How many siblings one invocation may plan, before continuation. */
export const MAX_PLAN_PER_INVOCATION = 25;

export interface InventoryCandidate {
  vin: string;
  tenantId: string;
  cohortKey: MarketCohortKey;
  /** The vehicle's last completed valuation fingerprint, if any. */
  lastValuationFingerprint?: string | null;
  /** The fingerprint this vehicle WOULD produce against the new snapshot. */
  nextValuationFingerprint: string;
  /** When this vehicle was last evaluated, for the nightly cap. */
  lastEvaluatedAt?: string | null;
  /**
   * The sibling's own awareness state.
   *
   * A car whose drivetrain or certification is CONFLICTED cannot be placed in
   * a cohort at all — the key would be built from a value we have reason to
   * disbelieve. Checked before the cohort comparison, because comparing two
   * keys when one of them is unreliable produces a confident wrong answer.
   */
  awareness?: MarketAwarenessState | null;
}

export interface PlannedReevaluation {
  vin: string;
  /** Literal type: propagation can never be granted provider access. */
  providerPolicy: "disabled";
  /**
   * How this vehicle relates to the triggering one AS A COMPARABLE.
   *
   * Carried on the plan because the two answers are different: a vehicle is
   * planned because it shares a MARKET, and what its evidence may then be
   * used for depends on this. `adjustment_required` is planned and is
   * context-only — it gets a fresh look and cannot produce a value.
   */
  valuationCompatibility: ValuationCompatibility;
  /** True unless this vehicle is an exact, unadjusted comparable. */
  evidenceContextOnly: boolean;
  reasons: string[];
}

export interface RejectedCandidate {
  vin: string;
  reasons: string[];
}

export interface PropagationPlan {
  planned: PlannedReevaluation[];
  rejected: RejectedCandidate[];
  /**
   * Neither compatible nor proven different — the evidence is missing.
   *
   * Separate from `rejected` on purpose: this is the enrichment work list, and
   * collapsing it into rejections is how a fixable gap becomes invisible.
   */
  indeterminate: RejectedCandidate[];
  /** More candidates remain; hand this back to continue. Null when complete. */
  continuationCursor: string | null;
  usedSharedEvidence: true;
  /** Always zero. Propagation reuses evidence; it never buys any. */
  providerCallsCaused: 0;
  providerCostCaused: 0;
  reasons: string[];
}

/** One completed nightly cycle. A vehicle is reevaluated at most once inside it. */
export const NIGHTLY_CYCLE_HOURS = 20;

const withinNightlyCycle = (lastEvaluatedAt: unknown, now: number): boolean => {
  if (typeof lastEvaluatedAt !== "string") return false;
  const t = Date.parse(lastEvaluatedAt);
  if (!Number.isFinite(t)) return false;
  return (now - t) / 3_600_000 < NIGHTLY_CYCLE_HOURS;
};

export function planImpactedInventory(input: {
  /** The tenant whose market moved. Work never crosses this boundary. */
  tenantId: string;
  /** The cohort the changed snapshot describes. */
  cohortKey: MarketCohortKey;
  /** The VIN whose ingestion triggered this. Excluded if already evaluated. */
  subjectVin: string;
  subjectAlreadyEvaluated: boolean;
  /** The tenant's inventory. */
  inventory: InventoryCandidate[];
  /** The approved pilot cohort. Nothing outside it is ever planned. */
  pilotVins: string[];
  /** How deep this invocation already is. Depth 1 plans nothing. */
  depth: PropagationDepth;
  now?: number;
  cursor?: string | null;
}): PropagationPlan {
  const reasons: string[] = [];
  const now = input.now ?? Date.now();
  const empty = (reason: string): PropagationPlan => ({
    planned: [], rejected: [], indeterminate: [], continuationCursor: null,
    usedSharedEvidence: true, providerCallsCaused: 0, providerCostCaused: 0,
    reasons: [...reasons, reason],
  });

  // Loop safety, checked first. A propagated evaluation is a leaf.
  if (input.depth >= MAX_PROPAGATION_DEPTH) {
    return empty("propagation_depth_exhausted");
  }
  if (!input.tenantId) return empty("propagation_tenant_missing");
  if (!input.cohortKey.usable) return empty("propagation_cohort_not_usable");

  const pilot = new Set(input.pilotVins.map((v) => v.trim().toUpperCase()));
  if (pilot.size === 0) return empty("propagation_pilot_cohort_empty");
  if (pilot.size > MAX_SHADOW_COHORT) return empty("propagation_pilot_cohort_too_large");

  const subject = input.subjectVin.trim().toUpperCase();
  const planned: PlannedReevaluation[] = [];
  const rejected: RejectedCandidate[] = [];
  const indeterminate: RejectedCandidate[] = [];
  const seen = new Set<string>();

  // Deterministic order, so the same inputs always produce the same plan and
  // the same continuation boundary.
  const ordered = [...input.inventory].sort((a, b) =>
    a.vin.toUpperCase() < b.vin.toUpperCase() ? -1 : a.vin.toUpperCase() > b.vin.toUpperCase() ? 1 : 0);

  let started = !input.cursor;
  let cursor: string | null = null;

  for (const candidate of ordered) {
    const vin = candidate.vin.trim().toUpperCase();
    if (!started) {
      if (vin === input.cursor) started = true;
      continue;
    }
    if (seen.has(vin)) continue;
    seen.add(vin);

    const why: string[] = [];

    // Tenant isolation. Tenant A's market may never schedule tenant B's car.
    if (candidate.tenantId !== input.tenantId) {
      rejected.push({ vin, reasons: ["propagation_cross_tenant_refused"] });
      continue;
    }
    if (!pilot.has(vin)) {
      rejected.push({ vin, reasons: ["propagation_outside_pilot_cohort"] });
      continue;
    }
    if (vin === subject && input.subjectAlreadyEvaluated) {
      rejected.push({ vin, reasons: ["propagation_subject_already_evaluated"] });
      continue;
    }

    // Identity conflicts first. A conflicted cohort key is built from a value
    // we have reason to disbelieve, and comparing it produces a confident
    // wrong answer rather than an honest refusal.
    if (candidate.awareness && !candidate.awareness.safeToCompare) {
      rejected.push({
        vin,
        reasons: ["propagation_identity_conflicted", ...candidate.awareness.conflicts.map((d) => `${d}_conflict`)],
      });
      continue;
    }

    // LAYER A — did this car's market move? Equipment has no vote here. A
    // Vision Package does not put a QX60 in a different market; it moves its
    // position within one.
    const market = marketAwarenessRelationship(input.cohortKey, candidate.cohortKey);
    if (market.relationship === "indeterminate") {
      indeterminate.push({ vin, reasons: market.reasons });
      continue;
    }
    if (!mayReceiveMarketAwareness(market)) {
      rejected.push({ vin, reasons: market.reasons });
      continue;
    }

    // LAYER B — what may its evidence then be USED for? Planned either way;
    // only `exact` may later serve as an unadjusted primary comparable.
    const compatibility = valuationCompatibility(input.cohortKey, candidate.cohortKey);
    why.push(...market.reasons, ...compatibility.reasons);

    // The same answer already exists. Recomputing it would add a duplicate row
    // and bury the day something changed.
    if (candidate.lastValuationFingerprint === candidate.nextValuationFingerprint) {
      rejected.push({ vin, reasons: ["propagation_valuation_fingerprint_unchanged"] });
      continue;
    }

    if (withinNightlyCycle(candidate.lastEvaluatedAt, now)) {
      rejected.push({ vin, reasons: ["propagation_nightly_cap_reached"] });
      continue;
    }

    if (planned.length >= MAX_PLAN_PER_INVOCATION) {
      // Bounded fan-out. The rest is handed back as a cursor rather than
      // spawned, so nothing unbounded is ever in flight.
      cursor = vin;
      reasons.push("propagation_continuation_required");
      break;
    }

    planned.push({
      vin,
      providerPolicy: "disabled",
      valuationCompatibility: compatibility.compatibility,
      evidenceContextOnly: !mayServeAsPrimaryComparable(compatibility)
        || isContextOnlyEvidence(compatibility),
      reasons: why,
    });
  }

  reasons.push(
    `propagation_planned_${planned.length}`,
    `propagation_rejected_${rejected.length}`,
    `propagation_indeterminate_${indeterminate.length}`,
    `propagation_exact_comparables_${planned.filter((p) => p.valuationCompatibility === "exact").length}`,
    `propagation_adjustment_required_${planned.filter((p) => p.valuationCompatibility === "adjustment_required").length}`,
  );

  return {
    planned, rejected, indeterminate,
    continuationCursor: cursor,
    usedSharedEvidence: true,
    providerCallsCaused: 0,
    providerCostCaused: 0,
    reasons,
  };
}

/**
 * Fields that may never travel from the triggering vehicle to a sibling.
 *
 * Enumerated so the tamper test can assert a plan entry carries none of them —
 * the plan is a list of VINs to RECOMPUTE, not a result to copy.
 */
export const NEVER_PROPAGATED_FIELDS = [
  "providerPrediction",
  "provider_prediction",
  "marketP50",
  "market_p50",
  "confidence",
  "verdict",
  "difference",
  "marketPosition",
  "market_position",
] as const;
