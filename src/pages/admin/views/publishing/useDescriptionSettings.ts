import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useDescriptionPermissions } from "@/hooks/useDescriptionOps";
import { realTenantId } from "@/lib/tenant/realTenantId";
import { useViewFixture } from "@/lib/admin/dataSource";
import { useEditorDraft } from "@/lib/admin/useEditorDraft";
import { SaveConflictError, useSaveFlow } from "@/lib/admin/useSaveFlow";
import { deriveDraftBarState, useLeaveGuard, type ReviewChangeRow } from "@/components/admin/v3/editor";
import {
  DESCRIPTION_LABELS,
  descriptionPayload,
  describeDescriptionValue,
  readDescriptionDraft,
  summarizeDeliveries,
  validateDescription,
  type DeliveryRecord,
  type DeliverySummary,
  type DescriptionDraft,
  type DescriptionRow,
  type ProfileOverride,
} from "@/lib/admin/descriptionSettingsModel";
import { useWaveCVariant, type WaveCVariant } from "./waveCVariant";

export interface CachedOutput {
  channel: string;
  character_count: number | null;
  validation_status: string | null;
  created_at: string;
}

export interface DestinationsFixture {
  section?: "automation" | "description";
  rooftopLabel: string;
  groupLabel: string;
  identity: { name: string; city: string; state: string };
  row: DescriptionRow | null;
  seeds?: Partial<Record<WaveCVariant, DescriptionRow | null>>;
  deliveries: DeliveryRecord[];
  profileOverrides: Record<string, ProfileOverride>;
  cached: CachedOutput[];
}

export const DESTINATIONS_VIEW_ID = "destinations";

type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };
const db = () => supabase as unknown as Db;

type Read<T> = { state: "loading" | "ok" | "unavailable"; data: T };

function useRead<T>(key: string, tenantId: string | null, enabled: boolean, load: (t: string) => Promise<T>, empty: T): Read<T> {
  const q = useQuery({ queryKey: ["admin-v3", "destinations", key, tenantId], enabled: enabled && !!tenantId, queryFn: () => load(tenantId as string), staleTime: 30_000, retry: false });
  if (!enabled) return { state: "ok", data: empty };
  if (q.isError) return { state: "unavailable", data: empty };
  if (q.isLoading || !tenantId) return { state: "loading", data: empty };
  return { state: "ok", data: q.data as T };
}

