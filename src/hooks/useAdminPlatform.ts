import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { applyTierPreset, type PlanTier } from "@/data/planTiers";

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
  // Job-role keys from dealerRoleCapabilities (plus legacy manager/staff/
  // sales/viewer values still stored on older rows).
  role: string;
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

// Shape of one tenant's entry in the marketcheck-sync diagnostics array. Used
// to turn a wrong/zero pull into a readable explanation in the admin UI.
export interface MarketcheckDiag {
  error?: string;
  note?: string;
  dealer_record?: string;
  dealer_listing_count?: number | null;
  mc_ids?: string[];
  chosen?: { param: string; id: string } | null;
  num_found?: number;
  seen?: number;
  listings_written?: number;
  write_error?: string | null;
  attempts?: Array<{ feed: string; param: string; id: string; http: number; num_found: number; got: number }>;
}

// Condense a diagnostics array into a one-or-two-line human summary.
export const summarizeMarketcheckDiag = (diags?: MarketcheckDiag[]): string => {
  const d = diags?.[0];
  if (!d) return "";
  if (d.error === "no_dealer_id") return d.note || "No MarketCheck dealer matched — set the dealer ID.";
  if (d.chosen) {
    const who = d.dealer_record ? `${d.dealer_record}` : `id ${d.chosen.id}`;
    const parts = [`Matched ${who} via ${d.chosen.param}=${d.chosen.id}`, `${d.num_found ?? d.seen ?? 0} in feed`, `${d.listings_written ?? 0} written`];
    if (d.write_error) parts.push(`write error: ${d.write_error}`);
    return parts.join(" · ");
  }
  // Nothing matched — lead with the server's explanation, then show what each
  // probe returned so the right param/entitlement can be pinned.
  const tried = (d.attempts || []).map((a) => `${a.param}=${a.id}→http ${a.http}/${a.num_found} found`);
  const head = d.note ? d.note : "No syndication feed returned cars.";
  return `${head} Tried: ${tried.join(" | ") || "none"}`;
};

export interface MarketcheckRow {
  tenant_id: string;
  allowed: boolean;
  enabled: boolean;
  source: string;
  dealer_id?: string;
  max_vehicles?: number;
  frequency?: string;
  day_of_week?: number;
  run_hour?: number;
  last_run_at: string | null;
  last_status?: { ran_at?: string; seen?: number; new_vehicles?: number; prices_recorded?: number } | null;
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

  // Cross-tenant MarketCheck grant state. Platform admins can read every row
  // via the marketcheck_sync_config RLS (has_role admin), so the grid joins
  // this client-side by tenant_id — no view change needed.
  const marketcheck = useQuery({
    queryKey: ["admin", "marketcheck"],
    queryFn: async (): Promise<MarketcheckRow[]> => {
      const baseSel = "tenant_id, allowed, enabled, source, max_vehicles, frequency, day_of_week, run_hour, last_run_at, last_status";
      // dealer_id may not exist on older schemas — fall back without it.
      let { data, error } = await (supabase as any)
        .from("marketcheck_sync_config")
        .select(baseSel + ", dealer_id");
      if (error && /dealer_id/i.test(error.message || "")) {
        ({ data, error } = await (supabase as any).from("marketcheck_sync_config").select(baseSel));
      }
      if (error) throw error;
      return (data as MarketcheckRow[]) || [];
    },
  });

  // Configure a tenant's MarketCheck sync (enable + website domain + schedule)
  // cross-tenant. save_marketcheck_config accepts an explicit tenant_id and
  // authorizes platform admins, so a super-admin sets it up from the tenant page.
  const saveMarketcheckConfig = useCallback(
    async (args: { tenantId: string; enabled: boolean; source: string; maxVehicles: number; frequency: string; dayOfWeek: number; runHour: number; dealerId?: string }): Promise<boolean> => {
      const base = {
        _tenant_id: args.tenantId,
        _enabled: args.enabled,
        _source: args.source,
        _max_vehicles: args.maxVehicles,
        _frequency: args.frequency,
        _day_of_week: args.dayOfWeek,
        _run_hour: args.runHour,
      };
      // Prefer the 8-arg overload (with dealer_id); fall back if the migration
      // hasn't been applied yet.
      let { error } = await (supabase as any).rpc("save_marketcheck_config", { ...base, _dealer_id: args.dealerId ?? "" });
      if (error && /save_marketcheck_config|function|does not exist|argument/i.test(error.message || "")) {
        ({ error } = await (supabase as any).rpc("save_marketcheck_config", base));
      }
      if (error) return false;
      await qc.invalidateQueries({ queryKey: ["admin", "marketcheck"] });
      return true;
    },
    [qc]
  );

