// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/resolveField.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Choosing between candidates, and saying how current the winner is.
//
// The ranking is NOT reimplemented here. `precedenceFor` / `sourceRank` /
// `capConfidence` in the truth engine already encode field-specific
// authority (directive §9) and this module calls them, so a change to the
// engine cannot silently stop applying to the Vehicle File. What this
// module adds is the part the engine has never had: a freshness policy
// (§10), computed from the writer's own stamp rather than from
// `vehicle_facts.observed_at`, which records when the orchestrator ran.

import {
  capConfidence,
  canProduceVerifiedFact,
  sourceRank,
  type Confidence,
  type SourceKind,
} from "../vehicleTruth/precedence.ts";
import type {
  FieldCandidate,
  FreshnessState,
  ParityClass,
  ResolvedField,
} from "./readModelTypes.ts";

/**
 * Read-model field -> truth-engine fact key.
 *
 * The engine's authority table is keyed by the fact names it already
 * stores; the read model's names are the ones a person uses. Anything not
 * mapped falls through to the field's own name, which the engine treats as
 * `shared` authority — the safe default, since it forces a real
 * disagreement to surface rather than letting one source assume priority.
 */
const FACT_KEY: Record<string, string> = {
  advertised_retail: "advertised_price",
  selling_price: "advertised_price",
  observed_price: "advertised_price",
  msrp_factory: "total_msrp",
  msrp_feed: "msrp",
  stock: "stock_number",
  certified: "is_certified",
  market_value: "market_value",
};

export const factKeyFor = (field: string): string => FACT_KEY[field] ?? field;

/**
 * How long a value of this kind stays believable (§10).
 *
 * A number is a policy, not a measurement, and each one is here because the
 * field behaves that way in this business:
 *
 *   - identity and factory build come off the VIN and do not change;
 *   - a dealer moves price and mileage constantly;
 *   - a website observation is evidence of a moment, and the crawler
 *     revisits on a rotation, so a fortnight-old capture is not "what the
 *     shopper sees" any more;
 *   - market analysis is recomputed by the provider on its own cadence;
 *   - a recall answer must be re-asked even when it never changes;
 *   - a completed repair is history and never expires.
 *
 * `null` means "does not expire". Absence from this table means the family
 * has no policy yet, which resolves to UNKNOWN rather than to CURRENT.
 */
export const FRESHNESS_DAYS: Record<string, number | null> = {
  // Identity / factory: stable for the life of the vehicle.
  vin: null,
  year: null,
  make: null,
  model: null,
  trim: null,
  body_style: null,
  engine: null,
  drivetrain: null,
  transmission: null,
  fuel_type: null,
  exterior_color: null,
  interior_color: null,
  msrp_factory: null,
  total_msrp: null,
  base_msrp: null,
  epa_city: null,
  epa_highway: null,
  // Dealer-controlled: volatile.
  stock: 30,
  stock_number: 30,
  mileage: 14,
  condition: 30,
  certified: 30,
  is_certified: 30,
  advertised_retail: 3,
  advertised_price: 3,
  selling_price: 3,
  doc_fee: 30,
  dealer_discount: 3,
  msrp_feed: 30,
  msrp: 30,
  in_transit: 3,
  // Public advertisement: evidence of a moment.
  observed_price: 7,
  observed_before_doc_fee: 7,
  observed_doc_fee: 7,
  observed_discount: 7,
  // Market analysis: the provider recomputes on its own cadence.
  market_value: 7,
  days_on_market: 2,
  comparable_count: 7,
  market_days_supply: 7,
  price_change_percent: 7,
  reference_price: 7,
  // Compliance: policy-driven, not change-driven.
  recall_status: 30,
  open_recall_count: 30,
  title_status: 90,
  title_verification: 90,
  // Historical events do not expire.
  completed_work: null,
};

const DAY_MS = 86_400_000;

export const ageInDays = (observedAt: string | null | undefined, now: number): number | null => {
  if (!observedAt) return null;
  const t = Date.parse(observedAt);
  if (Number.isNaN(t)) return null;
  return (now - t) / DAY_MS;
};

/** JSON equality, the same test the truth engine uses for candidate agreement. */
export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * String equality a person would accept: case and spacing differ between
 * five parsers reading the same feed, and "AWD" vs "awd" is not news.
 */
export const semanticallySame = (a: unknown, b: unknown): boolean => {
  if (sameValue(a, b)) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  const norm = (v: unknown) =>
    String(v).toLowerCase().replace(/[\s_-]+/g, " ").replace(/[^a-z0-9. ]/g, "").trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb;
};

