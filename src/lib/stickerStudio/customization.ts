import type { StudioTemplate, StickerBranding, StickerRenderOptions, LabelMode } from "./templates";

// ──────────────────────────────────────────────────────────────────────
// Per-dealer template customization. Dealers tune approved templates without
// editing raw layout code: brand colors, logo/QR visibility, copy overrides,
// section relabels, and default seed content. Stored in
// dealer_template_customizations (tenant-scoped). Safe limits are enforced in
// applyCustomization — dealers can never change print dimensions, remove the
// disclaimer area, drop required VIN/stock fields, or kill a compliance QR.
// ──────────────────────────────────────────────────────────────────────

export interface TemplateCustomization {
  accentColor?: string;
  secondaryColor?: string;
  logoEnabled: boolean;
  qrEnabled: boolean;
  disclaimerOverride?: string;
  valuePropOverride?: string;
  sectionLabels: Partial<Record<"installed" | "benefits" | "upgrades", string>>;
  defaultBenefits: string[];
  defaultAddendumWording?: string;
  preferredLabelMode?: LabelMode;
}

export const EMPTY_CUSTOMIZATION: TemplateCustomization = {
  logoEnabled: true,
  qrEnabled: true,
  sectionLabels: {},
  defaultBenefits: [],
};

// deno-lint-ignore no-explicit-any
export function customizationFromRow(row: any): TemplateCustomization {
  if (!row) return { ...EMPTY_CUSTOMIZATION };
  const labels = (row.section_label_overrides && typeof row.section_label_overrides === "object") ? row.section_label_overrides : {};
  const benefits = Array.isArray(row.default_benefits)
    ? row.default_benefits.map((b: unknown) => String(b)).filter(Boolean)
    : [];
  return {
    accentColor: row.accent_color || undefined,
    secondaryColor: row.secondary_color || undefined,
    logoEnabled: row.logo_enabled !== false,
    qrEnabled: row.qr_enabled !== false,
    disclaimerOverride: row.disclaimer_override || undefined,
    valuePropOverride: row.value_prop_override || undefined,
    sectionLabels: {
      installed: labels.installed || undefined,
      benefits: labels.benefits || undefined,
      upgrades: labels.upgrades || undefined,
    },
    defaultBenefits: benefits,
    defaultAddendumWording: row.default_addendum_wording || undefined,
    preferredLabelMode: row.preferred_label_mode === "black" ? "black" : row.preferred_label_mode === "white" ? "white" : undefined,
  };
}

export function customizationToRow(tenantId: string, templateId: string, c: TemplateCustomization): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    template_id: templateId,
    accent_color: c.accentColor || null,
    secondary_color: c.secondaryColor || null,
    logo_enabled: c.logoEnabled,
    qr_enabled: c.qrEnabled,
    disclaimer_override: c.disclaimerOverride || null,
    value_prop_override: c.valuePropOverride || null,
    section_label_overrides: c.sectionLabels || {},
  };
}
// Columns that only exist after the extras migration (20260620080000).
export function customizationExtrasRow(c: TemplateCustomization): Record<string, unknown> {
  return {
    default_benefits: c.defaultBenefits || [],
    default_addendum_wording: c.defaultAddendumWording || null,
    preferred_label_mode: c.preferredLabelMode || null,
  };
}

// Whether a template's QR may be turned off. Compliance templates require it.
export function qrRequired(template: StudioTemplate): boolean {
  return template.config.styleTags.includes("Compliance");
}

export interface AppliedCustomization {
  template: StudioTemplate;
  branding: StickerBranding;
  options: StickerRenderOptions;
}

// Merge a dealer customization onto a resolved template + seed branding.
// Application order is: built-in base -> DB template config (already in
// `template`) -> dealer customization (here) -> [vehicle data + UI applied by
// the generator]. Returns a new template/branding/options; never mutates input.
export function applyCustomization(
  template: StudioTemplate,
  branding: StickerBranding,
  c: TemplateCustomization | null | undefined,
): AppliedCustomization {
  if (!c) return { template, branding, options: {} };
  const cfg = template.config;

  // QR: dealers may only turn OFF, only when the template supports it, and never
  // on a compliance template that requires the scannable packet link.
  const keepQr = cfg.supportsQr && (c.qrEnabled || qrRequired(template));
  const nextConfig = {
    ...cfg,
    supportsQr: keepQr,
    defaultAccent: c.accentColor || cfg.defaultAccent,
  };

  const nextBranding: StickerBranding = {
    ...branding,
    accentColor: cfg.supportsAccent && c.accentColor ? c.accentColor : branding.accentColor,
    secondaryColor: c.secondaryColor || branding.secondaryColor,
    showLogo: cfg.supportsLogo ? c.logoEnabled : branding.showLogo,
    // Overrides only replace when non-empty — the disclaimer area can never be
    // emptied out (required compliance copy stays if the dealer clears it).
    disclaimer: (c.disclaimerOverride && c.disclaimerOverride.trim()) || branding.disclaimer,
    valueProp: c.valuePropOverride ?? branding.valueProp,
  };

  const options: StickerRenderOptions = {
    labelMode: c.preferredLabelMode,
    sectionLabels: c.sectionLabels,
  };

  return { template: { ...template, config: nextConfig }, branding: nextBranding, options };
}
