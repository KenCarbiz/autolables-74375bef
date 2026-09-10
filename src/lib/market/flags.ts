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
