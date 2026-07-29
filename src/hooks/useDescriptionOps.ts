import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import {
  describeGenerationOutcome,
  type GenerationResult, type GenerationOutcome,
} from "@/lib/description/generationOutcome";

// Data access for Description Intelligence. Every mutation goes through a
// server-side RPC or edge function — nothing here fabricates a completion
// state locally, and nothing reports success unless the server confirmed it.

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

// supabase-js collapses every non-2xx into "Edge Function returned a non-2xx
// status code", which tells an operator nothing. The real reason is in the
// attached Response body, so read it before surfacing anything.
const FALLBACK_FN_ERROR = "Edge Function returned a non-2xx status code";
const FN_ERROR_COPY: Record<string, string> = {
  forbidden: "You do not have access to this dealership's descriptions.",
  insufficient_permission: "Your role cannot run description generation. Ask a manager or admin.",
  "no tenant membership": "Your account is not a member of this dealership yet.",
  "invalid token": "Your session expired. Sign in again and retry.",
  "missing bearer token": "Your session expired. Sign in again and retry.",
};
async function fnErrorMessage(error: any): Promise<string> {
  const raw = String(error?.message || "request failed");
  let detail = "";
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.clone().json();
      detail = String(body?.error || body?.message || "");
    }
  } catch { /* body already consumed or not JSON — fall through */ }
  if (!detail) return raw;
  return FN_ERROR_COPY[detail] || (raw === FALLBACK_FN_ERROR ? detail : `${raw}: ${detail}`);
}

export interface DescriptionCaseRow extends Row {
  id: string; vehicle_id: string; vin: string; status: string;
  publication_eligibility: string; fact_confidence: number | null;
  quality_score: number | null; open_exception_count: number;
  lock_version: number; potentially_stale: boolean;
}

export interface OpsSummary {
  activeInventory: number; published: number; ready: number;
  reviewRequired: number; failed: number; stale: number; missing: number;
  /** Cases that exist but have not reached any outcome yet. */
  pending: number;
  /** Cases that actually finished — the only honest "processed" count. */
  settled: number;
}

export function useDescriptionPermissions() {
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const role = member?.role;
  return {
    canView: true,
    canGenerate: hasDealerCapability(role, "can_create_documents", isAdmin),
    canEdit: hasDealerCapability(role, "can_create_documents", isAdmin),
    canApprove: hasDealerCapability(role, "can_approve_passport_proof", isAdmin),
    canPublish: hasDealerCapability(role, "can_approve_passport_proof", isAdmin),
    canLock: hasDealerCapability(role, "can_approve_passport_proof", isAdmin),
    canResolve: hasDealerCapability(role, "can_approve_passport_proof", isAdmin),
    canConfigure: hasDealerCapability(role, "can_manage_settings", isAdmin),
  };
}

