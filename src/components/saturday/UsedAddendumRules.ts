// Used addendum rule-selection engine.
// Chooses the best 4.5x11 addendum template from the 50-template catalog based on
// dealer setup, OEM, vehicle condition, CPO status, pricing strategy, market transparency, and placement.

import { USED_ADDENDUM_CATALOG_50, type UsedAddendumTemplateDefinition } from "./UsedAddendumCatalog";
import type { SaturdayAddendumPricingMode, SaturdayMarketTransparencyMode } from "./types";
import type { DealerProfileInput, VehicleInventoryInput } from "./wiring";

export type DealerStoreType =
  | "franchise"
  | "independent"
  | "luxury"
  | "one_price"
  | "high_volume"
  | "commercial"
  | "special_finance";

export type TemplateRuleContext = {
  dealer: DealerProfileInput & {
    storeType?: DealerStoreType;
    preferredTemplateIds?: string[];
    disabledTemplateIds?: string[];
    enabledCategories?: string[];
  };
  vehicle: VehicleInventoryInput & {
    cpo?: boolean;
    isServiceLoaner?: boolean;
    isDemo?: boolean;
    isCommercial?: boolean;
    fuelType?: "gas" | "diesel" | "hybrid" | "ev" | "phev";
  };
  printPlacement?: "inside_window" | "outside_window" | "either";
  pricingMode?: SaturdayAddendumPricingMode;
  marketTransparencyMode?: SaturdayMarketTransparencyMode;
};

export type TemplateRuleResult = {
  template: UsedAddendumTemplateDefinition;
  reason: string;
  score: number;
  candidates: Array<{ id: string; name: string; score: number; reasons: string[] }>;
};

const normalize = (value?: string | number) => String(value || "").trim().toLowerCase();
const isLuxuryOEM = (make?: string | number) => [
  "acura",
  "audi",
  "bmw",
  "cadillac",
  "genesis",
  "infiniti",
  "lexus",
  "lincoln",
  "mercedes-benz",
  "mercedes",
  "porsche",
  "volvo",
].includes(normalize(make));

const templateById = new Map(USED_ADDENDUM_CATALOG_50.map((template) => [template.id, template]));

const hasTag = (template: UsedAddendumTemplateDefinition, tag: string) => template.tags.includes(tag);
const supportsOEM = (template: UsedAddendumTemplateDefinition, make?: string | number) => {
  if (!template.suggestedOEMs?.length) return false;
  const normalizedMake = normalize(make);
  return template.suggestedOEMs.some((oem) => normalize(oem) === normalizedMake);
};

export const selectUsedAddendumTemplate = (context: TemplateRuleContext): TemplateRuleResult => {
  const disabled = new Set(context.dealer.disabledTemplateIds || []);
  const enabledCategories = new Set(context.dealer.enabledCategories || []);
  const pricingMode = context.pricingMode || context.dealer.labelSettings?.addendumPricingMode || "used_market_value_plus_addendum";
  const marketMode = context.marketTransparencyMode || context.dealer.labelSettings?.marketTransparencyMode || "passport_only";
  const placement = context.printPlacement || context.dealer.labelSettings?.defaultLabelPlacement || "either";

  const preferred = (context.dealer.preferredTemplateIds || [])
    .map((id) => templateById.get(id))
    .find((template) => template && !disabled.has(template.id));

  if (preferred) {
    return {
      template: preferred,
      reason: "Dealer preferred template matched and is enabled.",
      score: 999,
      candidates: [{ id: preferred.id, name: preferred.name, score: 999, reasons: ["dealer preferred"] }],
    };
  }

  const scored = USED_ADDENDUM_CATALOG_50
    .filter((template) => !disabled.has(template.id))
    .filter((template) => !enabledCategories.size || enabledCategories.has(template.category))
    .map((template) => {
      let score = 0;
      const reasons: string[] = [];

      if (template.defaultPricingMode === pricingMode) {
        score += 18;
        reasons.push(`pricing mode: ${pricingMode}`);
      }

      if (marketMode !== "off" && template.supportsMarketTransparency) {
        score += marketMode === "print_and_passport" ? 18 : 10;
        reasons.push(`market transparency: ${marketMode}`);
      }

      if (context.vehicle.cpo && template.supportsCPO) {
        score += 20;
        reasons.push("CPO eligible");
      }

      if (supportsOEM(template, context.vehicle.make)) {
        score += 26;
        reasons.push(`OEM match: ${context.vehicle.make}`);
      }

      if (context.vehicle.isServiceLoaner && hasTag(template, "loaner")) {
        score += 28;
        reasons.push("service loaner match");
      }

      if (context.vehicle.isDemo && hasTag(template, "demo")) {
        score += 28;
        reasons.push("demo vehicle match");
      }

      if (context.vehicle.isCommercial && hasTag(template, "commercial")) {
        score += 30;
        reasons.push("commercial/fleet match");
      }

      if (["ev", "hybrid", "phev"].includes(context.vehicle.fuelType || "") && (hasTag(template, "ev") || hasTag(template, "hybrid"))) {
        score += 24;
        reasons.push("EV/hybrid match");
      }

      if (context.dealer.storeType === "one_price" && hasTag(template, "one-price")) {
        score += 26;
        reasons.push("one-price store match");
      }

      if (context.dealer.storeType === "luxury" || isLuxuryOEM(context.vehicle.make)) {
        if (template.category === "luxury" || template.family === "luxury_black") {
          score += 18;
          reasons.push("luxury fit");
        }
      }

      if (context.dealer.storeType === "high_volume" && (template.family === "minimal_compliance" || hasTag(template, "high-volume"))) {
        score += 14;
        reasons.push("high-volume fit");
      }

      if (placement !== "either" && template.recommendedPlacement === placement) {
        score += 8;
        reasons.push(`placement: ${placement}`);
      }

      if (template.category === "core") {
        score += 3;
        reasons.push("safe core fallback");
      }

      return { template, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const winner = scored[0]?.template || USED_ADDENDUM_CATALOG_50[0];
  const winningScore = scored[0]?.score || 0;
  const winningReasons = scored[0]?.reasons || ["catalog fallback"];

  return {
    template: winner,
    reason: winningReasons.join("; "),
    score: winningScore,
    candidates: scored.slice(0, 8).map(({ template, score, reasons }) => ({
      id: template.id,
      name: template.name,
      score,
      reasons,
    })),
  };
};

export const getUsedAddendumTemplatesByOEM = (make: string) =>
  USED_ADDENDUM_CATALOG_50.filter((template) => supportsOEM(template, make));

export const getUsedAddendumTemplatesByCategory = (category: string) =>
  USED_ADDENDUM_CATALOG_50.filter((template) => template.category === category);
