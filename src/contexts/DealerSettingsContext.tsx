import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";

// A configurable internal recon/service the dealer routes to a responsible
// party. Non-customer charge — tracked as the store's own cost.
export interface GetReadyService {
  name: string;
  responsible_name: string;
  responsible_email: string;
  cost: string;
}

// ── Window-sticker PRINT templates ──────────────────────────────
// Each dealer stores how they physically print a given document onto
// label stock. Two modes:
//   - "blank": AutoLabels prints the FULL designed sticker onto blank
//     stock. Only the label SIZE matters.
//   - "preprinted": the dealer feeds pre-printed label stock (their own
//     artwork/branding already on the page) and AutoLabels overlays ONLY
//     the vehicle data into fixed positions. Needs the artwork image (for
//     on-screen alignment) plus an X/Y position per field.
export type StickerDocType = "new_window" | "used_window" | "new_addendum" | "used_addendum";

export interface StickerFieldPosition {
  key: string;     // canonical data field (ymm, vin, price, …)
  label: string;   // human label shown in the editor
  x: number;       // horizontal position, percent of label width (0–100)
  y: number;       // vertical position, percent of label height (0–100)
  size: number;    // font size in points
  enabled: boolean;
}

export interface StickerPrintTemplate {
  mode: "blank" | "preprinted";
  width: string;        // label width, inches
  height: string;       // label height, inches
  artwork_url: string;  // pre-printed stock artwork (preprinted mode only)
  fields: StickerFieldPosition[];
}

export const DEFAULT_STICKER_FIELDS: StickerFieldPosition[] = [
  { key: "ymm", label: "Year / Make / Model", x: 8, y: 10, size: 18, enabled: true },
  { key: "trim", label: "Trim", x: 8, y: 19, size: 12, enabled: true },
  { key: "price", label: "Price", x: 60, y: 10, size: 24, enabled: true },
  { key: "mileage", label: "Mileage", x: 60, y: 19, size: 12, enabled: true },
  { key: "stock", label: "Stock #", x: 8, y: 84, size: 10, enabled: true },
  { key: "vin", label: "VIN", x: 8, y: 90, size: 10, enabled: true },
];

export const DEFAULT_STICKER_TEMPLATE: StickerPrintTemplate = {
  mode: "blank",
  width: "8.5",
  height: "11",
  artwork_url: "",
  fields: DEFAULT_STICKER_FIELDS,
};

export const STICKER_DOC_LABELS: Record<StickerDocType, string> = {
  new_window: "New-car window sticker",
  used_window: "Used-car window sticker",
  new_addendum: "New-car addendum",
  used_addendum: "Used-car addendum",
};

const defaultStickerTemplates = (): Record<StickerDocType, StickerPrintTemplate> => ({
  new_window: { ...DEFAULT_STICKER_TEMPLATE, fields: DEFAULT_STICKER_FIELDS.map((f) => ({ ...f })) },
  used_window: { ...DEFAULT_STICKER_TEMPLATE, fields: DEFAULT_STICKER_FIELDS.map((f) => ({ ...f })) },
  new_addendum: { ...DEFAULT_STICKER_TEMPLATE, fields: DEFAULT_STICKER_FIELDS.map((f) => ({ ...f })) },
  used_addendum: { ...DEFAULT_STICKER_TEMPLATE, fields: DEFAULT_STICKER_FIELDS.map((f) => ({ ...f })) },
});

