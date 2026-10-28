import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import { normalizeContactRouting } from "@/lib/passportRouting";
import { formatDealerPhone, normalizeDealerWebsite, resolveDealerIdentity, type DealerIdentityStore } from "@/lib/dealerIdentity";
import { adminTabHref } from "@/lib/admin/sections";

// Pure rules for the Dealership & Brand section: which settings keys each
// view owns, how a draft is diffed against the server row, what counts as
// valid, and the read-only derivations (contact readiness, header preview)
// that other surfaces display but never edit.

export type SettingsKey = keyof DealerSettings;
export type Draft<K extends SettingsKey> = Pick<DealerSettings, K>;

export const IDENTITY_KEYS = ["dealer_name", "dealer_city", "dealer_state", "dealer_timezone", "dealer_logo_url"] as const;
export const APPEARANCE_KEYS = ["primary_color"] as const;
export const HOURS_CONTACT_KEYS = ["dealer_hours", "dealer_phone", "dealer_website_url", "public_landing_url", "dealer_address", "dealer_zip", "dealer_principal", "dealer_license_number"] as const;
export const WHY_BUY_KEYS = ["dealer_tagline", "why_buy_here", "warranty_programs"] as const;
export const WEBSITES_KEYS = ["dms_provider", "new_inventory_url", "used_inventory_url", "autotrader_url", "cars_com_url", "cargurus_url", "capital_one_url", "carfax_url", "vdp_price_labels", "vdp_strip_finance_params", "vehicle_conditions"] as const;
export const DOCUMENT_DEFAULT_KEYS = ["default_new_addendum", "default_used_window", "default_used_addendum", "default_ftc_warranty", "passport_payment_display"] as const;

export type IdentityKey = (typeof IDENTITY_KEYS)[number];
export type AppearanceKey = (typeof APPEARANCE_KEYS)[number];
export type HoursContactKey = (typeof HOURS_CONTACT_KEYS)[number];
export type WhyBuyKey = (typeof WHY_BUY_KEYS)[number];
export type WebsitesKey = (typeof WEBSITES_KEYS)[number];
export type DocumentDefaultKey = (typeof DOCUMENT_DEFAULT_KEYS)[number];

export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" }, { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