export function useDescriptionOperations() {
  const { tenant } = useTenant();
  const [cases, setCases] = useState<DescriptionCaseRow[] | null>(null);
  const [vehicles, setVehicles] = useState<Record<string, Row>>({});
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [channelCounts, setChannelCounts] = useState<Record<string, { total: number; ready: number }>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setError(null);
    try {
      const [caseRes, vehRes, settingsRes] = await Promise.all([
        (supabase as any).from("description_cases").select("*")
          .eq("tenant_id", tenant.id).is("archived_at", null)
          .order("updated_at", { ascending: false }).limit(500),
        (supabase as any).from("vehicle_listings")
          .select("id, vin, ymm, trim, condition, mileage, status, hero_image_url, mc_attributes")
          .eq("tenant_id", tenant.id).in("status", ["draft", "published"]).limit(1000),
        (supabase as any).from("description_settings")
          .select("enabled_channels").eq("tenant_id", tenant.id).maybeSingle(),
      ]);
      if (caseRes.error) throw caseRes.error;
      const rows = (caseRes.data || []) as DescriptionCaseRow[];
      const enabledChannels: string[] = Array.isArray(settingsRes?.data?.enabled_channels)
        ? settingsRes.data.enabled_channels : [];
      const vmap: Record<string, Row> = {};
      for (const v of vehRes.data || []) vmap[v.id] = v;

      // Real per-case channel counts, so the table reports measurements rather
      // than a constant derived from the static channel list. Every
      // regeneration writes a fresh row per channel against a NEW master
      // version, so an unfiltered read counts every historical variant and
      // reports "21/7 channels". Scope the read to each case's current master.
      const masterIds = rows.map((r) => r.current_master_version_id).filter(Boolean) as string[];
      const chanRows: Row[] = [];
      for (let i = 0; i < masterIds.length; i += 100) {
        const { data } = await (supabase as any).from("description_channel_versions")
          .select("description_case_id, channel, validation_status, created_at")
          .eq("tenant_id", tenant.id).in("master_version_id", masterIds.slice(i, i + 100));
        if (data) chanRows.push(...data);
      }
      // A locked channel keeps its manual copy attached to the older master it
      // was written against, so it must be counted even though the current
      // master never regenerated it.
      const { data: lockedRows } = await (supabase as any).from("description_channel_versions")
        .select("description_case_id, channel, validation_status, created_at")
        .eq("tenant_id", tenant.id).eq("locked", true).limit(2000);
      // The denominator is how many channels the dealer ENABLED, not how many
      // rows happen to exist. Selective regeneration mints a new master and
      // writes rows for only the scoped channels, so a row-derived denominator
      // shrinks with the numerator and reports "1 / 1 · All Ready" for a
      // vehicle whose other six variants are stranded on the previous master.
      const seen = new Set<string>();
      const cmap: Record<string, { total: number; ready: number }> = {};
      for (const r of rows) cmap[r.id] = { total: enabledChannels.length, ready: 0 };
      for (const cv of [...(lockedRows || []), ...chanRows]) {
        const key = `${cv.description_case_id}:${cv.channel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (enabledChannels.length && !enabledChannels.includes(cv.channel)) continue;
        const e = (cmap[cv.description_case_id] ||= { total: enabledChannels.length, ready: 0 });
        if (!enabledChannels.length) e.total += 1;
        if (cv.validation_status === "passed" || cv.validation_status === "warning") e.ready += 1;
      }
      setChannelCounts(cmap);
      setCases(rows);
      setVehicles(vmap);

      // Counts come from the server, not from the capped page of rows above.
      // Deriving them client-side made a 700-vehicle store report "200 never
      // initialized" when every vehicle had a case — the 500-row cap was being
      // read as a measurement.
      const countCases = async (build: (q: any) => any) => {
        const base = (supabase as any).from("description_cases")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id).is("archived_at", null);
        const { count } = await build(base);
        return count || 0;
      };
      const [activeInventory, published, ready, reviewRequired, failed, staleStatus, stalePending, totalCases, pending] =
        await Promise.all([
          (supabase as any).from("vehicle_listings").select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id).in("status", ["draft", "published"]).then((r: any) => r.count || 0),
          countCases((q) => q.eq("status", "PUBLISHED")),
          countCases((q) => q.eq("status", "READY")),
          countCases((q) => q.eq("status", "REVIEW_REQUIRED")),
          countCases((q) => q.in("status", ["FAILED_RETRYABLE", "FAILED_BLOCKED"])),
          countCases((q) => q.eq("status", "STALE")),
          countCases((q) => q.eq("potentially_stale", true).neq("status", "STALE")),
          countCases((q) => q),
          // A case that exists but has not reached any outcome yet. Having a
          // row is not having a description, and conflating the two let a
          // fleet with zero generated copy report as fully processed.
          countCases((q) => q.in("status",
            ["UNINITIALIZED", "QUEUED", "BUILDING_FACTS", "GENERATING", "VALIDATING"])),
        ]);
      setSummary({
        activeInventory,
        published, ready, reviewRequired, failed,
        stale: staleStatus + stalePending,
        missing: Math.max(0, activeInventory - totalCases),
        pending,
        settled: Math.max(0, totalCases - pending),
      });
    } catch (e) {
      setError((e as Error).message || "Could not load description operations");
      setCases([]);
    }
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  // Kicks the self-healing sweep so vehicles from AutoCurb / DMS / CSV /
  // manual entry that never hit the MarketCheck hook get initialized.
  const reconcile = useCallback(async (limit = 25) => {
    if (!tenant?.id) return { ok: false, error: "no tenant" };
    const { data, error } = await supabase.functions.invoke("description-orchestrate", {
      body: { action: "reconcile", tenant_id: tenant.id, limit },
    });
    if (error) return { ok: false, error: await fnErrorMessage(error) };
    await load();
    return { ok: true, examined: (data as any)?.examined ?? 0 };
  }, [tenant?.id, load]);

  return { tenantId: tenant?.id ?? null, cases, vehicles, channelCounts, summary, error, reload: load, reconcile };
}

export function useDescriptionCase(vehicleId: string | undefined) {
  const { tenant } = useTenant();
  const [record, setRecord] = useState<{
    caseRow: DescriptionCaseRow | null; vehicle: Row | null;
    versions: Row[]; channels: Row[]; findings: Row[];
    exceptions: Row[]; snapshot: Row | null; deliveries: Row[];
    /** The tenant's own destinations, not the static catalog. */
    enabledChannels: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant?.id || !vehicleId) return;
    setError(null);
    try {
      const { data: veh } = await (supabase as any).from("vehicle_listings")
        .select("*").eq("id", vehicleId).maybeSingle();
      const { data: caseRow } = await (supabase as any).from("description_cases")
        .select("*").eq("tenant_id", tenant.id).eq("vehicle_id", vehicleId).maybeSingle();
      const { data: settingsRow } = await (supabase as any).from("description_settings")
        .select("enabled_channels").eq("tenant_id", tenant.id).maybeSingle();
      const enabledChannels: string[] = Array.isArray(settingsRow?.enabled_channels)
        ? settingsRow.enabled_channels : [];

      if (!caseRow) {
        setRecord({ caseRow: null, vehicle: veh, versions: [], channels: [], findings: [], exceptions: [], snapshot: null, deliveries: [], enabledChannels });
        return;
      }
      const [vers, chans, finds, excs, snaps, dels] = await Promise.all([
        (supabase as any).from("description_versions").select("*")
          .eq("description_case_id", caseRow.id).order("version_number", { ascending: false }),
        (supabase as any).from("description_channel_versions").select("*")
          .eq("description_case_id", caseRow.id)
          .order("channel").order("created_at", { ascending: false }),
        (supabase as any).from("description_validation_results").select("*")
          .eq("description_case_id", caseRow.id).eq("status", "open"),
        (supabase as any).from("description_exceptions").select("*")
          .eq("description_case_id", caseRow.id).in("status", ["open", "in_progress"])
          .order("created_at", { ascending: false }),
        (supabase as any).from("description_fact_snapshots").select("*")
          .eq("description_case_id", caseRow.id).order("created_at", { ascending: false }).limit(1),
        (supabase as any).from("description_deliveries").select("*")
          .eq("description_case_id", caseRow.id).order("created_at", { ascending: false }),
      ]);
      // One row per channel: regeneration writes a new row against a new master
      // version, so the raw list holds every historical variant.
      const byChannel = new Map<string, Row>();
      for (const cv of chans.data || []) if (!byChannel.has(cv.channel)) byChannel.set(cv.channel, cv);
      setRecord({
        caseRow, vehicle: veh,
        versions: vers.data || [], channels: [...byChannel.values()], findings: finds.data || [],
        exceptions: excs.data || [], snapshot: (snaps.data || [])[0] || null, deliveries: dels.data || [],
        enabledChannels,
      });
    } catch (e) {
      setError((e as Error).message || "Could not load the description record");
    }
  }, [tenant?.id, vehicleId]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (reason = "manual", channels?: string[]): Promise<
    | { ok: false; error: string }
    | { ok: true; generated: boolean; outcome: GenerationOutcome; result: unknown }
  > => {
    if (!tenant?.id || !vehicleId) return { ok: false, error: "missing context" };
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("description-orchestrate", {
      body: { action: "regenerate", tenant_id: tenant.id, vehicle_id: vehicleId, reason, channels },
    });
    setBusy(false);
    if (error) return { ok: false, error: await fnErrorMessage(error) };
    if ((data as any)?.error) return { ok: false, error: String((data as any).error) };
    await load();
    // The server tells us whether a version was actually produced, and when it
    // was not, WHY. A refusal carries a skip reason and its blocking codes —
    // dropping them here is what made every refusal look like a no-op.
    return {
      ok: true,
      generated: (data as any)?.generated !== false,
      outcome: describeGenerationOutcome(data as GenerationResult),
      result: data,
    };
  }, [tenant?.id, vehicleId, load]);

  // Internal publication is a server RPC guarded by optimistic concurrency:
  // a stale actor is rejected rather than silently overwriting newer work.
  const publishInternally = useCallback(async (versionId: string) => {
    const caseRow = record?.caseRow;
    if (!caseRow) return { ok: false, error: "no case" };
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("publish_description_internal", {
      p_case_id: caseRow.id, p_version_id: versionId, p_expected_lock_version: caseRow.lock_version,
    });
    setBusy(false);
    if (error) return { ok: false, error: error.message };
    const res = data as any;
    await load();
    if (!res?.ok) return { ok: false, error: String(res?.error || "publication rejected") };
    return { ok: true };
  }, [record?.caseRow, load]);

  const saveManualVersion = useCallback(async (content: string, reason: string) => {
    const caseRow = record?.caseRow;
    if (!caseRow || !tenant?.id) return { ok: false, error: "no case" };
    setBusy(true);
    // Clients hold no write grant on description_versions — the RPC is the only
    // path, and it creates a new immutable version rather than rewriting one.
    const { data, error } = await (supabase as any).rpc("save_description_manual_version", {
      p_case_id: caseRow.id, p_content: content, p_reason: reason,
    });
    if (error) { setBusy(false); return { ok: false, error: error.message }; }
    if ((data as any)?.ok === false) { setBusy(false); return { ok: false, error: String((data as any).error) }; }

    // A human edit must clear the same validators as generated copy before it
    // can publish, so validate it server-side immediately.
    const versionId = (data as any)?.version_id;
    const { data: vres, error: verr } = await supabase.functions.invoke("description-orchestrate", {
      body: { action: "validate", tenant_id: tenant.id, vehicle_id: caseRow.vehicle_id, version_id: versionId },
    });
    setBusy(false);
    await load();
    if (verr) return { ok: true, warning: "Saved, but validation could not run yet." };
    return { ok: true, validation: (vres as any)?.validation_status };
  }, [record, tenant?.id, load]);

  const setChannelLock = useCallback(async (channelVersionId: string, locked: boolean, reason?: string) => {
    const caseRow = record?.caseRow;
    if (!caseRow) return { ok: false, error: "no case" };
    const { data, error } = await (supabase as any).rpc("set_description_lock", {
      p_case_id: caseRow.id, p_scope: "channel", p_locked: locked,
      p_channel_version_id: channelVersionId, p_reason: reason ?? null,
    });
    if (error) return { ok: false, error: error.message };
    if ((data as any)?.ok === false) return { ok: false, error: String((data as any).error) };
    await load();
    return { ok: true };
  }, [record?.caseRow, load]);

  const setMasterLock = useCallback(async (locked: boolean, reason?: string) => {
    const caseRow = record?.caseRow;
    if (!caseRow) return { ok: false, error: "no case" };
    const { data, error } = await (supabase as any).rpc("set_description_lock", {
      p_case_id: caseRow.id, p_scope: "master", p_locked: locked,
      p_channel_version_id: null, p_reason: reason ?? null,
    });
    if (error) return { ok: false, error: error.message };
    if ((data as any)?.ok === false) return { ok: false, error: String((data as any).error) };
    await load();
    return { ok: true };
  }, [record?.caseRow, load]);

  const approveVersion = useCallback(async (versionId: string, approve = true) => {
    const caseRow = record?.caseRow;
    if (!caseRow) return { ok: false, error: "no case" };
    const { data, error } = await (supabase as any).rpc("approve_description_version", {
      p_case_id: caseRow.id, p_version_id: versionId, p_approve: approve, p_note: null,
    });
    if (error) return { ok: false, error: error.message };
    if ((data as any)?.ok === false) return { ok: false, error: String((data as any).error) };
    await load();
    return { ok: true };
  }, [record?.caseRow, load]);

  // The decision is persisted as a fact override, which the next snapshot
  // honors — without it the same conflict is re-derived and blocks forever.
  const resolveException = useCallback(async (
    exceptionId: string, fieldKey: string, decision: "include" | "exclude", regenerate: boolean,
  ) => {
    const caseRow = record?.caseRow;
    if (!caseRow) return { ok: false, error: "no case" };
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("resolve_description_conflict", {
      p_case_id: caseRow.id, p_exception_id: exceptionId, p_field_key: fieldKey,
      p_decision: decision, p_value: null, p_reason: decision,
    });
    if (error) { setBusy(false); return { ok: false, error: error.message }; }
    if ((data as any)?.ok === false) { setBusy(false); return { ok: false, error: String((data as any).error) }; }
    setBusy(false);
    // The override IS written at this point. If the follow-up regeneration is
    // refused (a Service Manager may resolve but not generate), the resolution
    // still stands — reload and say so rather than reporting the whole action
    // as failed and leaving the closed exception on screen.
    if (regenerate) {
      const gen = await generate("conflict_resolved");
      await load();
      if (!gen.ok) {
        return { ok: true, warning: `Conflict resolved, but regeneration did not run: ${gen.error}` };
      }
      return { ok: true };
    }
    await load();
    return { ok: true };
  }, [record?.caseRow, generate, load]);

  // A channel lock protects a manual edit, so there has to be a way to make
  // one. Server-side RPC + server-side validation, exactly like the master.
  const saveChannelVersion = useCallback(async (
    channel: string, content: string, reason: string,
  ) => {
    const caseRow = record?.caseRow;
    if (!caseRow || !tenant?.id) return { ok: false, error: "no case" };
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("save_description_channel_version", {
      p_case_id: caseRow.id, p_channel: channel, p_content: content, p_reason: reason,
    });
    setBusy(false);
    if (error) return { ok: false, error: error.message };
    const res = data as any;
    if (res?.ok === false) {
      if (res.error === "over_channel_limit") {
        return { ok: false, error: `Too long for this destination: ${res.length} of ${res.limit} characters.` };
      }
      return { ok: false, error: String(res.error) };
    }
    await load();
    return { ok: true, warning: "Saved and locked. It stays 'pending' until the next validation run." };
  }, [record?.caseRow, tenant?.id, load]);

  return { record, busy, error, reload: load, generate, publishInternally, saveManualVersion,
           saveChannelVersion, setChannelLock, setMasterLock, approveVersion, resolveException };
}
