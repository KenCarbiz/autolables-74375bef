import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useViewFixture } from "@/lib/admin/dataSource";
import {
  ACCESS_AUDIT_ACTIONS,
  canWriteTeamOnServer,
  isAccessAuditRow,
  normalizeMember,
  TEAM_WRITE_DENIED_REASON,
  type AccessAuditRow,
  type TeamMember,
  type TeamMemberRow,
} from "@/lib/admin/people";
import type { DealerRole } from "@/lib/permissions/dealerRoleCapabilities";

// People & Access reads the one membership store the app has, through the
// list_tenant_members procedure TeamPanel already uses, and writes only
// through the three gated procedures. Opening any view writes nothing.

export const PEOPLE_VIEW_ID = "people";

export interface PeopleFixture {
  members: TeamMemberRow[];
  viewerRole?: DealerRole;
  viewerIsAdmin?: boolean;
  selectedMemberId?: string;
  activity?: AccessAuditRow[];
  activityUnavailable?: boolean;
}

type RpcResult = { data: unknown; error: { message: string } | null };
interface Client {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  from: (table: string) => any;
}
const client = (): Client => supabase as unknown as Client;

export const teamQueryKey = (tenantId: string | null) => ["admin-v2", "people", "members", tenantId] as const;

export async function listTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const { data, error } = await client().rpc("list_tenant_members", { p_tenant_id: tenantId });
  if (error) throw new Error(error.message);
  return ((data as TeamMemberRow[] | null) ?? []).map(normalizeMember);
}

export const useTenantId = (): string | null => {
  const { tenant } = useTenant();
  return tenant?.id && tenant.id !== "house" ? tenant.id : null;
};

export type ReadState = "loading" | "ready" | "failed" | "no-tenant";

export interface TeamRead {
  /** Null until known; a failed read is never an empty team. */
  members: TeamMember[] | null;
  state: ReadState;
  error: string | null;
  fixture: PeopleFixture | null;
  refetch: () => Promise<TeamMember[] | null>;
}

export function useTeamMembers(): TeamRead {
  const fixture = useViewFixture<PeopleFixture>(PEOPLE_VIEW_ID);
  const tenantId = useTenantId();
  const query = useQuery({
    queryKey: teamQueryKey(tenantId),
    enabled: !fixture && !!tenantId,
    queryFn: () => listTeamMembers(tenantId as string),
    staleTime: 30_000,
    retry: false,
  });
  const fixtureMembers = useMemo(() => (fixture ? fixture.members.map(normalizeMember) : null), [fixture]);
  const queryRefetch = query.refetch;
  const refetch = useCallback(async () => {
    if (fixture) return fixtureMembers;
    const r = await queryRefetch();
    return r.data ?? null;
  }, [fixture, fixtureMembers, queryRefetch]);

  if (fixture) return { members: fixtureMembers, state: "ready", error: null, fixture, refetch };
  if (!tenantId) return { members: null, state: "no-tenant", error: null, fixture: null, refetch };
  if (query.isError) return { members: null, state: "failed", error: query.error instanceof Error ? query.error.message : "Read failed.", fixture: null, refetch };
  if (query.data === undefined) return { members: null, state: "loading", error: null, fixture: null, refetch };
  return { members: query.data, state: "ready", error: null, fixture: null, refetch };
}

export interface TeamAuthority {
  role: DealerRole;
  isAdmin: boolean;
  /** Mirrors the procedure guard: accepted owner, admin or general manager, or a platform admin. */
  canWrite: boolean;
  reason: string | null;
}

export function useTeamAuthority(): TeamAuthority {
  const fixture = useViewFixture<PeopleFixture>(PEOPLE_VIEW_ID);
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const role: DealerRole = fixture ? fixture.viewerRole ?? "owner" : member?.role;
  const admin = fixture ? !!fixture.viewerIsAdmin : isAdmin;
  const canWrite = canWriteTeamOnServer(role, admin);
  return { role, isAdmin: admin, canWrite, reason: canWrite ? null : TEAM_WRITE_DENIED_REASON };
}

export interface TeamWriteResult {
  ok: boolean;
  message: string;
}