  // Look up MarketCheck dealers in an area so the operator can find the right
  // rooftop's dealer_id (Dealers Search only filters by geography).
  const lookupMarketcheckDealers = useCallback(
    async (args: { zip?: string; state?: string }): Promise<Array<{ id: string; name: string; domain: string; city: string; state: string; listings: number | null }>> => {
      const { data, error } = await supabase.functions.invoke("marketcheck-sync", { body: { lookup: true, zip: args.zip, state: args.state } });
      if (error) return [];
      const r = (data || {}) as { dealers?: Array<{ id: string; name: string; domain: string; city: string; state: string; listings: number | null }> };
      return r.dealers || [];
    },
    []
  );

  // One-time clear of a tenant's un-dealt inventory (e.g. a wrong-dealer pull).
  // Keeps any car that already has a deal.
  const clearSyncedInventory = useCallback(
    async (tenantId: string): Promise<{ ok: boolean; message: string }> => {
      const { data, error } = await (supabase as any).rpc("admin_clear_synced_inventory", { _tenant_id: tenantId });
      if (error) return { ok: false, message: error.message };
      const r = (data || {}) as { listings_deleted?: number; files_deleted?: number };
      await qc.invalidateQueries({ queryKey: ["admin", "marketcheck"] });
      return { ok: true, message: `Cleared ${r.listings_deleted ?? 0} vehicles (kept anything with a deal)` };
    },
    [qc]
  );

  // Run a single tenant's scrape now (bypasses the schedule).
  const runMarketcheckNow = useCallback(
    async (tenantId: string): Promise<{ ok: boolean; message: string }> => {
      const { data, error } = await supabase.functions.invoke("marketcheck-sync", { body: { tenant_id: tenantId, force: true } });
      if (error) return { ok: false, message: "Sync failed — check the MarketCheck key / domain." };
      const r = (data || {}) as { error?: string; listings_seen?: number; new_vehicles?: number; prices_recorded?: number; diagnostics?: MarketcheckDiag[] };
      if (r.error === "not_configured") return { ok: false, message: "MARKETCHECK_API_KEY_1 is not set on the server." };
      await qc.invalidateQueries({ queryKey: ["admin", "marketcheck"] });
      const head = `Synced ${r.listings_seen ?? 0} vehicles · ${r.new_vehicles ?? 0} new · ${r.prices_recorded ?? 0} price updates`;
      const diag = summarizeMarketcheckDiag(r.diagnostics);
      return { ok: (r.listings_seen ?? 0) > 0, message: diag ? `${head}\n${diag}` : head };
    },
    [qc]
  );

  // Grant / revoke a tenant's MarketCheck capability from the platform grid.
  // Uses the existing admin-only RPC (takes an explicit tenant_id), so it
  // works cross-tenant with no impersonation.
  const setMarketcheckAllowed = useCallback(
    async (tenantId: string, allowed: boolean): Promise<boolean> => {
      const { error } = await (supabase as any).rpc("set_marketcheck_allowed", {
        _tenant_id: tenantId,
        _allowed: allowed,
      });
      if (error) return false;
      await qc.invalidateQueries({ queryKey: ["admin", "marketcheck"] });
      return true;
    },
    [qc]
  );

  // Set a tenant's plan tier: applies the tier's feature-flag preset to the
  // dealer's settings, grants/revokes the MarketCheck scrape (premium only),
  // and stamps the autolabels entitlement. One super-admin action provisions
  // the whole tier, cross-tenant, with no impersonation.
  const setTenantTier = useCallback(
    async (tenantId: string, tier: PlanTier): Promise<boolean> => {
      const patch = applyTierPreset(tier);
      const { error: e1 } = await (supabase as any).rpc("admin_set_tenant_features", {
        _tenant_id: tenantId,
        _patch: patch,
      });
      if (e1) return false;
      await (supabase as any).rpc("set_marketcheck_allowed", {
        _tenant_id: tenantId,
        _allowed: tier === "compliance_pro",
      });
      await (supabase as any).rpc("admin_override_entitlement", {
        _tenant_id: tenantId,
        _app_slug: "autolabels",
        _plan_tier: tier,
        _status: "active",
        _expires_at: null,
        _seat_limit: null,
      });
      await qc.invalidateQueries({ queryKey: ["admin", "marketcheck"] });
      await qc.invalidateQueries({ queryKey: ["admin", "entitlements"] });
      return true;
    },
    [qc]
  );

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
    marketcheck,
    setMarketcheckAllowed,
    saveMarketcheckConfig,
    lookupMarketcheckDealers,
    clearSyncedInventory,
    runMarketcheckNow,
    setTenantTier,
    setTenantActive,
    overrideEntitlement,
    setMemberRole,
    removeMember,
    createTenant,
    inviteMember,
    searchAudit,
  };
};
