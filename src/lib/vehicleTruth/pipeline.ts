// The per-VIN pipeline ledger.
//
// A vehicle does not have "a document state" — it has five, one per
// document family, and they move independently. A corrected MSRP makes the
// OEM reproduction stale while leaving the Buyers Guide untouched; a
// changed warranty selection does the reverse. Tracking one status per
// vehicle would either regenerate everything on every change or miss the
// change that mattered.
//
// So the ledger is per (vehicle, family), and staleness is derived from
// the truth layer rather than guessed: a document is stale when a snapshot
// newer than the one it was generated from listed its family as affected.
// That is the same routing `detectMaterialChange` already computes, which
// is what keeps the ledger and the documents from disagreeing about
// whether work is outstanding.

import {
  applicableFamilies,
  classifyCondition,
  type DocumentFamilyId,
} from "../documents/families.ts";

export type PipelineStage =
  | "not_applicable"
  | "awaiting_data"
  | "blocked"
  | "ready"
  | "generating"
  | "generated"
  | "review_required"
  | "approved"
  | "published"
  | "failed";

export type PipelineAction =
  | "none"
  | "await_data"
  | "resolve_conflict"
  | "generate"
  | "regenerate"
  | "review"
  | "publish"
  | "retry";

/** Stages a document has actually been produced in. */
const PRODUCED: PipelineStage[] = ["generated", "review_required", "approved", "published"];

export const isProduced = (stage: PipelineStage): boolean => PRODUCED.includes(stage);

/** Stages where nothing is outstanding and nothing is in flight. */
const SETTLED: PipelineStage[] = ["not_applicable", "published"];

export interface PipelineInput {
  family: DocumentFamilyId;
  condition: string | null | undefined;
  /** Current truth-snapshot version, or null when none has been resolved. */
  currentSnapshotVersion: number | null;
  /** Snapshot version the existing document was generated from. */
  generatedFromVersion?: number | null;
  /** Document state as recorded by the generator, if one exists. */
  documentStatus?: PipelineStage | null;
  /**
   * Families listed as affected by every snapshot after
   * `generatedFromVersion`, flattened. Only this family's presence matters.
   */
  affectedSinceGenerated?: DocumentFamilyId[];
  /** Open conflicts on manufacturer facts, which stop a reproduction. */
  blockingConflicts?: number;
  /**
   * Whether the inputs this family needs are present — a build sheet for
   * the OEM reproduction, a warranty selection for the Buyers Guide.
   */
  hasRequiredInputs?: boolean;
  /** Consecutive generation failures. */
  failureCount?: number;
}

export interface PipelineState {
  family: DocumentFamilyId;
  stage: PipelineStage;
  /** Applies to the vehicle at all? Drives whether it is shown as work. */
  applicable: boolean;
  required: boolean;
  /** A produced document the truth layer has since moved past. */
  stale: boolean;
  nextAction: PipelineAction;
  /** Plain-language reason, shown to staff as-is. */
  reason: string;
  /** True when this family is waiting on a person, not on the pipeline. */
  needsAttention: boolean;
}

const REASONS: Record<string, string> = {
  not_applicable: "Does not apply to this vehicle",
  unresolved_condition: "Vehicle condition is unresolved, so document eligibility cannot be decided",
  no_snapshot: "No vehicle snapshot has been resolved yet",
  awaiting_data: "Waiting on the source data this document needs",
  blocked: "A manufacturer data conflict must be resolved by a person first",
  ready: "Ready to generate",
  generating: "Generating",
  stale: "Vehicle data changed after this document was generated",
  generated: "Generated, not yet approved",
  review_required: "Needs review before it can be published",
  approved: "Approved, not yet published",
  published: "Published",
  failed: "Generation failed",
};

/**
 * Resolve one family's position in the pipeline.
 *
 * Order matters: a family that does not apply is never "outstanding work",
 * and a blocking conflict outranks readiness — generating a reproduction
 * from disputed manufacturer data would produce a confident-looking
 * document nobody has agreed with.
 */
