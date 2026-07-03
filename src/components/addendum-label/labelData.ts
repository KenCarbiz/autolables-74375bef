import type { Product } from "@/hooks/useProducts";
import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { DealerProgram } from "@/lib/dealerPrograms";
import { bucketForVehicle, resolveTierPrice } from "@/types/product";

// ──────────────────────────────────────────────────────────────
// 4.25in x 11in addendum label — data assembly and calculations.
// The label is self-aware: everything renders from the tenant's
// settings and the vehicle's inventory record. Nothing here invents
// a value; missing data hides its row (the layout collapses upward).
// ──────────────────────────────────────────────────────────────

export interface LabelTenant {
  name: string;
  logoUrl: string;
  addressLine: string;
  phone: string;
  website: string;
}

export interface LabelVehicle {
  year: string;
  make: string;
  model: string;
  trim: string;
  vin: string;
  stockNumber: string;
  condition: string;
  bodyStyle: string;
  msrp: number | null;
  price: number | null;
}

export interface LabelProductLine {
  id: string;
  name: string;
  subtitle: string;
  price: number | null;
  iconKey: string;
  disclosureRequired: boolean;
}

export interface LabelBenefitLine {
  id: string;
  name: string;
  iconKey: string;
  disclosureRequired: boolean;
}

export interface AddendumLabelData {
  tenant: LabelTenant;
  vehicle: LabelVehicle;
  passportUrl: string;
  passportModules: string[];
  installed: LabelProductLine[];
  benefits: LabelBenefitLine[];
  upgrades: LabelProductLine[];
  generatedDate: string;
  compact: boolean;
  // Per-dealer / per-variant presentation rules. Optional so every existing
  // caller keeps working; AddendumLabel merges this over DEFAULT_TEMPLATE_CONFIG.
  config?: Partial<TemplateConfig>;
}

// ──────────────────────────────────────────────────────────────
// Template configuration — the label is one engine driven by config.
// A variant is just a named preset of these switches; a dealer can also
// override any switch directly. Nothing here fabricates data: config only
// decides which real sections show and how prices/disclosures read.
// ──────────────────────────────────────────────────────────────

// "auto" defers to displayPrice (MSRP for new, price for used); the rest
// force a fixed customer-facing label regardless of condition.
export type PriceLabelMode = "auto" | "MSRP" | "Market Price" | "Selling Price" | "Total MSRP";

export type AddendumVariant =
  | "premium_full"     // v1 — everything on, the printed mockup
  | "ftc_minimal"      // stripped to identity + required disclosure, no marketing
  | "new"              // new-vehicle framing — Total MSRP
  | "used"             // used-vehicle framing — Selling Price
  | "cpo"              // certified pre-owned — Selling Price, benefits kept
  | "no_upgrades"      // hide the available-upgrades section
  | "no_installed";    // hide the installed-equipment section

export interface TemplateConfig {
  priceLabel: PriceLabelMode;
  showInstalledProducts: boolean;
  showIncludedBenefits: boolean;
  showAvailableUpgrades: boolean;
  showTrustBadges: boolean;
  showFooterComplianceBadges: boolean;
  installedProductsIncludedInTotal: boolean;
  availableUpgradesIncludedInTotal: boolean;
  disclosureMode: "short" | "full" | "none";
}

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  priceLabel: "auto",
  showInstalledProducts: true,
  showIncludedBenefits: true,
  showAvailableUpgrades: true,
  showTrustBadges: true,
  showFooterComplianceBadges: true,
  installedProductsIncludedInTotal: true,
  availableUpgradesIncludedInTotal: false,
  disclosureMode: "short",
};

// Named presets. Each returns a full config so the caller never has to
// remember which switches a variant flips; overrides layer on top of this.
export const configForVariant = (variant: AddendumVariant): TemplateConfig => {
  const base = { ...DEFAULT_TEMPLATE_CONFIG };
  switch (variant) {
    case "ftc_minimal":
      return { ...base, showTrustBadges: false, showIncludedBenefits: false, disclosureMode: "full" };
    case "new":
      return { ...base, priceLabel: "Total MSRP" };
    case "used":
      return { ...base, priceLabel: "Selling Price" };
    case "cpo":
      return { ...base, priceLabel: "Selling Price" };
    case "no_upgrades":
      return { ...base, showAvailableUpgrades: false };
    case "no_installed":
      return { ...base, showInstalledProducts: false };
    case "premium_full":
    default:
      return base;
  }
};

export const resolveConfig = (config?: Partial<TemplateConfig>): TemplateConfig =>
  ({ ...DEFAULT_TEMPLATE_CONFIG, ...(config ?? {}) });

