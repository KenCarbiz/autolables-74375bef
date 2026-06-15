import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";

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
