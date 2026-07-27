// ─────────────────────────────────────────────────────────────────────
// Error taxonomy (§30) — every way generation can fail, named once.
//
// Two properties carry real weight here and neither is cosmetic.
//
// `costMayHaveOccurred` is an honesty flag, not a billing field. A provider
// timeout does NOT mean the provider did nothing; it means we stopped waiting.
// The inference may have completed and been billed. Reporting "no cost" on a
// timeout would be a false statement about the tenant's money, so anything
// that fails at or after the request was dispatched must admit the cost is
// unknown. Only failures that provably preceded the dispatch claim false.
//
// `retryable` guards the attempt budget. A tenant-isolation failure, a bad
// config, or a blocked validation will fail identically on every attempt.
// Retrying them spends the budget that a genuine transient fault needed.
// ─────────────────────────────────────────────────────────────────────

export type ErrorCategory =
  | "authentication"
  | "authorization"
  | "tenant_isolation"
  | "vehicle_not_found"
  | "vehicle_truth"
  | "configuration"
  | "channel_policy"
  | "voice_profile"
  | "local_seo"
  | "cta"
  | "disclosure"
  | "budget"
  | "idempotency_conflict"
  | "queue"
  | "provider_rate_limit"
  | "provider_timeout"
  | "provider_authentication"
  | "provider_unavailable"
  | "provider_malformed_response"
  | "structured_output"
  | "validation_blocked"
  | "repair_exhausted"
  | "persistence"
  | "unknown_internal";

export interface ErrorDefinition {
  category: ErrorCategory;
  retryable: boolean;
  /** Operator-facing. Names the fix where one exists; never leaks internals. */
  userMessage: string;
  diagnosticCode: string;
  logSeverity: "info" | "warn" | "error" | "critical";
  requiresAudit: boolean;
  requiresAlert: boolean;
  /** True whenever we cannot prove the provider was not billed. */
  costMayHaveOccurred: boolean;
}

/**
 * Retrying any of these only burns the attempt budget: the same input produces
 * the same failure on every attempt.
 */
export const NON_RETRYABLE: readonly ErrorCategory[] = [
  "authentication",
  "authorization",
  "tenant_isolation",
  "configuration",
  "validation_blocked",
  "budget",
  "vehicle_not_found",
];

