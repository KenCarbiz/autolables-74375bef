// GENERATED — do not edit.
// Mirror of src/lib/market/pricingPosition.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const PRICING_POSITION_VERSION = "pricing-position-v0-shadow";
export type SupplyDemandRegime = "low_supply_high_demand" | "normal" | "high_supply_weak_demand" | "unknown";
export interface PricingPositionInput {
    marketDaysSupply: number | null;
    vdpViewsLast30: number | null;
    leadsLast30: number | null;
    inventoryAgeDays: number | null;
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
    publishable: false;
    missingInputs: string[];
    version: string;
}
export function recommendPricingPosition(input: PricingPositionInput): PricingPositionResult {
    const rationale: string[] = [];
    const missingInputs: string[] = [];
    if (input.marketDaysSupply == null)
        missingInputs.push("market_days_supply");
    if (input.vdpViewsLast30 == null)
        missingInputs.push("vdp_engagement");
    if (input.leadsLast30 == null)
        missingInputs.push("lead_activity");
    if (input.inventoryAgeDays == null)
        missingInputs.push("inventory_age");
    if (input.holdingCostPerDay == null)
        missingInputs.push("holding_cost");
    if (input.targetTurnDays == null)
        missingInputs.push("target_turn_days");
    let regime: SupplyDemandRegime = "unknown";
    let low: number | null = null;
    let high: number | null = null;
    const mds = input.marketDaysSupply;
    const engagement = input.vdpViewsLast30;
    if (mds != null && engagement != null) {
        if (mds <= 30 && engagement > 0) {
            regime = "low_supply_high_demand";
            low = 60;
            high = 75;
            rationale.push("low market days supply with active engagement");
        }
        else if (mds >= 75 || engagement === 0) {
            regime = "high_supply_weak_demand";
            low = 25;
            high = 40;
            rationale.push("high market days supply or no engagement");
        }
        else {
            regime = "normal";
            low = 50;
            high = 50;
            rationale.push("normal supply and demand");
        }
    }
    else {
        rationale.push("supply and demand signals unavailable; no position suggested");
    }
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