export const US_TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern Time (ET)" },
  { id: "America/Chicago", label: "Central Time (CT)" },
  { id: "America/Denver", label: "Mountain Time (MT)" },
  { id: "America/Phoenix", label: "Mountain Time, no DST (AZ)" },
  { id: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { id: "America/Anchorage", label: "Alaska Time (AKT)" },
  { id: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
];

export const BRAND_PALETTE: ReadonlyArray<{ label: string; hex: string }> = [
  { label: "Navy", hex: "#142338" },
  { label: "Blue", hex: "#2457D6" },
  { label: "White", hex: "#FFFFFF" },
];

export const ACCENT_PRESETS: ReadonlyArray<{ label: string; hex: string }> = [
  { label: "Blue", hex: "#2457D6" },
  { label: "Navy", hex: "#142338" },
];

/** The accent in force when no dealer colour is saved. */
export const DEFAULT_ACCENT_HEX = "#2457D6";

export const FIELD_LABELS: Partial<Record<SettingsKey, string>> = {
  dealer_name: "Dealership name",
  dealer_tagline: "Tagline",
  dealer_city: "City",
  dealer_state: "State",
  dealer_timezone: "Time zone",
  dealer_logo_url: "Logo",
  primary_color: "Workspace accent",
  dealer_hours: "Store hours",
  dealer_phone: "Main phone",
  dealer_website_url: "Website",
  public_landing_url: "Public landing page",
  dealer_address: "Street address",
  dealer_zip: "ZIP",
  dealer_principal: "Dealer principal",
  dealer_license_number: "DMV dealer license number",
  why_buy_here: "Why buy here",
  warranty_programs: "Warranty programs",
  dms_provider: "DMS provider",
  new_inventory_url: "New inventory page",
  used_inventory_url: "Used inventory page",
  autotrader_url: "AutoTrader",
  cars_com_url: "Cars.com",
  cargurus_url: "CarGurus",
  capital_one_url: "Capital One",
  carfax_url: "CARFAX",
  vdp_price_labels: "VDP price labels",
  vdp_strip_finance_params: "Strip finance and lease URL parameters",
  vehicle_conditions: "Condition terms",
  default_new_addendum: "New-car addendum",
  default_used_window: "Used-car window sticker",
  default_used_addendum: "Used-car addendum",
  default_ftc_warranty: "FTC used-car warranty",
  passport_payment_display: "Passport payment estimate",
};

export const fieldLabel = (key: string): string => FIELD_LABELS[key as SettingsKey] ?? key;

const SUBKEY_LABELS: Record<string, string> = { downPayment: "down payment", interestRate: "APR", payment: "payment", term: "term" };

/** A value as the review panel prints it: short, in words, never raw JSON. */
export function describeValue(value: unknown): string {
  if (value == null || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.length > 90 ? `${value.slice(0, 87)}...` : value;
  if (Array.isArray(value)) return value.length ? value.map(describeValue).join(", ") : "(none)";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${SUBKEY_LABELS[k] ?? k} ${typeof v === "boolean" ? (v ? "on" : "off") : describeValue(v)}`)
      .join(", ");
  }
  return String(value);
}

export function pickSettings<K extends SettingsKey>(settings: DealerSettings, keys: readonly K[]): Draft<K> {
  const out = {} as Draft<K>;
  for (const k of keys) out[k] = settings[k];
  return out;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function changedKeys<K extends SettingsKey>(draft: Draft<K>, original: Draft<K>, keys: readonly K[]): K[] {
  return keys.filter((k) => !same(draft[k], original[k]));
}

/** Only the keys that differ, so a save never rewrites what another editor owns. */
export function patchOf<K extends SettingsKey>(draft: Draft<K>, original: Draft<K>, keys: readonly K[]): Partial<DealerSettings> {
  const patch: Record<string, unknown> = {};
  for (const k of changedKeys(draft, original, keys)) patch[k] = draft[k];
  return patch as Partial<DealerSettings>;
}

export const isHexColor = (v: string): boolean => /^#[0-9a-f]{6}$/i.test((v || "").trim());

export const normalizeHex = (v: string): string => {
  const m = (v || "").trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(m) ? `#${m.toUpperCase()}` : (v || "").trim();
};

export const accentLabel = (hex: string): string => {
  const normalized = normalizeHex(hex || DEFAULT_ACCENT_HEX);
  const preset = ACCENT_PRESETS.find((p) => p.hex === normalized);
  return preset ? `${preset.label} (${preset.hex})` : `Custom (${normalized})`;
};

const ZIP = /^\d{5}(-\d{4})?$/;

export function validateIdentity(d: Draft<IdentityKey>): string[] {
  const errors: string[] = [];
  if (!(d.dealer_name || "").trim()) errors.push("Dealership name is required.");
  const state = (d.dealer_state || "").trim().toUpperCase();
  if (state && !US_STATES.some((s) => s.code === state)) errors.push("State must be a two-letter US state code.");
  return errors;
}

export function validateAppearance(d: Draft<AppearanceKey>): string[] {
  const v = (d.primary_color || "").trim();
  return v && !isHexColor(v) ? ["Accent colour must be a six-digit hex value like #2457D6."] : [];
}

export function validateHoursContact(d: Draft<HoursContactKey>): string[] {
  const errors: string[] = [];
  const zip = (d.dealer_zip || "").trim();
  if (zip && !ZIP.test(zip)) errors.push("ZIP must be five digits, optionally with a four-digit extension.");
  const phone = (d.dealer_phone || "").trim();
  if (phone && !formatDealerPhone(phone)) errors.push("Phone number is incomplete or looks like a placeholder.");
  const site = (d.dealer_website_url || "").trim();
  if (site && !normalizeDealerWebsite(site).href) errors.push("Website address is not a valid web address.");
  const landing = (d.public_landing_url || "").trim();
  if (landing && !normalizeDealerWebsite(landing, { isLandingPage: true }).href) errors.push("Landing page is not a valid web address.");
  return errors;
}

const URL_KEYS: ReadonlyArray<{ key: WebsitesKey; label: string }> = [
  { key: "new_inventory_url", label: "New inventory page" },
  { key: "used_inventory_url", label: "Used inventory page" },
  { key: "autotrader_url", label: "AutoTrader" },
  { key: "cars_com_url", label: "Cars.com" },
  { key: "cargurus_url", label: "CarGurus" },
  { key: "capital_one_url", label: "Capital One" },
  { key: "carfax_url", label: "CARFAX" },
];

export function validateWebsites(d: Draft<WebsitesKey>): string[] {
  const errors: string[] = [];
  for (const { key, label } of URL_KEYS) {
    const v = String(d[key] || "").trim();
    if (!v) continue;
    const withProtocol = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(withProtocol);
      if (!u.hostname.includes(".")) errors.push(`${label} address is not valid.`);
    } catch {
      errors.push(`${label} address is not valid.`);
    }
  }
  return errors;
}

export const validateWhyBuy = (_d: Draft<WhyBuyKey>): string[] => [];
export const validateDocumentDefaults = (_d: Draft<DocumentDefaultKey>): string[] => [];

export interface ReadinessRow {
  key: "sales_phone" | "sales_email" | "website";
  label: string;
  value: string;
  href: string | null;
  state: "ready" | "incomplete";
  /** Where the value is edited; this card never edits it. */
  editHref: string;
}

/** The contact details customer-facing content relies on, each read from its owner. */
export function contactReadiness(settings: Pick<DealerSettings, "passport_contact_routing" | "dealer_website_url" | "public_landing_url">): ReadinessRow[] {
  const routing = normalizeContactRouting(settings.passport_contact_routing);
  const phone = formatDealerPhone(routing.dealershipDefaultContact?.salesPhone);
  const email = String(routing.dealershipDefaultContact?.salesEmail || "").trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const landing = String(settings.public_landing_url || "").trim();
  const site = landing ? normalizeDealerWebsite(landing, { isLandingPage: true }) : normalizeDealerWebsite(settings.dealer_website_url);
  return [
    { key: "sales_phone", label: "Sales phone", value: phone || "Not configured", href: phone ? `tel:${phone.replace(/\D/g, "")}` : null, state: phone ? "ready" : "incomplete", editHref: adminTabHref("routing") },
    { key: "sales_email", label: "Sales email", value: emailOk ? email : "Not configured", href: emailOk ? `mailto:${email}` : null, state: emailOk ? "ready" : "incomplete", editHref: adminTabHref("routing") },
    { key: "website", label: "Website", value: site.href || "Not configured", href: site.href || null, state: site.href ? "ready" : "incomplete", editHref: adminTabHref("hours-contact") },
  ];
}

export interface HeaderPreview {
  /** What the application header shows: active store, then group, then the saved dealership name. */
  name: string;
  nameSource: "store" | "group" | "settings" | "none";
  /** What the document masthead prints, from the identity resolver. */
  documentName: string;
  location: string;
  logoUrl: string;
  warnings: string[];
}

const PLACEHOLDER_NAME = "Your Dealership";

/**
 * The application header names the dealership by the active store, then the
 * dealer group, then the saved dealership name; documents use the identity
 * resolver. Both are reported so the preview never claims an edit will show
 * somewhere it will not.
 */
export function headerPreview(
  settings: DealerSettings,
  opts: { tenantName?: string | null; stores?: DealerIdentityStore[]; activeStoreId?: string | null } = {},
): HeaderPreview {
  const identity = resolveDealerIdentity({ settings, stores: opts.stores, activeStoreId: opts.activeStoreId, tenantName: opts.tenantName });
  const store = opts.activeStoreId ? opts.stores?.find((s) => s.id === opts.activeStoreId) : undefined;
  const dealerName = settings.dealer_name && settings.dealer_name !== PLACEHOLDER_NAME ? settings.dealer_name.trim() : "";
  const storeName = String(store?.name || "").trim();
  const groupName = String(opts.tenantName || "").trim();
  const name = storeName || groupName || dealerName;
  const nameSource = storeName ? "store" : groupName ? "group" : dealerName ? "settings" : "none";
  const city = String(store?.city || settings.dealer_city || "").trim();
  const state = String(store?.state || settings.dealer_state || "").trim();
  return {
    name,
    nameSource,
    documentName: identity.tenantName,
    location: [city, state].filter(Boolean).join(", "),
    logoUrl: identity.tenantLogoUrl,
    warnings: identity.warnings.map((w) => w.message),
  };
}

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return "Upload a PNG, JPG or SVG file.";
  if (file.size > LOGO_MAX_BYTES) return "The logo must be 2 MB or smaller.";
  return null;
}