export const ERROR_TAXONOMY: Record<ErrorCategory, ErrorDefinition> = {
  authentication: {
    category: "authentication", retryable: false,
    userMessage: "Your session has expired. Sign in again to continue.",
    diagnosticCode: "AL-DESC-1001", logSeverity: "info",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: false,
  },
  authorization: {
    category: "authorization", retryable: false,
    userMessage: "Your role does not permit generating descriptions. Ask an administrator for access.",
    diagnosticCode: "AL-DESC-1002", logSeverity: "warn",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: false,
  },
  // A request that reached across tenants is a security event even when it was
  // an honest bug, so it always audits and always alerts.
  tenant_isolation: {
    category: "tenant_isolation", retryable: false,
    userMessage: "This vehicle does not belong to your dealership.",
    diagnosticCode: "AL-DESC-1003", logSeverity: "critical",
    requiresAudit: true, requiresAlert: true, costMayHaveOccurred: false,
  },
  vehicle_not_found: {
    category: "vehicle_not_found", retryable: false,
    userMessage: "That vehicle could not be found. It may have been deleted or archived.",
    diagnosticCode: "AL-DESC-1004", logSeverity: "info",
    requiresAudit: false, requiresAlert: false, costMayHaveOccurred: false,
  },
  vehicle_truth: {
    category: "vehicle_truth", retryable: false,
    userMessage: "This vehicle's verified data is incomplete or in conflict. Resolve the conflicts before generating copy.",
    diagnosticCode: "AL-DESC-1005", logSeverity: "info",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: false,
  },
  configuration: {
    category: "configuration", retryable: false,
    userMessage: "Description generation is not configured correctly for this dealership. Contact support.",
    diagnosticCode: "AL-DESC-1006", logSeverity: "warn",
    requiresAudit: false, requiresAlert: true, costMayHaveOccurred: false,
  },
  channel_policy: {
    category: "channel_policy", retryable: false,
    userMessage: "This channel is disabled or has no policy configured. Enable it in description settings.",
    diagnosticCode: "AL-DESC-1007", logSeverity: "info",
    requiresAudit: false, requiresAlert: false, costMayHaveOccurred: false,
  },
  voice_profile: {
    category: "voice_profile", retryable: false,
    userMessage: "Your dealership voice profile is missing or awaiting approval. Approve it before generating copy.",
    diagnosticCode: "AL-DESC-1008", logSeverity: "info",
    requiresAudit: false, requiresAlert: false, costMayHaveOccurred: false,
  },
  local_seo: {
    category: "local_seo", retryable: false,
    userMessage: "The keyword or market-area targeting for this request is not supported by the vehicle's verified data.",
    diagnosticCode: "AL-DESC-1009", logSeverity: "info",
    requiresAudit: false, requiresAlert: false, costMayHaveOccurred: false,
  },
  cta: {
    category: "cta", retryable: false,
    userMessage: "No call to action is configured for this channel. Add one in description settings.",
    diagnosticCode: "AL-DESC-1010", logSeverity: "info",
    requiresAudit: false, requiresAlert: false, costMayHaveOccurred: false,
  },
  disclosure: {
    category: "disclosure", retryable: false,
    userMessage: "A required legal disclosure is unavailable for this vehicle, so copy cannot be published.",
    diagnosticCode: "AL-DESC-1011", logSeverity: "warn",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: false,
  },
  budget: {
    category: "budget", retryable: false,
    userMessage: "This dealership has reached its generation budget for the period.",
    diagnosticCode: "AL-DESC-1012", logSeverity: "warn",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: false,
  },
  // Another request holds the key. This attempt spent nothing, but the request
  // it collided with may still be spending.
  idempotency_conflict: {
    category: "idempotency_conflict", retryable: false,
    userMessage: "A generation for this vehicle is already in progress.",
    diagnosticCode: "AL-DESC-1013", logSeverity: "info",
    requiresAudit: false, requiresAlert: false, costMayHaveOccurred: false,
  },
  queue: {
    category: "queue", retryable: true,
    userMessage: "The generation queue is busy. Try again in a moment.",
    diagnosticCode: "AL-DESC-1014", logSeverity: "warn",
    requiresAudit: false, requiresAlert: false, costMayHaveOccurred: false,
  },
  // The provider rejected the call before running inference, so nothing billed.
  provider_rate_limit: {
    category: "provider_rate_limit", retryable: true,
    userMessage: "The writing service is rate limited right now. Try again shortly.",
    diagnosticCode: "AL-DESC-2001", logSeverity: "warn",
    requiresAudit: false, requiresAlert: false, costMayHaveOccurred: false,
  },
  // We stopped waiting; the provider may have finished and billed us anyway.
  provider_timeout: {
    category: "provider_timeout", retryable: true,
    userMessage: "The writing service did not respond in time. Try again.",
    diagnosticCode: "AL-DESC-2002", logSeverity: "warn",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: true,
  },
  provider_authentication: {
    category: "provider_authentication", retryable: false,
    userMessage: "The writing service rejected our credentials. Support has been notified.",
    diagnosticCode: "AL-DESC-2003", logSeverity: "error",
    requiresAudit: true, requiresAlert: true, costMayHaveOccurred: false,
  },
  // A 5xx can come from a gateway after the upstream model already ran.
  provider_unavailable: {
    category: "provider_unavailable", retryable: true,
    userMessage: "The writing service is temporarily unavailable. Try again shortly.",
    diagnosticCode: "AL-DESC-2004", logSeverity: "error",
    requiresAudit: true, requiresAlert: true, costMayHaveOccurred: true,
  },
  provider_malformed_response: {
    category: "provider_malformed_response", retryable: true,
    userMessage: "The writing service returned an unreadable response. Try again.",
    diagnosticCode: "AL-DESC-2005", logSeverity: "warn",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: true,
  },
  structured_output: {
    category: "structured_output", retryable: true,
    userMessage: "The generated copy did not match the required structure. Try again.",
    diagnosticCode: "AL-DESC-2006", logSeverity: "warn",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: true,
  },
  // The model produced copy and we refused it. Refusing after the fact does
  // not un-bill the tokens.
  validation_blocked: {
    category: "validation_blocked", retryable: false,
    userMessage: "The generated copy made claims this vehicle's verified data does not support, so it was withheld.",
    diagnosticCode: "AL-DESC-3001", logSeverity: "warn",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: true,
  },
  repair_exhausted: {
    category: "repair_exhausted", retryable: false,
    userMessage: "The copy could not be corrected within the allowed attempts. Nothing was published.",
    diagnosticCode: "AL-DESC-3002", logSeverity: "error",
    requiresAudit: true, requiresAlert: false, costMayHaveOccurred: true,
  },
  persistence: {
    category: "persistence", retryable: true,
    userMessage: "The description was generated but could not be saved. Try again.",
    diagnosticCode: "AL-DESC-4001", logSeverity: "error",
    requiresAudit: true, requiresAlert: true, costMayHaveOccurred: true,
  },
  // Unknown means unknown. We cannot claim the tenant was not billed.
  unknown_internal: {
    category: "unknown_internal", retryable: false,
    userMessage: "Something went wrong generating this description. Support has been notified.",
    diagnosticCode: "AL-DESC-9000", logSeverity: "critical",
    requiresAudit: true, requiresAlert: true, costMayHaveOccurred: true,
  },
};

