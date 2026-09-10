// GENERATED — do not edit.
// Mirror of src/lib/market/pricingPosition.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Recommended pricing position ───────────────────────────────────────────
//
// Kept in its own module because it answers a different question from
// everything else here, and merging the two is the failure this whole rebuild
// exists to prevent.
//
//   Adjusted Market Value — what the evidence says the car is worth.
//   Pricing Position      — where this dealer may choose to price it.
//
// A dealer with the only certified QX50 inside a hundred miles is entitled to
// price above the market and will still sell it. That is a strategy, and it
// must never travel backwards into the valuation to make the strategy look
// like the market. So this module reads the market and never writes it: it
// returns a target PERCENTILE, and the caller looks that percentile up in a
// distribution it did not compute.
//
// Shadow only. Market Days Supply, VDP engagement and sale outcomes are not
// yet calibrated here, so the eventual objective —
//
//   RecommendedPrice = argmax_p [ ExpectedGross(p)
//                                 × P(sale within target days | p)
//                                 − ExpectedHoldingCost(p) ]
//
// — is recorded as the target and not approximated with a guess.

export const PRICING_POSITION_VERSION = "pricing-position-v0-shadow";

export type SupplyDemandRegime = "low_supply_high_demand" | "normal" | "high_supply_weak_demand" | "unknown";

export interface PricingPositionInput {
  marketDaysSupply: number | null;
  vdpViewsLast30: number | null;
  leadsLast30: number | null;
  inventoryAgeDays: number | null;
  /** Tenant policy: the age at which a car should start moving down the range. */
  agingThresholdDays?: number | null;
  holdingCostPerDay?: number | null;
  targetTurnDays?: number | null;
  grossObjective?: number | null;
}

export interface PricingPositionResult {
  regime: SupplyDemandRegime;
  targetPercentileLow: number | null;
  targetPercentileHigh: number | null;
  rationale: string[];
  /** Always false until Section 23's thresholds are calibrated. */
  publishable: false;
  missingInputs: string[];
  version: string;
}

export function recommendPricingPosition(input: PricingPositionInput): PricingPositionResult {
  const rationale: string[] = [];
  const missingInputs: string[] = [];

  if (input.marketDaysSupply == null) missingInputs.push("market_days_supply");
  if (input.vdpViewsLast30 == null) missingInputs.push("vdp_engagement");
  if (input.leadsLast30 == null) missingInputs.push("lead_activity");
  if (input.inventoryAgeDays == null) missingInputs.push("inventory_age");
  if (input.holdingCostPerDay == null) missingInputs.push("holding_cost");
  if (input.targetTurnDays == null) missingInputs.push("target_turn_days");

  let regime: SupplyDemandRegime = "unknown";
  let low: number | null = null;
  let high: number | null = null;

  const mds = input.marketDaysSupply;
  const engagement = input.vdpViewsLast30;

  if (mds != null && engagement != null) {
    if (mds <= 30 && engagement > 0) {
      regime = "low_supply_high_demand";
      low = 60; high = 75;
      rationale.push("low market days supply with active engagement");
    } else if (mds >= 75 || engagement === 0) {
      regime = "high_supply_weak_demand";
      low = 25; high = 40;
      rationale.push("high market days supply or no engagement");
    } else {
      regime = "normal";
      low = 50; high = 50;
      rationale.push("normal supply and demand");
    }
  } else {
    rationale.push("supply and demand signals unavailable; no position suggested");
  }

  // Ageing moves the target down the SAME distribution. It never moves the
  // distribution.
  const threshold = input.agingThresholdDays ?? 60;
  if (low != null && high != null && input.inventoryAgeDays != null && input.inventoryAgeDays > threshold) {
    const overBy = input.inventoryAgeDays - threshold;
    const steps = Math.min(3, Math.floor(overBy / 30) + 1);
    low = Math.max(10, low - steps * 10);
    high = Math.max(15, high - steps * 10);
    rationale.push(`aged ${input.inventoryAgeDays} days past the ${threshold}-day policy`);
  }

  return {
    regime,
    targetPercentileLow: low,
    targetPercentileHigh: high,
    rationale,
    publishable: false,
    missingInputs,
    version: PRICING_POSITION_VERSION,
  };
}
