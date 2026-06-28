import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { mapAutocurbProfile } from "@/lib/autocurbProfile";
import type { DealerProgram } from "@/lib/dealerPrograms";
import type { DocumentRules } from "@/lib/documentRules";
import { DEFAULT_STICKY_BUTTONS, type StickyBottomButtons } from "@/lib/stickyButtons";

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
//   - "preprinted": the dealer feeds their own pre-printed label stock
//     (branding/header/footer already printed, e.g. AutoExperts USA
//     stock) and AutoLabels fills ONLY the empty content area with the
//     vehicle data block + QR. Needs the artwork image (for on-screen
//     alignment) plus the content-area rectangle that data flows into.
export type StickerDocType = "new_window" | "used_window" | "new_addendum" | "used_addendum";

// The empty region on pre-printed stock that AutoLabels fills with the
// vehicle data block. All values are a percentage of the label (0–100).
export interface StickerContentArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StickerPrintTemplate {
  mode: "blank" | "preprinted";
  width: string;        // label width, inches
  height: string;       // label height, inches
  artwork_url: string;  // pre-printed stock artwork (preprinted mode only)
  content_area: StickerContentArea;
  // What the dealer wants printed into the pre-printed fill area. Vehicle ID
  // and the QR always print; equipment + pricing are dealer's choice so the
  // same engine can drive sparse (AutoExperts-style) or full-data stock.
  fill_equipment: boolean;
  fill_pricing: boolean;
}

// Default content area roughly matches the open white region on common
// pre-printed dealer stock (header band on top, footer band on bottom).
export const DEFAULT_CONTENT_AREA: StickerContentArea = { x: 6, y: 24, width: 88, height: 54 };

export const DEFAULT_STICKER_TEMPLATE: StickerPrintTemplate = {
  mode: "blank",
  width: "8.5",
  height: "11",
  artwork_url: "",
  content_area: { ...DEFAULT_CONTENT_AREA },
  fill_equipment: true,
  fill_pricing: true,
};

export const STICKER_DOC_LABELS: Record<StickerDocType, string> = {
  new_window: "New-car window sticker",
  used_window: "Used-car window sticker",
  new_addendum: "New-car addendum",
  used_addendum: "Used-car addendum",
};