// The label a customer reads for the headline price. "auto" keeps the
// condition-aware behavior; any explicit mode wins so a dealer can print
// "Selling Price" on a new car if that's how they merchandise it.
const FORCED_PRICE_LABELS: Record<Exclude<PriceLabelMode, "auto">, string> = {
  "MSRP": "MSRP",
  "Market Price": "MARKET PRICE",
  "Selling Price": "SELLING PRICE",
  "Total MSRP": "TOTAL MSRP",
};

export const resolvePrice = (
  v: Pick<LabelVehicle, "condition" | "msrp" | "price">,
  config: TemplateConfig,
): { label: string; value: number | null } => {
  const base = displayPrice(v);
  if (config.priceLabel === "auto") return base;
  return { label: FORCED_PRICE_LABELS[config.priceLabel], value: base.value };
};

export const fmtCurrency = (v?: number | null): string =>
  v == null || !Number.isFinite(v) ? "" : `$${Math.round(v).toLocaleString("en-US")}`;

export const fmtDate = (d: Date = new Date()): string =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

// The main displayed price comes from the vehicle record, never from
// summing products — installed items are already inside it when included.
export const displayPrice = (v: Pick<LabelVehicle, "condition" | "msrp" | "price">): { label: string; value: number | null } => {
  const isNew = v.condition === "new";
  if (isNew && v.msrp != null) return { label: "TOTAL MSRP", value: v.msrp };
  if (v.price != null) return { label: "TOTAL PRICE", value: v.price };
  if (v.msrp != null) return { label: "TOTAL MSRP", value: v.msrp };
  return { label: "PRICE", value: null };
};

export const sumLines = (lines: { price: number | null }[]): number =>
  lines.reduce((sum, l) => sum + (l.price ?? 0), 0);

// Compact mode keeps the label inside 11 inches when the dealer runs a
// long catalog. VIN, stock, price, QR, and disclosures survive no matter what.
export const isCompact = (installed: unknown[], benefits: unknown[], upgrades: unknown[]): boolean =>
  installed.length + benefits.length + upgrades.length > 12;

// Effective disposition per the addendum builder's FTC rule set: the admin
// default mode wins over the catalog type, and a product that can't be
// pre-installed is always optional. (Verified install proofs refine this
// further on the interactive addendum; the label uses the same defaults.)
export const splitProducts = (
  products: Product[],
  mode: DealerSettings["product_default_mode"],
  bodyStyle: string,
  model: string,
): { installed: LabelProductLine[]; upgrades: LabelProductLine[] } => {
  const bucket = bucketForVehicle(bodyStyle, model);
  const installed: LabelProductLine[] = [];
  const upgrades: LabelProductLine[] = [];
  for (const p of products) {
    const pr = p as Product & { available_preinstalled?: boolean; subtitle?: string; icon_type?: string; iconType?: string };
    let badge = mode === "all_installed" ? "installed" : mode === "all_optional" ? "optional" : p.badge_type;
    if (pr.available_preinstalled === false) badge = "optional";
    const price = resolveTierPrice(pr.price_tiers, bucket) ?? p.price ?? null;
    const line: LabelProductLine = {
      id: p.id,
      name: p.name,
      subtitle: (pr.subtitle || "").trim(),
      price,
      iconKey: (pr.icon_type || pr.iconType || "").trim() || "default_product",
      disclosureRequired: !!(p.disclosure || "").trim(),
    };
    (badge === "installed" ? installed : upgrades).push(line);
  }
  return { installed, upgrades };
};

// Included benefits come from the dealer's structured value-prop programs —
// enabled, sticker-visible, and applicable to this vehicle's condition.
export const programsToBenefits = (
  programs: DealerProgram[] | undefined,
  condition: string,
): LabelBenefitLine[] =>
  (programs || [])
    .filter((pg) => pg.enabled && pg.showOnSticker)
    .filter((pg) => {
      const a = pg.appliesTo as unknown as string;
      if (!a || a === "all") return true;
      if (condition === "cpo") return a === "cpo" || a === "used";
      return a === condition;
    })
    .map((pg) => ({
      id: pg.id,
      name: pg.title,
      iconKey: /powertrain/i.test(pg.title) ? "powertrain_warranty"
        : /maintenance/i.test(pg.title) ? "maintenance_plan"
        : /roadside/i.test(pg.title) ? "roadside_assistance"
        : /exchange|return/i.test(pg.title) ? "exchange_policy"
        : "included_benefit",
      disclosureRequired: !!(pg.disclosure || "").trim(),
    }));