export interface TeamWriters {
  /** Set when nothing may be written from this surface; the reason is shown, never silently swallowed. */
  readOnlyReason: string | null;
  setRole: (memberId: string, role: string) => Promise<TeamWriteResult>;
  invite: (email: string, role: string) => Promise<TeamWriteResult>;
  remove: (memberId: string) => Promise<TeamWriteResult>;
  /** Fresh read for conflict checks: the role now, null when the member is gone, undefined when it could not be read. */
  currentRoleOf: (memberId: string) => Promise<string | null | undefined>;
}

const FIXTURE_READ_ONLY = "Design fixture: nothing is written from this screen.";

const friendly = (message: string): string => {
  const m = message.toLowerCase();
  if (m.includes("not authorized") || m.includes("permission denied")) return "Only an owner, admin or general manager can change the team.";
  if (m.includes("last owner")) return "The last owner cannot be changed or removed.";
  return message;
};

export function useTeamWriters(): TeamWriters {
  const fixture = useViewFixture<PeopleFixture>(PEOPLE_VIEW_ID);
  const tenantId = useTenantId();
  const queryClient = useQueryClient();

  const run = useCallback(async (fn: string, args: Record<string, unknown>, success: string): Promise<TeamWriteResult> => {
    if (fixture) return { ok: false, message: FIXTURE_READ_ONLY };
    if (!tenantId) return { ok: false, message: "No rooftop is selected." };
    const { error } = await client().rpc(fn, args);
    if (error) return { ok: false, message: friendly(error.message) };
    await queryClient.invalidateQueries({ queryKey: teamQueryKey(tenantId) });
    return { ok: true, message: success };
  }, [fixture, tenantId, queryClient]);

  const currentRoleOf = useCallback(async (memberId: string): Promise<string | null | undefined> => {
    if (fixture) return fixture.members.find((m) => m.id === memberId)?.role ?? null;
    if (!tenantId) return undefined;
    try {
      const members = await listTeamMembers(tenantId);
      return members.find((m) => m.id === memberId)?.role ?? null;
    } catch {
      return undefined;
    }
  }, [fixture, tenantId]);

  return useMemo(() => ({
    readOnlyReason: fixture ? FIXTURE_READ_ONLY : null,
    setRole: (memberId, role) => run("set_tenant_member_role", { p_member_id: memberId, p_role: role }, "Role updated."),
    invite: (email, role) => run("invite_tenant_member", { p_tenant_id: tenantId, p_email: email, p_role: role }, `Invitation recorded for ${email}.`),
    remove: (memberId) => run("remove_tenant_member", { p_member_id: memberId }, "Removed from the team."),
    currentRoleOf,
  }), [fixture, tenantId, run, currentRoleOf]);
}

export interface ActivityRead {
  rows: AccessAuditRow[] | null;
  state: ReadState;
  error: string | null;
}

export function useAccessActivity(): ActivityRead {
  const fixture = useViewFixture<PeopleFixture>(PEOPLE_VIEW_ID);
  const tenantId = useTenantId();
  const query = useQuery({
    queryKey: ["admin-v2", "people", "activity", tenantId],
    enabled: !fixture && !!tenantId,
    queryFn: async (): Promise<AccessAuditRow[]> => {
      const { data, error } = await client()
        .from("audit_log")
        .select("id, action, entity_type, entity_id, user_email, details, created_at")
        .eq("store_id", tenantId)
        .in("action", [...ACCESS_AUDIT_ACTIONS])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return ((data as AccessAuditRow[] | null) ?? []).filter(isAccessAuditRow);
    },
    staleTime: 30_000,
    retry: false,
  });

  if (fixture) {
    if (fixture.activityUnavailable) return { rows: null, state: "failed", error: "Fixture: activity unavailable." };
    return { rows: (fixture.activity ?? []).filter(isAccessAuditRow), state: "ready", error: null };
  }
  if (!tenantId) return { rows: null, state: "no-tenant", error: null };
  if (query.isError) return { rows: null, state: "failed", error: query.error instanceof Error ? query.error.message : "Read failed." };
  if (query.data === undefined) return { rows: null, state: "loading", error: null };
  return { rows: query.data, state: "ready", error: null };
}