const defaultStickerTemplates = (): Record<StickerDocType, StickerPrintTemplate> => ({
  new_window: { ...DEFAULT_STICKER_TEMPLATE, content_area: { ...DEFAULT_CONTENT_AREA } },
  used_window: { ...DEFAULT_STICKER_TEMPLATE, content_area: { ...DEFAULT_CONTENT_AREA } },
  new_addendum: { ...DEFAULT_STICKER_TEMPLATE, content_area: { ...DEFAULT_CONTENT_AREA } },
  used_addendum: { ...DEFAULT_STICKER_TEMPLATE, content_area: { ...DEFAULT_CONTENT_AREA } },
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
  carfax_url: string;
  // Per-dealer VDP advertised-price extraction. Dealers label their selling
  // price differently (Harte Infiniti = "Harte Deal", others = "Internet
  // Price" / "ePrice" / "Your Price" / "Selling Price"), so the scraper
  // takes a comma-separated, priority-ordered list of label strings to
  // search for next to a dollar amount on the VDP. The strip toggle removes
  // ?type=finance / ?type=lease style params before fetching so the page
  // shows the standard advertised price, not the incentive-conditional one.
  vdp_price_labels: string;
  vdp_strip_finance_params: boolean;
  // Marketing assets shown to shoppers (packet / stickers / portal).
  why_buy_here: string;            // dealership value prop / why buy here
  warranty_programs: string;       // warranty programs offered (free text)
  // Structured dealer value-proposition programs (10yr/100k powertrain,
  // lifetime powertrain, free maintenance, …) with FTC-style value/offer/
  // benefit/disclosure, optional finance requirement, and placement toggles.
  dealer_programs: DealerProgram[];
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
  // Compliance Pro premium stack (gated by tier). When off, the addendum flow
  // runs without the price-integrity gate / scrape verification.
  feature_price_verification: boolean;
  feature_marketcheck_sync: boolean;
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
  // Customer-facing price on the Passport: show the advertised price (before
  // the doc fee) and disclose the fee separately, or show the final website
  // sale price (fee included). Default: advertised_before_doc.
  price_display_mode: "advertised_before_doc" | "website_sale_price";
  // Office title/MCO upload. One or more clerk emails (comma/newline separated)
  // get the per-vehicle upload link + QR. Reminders re-send every N days until
  // the title/MCO is on file.
  title_clerk_email: string;
  title_reminders_enabled: boolean;
  title_reminder_days: number;
  title_email_on_intake: boolean;
  // Compliance
  cars_act_mode: boolean;
  retention_years: number;
  // Document workflow rules (approval / stale / packet / passport). Stored as
  // a nested blob; resolved with defaults via getDealerDocumentRules().
  document_rules?: Partial<DocumentRules>;
  required_languages: string[];
  // Privacy notice (dealer uploads their own)
  privacy_notice_enabled: boolean;
  privacy_notice_text: string;
  privacy_notice_url: string;
  // Inventory Command Center V2 — show the Quick Actions panel in the right
  // rail. Off by default for a cleaner executive dashboard.
  inventory_show_quick_actions: boolean;
  // Vehicle Passport — dealer-configurable sticky bottom CTA bar (max 4).
  sticky_bottom_buttons: StickyBottomButtons;
  // Vehicle Passport dealership-trust content (dealer-entered; rendered on the
  // public passport's "Why Buy From This Dealership" + "What Owners Say"). All
  // optional — each badge/review only shows when the dealer provides it.
  dealer_years_in_business: string;   // e.g. "45"
  dealer_satisfaction: string;        // e.g. "98%"
  dealer_bbb_rating: string;          // e.g. "A+"
  dealer_google_rating: string;       // e.g. "4.9"
  dealer_google_count: string;        // e.g. "1248"
  dealer_certifications: string;      // comma-separated award/cert names
  dealer_storefront_url: string;      // dealership photo URL
  dealer_review_sources: string;      // newline list: "Source | rating | quote"
  // Passport sticky-CTA sales advisor (shown in the conversion rail).
  dealer_advisor_name: string;
  dealer_advisor_title: string;       // e.g. "Senior Vehicle Specialist"
  dealer_advisor_photo: string;       // advisor headshot URL
  dealer_advisor_response: string;    // e.g. "Usually replies within 5 minutes"
  // Passport dealership profile — amenities & services (captured at onboarding,
  // editable in admin). Only what the dealer sets is shown on the Passport, so
  // we never assert a capability a store doesn't actually offer.
  dealer_family_owned: string;        // "yes" or ""
  dealer_service_location: string;    // "onsite" | "offsite" | ""
  dealer_service_address: string;     // off-site service department address (optional)
  dealer_delivery: string;            // "none" | "local" | "regional" | "nationwide" | ""
  dealer_financing: string;           // "yes" or ""
  dealer_amenities: string;           // comma-separated (e.g. "Customer lounge, Café, EV charging")
  dealer_services: string;            // comma-separated (e.g. "OEM parts, Warranty repairs, State inspection")
  dealer_hours: string;               // free text (e.g. "Mon–Sat 9–7, Sun closed")
  // Mobile Passport slide-out footer CTA style (default: dealer_availability).
  mobile_slideout_cta_variant: string; // "context_aware" | "two_button" | "dealer_availability" | "progressive"
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
  carfax_url: "",
  vdp_price_labels: "",
  vdp_strip_finance_params: true,
  why_buy_here: "",
  warranty_programs: "",
  dealer_programs: [],
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
  feature_price_verification: false,
  feature_marketcheck_sync: false,
  addendum_paper_size: "letter",
  addendum_custom_width: "8.5",
  addendum_custom_height: "11",
  product_default_mode: "selective",
  allow_type_override_at_signing: false,
  doc_fee_enabled: true,
  doc_fee_amount: 0,
  doc_fee_state: "",
  price_display_mode: "advertised_before_doc",
  title_clerk_email: "",
  title_reminders_enabled: true,
  title_reminder_days: 3,
  title_email_on_intake: true,
  cars_act_mode: false,
  retention_years: 7,
  required_languages: ["en"],
  privacy_notice_enabled: false,
  privacy_notice_text: "",
  privacy_notice_url: "",
  inventory_show_quick_actions: false,
  sticky_bottom_buttons: DEFAULT_STICKY_BUTTONS,
  dealer_years_in_business: "",
  dealer_satisfaction: "",
  dealer_bbb_rating: "",
  dealer_google_rating: "",
  dealer_google_count: "",
  dealer_certifications: "",
  dealer_storefront_url: "",
  dealer_review_sources: "",
  dealer_advisor_name: "",
  dealer_advisor_title: "",
  dealer_advisor_photo: "",
  dealer_advisor_response: "",
  dealer_family_owned: "",
  dealer_service_location: "",
  dealer_service_address: "",
  dealer_delivery: "",
  dealer_financing: "",
  dealer_amenities: "",
  dealer_services: "",
  dealer_hours: "",
  mobile_slideout_cta_variant: "dealer_availability",
};

interface DealerSettingsContextType {
  settings: DealerSettings;
  loading: boolean;
  updateSettings: (updates: Partial<DealerSettings>) => Promise<boolean>;
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

    // Always-available baseline from the active tenant (TenantContext loads
    // name + logo from onboarding_profiles). This guarantees Branding / the
    // addendum letterhead show the dealership even if dealer_profiles is empty
    // and the Autocurb mirror is RLS-blocked for a non-admin member.
    const tenantBasics: Record<string, string> = {};
    if (tenant && tenant.id !== "house") {
      if (tenant.name && tenant.name !== "AutoLabels.io") tenantBasics.dealer_name = tenant.name;
      const tl = tenant.logo_url || "";
      if (tl && !tl.includes("autolabels-mark") && !tl.includes("logo-mark")) tenantBasics.dealer_logo_url = tl;
    }

    // Signed-in + tenant: read from Supabase.
    try {
      const { data, error } = await (supabase as any)
        .from("dealer_profiles")
        .select("settings")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      // Autocurb-imported tenants carry the dealership profile on the tenant
      // mirror. Derive branding/legal defaults from it so Admin → Branding is
      // pre-populated for Autocurb dealers without a manual save. Best-effort:
      // a missing column or RLS denial just yields no fallback.
      let autocurbDerived: Record<string, string> = {};
      try {
        const { data: trow } = await (supabase as any)
          .from("tenants")
          .select("autocurb_profile, source")
          .eq("id", tenantId)
          .maybeSingle();
        if (trow?.autocurb_profile) autocurbDerived = mapAutocurbProfile(trow.autocurb_profile);
      } catch { /* mirror unavailable; skip the fallback layer */ }
      // Layer: defaults < Autocurb mirror < local cache < DB. Saved dealer
      // edits always win; the mirror only fills gaps. The cache carries last
      // edits so doc fee / state survive a reload if a DB write failed.
      const dbSettings = (data?.settings as Partial<DealerSettings>) || {};
      const merged: DealerSettings = {
        ...DEFAULT_SETTINGS,
        ...tenantBasics,
        ...autocurbDerived,
        ...(readCache(tenantId) || {}),
        ...dbSettings,
      };
      setSettings(merged);
      writeCache(tenantId, merged);
    } catch {
      // Table may not exist yet (migration not applied) or query failed.
      // Fall back to cache then defaults, but still seed the tenant basics.
      const cached = readCache(tenantId);
      setSettings({ ...DEFAULT_SETTINGS, ...tenantBasics, ...(cached || {}) });
    } finally {
      setLoading(false);
    }
  }, [user, tenantId, tenant]);

  // Re-load when the user, their active tenant, or the tenant's name/logo
  // resolves (TenantContext fills name/logo slightly after the id).
  useEffect(() => {
    const k = `${user?.id ?? "anon"}:${tenantId ?? "none"}:${tenant?.name ?? ""}:${tenant?.logo_url ?? ""}`;
    if (loadedKeyRef.current === k) return;
    loadedKeyRef.current = k;
    load();
  }, [user?.id, tenantId, tenant?.name, tenant?.logo_url, load]);

  const updateSettings = useCallback(
    async (updates: Partial<DealerSettings>) => {
      const next: DealerSettings = { ...settings, ...updates };
      setSettings(next);
      writeCache(tenantId, next);
      // Only persist to Supabase when we have a real tenant.
      if (!user || !tenantId) return false;
      // Supabase returns RLS denials in `error` (it does not throw), so check
      // it explicitly and tell the dealer when a save didn't reach the server —
      // otherwise edits silently live in cache and vanish on reload.
      const { error } = await (supabase as any)
        .from("dealer_profiles")
        .upsert(
          { tenant_id: tenantId, settings: next, updated_by: user.id },
          { onConflict: "tenant_id" }
        );
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("dealer_profiles upsert failed:", error.message);
        toast.error("Couldn't save to the server — you may not have access to this dealership's settings. Changes are kept locally only.");
        return false;
      }
      return true;
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
