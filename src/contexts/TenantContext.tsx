import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import type { Tenant, Store } from "@/types/tenant";
import { useTenantIntegration, IntegrationMode } from "@/hooks/useTenantIntegration";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { pickActiveTenantId } from "@/lib/tenant/activeTenant";

// ──────────────────────────────────────────────────────────────
// TenantContext — single source of truth for the CURRENT tenant
// and the dealer's stores. Always sources from Supabase when the
// user is signed in, so we can never drift from useEntitlements.
//
// The only piece we still keep in localStorage is the user's
// last-selected store (a preference, not authoritative data).
// ──────────────────────────────────────────────────────────────

interface TenantContextType {
  tenant: Tenant | null;
  stores: Store[];
  currentStore: Store | null;
  setCurrentStore: (store: Store) => void;
  addStore: (store: Omit<Store, "id" | "created_at">) => void;
  updateStore: (id: string, updates: Partial<Store>) => void;
  deleteStore: (id: string) => void;
  updateTenant: (updates: Partial<Tenant>) => void;
  loading: boolean;
  mode: IntegrationMode;
  isEmbedded: boolean;
  isStandalone: boolean;
  isOnboardingComplete: boolean;
  completeOnboarding: () => void;
  parentOrigin: string | null;
  externalUser: { id: string; email: string; name?: string; role?: string } | null;
  reload: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

const CURRENT_STORE_KEY = "wl_current_store";

// House fallback for anonymous / public pages. Signed-in users always
// replace this with their real Supabase tenant once it loads.
const HOUSE_TENANT: Tenant = {
  id: "house",
  name: "AutoLabels.io",
  slug: "autolabels",
  logo_url: "/autolabels-mark.svg",
  primary_color: "#1E90FF",
  secondary_color: "#0B2041",
  created_at: new Date().toISOString(),
  is_active: true,
};

const profileStoresToStores = (rows: Array<Record<string, unknown>>, tenantId: string): Store[] =>
  (rows || []).map((r, i) => ({
    id: String(r.id || r.slug || `store-${i}`),
    tenant_id: tenantId,
    name: String(r.name || "Main Store"),
    slug: String(r.slug || r.id || `store-${i}`),
    address: String(r.address || ""),
    city: String(r.city || ""),
    state: String(r.state || ""),
    zip: String(r.zip || ""),
    phone: String(r.phone || ""),
    logo_url: String(r.logo_url || ""),
    tagline: String(r.tagline || ""),
    primary_color: String(r.primary_color || ""),
    created_at: String(r.created_at || new Date().toISOString()),
    is_active: r.is_active !== false,
  }));

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const integration = useTenantIntegration();

