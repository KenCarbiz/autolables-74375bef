// The customer-readable part of a rooftop's Passport payment estimator, as the
// anonymous listing payload carries it. Only the published, enabled config of
// the listing's own rooftop; never drafts, history, actors or other stores.
// A disabled or missing config projects to { enabled: false } so the Passport
// hides every estimator output instead of falling back to constants.

export interface PublicPaymentEstimator {
  enabled: boolean;
  version?: number;
  downPayment?: unknown;
  shopperControls?: unknown;
  rules?: unknown[];
}

export function projectPublicPaymentEstimator(row: { enabled?: unknown; version?: unknown; config?: unknown } | null | undefined): PublicPaymentEstimator {
  const cfg = (row?.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>;
  if (!row || row.enabled !== true || cfg.enabled !== true) return { enabled: false };
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  return {
    enabled: true,
    version: typeof row.version === "number" ? row.version : undefined,
    downPayment: cfg.downPayment,
    shopperControls: cfg.shopperControls,
    rules: rules.filter((r) => r && typeof r === "object" && (r as Record<string, unknown>).enabled !== false),
  };
}