export interface DealerSettings {
  // Branding
  dealer_name: string;
  dealer_tagline: string;
  dealer_logo_url: string;
  primary_color: string;
  // Dealership legal + contact details (appear on the addendum / Buyers
  // Guide and identify the licensed seller). dealer_state is the state the
  // dealer legally operates in and drives state compliance rules.
  dealer_address: string;
  dealer_city: string;
  dealer_state: string;   // 2-letter operating state
  dealer_zip: string;
  dealer_phone: string;
  dealer_principal: string;        // dealer principal / owner of record
  dealer_license_number: string;   // DMV dealer license / ID number
  dealer_oem_brands: string;       // franchised OEM brands (comma-separated)
  // Inventory feed / website verification (Wave 36). The DMS is the
  // authoritative source for inventory + pricing; the new/used inventory
  // website URLs feed the advertised-price-vs-sticker crawl.
  dms_provider: string;            // e.g. CDK, Reynolds, Dealertrack, Tekion
  new_inventory_url: string;       // dealer's New inventory listing page
  used_inventory_url: string;      // dealer's Used inventory listing page
  // Marketplace listing URLs the price-integrity crawler verifies against,
  // so the dealer's website AND the marketplaces match the window sticker.
  cargurus_url: string;
  cars_com_url: string;
  autotrader_url: string;
  capital_one_url: string;
  // Marketing assets shown to shoppers (packet / stickers / portal).
  why_buy_here: string;            // dealership value prop / why buy here
  warranty_programs: string;       // warranty programs offered (free text)
  // Dealer-configurable condition terms (comma-separated). The dealer can use
  // their own labels (e.g. "OEM CPO", "Dealer CPO"); each maps to a canonical
  // new/used/cpo value under the hood for storage + compliance gating.
  vehicle_conditions: string;
  // Configurable internal recon/service catalog (non-customer charge). Each
  // service routes to a responsible party (name + email) and carries a default
  // dealer cost; picked when starting a Get-Ready.
  get_ready_services: GetReadyService[];
  // Per-dealer document defaults the sticker/addendum generators pull when a
  // new or used vehicle is started.
  default_new_addendum: string;     // layout id for the new-car addendum sticker
  default_used_window: string;      // layout id for the used-car window sticker
  default_used_addendum: string;    // layout id for the used-car addendum sticker
  default_ftc_warranty: string;     // FTC Buyers Guide warranty designation
  // Per-dealer physical PRINT templates, keyed by document type. Stores the
  // label stock size and (for pre-printed stock) the artwork + the X/Y
  // positions the vehicle data is overlaid into when printing.
  sticker_print_templates: Record<StickerDocType, StickerPrintTemplate>;
  // Feature toggles — what shows on the employee-facing addendum
  feature_vin_decode: boolean;
  feature_buyers_guide: boolean;
  feature_product_rules: boolean;
  feature_product_icons: boolean;
  feature_vin_barcode: boolean;
  feature_lead_capture: boolean;
  feature_cobuyer_signature: boolean;
  feature_custom_branding: boolean;
  feature_ink_saving: boolean;
  feature_spanish_buyers_guide: boolean;
  // Wave 28 — VI / KO / ZH for the CA market. Defaults OFF
  // because the dealer should verify each translation reads
  // correctly for their customer base before enabling.
  feature_multilang_buyers_guide: boolean;
  feature_url_scrape: boolean;
  // Extended feature toggles
  feature_inventory: boolean;
  feature_invoicing: boolean;
  feature_warranty: boolean;
  feature_payroll: boolean;
  feature_analytics: boolean;
  feature_sms: boolean;
  feature_ai_descriptions: boolean;
  feature_blackbook: boolean;
  // Addendum sizing & product defaults
  addendum_paper_size: "letter" | "legal" | "half-sheet" | "addendum-strip" | "addendum-half" | "monroney" | "custom";
  addendum_custom_width: string;   // inches
  addendum_custom_height: string;  // inches
  product_default_mode: "all_installed" | "all_optional" | "selective";
  allow_type_override_at_signing: boolean;
  // Dealer documentation fee
  doc_fee_enabled: boolean;
  doc_fee_amount: number;
  doc_fee_state: string;  // 2-letter state code
  // Compliance
  cars_act_mode: boolean;
  retention_years: number;
  required_languages: string[];
  // Privacy notice (dealer uploads their own)
  privacy_notice_enabled: boolean;
  privacy_notice_text: string;
  privacy_notice_url: string;
}

export const DEFAULT_SETTINGS: DealerSettings = {
  dealer_name: "Your Dealership",
  dealer_tagline: "Your Trusted Automotive Partner",
  dealer_logo_url: "",
  primary_color: "",
  dealer_address: "",
  dealer_city: "",
  dealer_state: "",
  dealer_zip: "",
  dealer_phone: "",
  dealer_principal: "",
  dealer_license_number: "",
  dealer_oem_brands: "",
  dms_provider: "",
  new_inventory_url: "",
  used_inventory_url: "",
  cargurus_url: "",
  cars_com_url: "",
  autotrader_url: "",
  capital_one_url: "",
  why_buy_here: "",
  warranty_programs: "",
  vehicle_conditions: "New, Demo, Used, CPO",
  get_ready_services: [
    { name: "Reconditioning / mechanical", responsible_name: "Service Dept.", responsible_email: "", cost: "" },
    { name: "Emissions / safety inspection", responsible_name: "Lot Attendant", responsible_email: "", cost: "" },
    { name: "Accessories install", responsible_name: "Detail / Vendor", responsible_email: "", cost: "" },
  ],
  default_new_addendum: "standard",
  default_used_window: "standard",
  default_used_addendum: "standard",
  default_ftc_warranty: "as_is",
  sticker_print_templates: defaultStickerTemplates(),
  feature_vin_decode: true,
  feature_buyers_guide: true,
  feature_product_rules: true,
  feature_product_icons: true,
  feature_vin_barcode: true,
  feature_lead_capture: true,
  feature_cobuyer_signature: true,
  feature_custom_branding: true,
  feature_ink_saving: false,
  feature_spanish_buyers_guide: true,
  feature_multilang_buyers_guide: false,
  feature_url_scrape: true,
  feature_inventory: true,
  feature_invoicing: true,
  feature_warranty: true,
  feature_payroll: false,
  feature_analytics: true,
  feature_sms: true,
  feature_ai_descriptions: true,
  feature_blackbook: false,
  addendum_paper_size: "letter",
  addendum_custom_width: "8.5",
  addendum_custom_height: "11",
  product_default_mode: "selective",
  allow_type_override_at_signing: false,
  doc_fee_enabled: true,
  doc_fee_amount: 0,
  doc_fee_state: "",
  cars_act_mode: false,
  retention_years: 7,
  required_languages: ["en"],
  privacy_notice_enabled: false,
  privacy_notice_text: "",
  privacy_notice_url: "",
};

