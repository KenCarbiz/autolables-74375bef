// Five-agent quality standards for AutoLabels sticker catalogs.
// Purpose: keep all addendum and window sticker templates aligned with the product goals before
// individual visual refinement begins.

import { USED_ADDENDUM_CATALOG_50 } from "./UsedAddendumCatalog";
import { USED_WINDOW_STICKER_CATALOG_50 } from "./UsedWindowStickerCatalog";

export type QualityAgentId =
  | "dealer_principal"
  | "oem_franchise_gm"
  | "customer_conversion"
  | "print_operations"
  | "enterprise_architect";

export type TemplateQualityIssue = {
  templateId: string;
  templateName: string;
  catalog: "used_addendum" | "used_window_sticker";
  severity: "info" | "warning" | "critical";
  agent: QualityAgentId;
  message: string;
};

export type TemplateQualitySummary = {
  totalTemplates: number;
  totalIssues: number;
  criticalIssues: number;
  warningIssues: number;
  infoIssues: number;
  issues: TemplateQualityIssue[];
};

export const FIVE_AGENT_QUALITY_STANDARDS: Record<QualityAgentId, string[]> = {
  dealer_principal: [
    "Vehicle value story is obvious within three seconds.",
    "Dealer branding is present but does not overpower the vehicle.",
    "The template can support dealer-selected pricing language.",
    "The sticker creates a reason to engage or ask a question.",
  ],
  oem_franchise_gm: [
    "OEM themed templates support manufacturer-aligned colors and conservative layouts.",
    "CPO templates clearly support certification language and coverage tiers.",
    "Premium/luxury templates avoid clutter and use restrained hierarchy.",
  ],
  customer_conversion: [
    "Vehicle image, price/value, specs, MPG, trust, and CTA are easy to scan.",
    "Passport CTA is present only when the dealer enables the passport.",
    "Market transparency claims are shown only when data/settings allow it.",
  ],
  print_operations: [
    "Template declares inside/outside/either placement so QR, contrast, and scale can adapt.",
    "Large window stickers support clean factory/API images where appropriate.",
    "Templates have category, family, tags, and default pricing mode for archival lookup.",
  ],
  enterprise_architect: [
    "Template metadata supports rule-based selection.",
    "Templates support dealer theme and OEM theme inheritance.",
    "No template requires fake review scores, fake market values, or invented vehicle data.",
  ],
};

const hasTag = (template: { tags?: string[] }, tag: string) => Boolean(template.tags?.includes(tag));
const includesAny = (values: string[] | undefined, options: string[]) => Boolean(values?.some((value) => options.includes(value)));

const evaluateCommonTemplate = (input: {
  template: any;
  catalog: "used_addendum" | "used_window_sticker";
  needsImageSupport?: boolean;
}): TemplateQualityIssue[] => {
  const { template, catalog, needsImageSupport } = input;
  const issues: TemplateQualityIssue[] = [];
  const base = {
    templateId: template.id,
    templateName: template.name,
    catalog,
  };

  if (!template.category || !template.family || !template.defaultPricingMode) {
    issues.push({ ...base, severity: "critical", agent: "enterprise_architect", message: "Missing category, family, or default pricing mode metadata needed for rule selection." });
  }

  if (!template.supportsDealerTheme || !template.supportsOEMTheme) {
    issues.push({ ...base, severity: "critical", agent: "enterprise_architect", message: "Template must support dealer theme and OEM theme inheritance." });
  }

  if (!template.recommendedPlacement) {
    issues.push({ ...base, severity: "warning", agent: "print_operations", message: "Template should declare recommended label placement: inside, outside, or either." });
  }

  if (!template.tags?.length) {
    issues.push({ ...base, severity: "warning", agent: "print_operations", message: "Template needs tags so dealers can search/filter/archive it." });
  }

  if (template.category === "oem" && !template.suggestedOEMs?.length) {
    issues.push({ ...base, severity: "critical", agent: "oem_franchise_gm", message: "OEM template needs suggested OEM mapping." });
  }

  if (template.category === "certification" && !template.supportsCPO) {
    issues.push({ ...base, severity: "critical", agent: "oem_franchise_gm", message: "Certification template must support CPO/certified language." });
  }

  if (template.supportsMarketTransparency && template.defaultPricingMode === "used_live_price_plus_addendum" && hasTag(template, "market")) {
    issues.push({ ...base, severity: "info", agent: "customer_conversion", message: "Market-focused templates usually convert better with market value or passport live price modes." });
  }

  if (needsImageSupport && !template.supportsFactoryCleanImage) {
    issues.push({ ...base, severity: "warning", agent: "print_operations", message: "Large window sticker should support factory-clean API imagery." });
  }

  if (needsImageSupport && !template.recommendedImagePreference) {
    issues.push({ ...base, severity: "warning", agent: "print_operations", message: "Large window sticker should declare image preference: factory clean, dealer photo, or transparent first." });
  }

  if (template.supportsPassport === false && includesAny(template.tags, ["passport", "qr", "live-price", "scan", "passport-truth"])) {
    issues.push({ ...base, severity: "warning", agent: "customer_conversion", message: "Template tags imply passport/QR usage but supportsPassport is false." });
  }

  if (template.category === "luxury" && !includesAny(template.tags, ["luxury", "premium", "executive", "signature", "concierge"])) {
    issues.push({ ...base, severity: "warning", agent: "oem_franchise_gm", message: "Luxury template should include premium/luxury tags for search and rules." });
  }

  return issues;
};

export const auditUsedAddendumCatalog = (): TemplateQualityIssue[] =>
  USED_ADDENDUM_CATALOG_50.flatMap((template) => evaluateCommonTemplate({ template, catalog: "used_addendum" }));

export const auditUsedWindowStickerCatalog = (): TemplateQualityIssue[] =>
  USED_WINDOW_STICKER_CATALOG_50.flatMap((template) => evaluateCommonTemplate({ template, catalog: "used_window_sticker", needsImageSupport: true }));

export const auditAllStickerCatalogs = (): TemplateQualitySummary => {
  const issues = [...auditUsedAddendumCatalog(), ...auditUsedWindowStickerCatalog()];
  return {
    totalTemplates: USED_ADDENDUM_CATALOG_50.length + USED_WINDOW_STICKER_CATALOG_50.length,
    totalIssues: issues.length,
    criticalIssues: issues.filter((issue) => issue.severity === "critical").length,
    warningIssues: issues.filter((issue) => issue.severity === "warning").length,
    infoIssues: issues.filter((issue) => issue.severity === "info").length,
    issues,
  };
};

export const getTemplateQualityGoals = () => FIVE_AGENT_QUALITY_STANDARDS;