export interface ResolveFieldOptions {
  /** Tenant's configured source order for this fact, best first. */
  configuredOrder?: SourceKind[] | null;
  /** Milliseconds since the epoch; injected so the result is testable. */
  now?: number;
  /** Override the freshness window, in days. */
  freshnessDays?: number | null;
  /**
   * Sentence explaining why a disagreement here is expected, not a fault.
   * It annotates the reason; on its own it does NOT silence a dispute,
   * because "these two often word it differently" and "these two may both
   * verify this and they disagree" are different claims and a caller must
   * be able to make the first without losing the second.
   */
  expectedDisagreement?: string | null;
  /**
   * Suppress the dispute flag for this field. Separate from the sentence
   * above so silencing a conflict is always a deliberate act.
   */
  suppressDispute?: boolean;
}

const rankOf = (factKey: string, c: FieldCandidate, order: SourceKind[] | null): number =>
  sourceRank(factKey, c.source, order);

const conf = (c: FieldCandidate): Confidence => capConfidence(c.source, c.confidence);
const CONFIDENCE_ORDER: Confidence[] = ["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"];

/**
 * Resolve one field.
 *
 * Ranking order is the engine's: authority first, then confidence, then
 * recency. Recency stays last on purpose — a fresh guess must not outrank a
 * manufacturer's answer — but a value whose source has gone quiet is
 * reported STALE rather than quietly presented as current.
 */
export function resolveField<T>(
  key: string,
  candidates: Array<FieldCandidate<T>>,
  options: ResolveFieldOptions = {},
): ResolvedField<T> {
  const now = options.now ?? Date.now();
  const factKey = factKeyFor(key);
  const order = options.configuredOrder ?? null;
  const usable = candidates.filter((c) => c.value !== null && c.value !== undefined && c.value !== "");

  if (!usable.length) {
    return {
      key,
      value: null,
      chosen: null,
      freshness: "UNKNOWN",
      ageDays: null,
      candidates: [...candidates],
      disagreeing: [],
      disputed: false,
      reason: candidates.length
        ? `Every candidate for ${key} was empty (${candidates.map((c) => c.origin).join(", ")}).`
        : `No source supplies ${key} for this vehicle.`,
    };
  }

  const ranked = [...usable].sort((a, b) => {
    const byRank = rankOf(factKey, a, order) - rankOf(factKey, b, order);
    if (byRank !== 0) return byRank;
    const byConf = CONFIDENCE_ORDER.indexOf(conf(a)) - CONFIDENCE_ORDER.indexOf(conf(b));
    if (byConf !== 0) return byConf;
    return String(b.observedAt ?? "").localeCompare(String(a.observedAt ?? ""));
  });

  const winner = ranked[0];
  const disagreeing = ranked.slice(1).filter((c) => !sameValue(c.value, winner.value));

  // A disagreement between two sources that may BOTH verify this fact is a
  // dispute for a person, not an outcome of ranking. An expected difference
  // (two MSRP concepts, a fee-inclusive vs fee-exclusive price) is named by
  // the caller and does not raise one.
  const disputed = !options.suppressDispute
    && disagreeing.some((c) =>
      canProduceVerifiedFact(c.source)
      && canProduceVerifiedFact(winner.source)
      && conf(c) === "VERIFIED"
      && conf(winner) === "VERIFIED");

  // A newer answer from a source of equal or better standing, disagreeing,
  // means the winner has been overtaken even though it still outranks on
  // authority — the case a pure ranking cannot express.
  const winnerRank = rankOf(factKey, winner, order);
  const winnerAge = ageInDays(winner.observedAt, now);
  const superseded = disagreeing.some((c) => {
    if (rankOf(factKey, c, order) > winnerRank) return false;
    const cAge = ageInDays(c.observedAt, now);
    return cAge != null && winnerAge != null && cAge < winnerAge;
  });

  const windowDays = options.freshnessDays !== undefined
    ? options.freshnessDays
    : (factKey in FRESHNESS_DAYS ? FRESHNESS_DAYS[factKey] : FRESHNESS_DAYS[key]);

  let freshness: FreshnessState;
  let reason: string;
  if (disputed) {
    freshness = "CONFLICTED";
    reason = `${winner.provider} says ${JSON.stringify(winner.value)} and ${disagreeing[0].provider} says `
      + `${JSON.stringify(disagreeing[0].value)}; both may verify ${factKey}, so a person decides.`;
  } else if (superseded) {
    freshness = "SUPERSEDED";
    reason = `A newer answer of equal or better standing disagrees (${disagreeing[0].provider}, `
      + `${disagreeing[0].observedAt ?? "unstamped"}).`;
  } else if (windowDays === undefined) {
    freshness = "UNKNOWN";
    reason = `${winner.provider} via ${winner.origin}; no freshness policy is defined for ${factKey}.`;
  } else if (windowDays === null) {
    freshness = "CURRENT";
    reason = `${winner.provider} via ${winner.origin}; this fact does not expire.`;
  } else if (winnerAge == null) {
    freshness = "UNKNOWN";
    reason = `${winner.provider} via ${winner.origin}; nothing stamps when the source observed it.`;
  } else if (winnerAge > windowDays) {
    freshness = "STALE";
    reason = `${winner.provider} via ${winner.origin}, last observed ${winnerAge.toFixed(1)} days ago; `
      + `policy for ${factKey} is ${windowDays} days.`;
  } else {
    freshness = "CURRENT";
    reason = `${winner.provider} via ${winner.origin}, observed ${winnerAge.toFixed(1)} days ago.`;
  }

  if (options.expectedDisagreement && disagreeing.length) {
    reason += ` Disagreement is expected: ${options.expectedDisagreement}`;
  }

  return {
    key,
    value: winner.value,
    chosen: winner,
    freshness,
    ageDays: winnerAge,
    candidates: ranked,
    disagreeing,
    disputed,
    reason,
  };
}

