// Review & Apply: the change-safety contract for consequential settings. A
// draft is validated, its impact computed against a known version, reviewed,
// and only then applied with that version and an idempotency key. Opening a
// review writes nothing. Stale impact, unknown counts or a version mismatch
// block apply; a partial result stays visible as partial.

export type ReviewApplyPhase =
  | "editing"
  | "validating"
  | "reviewing"
  | "applying"
  | "applied"
  | "partial"
  | "failed"
  | "conflict"
  | "invalidated";

export interface ImpactSnapshot {
  computedAt: string;
  /** Version of the policy the impact was computed against. */
  version: string | number | null;
  /** Null means the count could not be determined; apply is blocked. */
  counts: Record<string, number | null>;
  samples: unknown[];
  warnings: string[];
  exclusions: string[];
}

export interface ApplyResult {
  status: "applied" | "partial" | "failed";
  affected: number | null;
  message: string;
  auditEventId?: string | null;
}

export interface ReviewApplyState<T> {
  phase: ReviewApplyPhase;
  original: T;
  draft: T;
  validation: string[];
  impact: ImpactSnapshot | null;
  idempotencyKey: string | null;
  result: ApplyResult | null;
  error: string | null;
  changedElsewhere: string[];
}

export type ReviewApplyEvent<T> =
  | { type: "edit"; draft: T }
  | { type: "validate"; errors: string[] }
  | { type: "review"; impact: ImpactSnapshot; idempotencyKey: string }
  | { type: "apply" }
  | { type: "result"; result: ApplyResult }
  | { type: "error"; message: string }
  | { type: "conflict"; changedFields: string[] }
  | { type: "invalidate"; reason: string }
  | { type: "reset"; original?: T };

export const initialReviewApply = <T>(original: T): ReviewApplyState<T> => ({
  phase: "editing",
  original,
  draft: original,
  validation: [],
  impact: null,
  idempotencyKey: null,
  result: null,
  error: null,
  changedElsewhere: [],
});

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export const isUnchanged = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

export function reviewApplyReducer<T>(state: ReviewApplyState<T>, event: ReviewApplyEvent<T>): ReviewApplyState<T> {
  switch (event.type) {
    case "edit":
      // Any edit after review discards the impact: it was computed for a different draft.
      return { ...state, phase: "editing", draft: event.draft, impact: null, idempotencyKey: null, result: null, error: null, validation: [] };
    case "validate":
      return { ...state, phase: event.errors.length ? "editing" : "validating", validation: event.errors };
    case "review":
      if (state.validation.length) return state;
      return { ...state, phase: "reviewing", impact: event.impact, idempotencyKey: event.idempotencyKey, error: null };
    case "apply": {
      const gate = canApply(state);
      if (!gate.ok) return { ...state, error: gate.reason ?? null };
      return { ...state, phase: "applying", error: null };
    }
    case "result":
      return { ...state, phase: event.result.status, result: event.result, original: event.result.status === "applied" ? state.draft : state.original };
    case "error":
      return { ...state, phase: state.phase === "applying" ? "failed" : state.phase, error: event.message };
    case "conflict":
      return { ...state, phase: "conflict", changedElsewhere: event.changedFields, impact: null, idempotencyKey: null };
    case "invalidate":
      return { ...state, phase: "invalidated", impact: null, idempotencyKey: null, error: event.reason };
    case "reset":
      return initialReviewApply(event.original ?? state.original);
    default:
      return state;
  }
}

export interface ApplyGate {
  ok: boolean;
  reason?: string;
}

/** The server re-checks all of this; the client refuses early so a stale review never looks applicable. */
export function canApply<T>(state: ReviewApplyState<T>, currentVersion?: string | number | null): ApplyGate {
  if (state.phase !== "reviewing") return { ok: false, reason: "Review the change before applying it." };
  if (state.validation.length) return { ok: false, reason: "Fix the validation errors first." };
  if (isUnchanged(state.draft, state.original)) return { ok: false, reason: "Nothing has changed." };
  if (!state.impact) return { ok: false, reason: "The impact has not been computed." };
  if (Object.values(state.impact.counts).some((v) => v === null)) return { ok: false, reason: "The impact could not be fully determined, so the change cannot be applied." };
  if (!state.idempotencyKey) return { ok: false, reason: "No idempotency key." };
  if (currentVersion !== undefined && state.impact.version !== currentVersion) {
    return { ok: false, reason: "The policy changed after this review. Reload and review again." };
  }
  return { ok: true };
}

/** Deterministic enough for retries within a session; the server treats it as the dedup key. */
export const newIdempotencyKey = (scope: string): string =>
  `${scope}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;

/** The fields that differ between two flat records, for before/after tables. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: T): Array<{ field: keyof T & string; before: unknown; after: unknown }> {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])) as Array<keyof T & string>;
  return keys
    .filter((k) => !isUnchanged(before[k], after[k]))
    .map((k) => ({ field: k, before: before[k], after: after[k] }));
}
