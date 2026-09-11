// ── Feature flags ──────────────────────────────────────────────────────────
//
// Every flag defaults OFF, and "off" is the literal default in code rather
// than a value somebody remembered to set in a table. A missing row, an
// unreadable settings blob and an unknown flag name all resolve to false, so
// the failure mode of the configuration system is "V2 stays dark" instead of
// "V2 went live on a tenant nobody reviewed".

export const MARKET_FLAGS = {
  /** Compute V2 beside production, write nothing a customer sees. */
  market_value_v2_shadow: false,
  /** Show the V2 view to dealer staff only. */
  market_value_v2_admin: false,
  /** Show the V2 view on the customer Passport. */
  market_value_v2_public: false,
  /** Use the documented current endpoint instead of the legacy predict path. */
  marketcheck_current_endpoint: false,
  /** Premium comparables endpoint. Costs money; owner approval required. */
  marketcheck_premium_comparables: false,
  /** Recommended pricing position, shadow only. */
  pricing_position_v2_shadow: false,
  /**
   * Refuse to make a market claim about a vehicle whose own price is missing,
   * zero, negative or implausible. OFF in production: three published pages
   * currently render such a claim and removing them is a deliberate, canaried
   * change, not a refactor side effect.
   */
  market_invalid_claim_suppression: false,
} as const;

export type MarketFlag = keyof typeof MARKET_FLAGS;

export const MARKET_FLAG_NAMES = Object.keys(MARKET_FLAGS) as MarketFlag[];

export const isMarketFlag = (v: unknown): v is MarketFlag =>
  typeof v === "string" && (MARKET_FLAG_NAMES as string[]).includes(v);

/**
 * Read one flag out of a tenant settings blob.
 *
 * Only a literal `true` turns anything on. The string "true", 1 and "yes" are
 * deliberately NOT accepted: a feed-shaped truthy value has no business
 * enabling a pricing engine, and every one of those spellings has already
 * caused a bug in this codebase (see isTruthyFlag in vehicleCondition.ts,
 * which exists because "false" is truthy in JS).
 */
export function readMarketFlag(settings: unknown, flag: MarketFlag): boolean {
  const bag = (settings ?? null) as { market_flags?: Record<string, unknown> } | null;
  return bag?.market_flags?.[flag] === true;
}

export function readMarketFlags(settings: unknown): Record<MarketFlag, boolean> {
  const out = {} as Record<MarketFlag, boolean>;
  for (const flag of MARKET_FLAG_NAMES) out[flag] = readMarketFlag(settings, flag);
  return out;
}

// ── What "shadow" has to mean before it is a control ───────────────────────
//
// Six of the seven flags above have ZERO production readers. A stored `false`
// on a flag nothing reads is not a rollout control; it is a label. Turning
// `market_value_v2_shadow` "on" today changes nothing, produces no evidence,
// and — worse than doing nothing — reads in an audit as though a shadow pilot
// ran and found nothing wrong.
//
// This section does not wire shadow up. It states, as executable policy, the
// conditions a future shadow reader must satisfy, so the reader is written
// against a contract rather than against an intention. There is deliberately
// no caller, no scheduler, no fetch and no database write here: every function
// below is pure and safe to import from anywhere, deployed or not.

export const SHADOW_CONTROL_REQUIREMENTS = [
  "server_side_only",
  "tenant_scoped",
  "no_public_rendering",
  "no_compatibility_column_write",
  "no_automatic_provider_call",
  "no_budget_bypass",
  "append_only_evidence",
  "auditable_invocation_source",
  "immediate_off_switch",
  "no_browser_controlled_provider_spend",
] as const;

export type ShadowControlRequirement = (typeof SHADOW_CONTROL_REQUIREMENTS)[number];

/**
 * Where a shadow evaluation was asked for.
 *
 * `browser` is enumerated so it can be REFUSED by name. A page that can ask
 * the server to evaluate a vehicle is a page that can ask the server to spend
 * money, and a shadow pilot is exactly the wrong place to discover that.
 */
export type ShadowInvocationSource =
  | "server_scheduled"
  | "server_operator"
  | "browser"
  | "unknown";

const SERVER_SOURCES: ShadowInvocationSource[] = ["server_scheduled", "server_operator"];

export interface ShadowDecision {
  /** May a shadow evaluation run at all. */
  run: boolean;
  /** Always false. Shadow reads stored evidence; it never buys more. */
  allowProviderCall: false;
  /** Always false. Shadow may not touch the columns a customer reads. */
  allowCompatibilityWrite: false;
  /** Always false. Shadow is invisible to customers by construction. */
  allowPublicRender: false;
  reasons: string[];
}

/**
 * Decide whether a shadow evaluation may proceed. Pure; no side effects.
 *
 * The three `allow*` fields are typed as literal `false` rather than boolean:
 * a future edit that tries to turn one on does not compile.
 */
export function decideShadowEvaluation(input: {
  settings: unknown;
  tenantId: string | null | undefined;
  source: ShadowInvocationSource;
}): ShadowDecision {
  const reasons: string[] = [];
  const deny = (): ShadowDecision => ({
    run: false,
    allowProviderCall: false,
    allowCompatibilityWrite: false,
    allowPublicRender: false,
    reasons,
  });

  if (!readMarketFlag(input.settings, "market_value_v2_shadow")) {
    // The immediate off switch: absence, malformation and an explicit false
    // all land here, so "off" is the failure mode of the whole config path.
    reasons.push("shadow_flag_off");
    return deny();
  }
  if (!input.tenantId) {
    reasons.push("shadow_requires_tenant_scope");
    return deny();
  }
  if (!SERVER_SOURCES.includes(input.source)) {
    reasons.push(`shadow_invocation_source_rejected_${input.source}`);
    reasons.push("no_browser_controlled_provider_spend");
    return deny();
  }

  reasons.push("shadow_enabled", `shadow_invocation_source_${input.source}`);
  return {
    run: true,
    allowProviderCall: false,
    allowCompatibilityWrite: false,
    allowPublicRender: false,
    reasons,
  };
}

/**
 * Flags with no production reader are inert, and saying otherwise in a report
 * is how a rollout gets credited to a switch that does nothing. This is the
 * predicate a test uses to keep the claim honest against the actual tree.
 */
export const isInertWithoutReader = (readerCount: number): boolean => readerCount === 0;