interface DealerSettingsContextType {
  settings: DealerSettings;
  loading: boolean;
  updateSettings: (updates: Partial<DealerSettings>) => Promise<void>;
  reload: () => Promise<void>;
}

const DealerSettingsContext = createContext<DealerSettingsContextType | undefined>(undefined);

// ──────────────────────────────────────────────────────────────
// Tenant-scoped dealer_profiles row is the source of truth.
// localStorage is a write-through cache so public / unauthenticated
// pages (/, /v/:slug, /sign/:token, /deal/:token) and the first
// paint of signed-in routes still render with the last known
// branding instead of flashing the generic defaults.
// Cache key is versioned + tenant-scoped.
// ──────────────────────────────────────────────────────────────

const cacheKey = (tenantId: string | null) => `autolabels.dealer_settings.v2:${tenantId ?? "anon"}`;

const readCache = (tenantId: string | null): DealerSettings | null => {
  try {
    const raw = localStorage.getItem(cacheKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return null;
  }
};

const writeCache = (tenantId: string | null, settings: DealerSettings) => {
  try { localStorage.setItem(cacheKey(tenantId), JSON.stringify(settings)); } catch { /* quota, ignore */ }
};

export const DealerSettingsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

  const [settings, setSettings] = useState<DealerSettings>(() => readCache(tenantId) ?? DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const loadedKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Anonymous / no-tenant users: trust the cache, render defaults.
    if (!user || !tenantId) {
      const cached = readCache(tenantId);
      setSettings(cached ?? DEFAULT_SETTINGS);
      setLoading(false);
      return;
    }

    // Signed-in + tenant: read from Supabase.
    try {
      const { data, error } = await (supabase as any)
        .from("dealer_profiles")
        .select("settings")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      // Layer: defaults < local cache < DB. When the DB row is empty
      // (e.g. a write failed and never persisted), the local cache still
      // carries the dealer's last edits so doc fee / state survive a
      // reload instead of silently resetting to defaults.
      const dbSettings = (data?.settings as Partial<DealerSettings>) || {};
      const merged: DealerSettings = {
        ...DEFAULT_SETTINGS,
        ...(readCache(tenantId) || {}),
        ...dbSettings,
      };
      setSettings(merged);
      writeCache(tenantId, merged);
    } catch {
      // Table may not exist yet (migration not applied) or query failed.
      // Fall back to cache then defaults so the app still works.
      const cached = readCache(tenantId);
      setSettings(cached ?? DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, [user, tenantId]);

  // Re-load when the user or their active tenant changes.
  useEffect(() => {
    const k = `${user?.id ?? "anon"}:${tenantId ?? "none"}`;
    if (loadedKeyRef.current === k) return;
    loadedKeyRef.current = k;
    load();
  }, [user?.id, tenantId, load]);

  const updateSettings = useCallback(
    async (updates: Partial<DealerSettings>) => {
      const next: DealerSettings = { ...settings, ...updates };
      setSettings(next);
      writeCache(tenantId, next);
      // Only persist to Supabase when we have a real tenant.
      if (!user || !tenantId) return;
      try {
        await (supabase as any)
          .from("dealer_profiles")
          .upsert(
            {
              tenant_id: tenantId,
              settings: next,
              updated_by: user.id,
            },
            { onConflict: "tenant_id" }
          );
      } catch {
        // Keep the in-memory + cache update; log for observability later.
        // eslint-disable-next-line no-console
        console.warn("dealer_profiles upsert failed; kept local cache");
      }
    },
    [settings, tenantId, user]
  );

  return (
    <DealerSettingsContext.Provider value={{ settings, loading, updateSettings, reload: load }}>
      {children}
    </DealerSettingsContext.Provider>
  );
};

export const useDealerSettings = () => {
  const ctx = useContext(DealerSettingsContext);
  if (!ctx) throw new Error("useDealerSettings must be used within DealerSettingsProvider");
  return ctx;
};
