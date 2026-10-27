// GENERATED — do not edit.
// Mirror of src/lib/market/providerEnvelope.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── One metadata envelope for every provider intelligence call ─────────────
//
// Every major MarketCheck call used to record a different subset of what it
// asked, what it got and what it cost — comps kept a tier, history kept a
// timestamp, sold stats kept a scope, the prediction kept a fingerprint and
// nothing kept the provider's own warnings. The change order (§11) asks for
// one envelope so auditability, cost analytics, stale-data detection,
// provider-disagreement analysis, replay and contract-drift detection all
// read the same record.
//
// Pure: the envelope is built from values the caller already holds. Costs are
// resolved through the registry so a configured override wins over the list
// default, and the registry supplies the TTL that becomes `expiresAt`.

import { capability, effectiveCost, type CostOverrides } from "./providerRegistry.ts";
import type { ProviderAttemptOutcome } from "./freshness.ts";
import type { IdentityMatchLevel } from "./identityMatch.ts";
import { digest, stableStringify } from "./hash.ts";

export type EntitlementState = "entitled" | "not_entitled" | "unknown";

export type ProviderOutcomeClass =
  | "success"
  | "no_result"
  | "entitlement_failure"
  | "rate_limited"
  | "provider_failure"
  | "request_rejected";

export interface ProviderResultEnvelope {
  provider: string;
  product: string;
  capabilityKey: string;
  endpoint: string;
  apiVersionOrContractVersion: string;
  requestFingerprint: string;
  subjectVin: string | null;
  market: string | null;
  matchTier: IdentityMatchLevel | string | null;
  geography: Record<string, unknown> | null;
  requestedFilters: Record<string, unknown>;
  /** What the provider says it actually applied. Null when it did not say. */
  appliedFilters: Record<string, unknown> | null;
  warnings: string[];
  notices: string[];
  providerGeneratedAt: string | null;
  fetchedAt: string;
  expiresAt: string | null;
  costUsd: number | null;
  costSource: "configured" | "list_default" | "unpriced";
  entitlementState: EntitlementState;
  responseShapeVersion: string;
  outcome: ProviderAttemptOutcome;
  outcomeClass: ProviderOutcomeClass;
  httpStatus: number | null;
  sampleSize: number | null;
  /** True when the provider said it did not do exactly what was asked. */
  filtersDiverged: boolean;
}

export interface EnvelopeInput {
  capabilityKey: string;
  endpoint: string;
  contractVersion: string;
  subjectVin?: string | null;
  market?: string | null;
  matchTier?: IdentityMatchLevel | string | null;
  geography?: Record<string, unknown> | null;
  requestedFilters: Record<string, unknown>;
  /** The provider's `applied` section, verbatim, when present. */
  applied?: unknown;
  warnings?: unknown;
  notices?: unknown;
  providerGeneratedAt?: unknown;
  fetchedAt: string;
  outcome: ProviderAttemptOutcome;
  httpStatus?: number | null;
  sampleSize?: unknown;
  /** Keys of the response body, for shape versioning; order-insensitive. */
  responseKeys?: string[];
  costOverrides?: CostOverrides | null;
  /** Whether the account is known to hold the entitlement. */
  entitlement?: EntitlementState;
}

const strings = (v: unknown): string[] => {
  if (v == null) return [];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? JSON.stringify(x) : String(x)))
      .map((s) => s.trim()).filter(Boolean);
  }
  if (typeof v === "object") return [JSON.stringify(v)];
  return [String(v)];
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function classifyOutcome(outcome: ProviderAttemptOutcome, sampleSize: number | null): ProviderOutcomeClass {
  switch (outcome) {
    case "succeeded":
      return sampleSize === 0 ? "no_result" : "success";
    case "auth_failed":
    case "not_entitled":
      return "entitlement_failure";
    case "rate_limited":
      return "rate_limited";
    case "request_rejected":
      return "request_rejected";
    default:
      return "provider_failure";
  }
}

/** Normalized applied filters, or null when the provider sent none. */
const appliedFilters = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Did the provider apply what was asked. Only keys the provider echoed are
 * compared; a requested key the provider did not echo is not a divergence,
 * it is an unknown, and it is reported as a notice rather than a warning.
 */
export function filtersDiverged(requested: Record<string, unknown>, applied: Record<string, unknown> | null): boolean {
  if (!applied) return false;
  for (const [k, v] of Object.entries(applied)) {
    if (!(k in requested)) continue;
    if (stableStringify(requested[k]) !== stableStringify(v)) return true;
  }
  return false;
}

export function buildProviderEnvelope(input: EnvelopeInput): ProviderResultEnvelope {
  const cap = capability(input.capabilityKey);
  const sampleSize = num(input.sampleSize);
  const applied = appliedFilters(input.applied);
  const diverged = filtersDiverged(input.requestedFilters, applied);
  const warnings = strings(input.warnings);
  const notices = strings(input.notices);
  if (diverged) warnings.push("provider_applied_filters_differ_from_request");
  const requestFingerprint = digest({
    capability: input.capabilityKey,
    endpoint: input.endpoint,
    contract: input.contractVersion,
    filters: input.requestedFilters,
    vin: input.subjectVin ?? null,
  });
  const overrideCost = input.costOverrides?.[input.capabilityKey];
  const configured = typeof overrideCost === "number" && Number.isFinite(overrideCost) && overrideCost >= 0;
  const cost = cap ? effectiveCost(input.capabilityKey, input.costOverrides) : null;
  const ttl = cap?.ttlHours ?? null;
  const fetched = Date.parse(input.fetchedAt);
  const expiresAt = ttl != null && Number.isFinite(fetched) ? new Date(fetched + ttl * 3_600_000).toISOString() : null;
  const outcome = input.outcome;
  return {
    provider: cap?.provider ?? "marketcheck",
    product: cap?.product ?? input.capabilityKey,
    capabilityKey: input.capabilityKey,
    endpoint: input.endpoint,
    apiVersionOrContractVersion: input.contractVersion,
    requestFingerprint,
    subjectVin: input.subjectVin ?? null,
    market: input.market ?? null,
    matchTier: input.matchTier ?? null,
    geography: input.geography ?? null,
    requestedFilters: input.requestedFilters,
    appliedFilters: applied,
    warnings,
    notices,
    providerGeneratedAt: typeof input.providerGeneratedAt === "string" ? input.providerGeneratedAt : null,
    fetchedAt: input.fetchedAt,
    expiresAt,
    costUsd: outcome === "not_attempted" ? 0 : cost,
    costSource: cap == null || (cap.billingProduct === "unknown" && !configured) ? "unpriced" : configured ? "configured" : "list_default",
    entitlementState: input.entitlement ?? (outcome === "not_entitled" || outcome === "auth_failed" ? "not_entitled" : outcome === "succeeded" ? "entitled" : "unknown"),
    responseShapeVersion: digest([...(input.responseKeys ?? [])].sort()),
    outcome,
    outcomeClass: classifyOutcome(outcome, sampleSize),
    httpStatus: input.httpStatus ?? null,
    sampleSize,
    filtersDiverged: diverged,
  };
}

/** Whether an envelope's answer is still inside its freshness window. */
export const envelopeFresh = (e: Pick<ProviderResultEnvelope, "expiresAt">, nowMs: number): boolean =>
  e.expiresAt == null || Date.parse(e.expiresAt) > nowMs;
