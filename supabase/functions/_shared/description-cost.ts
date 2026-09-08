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
  /** Set only on operator-supplied entries, so a stored record says which
   *  price list produced it and a later table change cannot be mistaken for
   *  the price that was actually applied. */
  version?: string;
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

// ── Operator-supplied prices ─────────────────────────────────────────
//
// The table above is a code constant, so a model it does not list can only be
// priced by a deploy. That is how a whole month of production ran unmeasured:
// the tenant was configured for a model with no entry, every record landed
// `unavailable` with a null amount, SUM(cost_amount) stayed 0, and the dollar
// budget reported 0% consumed no matter how much was spent.
//
// An operator can now supply the missing rate as configuration
// (DESCRIPTION_MODEL_PRICING, read by the edge function at boot). Overrides win
// over the table for the same key -- a published rate that has changed is
// exactly what this is for -- and every entry is validated before it is
// accepted, because a malformed price is worse than a missing one: it would
// make the number look measured.
export const PRICING_OVERRIDE_VERSION = `${PRICING_TABLE_VERSION}+operator`;

const OVERRIDES = new Map<string, ModelPricing>();

export interface PricingOverrideParse {
  entries: ModelPricing[];
  errors: string[];
}

/**
 * Reads an operator price list. Never throws: a bad configuration string must
 * leave the system unpriced-but-honest, not crash the generator.
 */
export function parsePricingOverrides(raw: string | null | undefined): PricingOverrideParse {
  const text = String(raw ?? "").trim();
  if (!text) return { entries: [], errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { entries: [], errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];

  const entries: ModelPricing[] = [];
  const errors: string[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const model = String(row.model ?? "").trim();
    const input = Number(row.inputPerMillion);
    const output = Number(row.outputPerMillion);
    const cachedRaw = row.cachedInputPerMillion;
    const cached = cachedRaw === undefined || cachedRaw === null ? undefined : Number(cachedRaw);
    const currency = String(row.currency ?? "USD").toUpperCase();

    if (!model) { errors.push("an entry has no model key"); continue; }
    // Rejecting a zero rate is the whole point. A zero is a claim that the
    // call was free, and that claim is what an operator acts on.
    if (!(Number.isFinite(input) && input > 0) || !(Number.isFinite(output) && output > 0)) {
      errors.push(`"${model}" needs positive inputPerMillion and outputPerMillion`);
      continue;
    }
    if (cached !== undefined && !(Number.isFinite(cached) && cached >= 0)) {
      errors.push(`"${model}" has a non-numeric cachedInputPerMillion`);
      continue;
    }
    if (currency !== "USD") {
      errors.push(`"${model}" is priced in ${currency}; only USD is supported`);
      continue;
    }
    entries.push({
      model,
      provider: String(row.provider ?? "operator"),
      inputPerMillion: input,
      outputPerMillion: output,
      ...(cached === undefined ? {} : { cachedInputPerMillion: cached }),
      currency: "USD",
      effectiveFrom: String(row.effectiveFrom ?? "").trim() || new Date().toISOString().slice(0, 10),
      version: String(row.version ?? "").trim() || PRICING_OVERRIDE_VERSION,
    });
  }
  return { entries, errors };
}

/** Installs operator prices. Returns the model keys now priced by override. */
export function registerPricing(entries: ModelPricing[]): string[] {
  for (const e of entries) OVERRIDES.set(e.model, e);
  return entries.map((e) => e.model);
}

/** Test seam. Production never needs to drop a price it has been given. */
export function clearPricingOverrides(): void {
  OVERRIDES.clear();
}

export function pricingFor(model: string): ModelPricing | undefined {
  const key = String(model || "").trim();
  return OVERRIDES.get(key) ?? BY_MODEL.get(key);
}

/** Whether spend on this model can be measured at all. */
export function isPriced(model: string): boolean {
  return pricingFor(model) !== undefined;
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
    pricingVersion: pricing?.version ?? PRICING_TABLE_VERSION,
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
      note: `no pricing entry for "${model}" in ${PRICING_TABLE_VERSION}`
        + ` — set DESCRIPTION_MODEL_PRICING to record what this model costs`,
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