export function errorFor(category: ErrorCategory): ErrorDefinition {
  return ERROR_TAXONOMY[category] ?? ERROR_TAXONOMY.unknown_internal;
}

export function isRetryable(category: ErrorCategory): boolean {
  return errorFor(category).retryable;
}

const SCHEMA_HINT = /schema|json|parse|invalid[_ -]?request[_ -]?error|malformed|tool[_ -]?use|response[_ -]?format|max[_ -]?tokens/i;

/**
 * Maps a provider HTTP status onto the taxonomy. Status 0 (or anything below
 * 100) is how fetch surfaces an aborted or dropped connection — indistinguish-
 * able from a timeout from our side, and billed the same way.
 */
export function classifyProviderError(status: number, body?: string): ErrorCategory {
  const s = Number.isFinite(status) ? Math.trunc(status) : 0;
  if (s <= 0 || s < 100) return "provider_timeout";
  if (s === 401 || s === 403 || s === 407) return "provider_authentication";
  if (s === 408 || s === 504 || s === 522 || s === 524) return "provider_timeout";
  if (s === 429) return "provider_rate_limit";
  if (s >= 500) return "provider_unavailable";
  if (s === 400 || s === 413 || s === 422) {
    return SCHEMA_HINT.test(body ?? "") ? "structured_output" : "configuration";
  }
  if (s >= 400) return "configuration";
  return "provider_malformed_response";
}

export interface SafeError {
  category: ErrorCategory;
  diagnosticCode: string;
  userMessage: string;
  retryable: boolean;
  costMayHaveOccurred: boolean;
}

/**
 * The only object permitted to cross the response boundary. `internalDetail` is
 * accepted so callers can pass what they have without a second code path, and
 * is deliberately dropped: stack traces, provider bodies, SQL, prompt text and
 * other tenants' identifiers must never reach a client. Log it separately.
 */
export function toSafeError(category: ErrorCategory, internalDetail?: string): SafeError {
  const def = errorFor(category);
  return {
    category: def.category,
    diagnosticCode: def.diagnosticCode,
    userMessage: def.userMessage,
    retryable: def.retryable,
    costMayHaveOccurred: def.costMayHaveOccurred,
  };
}

const CREDENTIAL_KEY = /(api[_\-\s]?key|apikey|access[_\-\s]?key|secret|password|passwd|pwd|authorization|auth[_\-\s]?token|bearer|token|credential|private[_\-\s]?key|service[_\-\s]?role|session[_\-\s]?key|signature|cookie|set[_\-\s]?cookie)/i;
const BEARER_VALUE = /^\s*(bearer|basic|token)\s+\S+/i;
const OPAQUE_VALUE = /^[A-Za-z0-9._\-+/=]{40,}$/;

const REDACTED = "[redacted]";

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    // A long opaque blob is credential-shaped even under a benign key name;
    // audit rows are read by humans and copied into tickets.
    if (BEARER_VALUE.test(value) || OPAQUE_VALUE.test(value.trim())) return REDACTED;
    return value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return redactForAudit(value as Record<string, unknown>);
  }
  return value;
}

/** Strips credential-shaped keys and values before anything reaches the audit log. */
export function redactForAudit(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    out[key] = CREDENTIAL_KEY.test(key) ? REDACTED : redactValue(value);
  }
  return out;
}