const unwrap = <T,>(r: { data: T; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data;
};

export function useDescriptionSettings() {
  const fixture = useViewFixture<DestinationsFixture>(DESTINATIONS_VIEW_ID);
  const variant = useWaveCVariant(!!fixture);
  const { tenant, currentStore } = useTenant();
  const { settings: dealer } = useDealerSettings();
  const perms = useDescriptionPermissions();
  const qc = useQueryClient();
  const tenantId = fixture ? null : realTenantId(tenant);
  const live = !fixture;

  const settingsQ = useQuery({
    queryKey: ["admin-v3", "destinations", "settings", tenantId],
    enabled: live && !!tenantId,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => unwrap(await db().from("description_settings").select("*").eq("tenant_id", tenantId).maybeSingle()) as DescriptionRow | null,
  });
  const deliveries = useRead<DeliveryRecord[]>("deliveries", tenantId, live, async (t) =>
    unwrap(await db().from("description_deliveries").select("id, destination, status, delivery_mode, attempt_count, published_at, failed_at, created_at, response_metadata").eq("tenant_id", t).order("created_at", { ascending: false }).limit(200)) ?? [], []);
  const overrides = useRead<Record<string, ProfileOverride>>("channel-policies", tenantId, live, async (t) => {
    const rows = unwrap(await db().from("description_channel_policies").select("channel, policy_json, active").eq("tenant_id", t)) as Array<{ channel: string; policy_json: ProfileOverride | null }> | null;
    return Object.fromEntries((rows ?? []).map((r) => [r.channel, r.policy_json ?? {}]));
  }, {});
  const cached = useRead<CachedOutput[]>("cached", tenantId, live, async (t) =>
    unwrap(await db().from("description_channel_versions").select("channel, character_count, validation_status, created_at").eq("tenant_id", t).order("created_at", { ascending: false }).limit(60)) ?? [], []);

  const fixtureRow = fixture ? (variant !== "default" && fixture.seeds && variant in fixture.seeds ? fixture.seeds[variant] ?? null : fixture.row) : null;
  const row = fixture ? fixtureRow : (settingsQ.data ?? null);
  const loading = live && (!tenantId ? false : settingsQ.isLoading);
  const unreadable = fixture ? variant === "error" : !!tenantId && settingsQ.isError;
  const baseline = loading ? undefined : readDescriptionDraft(row);

  const scopeKey = fixture ? `fixture:${variant}` : `${tenantId ?? "none"}:${currentStore?.id ?? "group"}`;
  const [generation, setGeneration] = useState(0);
  const edit = useEditorDraft<DescriptionDraft>({ scopeKey, generation, baseline, validate: validateDescription });
  const flow = useSaveFlow(scopeKey);
  const guard = useLeaveGuard(edit.dirty);

  const canEdit = fixture ? variant !== "readonly" : perms.canConfigure;
  const blockedReason = unreadable
    ? "These settings could not be read from the server, so nothing can be saved until they load."
    : fixture ? "Design fixture: saving is disabled."
    : loading ? "Settings are still loading."
    : !tenantId ? "No dealership is selected."
    : null;

  const blocking = useMemo(() => {
    const changed = new Set<string>(edit.changedKeys);
    return Object.fromEntries(Object.entries(edit.errors).filter(([k, v]) => v && changed.has(k))) as Record<string, string>;
  }, [edit.errors, edit.changedKeys]);
  const valid = Object.keys(blocking).length === 0;

  const rows: ReviewChangeRow[] = useMemo(
    () => edit.changes.map((c) => ({ id: c.key, label: DESCRIPTION_LABELS[c.key] ?? c.key, before: describeDescriptionValue(c.key, c.before), after: describeDescriptionValue(c.key, c.after) })),
    [edit.changes],
  );
  const barState = deriveDraftBarState({ phase: flow.phase, dirty: edit.dirty, changeCount: edit.changes.length, firstError: Object.values(blocking)[0], message: flow.message });
  const canApply = canEdit && !blockedReason && valid && edit.dirty && flow.phase !== "saving";

  const apply = useCallback(async () => {
    if (!canApply || !tenantId || !edit.draft) return false;
    const draft = edit.draft;
    const ok = await flow.run(async () => {
      const current = unwrap(await db().from("description_settings").select("updated_at").eq("tenant_id", tenantId).maybeSingle()) as { updated_at?: string } | null;
      const loadedAt = (row as { updated_at?: string } | null)?.updated_at;
      if ((current?.updated_at ?? null) !== (loadedAt ?? null)) throw new SaveConflictError("These settings were changed by someone else after you opened them.");
      const { data, error } = await db().rpc("save_description_settings", { p_tenant_id: tenantId, p_settings: descriptionPayload(draft) });
      if (error) throw new Error("The server did not accept the change.");
      if (data?.ok === false) throw new Error(data.error === "insufficient_permission" ? "Your role cannot change these settings." : "The server did not accept the change.");
    });
    if (ok) {
      edit.markSaved();
      await qc.invalidateQueries({ queryKey: ["admin-v3", "destinations", "settings", tenantId] });
    }
    return ok;
  }, [canApply, tenantId, edit, flow, row, qc]);

  const discard = useCallback(() => {
    edit.reset();
    flow.dismiss();
  }, [edit, flow]);

  const refresh = useCallback(() => {
    discard();
    setGeneration((g) => g + 1);
    if (tenantId) void qc.invalidateQueries({ queryKey: ["admin-v3", "destinations", "settings", tenantId] });
  }, [discard, tenantId, qc]);

  const saveProfile = useMutation({
    mutationFn: async (args: { channel: string; policy: ProfileOverride; reason: string }) => {
      if (!tenantId) throw new Error("No dealership is selected.");
      const { data, error } = await db().rpc("save_description_channel_policy", { p_tenant_id: tenantId, p_channel: args.channel, p_policy: args.policy, p_active: true, p_reason: args.reason || null });
      if (error) throw new Error("The server did not accept the profile.");
      if (data?.ok === false) throw new Error(data.error === "insufficient_permission" ? "Your role cannot change output profiles." : "The server did not accept the profile.");
      await qc.invalidateQueries({ queryKey: ["admin-v3", "destinations", "channel-policies", tenantId] });
    },
  });

  const records = useMemo(() => (fixture ? (variant === "empty" || variant === "error" ? [] : fixture.deliveries) : deliveries.data), [fixture, variant, deliveries.data]);
  const summary: Record<string, DeliverySummary> = useMemo(() => summarizeDeliveries(records), [records]);
  const identity = fixture ? fixture.identity : { name: dealer.dealer_name ?? "", city: dealer.dealer_city ?? "", state: dealer.dealer_state ?? "" };

  return {
    fixture,
    variant,
    isFixture: !!fixture,
    section: fixture?.section ?? null,
    rooftopLabel: fixture?.rooftopLabel ?? (currentStore?.name || null),
    groupLabel: fixture?.groupLabel ?? (tenant?.name && tenant.id !== "house" ? tenant.name : null),
    identity,
    loading,
    unreadable,
    row,
    canEdit,
    canSaveProfiles: fixture ? false : perms.canConfigure,
    blockedReason,
    edit,
    blocking,
    flow,
    guard,
    rows,
    barState,
    canApply,
    apply,
    discard,
    refresh,
    deliveries: { state: fixture ? (variant === "error" ? "unavailable" : "ok") : deliveries.state, summary, records },
    overrides: fixture ? { state: "ok" as const, data: fixture.profileOverrides } : overrides,
    cached: fixture ? { state: "ok" as const, data: variant === "empty" ? [] : fixture.cached } : cached,
    saveProfile,
  };
}

export type DescriptionSettingsApi = ReturnType<typeof useDescriptionSettings>;