  const [tenant, setTenant] = useState<Tenant | null>(HOUSE_TENANT);
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStore, setCurrentStoreState] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantRowId, setTenantRowId] = useState<string | null>(null);

  // Source of truth loader: Supabase tenant + profile.stores for the
  // signed-in user's membership. Falls back to the house tenant for
  // anonymous visitors on public pages.
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (authLoading) return;

    if (!userId) {
      setTenant(HOUSE_TENANT);
      setStores([]);
      setCurrentStoreState(null);
      setTenantRowId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: memberships } = await (supabase as any)
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", userId)
        .not("accepted_at", "is", null);

      const tenantIds = ((memberships as Array<{ tenant_id: string }>) || [])
        .map((m) => m.tenant_id)
        .filter(Boolean);
      const activeTenantId = await pickActiveTenantId(tenantIds);

      if (!activeTenantId) {
        // Signed in but no tenant yet — keep the house tenant for chrome
        // but expose stores=[] so the wizard can run.
        setTenant(HOUSE_TENANT);
        setStores([]);
        setCurrentStoreState(null);
        setTenantRowId(null);
        setLoading(false);
        return;
      }

      const [tenantRes, profileRes] = await Promise.all([
        (supabase as any).from("tenants").select("*").eq("id", activeTenantId).maybeSingle(),
        (supabase as any).from("onboarding_profiles").select("*").eq("tenant_id", activeTenantId).maybeSingle(),
      ]);

      const t = tenantRes.data;
      const profile = profileRes.data;

      const nextTenant: Tenant = t
        ? {
            id: t.id,
            name: t.name,
            slug: t.slug,
            logo_url: profile?.logo_url || "/autolabels-mark.svg",
            primary_color: profile?.primary_color || "#1E90FF",
            secondary_color: profile?.secondary_color || "#0B2041",
            created_at: t.created_at,
            is_active: t.is_active,
          }
        : HOUSE_TENANT;

      const rawStores = Array.isArray(profile?.stores) ? profile.stores : [];
      const mapped = profileStoresToStores(rawStores, nextTenant.id);

      setTenant(nextTenant);
      setTenantRowId(t?.id || null);
      setStores(mapped);

      const savedId = localStorage.getItem(CURRENT_STORE_KEY);
      const pick = mapped.find((s) => s.id === savedId) || mapped[0] || null;
      setCurrentStoreState(pick);
    } catch {
      // On any error fall back to house so the UI can still render.
      setTenant(HOUSE_TENANT);
      setStores([]);
      setCurrentStoreState(null);
      setTenantRowId(null);
    } finally {
      setLoading(false);
    }
  }, [userId, authLoading]);

  useEffect(() => {
    load();
  }, [load]);

  // Sync from external parent (embedded Autocurb iframe mode) — this
  // overrides the Supabase load when the app is hosted inside
  // Autocurb's UI and the parent pushes tenant data via postMessage.
  useEffect(() => {
    if (!integration.externalTenant) return;
    const ext = integration.externalTenant;
    const nextTenant: Tenant = {
      id: ext.tenant.id,
      name: ext.tenant.name,
      slug: ext.tenant.slug,
      logo_url: ext.tenant.logo_url,
      primary_color: ext.tenant.primary_color,
      secondary_color: ext.tenant.secondary_color,
      created_at: new Date().toISOString(),
      is_active: true,
    };
    setTenant(nextTenant);
    if (ext.stores && ext.stores.length > 0) {
      const mapped: Store[] = ext.stores.map((s) => ({
        id: s.id,
        tenant_id: nextTenant.id,
        name: s.name,
        slug: s.id,
        address: s.address || "",
        city: s.city || "",
        state: s.state || "",
        zip: s.zip || "",
        phone: s.phone || "",
        logo_url: s.logo_url || "",
        tagline: s.tagline || "",
        primary_color: ext.tenant.primary_color,
        created_at: new Date().toISOString(),
        is_active: true,
      }));
      setStores(mapped);
      setCurrentStoreState(mapped[0]);
    }
  }, [integration.externalTenant]);

  // Deps below intentionally key on the specific stable members of `integration`
  // (mode primitive, sendToParent/completeOnboarding are useCallback'd in the
  // hook) rather than the whole object, which the hook re-creates each render.
  const integrationMode = integration.mode;
  const sendToParent = integration.sendToParent;

  const persistStores = useCallback(async (next: Store[]) => {
    if (!tenantRowId || integrationMode === "embedded") return;
    const stripped = next.map((s) => ({
      id: s.id, name: s.name, slug: s.slug,
      address: s.address, city: s.city, state: s.state, zip: s.zip,
      phone: s.phone, logo_url: s.logo_url, tagline: s.tagline,
      primary_color: s.primary_color, is_active: s.is_active,
    }));
    await (supabase as any)
      .from("onboarding_profiles")
      .update({ stores: stripped })
      .eq("tenant_id", tenantRowId);
  }, [tenantRowId, integrationMode]);

  const setCurrentStore = useCallback((store: Store) => {
    setCurrentStoreState(store);
    localStorage.setItem(CURRENT_STORE_KEY, store.id);
    sendToParent("store_change", { storeId: store.id });
  }, [sendToParent]);

  const addStore = useCallback((data: Omit<Store, "id" | "created_at">) => {
    const newStore: Store = {
      ...data,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    const next = [...stores, newStore];
    setStores(next);
    void persistStores(next);
  }, [stores, persistStores]);

  const updateStore = useCallback((id: string, updates: Partial<Store>) => {
    const next = stores.map((s) => (s.id === id ? { ...s, ...updates } : s));
    setStores(next);
    if (currentStore?.id === id) setCurrentStoreState({ ...currentStore, ...updates });
    void persistStores(next);
  }, [stores, currentStore, persistStores]);

  const deleteStore = useCallback((id: string) => {
    const next = stores.filter((s) => s.id !== id);
    setStores(next);
    if (currentStore?.id === id) {
      const fallback = next[0] || null;
      setCurrentStoreState(fallback);
      if (fallback) localStorage.setItem(CURRENT_STORE_KEY, fallback.id);
    }
    void persistStores(next);
  }, [stores, currentStore, persistStores]);

  const updateTenant = useCallback(async (updates: Partial<Tenant>) => {
    if (!tenant) return;
    const next = { ...tenant, ...updates };
    setTenant(next);
    if (!tenantRowId || integrationMode === "embedded") return;
    await (supabase as any)
      .from("tenants")
      .update({ name: next.name })
      .eq("id", tenantRowId);
    await (supabase as any)
      .from("onboarding_profiles")
      .update({
        display_name: next.name,
        logo_url: next.logo_url,
        primary_color: next.primary_color,
        secondary_color: next.secondary_color,
      })
      .eq("tenant_id", tenantRowId);
  }, [tenant, tenantRowId, integrationMode]);

  const value = useMemo<TenantContextType>(() => ({
    tenant,
    stores,
    currentStore,
    setCurrentStore,
    addStore,
    updateStore,
    deleteStore,
    updateTenant,
    loading,
    mode: integrationMode,
    isEmbedded: integrationMode === "embedded",
    isStandalone: integrationMode === "standalone",
    isOnboardingComplete: integration.isOnboardingComplete,
    completeOnboarding: integration.completeOnboarding,
    parentOrigin: integration.parentOrigin,
    externalUser: integration.externalTenant?.user || null,
    reload: load,
  }), [
    tenant, stores, currentStore, setCurrentStore, addStore, updateStore, deleteStore,
    updateTenant, loading, integrationMode, integration.isOnboardingComplete,
    integration.completeOnboarding, integration.parentOrigin, integration.externalTenant, load,
  ]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export const useTenant = () => {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
};
