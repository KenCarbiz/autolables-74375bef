import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { pickActiveTenantId } from "@/lib/tenant/activeTenant";

// ──────────────────────────────────────────────────────────────
// useEntitlements — single source of truth for:
//   1. Which tenant the signed-in user belongs to.
//   2. What apps their tenant has paid for (and at what tier).
//   3. The shared onboarding profile (name, logo, stores, etc.).
//
// Any app in the Autocurb/AutoLabels family reads the same tables
// (migration 20260417030000), so this hook is portable.
// ──────────────────────────────────────────────────────────────

export type AppSlug = "autolabels" | "autocurb" | "autoframe" | "autovideo";
export type EntitlementStatus = "trial" | "active" | "canceled" | "past_due" | "paused";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  source: "autocurb" | "autolabels" | "manual";
  autocurb_tenant_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantMemberRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  role: "owner" | "admin" | "manager" | "staff";
  accepted_at: string | null;
  invited_at: string;
}

export interface OnboardingProfileRow {
  tenant_id: string;
  display_name: string | null;
  tagline: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  stores: Array<Record<string, unknown>>;
  billing: Record<string, unknown>;
  lead_preferences: Record<string, unknown>;
  completed_at: string | null;
  source: "autocurb" | "autolabels" | "manual";
  last_synced_at: string | null;
}

export interface EntitlementRow {
  id: string;
  tenant_id: string;
  app_slug: AppSlug;
  plan_tier: string;
  status: EntitlementStatus;
  activated_at: string;
  trial_ends_at: string | null;
  expires_at: string | null;
  stripe_subscription_id: string | null;
  seat_limit: number | null;
}

export interface EntitlementsState {
  tenant: TenantRow | null;
  member: TenantMemberRow | null;
  profile: OnboardingProfileRow | null;
  entitlements: EntitlementRow[];
  loading: boolean;
  error: string | null;
}

// Last-verified tenant/entitlement cache. The gate decision (render the
// app vs. bounce to NoTenantScreen) must survive a transient hiccup —
// a slow network, a stale JWT that makes RLS return an empty row, an
// edge-function timeout. We cache the last GOOD result per user and fall
// back to it on transient failure so a signed-in dealer is never booted
// over a blip. This only affects the gate's render decision; every actual
// data query still goes through RLS, so a tampered cache grants no data.
const CACHE_PREFIX = "al_ent_";
type CachedEntitlements = Pick<EntitlementsState, "tenant" | "member" | "profile" | "entitlements">;

const readCache = (uid: string): CachedEntitlements | null => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + uid);
    return raw ? (JSON.parse(raw) as CachedEntitlements) : null;
  } catch {
    return null;
  }
};
const writeCache = (uid: string, v: CachedEntitlements): void => {
  try {
    localStorage.setItem(CACHE_PREFIX + uid, JSON.stringify(v));
  } catch {
    /* quota / unavailable — cache is best-effort */
  }
};
const clearCache = (uid: string): void => {
  try {
    localStorage.removeItem(CACHE_PREFIX + uid);
  } catch {
    /* ignore */
  }
};
const clearAllCache = (): void => {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
};

// Force a token refresh, bounded so a hung auth server can't freeze the
// gate. Returns whether we now hold a valid session. A stale/expired JWT
// is the #1 cause of the "logs in, waits, gets bounced" report: RLS
// silently returns no tenant for a dealer who plainly has one.
const refreshSessionSafe = async (): Promise<boolean> => {
  try {
    const refreshed = await Promise.race([
      supabase.auth.refreshSession(),
      new Promise<{ data: { session: null } }>((resolve) =>
        setTimeout(() => resolve({ data: { session: null } }), 4000),
      ),
    ]);
    return !!(refreshed as { data?: { session?: unknown } }).data?.session;
  } catch {
    return false;
  }
};

