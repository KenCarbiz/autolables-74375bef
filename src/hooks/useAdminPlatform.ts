import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// useAdminPlatform — data + mutations for the platform-admin
// surfaces. Assumes the caller has the 'admin' role; RLS enforces
// that cross-tenant reads only succeed for admins.
// ──────────────────────────────────────────────────────────────

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  source: "autocurb" | "autolabels" | "manual";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  member_count: number;
  active_apps: number;
  app_slugs: string[];
  last_activity: string | null;
}

export interface MemberRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  invited_email: string | null;
  role: "owner" | "admin" | "manager" | "staff";
  accepted_at: string | null;
  invited_at: string;
}

export interface EntitlementRow {
  id: string;
  tenant_id: string;
  app_slug: string;
  plan_tier: string;
  status: "trial" | "active" | "canceled" | "past_due" | "paused";
  activated_at: string;
  trial_ends_at: string | null;
  expires_at: string | null;
  stripe_subscription_id: string | null;
  seat_limit: number | null;
}

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  store_id: string | null;
  user_id: string | null;
  user_email: string | null;
  ip_address: string | null;
  content_hash: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export const useAdminPlatform = () => {
  const qc = useQueryClient();

  const tenants = useQuery({
    queryKey: ["admin", "tenants"],
    queryFn: async (): Promise<TenantSummary[]> => {
      const { data, error } = await (supabase as any)
        .from("tenant_summary")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as TenantSummary[]) || [];
    },
  });

  const members = useQuery({
    queryKey: ["admin", "members"],
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await (supabase as any)
        .from("tenant_members")
        .select("*")
        .order("invited_at", { ascending: false });
      if (error) throw error;
      return (data as MemberRow[]) || [];
    },
  });

  const entitlements = useQuery({
    queryKey: ["admin", "entitlements"],
    queryFn: async (): Promise<EntitlementRow[]> => {
      const { data, error } = await (supabase as any)
        .from("app_entitlements")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data as EntitlementRow[]) || [];
    },
  });

  const setTenantActive = useCallback(
    async (tenantId: string, active: boolean): Promise<boolean> => {
      const { error } = await (supabase as any).rpc("admin_set_tenant_active", {
        _tenant_id: tenantId,
        _active: active,
      });
      if (error) return false;
      await qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      return true;
    },
    [qc]
  );

  const overrideEntitlement = useCallback(
    async (args: {
      tenantId: string;
      appSlug: string;
      planTier: string;
      status: EntitlementRow["status"];
      expiresAt?: string | null;
      seatLimit?: number | null;
    }): Promise<boolean> => {
      const { error } = await (supabase as any).rpc("admin_override_entitlement", {
        _tenant_id: args.tenantId,
        _app_slug: args.appSlug,
        _plan_tier: args.planTier,
        _status: args.status,
        _expires_at: args.expiresAt ?? null,
        _seat_limit: args.seatLimit ?? null,
      });
      if (error) return false;
      await qc.invalidateQueries({ queryKey: ["admin", "entitlements"] });
      await qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      return true;
    },
    [qc]
  );

  const setMemberRole = useCallback(
    async (memberId: string, role: MemberRow["role"]): Promise<boolean> => {
      const { error } = await (supabase as any).rpc("admin_set_member_role", {
        _member_id: memberId,
        _role: role,
      });
      if (error) return false;
      await qc.invalidateQueries({ queryKey: ["admin", "members"] });
      return true;
    },
    [qc]
  );

  const removeMember = useCallback(
    async (memberId: string): Promise<boolean> => {
      const { error } = await (supabase as any)
        .from("tenant_members")
        .delete()
        .eq("id", memberId);
      if (error) return false;
      await qc.invalidateQueries({ queryKey: ["admin", "members"] });
      return true;
    },
    [qc]
  );

  const createTenant = useCallback(
    async (args: {
      name: string;
      slug?: string;
      domain?: string;
      ownerEmail: string;
      appSlug?: string;
      planTier?: string;
      trialDays?: number;
    }): Promise<string | null> => {
      const { data, error } = await (supabase as any).rpc("admin_create_tenant", {
        _name: args.name,
        _slug: args.slug || null,
        _domain: args.domain || null,
        _owner_email: args.ownerEmail,
        _app_slug: args.appSlug || "autolabels",
        _plan_tier: args.planTier || "essential",
        _trial_days: args.trialDays ?? 14,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("createTenant", error);
        throw new Error(error.message || error.hint || "Tenant create failed");
      }
      await qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      await qc.invalidateQueries({ queryKey: ["admin", "members"] });
      await qc.invalidateQueries({ queryKey: ["admin", "entitlements"] });
      return data as string;
    },
    [qc]
  );

  const inviteMember = useCallback(
    async (args: { tenantId: string; email: string; role?: MemberRow["role"] }): Promise<boolean> => {
      const { error } = await (supabase as any).rpc("admin_invite_member", {
        _tenant_id: args.tenantId,
        _email: args.email,
        _role: args.role || "staff",
      });
      if (error) return false;
      await qc.invalidateQueries({ queryKey: ["admin", "members"] });
      return true;
    },
    [qc]
  );

  const searchAudit = useCallback(
    async (args: {
      tenantId?: string;
      action?: string;
      sinceDays?: number;
      limit?: number;
    }): Promise<AuditRow[]> => {
      let q = (supabase as any)
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(args.limit ?? 100);
      if (args.tenantId) q = q.eq("store_id", args.tenantId);
      if (args.action) q = q.eq("action", args.action);
      if (args.sinceDays) {
        const since = new Date(Date.now() - args.sinceDays * 86_400_000).toISOString();
        q = q.gte("created_at", since);
      }
      const { data, error } = await q;
      if (error) return [];
      return (data as AuditRow[]) || [];
    },
    []
  );

  return {
    tenants,
    members,
    entitlements,
    setTenantActive,
    overrideEntitlement,
    setMemberRole,
    removeMember,
    createTenant,
    inviteMember,
    searchAudit,
  };
};
