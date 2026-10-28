// ── Plumbing shared by the used and new Passport read-model builders ───────

import { containsForbiddenKey, type Freshness, type FreshnessSummary, type PublicState } from "../contracts.ts";

export const PASSPORT_READ_MODELS_VERSION = "passport-read-models-1.0.0";

export type ReadModelErrorCode = "vehicle_type_mismatch" | "forbidden_key";

/** A builder refuses the wrong vehicle type and any conclusion that carries raw provider material. */
export class ReadModelInputError extends Error {
  readonly code: ReadModelErrorCode;

  constructor(code: ReadModelErrorCode, message: string) {
    super(message);
    this.name = "ReadModelInputError";
    this.code = code;
  }
}

/** Only an explicit new condition selects the new passport; every other condition is a used vehicle. */
export const isNewCondition = (condition: string | null | undefined): boolean =>
  (condition ?? "").trim().toLowerCase() === "new";

const CARRIED_STATES: readonly PublicState[] = ["adverse", "warning", "unavailable"];

/**
 * One row of a read model's freshness table. Staleness wins over whatever the
 * fact said; a fact with no date keeps an adverse, warning or unavailable
 * state because those are not claims that a date would strengthen.
 */
export function freshnessEntry(args: {
  key: string;
  label: string;
  freshness: Freshness;
  source: string | null;
  factState?: PublicState | null;
}): FreshnessSummary {
  const f = args.freshness;
  const carried = args.factState ?? null;
  const state: PublicState =
    f.state === "stale" ? "stale"
    : f.state === "unknown" ? (carried != null && CARRIED_STATES.includes(carried) ? carried : "unknown")
    : carried ?? "verified";
  return { key: args.key, label: args.label, checkedAt: f.checkedAt, state, ttlDays: f.ttlDays, source: args.source };
}

export function assertPublishableShape(model: unknown, modelName: string): void {
  const key = containsForbiddenKey(model);
  if (key) throw new ReadModelInputError("forbidden_key", `${modelName} carries the forbidden key "${key}"`);
}