export const useEntitlements = () => {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<EntitlementsState>({
    tenant: null,
    member: null,
    profile: null,
    entitlements: [],
    loading: true,
    error: null,
  });

  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) {
      clearAllCache();
      setState({
        tenant: null, member: null, profile: null, entitlements: [],
        loading: false, error: null,
      });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    // Wrap the whole thing in a try/catch so a thrown query never
    // leaves the gate stuck on `loading=true`. Tables that don't exist
    // yet (un-applied migration, fresh project) become `error` not a
    // hung spinner.
    const cached = readCache(userId);
    // A user can belong to several tenants; the active one must be chosen
    // deterministically (a bare .limit(1) picks an arbitrary row and could
    // land the dealer on an empty tenant). Fetch all accepted memberships,
    // then resolve the active tenant the same way TenantContext does.
    const fetchMembership = async () => {
      const res = await (supabase as any)
        .from("tenant_members")
        .select("*")
        .eq("user_id", userId)
        .not("accepted_at", "is", null);
      if (res.error) return { data: null, error: res.error };
      const rows = (res.data as any[]) || [];
      if (rows.length === 0) return { data: null, error: null };
      const activeId = await pickActiveTenantId(rows.map((r) => r.tenant_id));
      return { data: rows.find((r) => r.tenant_id === activeId) || rows[0], error: null };
    };

    try {
      let { data: membership, error: memberErr } = await fetchMembership();

      // Stale-JWT recovery. Refresh + retry ONCE when the result looks
      // wrong: a hard error, or an empty row for a user we have a verified
      // tenant cached for (a dealer doesn't lose their tenant between page
      // loads — an empty result means the session went stale, not that
      // access was revoked). Genuine new users / platform admins (no error,
      // no cache) skip the refresh so they don't churn tokens needlessly.
      if (memberErr || (!membership && cached)) {
        const refreshed = await refreshSessionSafe();
        if (refreshed) {
          ({ data: membership, error: memberErr } = await fetchMembership());
        } else if (cached) {
          // Couldn't reach the auth server — keep the last verified tenant
          // so a network blip never boots a signed-in dealer.
          setState({ ...cached, loading: false, error: null });
          return;
        }
      }

      if (memberErr) {
        // Hard error even after a refresh attempt — prefer last-good over
        // a kick-out; only surface the error when we have nothing cached.
        if (cached) {
          setState({ ...cached, loading: false, error: null });
          return;
        }
        setState({
          tenant: null, member: null, profile: null, entitlements: [],
          loading: false, error: memberErr.message,
        });
        return;
      }

      if (!membership) {
        // Empty AFTER a fresh token = genuinely no tenant. Drop any stale
        // cache so a removed dealer doesn't keep cached access.
        clearCache(userId);
        setState({
          tenant: null, member: null, profile: null, entitlements: [],
          loading: false, error: null,
        });
        return;
      }

      const [tenantRes, profileRes, entRes] = await Promise.all([
        (supabase as any).from("tenants").select("*").eq("id", membership.tenant_id).single(),
        (supabase as any).from("onboarding_profiles").select("*").eq("tenant_id", membership.tenant_id).maybeSingle(),
        (supabase as any).from("app_entitlements").select("*").eq("tenant_id", membership.tenant_id),
      ]);

      const next: CachedEntitlements = {
        tenant: (tenantRes.data as TenantRow) || null,
        member: membership as TenantMemberRow,
        profile: (profileRes.data as OnboardingProfileRow) || null,
        entitlements: (entRes.data as EntitlementRow[]) || [],
      };

      setState({
        ...next,
        loading: false,
        error: tenantRes.error?.message || entRes.error?.message || null,
      });
      // Only cache a fully resolved tenant — never a partial/errored read.
      if (next.tenant) writeCache(userId, next);
    } catch (err) {
      // Last resort: a thrown query (network down) should fall back to the
      // last verified result rather than bounce the dealer to onboarding.
      if (cached) {
        setState({ ...cached, loading: false, error: null });
        return;
      }
      setState({
        tenant: null, member: null, profile: null, entitlements: [],
        loading: false,
        error: err instanceof Error ? err.message : "load failed",
      });
    }
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  const hasApp = useCallback(
    (slug: AppSlug): boolean => {
      const ent = state.entitlements.find((e) => e.app_slug === slug);
      if (!ent) return false;
      if (ent.status !== "trial" && ent.status !== "active") return false;
      if (ent.expires_at && new Date(ent.expires_at) < new Date()) return false;
      return true;
    },
    [state.entitlements]
  );

  const tier = useCallback(
    (slug: AppSlug): string | null => {
      const ent = state.entitlements.find((e) => e.app_slug === slug);
      return ent?.plan_tier ?? null;
    },
    [state.entitlements]
  );

  const entitlementFor = useCallback(
    (slug: AppSlug): EntitlementRow | null =>
      state.entitlements.find((e) => e.app_slug === slug) ?? null,
    [state.entitlements]
  );

  // Provision or re-activate the autolabels entitlement for the current tenant.
  // Used by the "Activate AutoLabels" paywall for users who came from autocurb.
  const activateApp = useCallback(
    async (slug: AppSlug, planTier: string = "essential"): Promise<boolean> => {
      if (!state.tenant) return false;
      const existing = state.entitlements.find((e) => e.app_slug === slug);
      if (existing) {
        const { error } = await (supabase as any)
          .from("app_entitlements")
          .update({
            status: "trial",
            plan_tier: planTier,
            trial_ends_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
          })
          .eq("id", existing.id);
        if (error) return false;
      } else {
        const { error } = await (supabase as any).from("app_entitlements").insert({
          tenant_id: state.tenant.id,
          app_slug: slug,
          plan_tier: planTier,
          status: "trial",
          trial_ends_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
        });
        if (error) return false;
      }
      await load();
      return true;
    },
    [state.tenant, state.entitlements, load]
  );

  // For a direct-signup user with no tenant yet.
  const bootstrapTenant = useCallback(
    async (input: {
      name: string;
      slug?: string;
      source?: "autolabels" | "autocurb" | "manual";
      app: AppSlug;
      tier?: string;
    }): Promise<{ tenantId: string | null; error: string | null }> => {
      const slug =
        input.slug ||
        input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") +
          "-" + Math.random().toString(36).slice(2, 6);
      const { data, error } = await (supabase as any).rpc("bootstrap_tenant", {
        _name: input.name,
        _slug: slug,
        _source: input.source || "autolabels",
        _app_slug: input.app,
        _plan_tier: input.tier || "essential",
      });
      if (error) return { tenantId: null, error: error.message };
      await load();
      return { tenantId: data as string, error: null };
    },
    [load]
  );

  return {
    ...state,
    hasApp,
    tier,
    entitlementFor,
    activateApp,
    bootstrapTenant,
    reload: load,
    isProvisioned: state.entitlements.length > 0,
    needsOnboarding: !state.loading && !!user && !state.tenant,
  };
};
