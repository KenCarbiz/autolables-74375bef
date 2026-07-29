// ─────────────────────────────────────────────────────────────────────
// Versioned pricing and token accounting for AI description generation.
//
// One rule drives the whole module: an estimate is never presented as a
// provider charge. `state` records where every number came from, and a
// record whose inputs are unknown carries a null amount rather than a
// zero — a zero is a claim that the call was free, and an operator will
// act on it.
//
// Prices change. Every record keeps the pricing version it was computed
// under, so a later price change applies to future work and never
// rewrites what a past generation cost.
// ─────────────────────────────────────────────────────────────────────

export const PRICING_TABLE_VERSION = "pricing_2026_07";

export interface ModelPricing {
  model: string;
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
  currency: "USD";
  effectiveFrom: string;
}

// The model keys this repo actually sends: the settings-level keys in
// ai-description's MODEL_IDS plus the dated id it forwards to Anthropic.
// A cost record must be resolvable from either side of that mapping.
export const PRICING_TABLE: ModelPricing[] = [
  {
    model: "claude-opus-5",
    provider: "anthropic",
    inputPerMillion: 5,
    outputPerMillion: 25,
    cachedInputPerMillion: 0.5,
    currency: "USD",
    effectiveFrom: "2026-07-01",
  },
  {
    model: "claude-sonnet-5",
    provider: "anthropic",
    inputPerMillion: 3,
    outputPerMillion: 15,
    cachedInputPerMillion: 0.3,
    currency: "USD",
    effectiveFrom: "2026-07-01",
  },
  {
    model: "claude-haiku-4-5",
    provider: "anthropic",
    inputPerMillion: 1,
    outputPerMillion: 5,
    cachedInputPerMillion: 0.1,
    currency: "USD",
    effectiveFrom: "2026-07-01",
  },
  {
    model: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    inputPerMillion: 1,
    outputPerMillion: 5,
    cachedInputPerMillion: 0.1,
    currency: "USD",
    effectiveFrom: "2026-07-01",
  },
];

const BY_MODEL = new Map(PRICING_TABLE.map((p) => [p.model, p]));

export function pricingFor(model: string): ModelPricing | undefined {
  return BY_MODEL.get(String(model || "").trim());
}

export type CostState =
  | "provider_reported"
  | "calculated_estimate"
  | "pending"
  | "unavailable"
  | "reconciled";

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
}

export interface CostRecord {
  provider: string;
  model: string;
  usage: TokenUsage;
  state: CostState;
  amount: number | null;
  currency: string;
  pricingVersion: string;
  note?: string;
}

const DEFAULT_CURRENCY = "USD";

export function computeCost(
  model: string,
  usage: TokenUsage,
  providerReported?: number | null,
): CostRecord {
  const pricing = pricingFor(model);
  const base = {
    provider: pricing?.provider ?? "unknown",
    model,
    usage,
    currency: pricing?.currency ?? DEFAULT_CURRENCY,
    pricingVersion: PRICING_TABLE_VERSION,
  };

  // A number the provider billed outranks anything we can derive, even when
  // the model is missing from the table — it is the charge, not a guess at it.
  if (typeof providerReported === "number" && Number.isFinite(providerReported)) {
    return { ...base, state: "provider_reported", amount: providerReported };
  }

  if (!pricing) {
    return {
      ...base,
      state: "unavailable",
      amount: null,
      note: `no pricing entry for "${model}" in ${PRICING_TABLE_VERSION}`,
    };
  }

  if (usage.inputTokens === null || usage.outputTokens === null) {
    return {
      ...base,
      state: "pending",
      amount: null,
      note: "token usage not reported; cost is unknown, not zero",
    };
  }

  // Providers report input tokens net of cache reads, so cached tokens are an
  // addition to the bill rather than a discount already folded into input.
  const cached = usage.cachedInputTokens ?? 0;
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const amount = roundMoney(
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
      (usage.outputTokens / 1_000_000) * pricing.outputPerMillion +
      (cached / 1_000_000) * cachedRate,
  );

  return { ...base, state: "calculated_estimate", amount };
}

/**
 * Approximates tokens at ~4 characters per token. This is an ESTIMATE and is
 * only ever used to build a `calculated_estimate` record — never to reconcile
 * or replace a provider-reported count.
 */
export function estimateTokens(text: string): number {
  const chars = String(text || "").length;
  return Math.ceil(chars / 4);
}

export function estimateRequestCost(
  model: string,
  promptText: string,
  expectedOutputChars: number,
): CostRecord {
  const outputChars = Number.isFinite(expectedOutputChars)
    ? Math.max(0, expectedOutputChars)
    : 0;
  const record = computeCost(model, {
    inputTokens: estimateTokens(promptText),
    outputTokens: Math.ceil(outputChars / 4),
  });
  return {
    ...record,
    note: record.note ?? `estimated at ~4 chars/token before the request was sent`,
  };
}

export function sumCost(records: CostRecord[]): {
  total: number;
  currency: string;
  anyEstimated: boolean;
  anyUnavailable: boolean;
} {
  let total = 0;
  let currency: string | null = null;
  let anyEstimated = false;
  let anyUnavailable = false;

  for (const r of records) {
    if (r.state === "calculated_estimate") anyEstimated = true;
    // Pending counts as unavailable: the caller has one flag to learn that the
    // total is incomplete, and an unpriced call is missing from it either way.
    if (r.amount === null) anyUnavailable = true;
    if (r.amount === null) continue;

    // Adding two currencies together produces a number that means nothing.
    // Fail loudly rather than hand back a plausible-looking total.
    if (currency !== null && r.currency !== currency) {
      throw new Error(`cannot sum costs across currencies: ${currency} and ${r.currency}`);
    }
    currency = r.currency;
    total += r.amount;
  }

  return {
    total: roundMoney(total),
    currency: currency ?? DEFAULT_CURRENCY,
    anyEstimated,
    anyUnavailable,
  };
}

const roundMoney = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