/** An empty resolved field, for a section that genuinely has no candidate. */
export function emptyField<T>(key: string, why: string): ResolvedField<T> {
  return {
    key,
    value: null,
    chosen: null,
    freshness: "UNKNOWN",
    ageDays: null,
    candidates: [],
    disagreeing: [],
    disputed: false,
    reason: why,
  };
}

export interface ParityInput {
  currentValue: unknown;
  resolved: ResolvedField<unknown>;
  /**
   * Named reason the two are allowed to differ (two MSRP concepts, a
   * fee-inclusive total against a fee-exclusive one). Supplying this is what
   * turns a mismatch into EXPECTED SOURCE DIFFERENCE; it may never be
   * supplied merely because a mismatch is inconvenient.
   */
  expectedDifference?: string | null;
  /** The current value is demonstrably wrong (evidence, not preference). */
  currentKnownWrong?: string | null;
  /** The resolved value is demonstrably wrong. */
  resolvedKnownWrong?: string | null;
}

/**
 * Classify one field on one vehicle for the shadow report (§50).
 *
 * UNEXPLAINED is the honest default. Every other verdict requires a reason,
 * and §51 forbids UNEXPLAINED entirely on VIN, stock, mileage and retail —
 * so the pressure this function is under is to invent an explanation. It
 * does not: a mismatch with no supplied reason stays UNEXPLAINED.
 */
export function classifyParity(input: ParityInput): { verdict: ParityClass; explanation: string } {
  const { currentValue, resolved } = input;
  const resolvedValue = resolved.value;
  const both = currentValue != null && currentValue !== "" && resolvedValue != null;

  if (sameValue(currentValue ?? null, resolvedValue ?? null)) {
    return {
      verdict: "MATCH",
      explanation: `Both read ${JSON.stringify(resolvedValue)}${resolved.chosen ? ` (${resolved.chosen.origin})` : ""}.`,
    };
  }

  if (both && semanticallySame(currentValue, resolvedValue)) {
    return {
      verdict: "SEMANTIC_MATCH",
      explanation: `Same value, different form: ${JSON.stringify(currentValue)} vs ${JSON.stringify(resolvedValue)}.`,
    };
  }

  if (input.currentKnownWrong) {
    return {
      verdict: "CURRENT_OLD_VALUE_WRONG",
      explanation: input.currentKnownWrong,
    };
  }

  if (input.resolvedKnownWrong) {
    return {
      verdict: "NEW_VALUE_WRONG",
      explanation: input.resolvedKnownWrong,
    };
  }

  if (input.expectedDifference) {
    return {
      verdict: "EXPECTED_SOURCE_DIFFERENCE",
      explanation: input.expectedDifference,
    };
  }

  // A stale winner that disagrees with what the app shows is the current
  // value being right and the ledger being behind — reported as the ledger
  // being wrong, which is what it is.
  if (resolved.freshness === "STALE" && both) {
    return {
      verdict: "NEW_VALUE_WRONG",
      explanation: `Resolved from a stale source: ${resolved.reason}`,
    };
  }

  if (resolvedValue == null && currentValue != null) {
    return {
      verdict: "UNEXPLAINED",
      explanation: `The app shows ${JSON.stringify(currentValue)} and no source supplies it. ${resolved.reason}`,
    };
  }

  if (currentValue == null && resolvedValue != null) {
    return {
      verdict: "CURRENT_OLD_VALUE_WRONG",
      explanation: `The app shows nothing while ${resolved.chosen?.provider ?? "a source"} supplies `
        + `${JSON.stringify(resolvedValue)} (${resolved.chosen?.origin ?? "unknown origin"}).`,
    };
  }

  return {
    verdict: "UNEXPLAINED",
    explanation: `App: ${JSON.stringify(currentValue)} (current path). Resolved: ${JSON.stringify(resolvedValue)}. `
      + `${resolved.reason} No rule explains the difference.`,
  };
}