export function computePipelineState(input: PipelineInput): PipelineState {
  const { family } = input;
  const cls = classifyCondition(input.condition);
  const applicability = applicableFamilies(input.condition)
    .find((f) => f.family === family)?.applicability ?? "not_applicable";
  const required = applicability === "required";

  const base = { family, applicable: applicability !== "not_applicable", required };

  if (cls === "unknown") {
    return {
      ...base, applicable: false, stage: "not_applicable", stale: false,
      nextAction: "none", reason: REASONS.unresolved_condition, needsAttention: true,
    };
  }
  if (applicability === "not_applicable") {
    return {
      ...base, stage: "not_applicable", stale: false,
      nextAction: "none", reason: REASONS.not_applicable, needsAttention: false,
    };
  }

  const status = input.documentStatus ?? null;
  const produced = !!status && isProduced(status);
  const stale = produced
    && (input.affectedSinceGenerated ?? []).includes(family);

  // A failure is reported before readiness so a repeatedly failing family
  // is never presented as simply "ready" again and again.
  if (status === "failed") {
    return {
      ...base, stage: "failed", stale: false,
      nextAction: (input.failureCount ?? 0) >= 3 ? "review" : "retry",
      reason: REASONS.failed, needsAttention: true,
    };
  }

  if ((input.blockingConflicts ?? 0) > 0) {
    return {
      ...base, stage: "blocked", stale,
      nextAction: "resolve_conflict", reason: REASONS.blocked, needsAttention: true,
    };
  }

  if (status === "generating") {
    return {
      ...base, stage: "generating", stale: false,
      nextAction: "none", reason: REASONS.generating, needsAttention: false,
    };
  }

  if (stale) {
    return {
      ...base, stage: status!, stale: true,
      nextAction: "regenerate", reason: REASONS.stale, needsAttention: required,
    };
  }

  if (produced) {
    return {
      ...base, stage: status!, stale: false,
      nextAction: status === "published" ? "none"
        : status === "approved" ? "publish"
        : status === "review_required" ? "review" : "publish",
      reason: REASONS[status!] ?? "",
      needsAttention: status === "review_required" || (required && status !== "published"),
    };
  }

  if (input.currentSnapshotVersion === null) {
    return {
      ...base, stage: "awaiting_data", stale: false,
      nextAction: "await_data", reason: REASONS.no_snapshot, needsAttention: required,
    };
  }

  if (input.hasRequiredInputs === false) {
    return {
      ...base, stage: "awaiting_data", stale: false,
      nextAction: "await_data", reason: REASONS.awaiting_data, needsAttention: required,
    };
  }

  return {
    ...base, stage: "ready", stale: false,
    nextAction: "generate", reason: REASONS.ready, needsAttention: required,
  };
}

export interface VehiclePipelineInput {
  condition: string | null | undefined;
  currentSnapshotVersion: number | null;
  blockingConflicts?: number;
  /** Per-family detail, keyed by family. Absent means nothing produced. */
  families?: Partial<Record<DocumentFamilyId, Omit<PipelineInput, "family" | "condition" | "currentSnapshotVersion" | "blockingConflicts">>>;
}

export interface VehiclePipeline {
  states: PipelineState[];
  /** Families that apply and are not finished. */
  outstanding: PipelineState[];
  /** Families a person has to act on. */
  needsAttention: PipelineState[];
  /** Every required family is published. */
  compliant: boolean;
  /** 0-1 across applicable families, for a progress indicator. */
  completion: number;
}

/**
 * The whole vehicle, family by family.
 *
 * `compliant` deliberately asks only about REQUIRED families: an FTC
 * Buyers Guide missing from a used vehicle is a legal problem, an
 * ungenerated addendum is not.
 */
export function computeVehiclePipeline(input: VehiclePipelineInput): VehiclePipeline {
  const states = applicableFamilies(input.condition).map(({ family }) =>
    computePipelineState({
      family,
      condition: input.condition,
      currentSnapshotVersion: input.currentSnapshotVersion,
      blockingConflicts: family === "oem_window_sticker_reproduction"
        ? input.blockingConflicts
        // A manufacturer conflict stops the manufacturer document. It does
        // not stop a dealer addendum or a required federal disclosure.
        : 0,
      ...(input.families?.[family] ?? {}),
    }));

  const applicable = states.filter((s) => s.applicable);
  const settled = applicable.filter((s) => SETTLED.includes(s.stage) && !s.stale);
  const requiredStates = states.filter((s) => s.required);

  return {
    states,
    outstanding: applicable.filter((s) => s.stage !== "published" || s.stale),
    needsAttention: states.filter((s) => s.needsAttention),
    compliant: requiredStates.length > 0
      && requiredStates.every((s) => s.stage === "published" && !s.stale),
    completion: applicable.length ? settled.length / applicable.length : 1,
  };
}

/**
 * Which families a snapshot transition invalidates.
 *
 * Takes the `affected_families` recorded on each snapshot newer than the
 * one a document was built from. Snapshots carry the wider
 * DocumentFamilyKey set (which includes `description` and `passport`), so
 * anything that is not one of the five document families is dropped here
 * rather than being invented into one.
 */
export function familiesInvalidatedBy(
  affectedPerSnapshot: string[][],
): DocumentFamilyId[] {
  const known = new Set<string>(
    applicableFamilies("used").concat(applicableFamilies("new")).map((f) => f.family),
  );
  const out = new Set<DocumentFamilyId>();
  for (const list of affectedPerSnapshot) {
    for (const key of list) {
      if (known.has(key)) out.add(key as DocumentFamilyId);
    }
  }
  return [...out];
}
