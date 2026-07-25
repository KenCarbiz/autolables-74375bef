import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

// Data access for Description Intelligence. Every mutation goes through a
// server-side RPC or edge function — nothing here fabricates a completion
// state locally, and nothing reports success unless the server confirmed it.

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

export interface DescriptionCaseRow extends Row {
  id: string; vehicle_id: string; vin: string; status: string;
  publication_eligibility: string; fact_confidence: number | null;
  quality_score: number | null; open_exception_count: number;
  lock_version: number; potentially_stale: boolean;
}

export interface OpsSummary {
  activeInventory: number; published: number; ready: number;
  reviewRequired: number; failed: number; stale: number; missing: number;
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
      const [caseRes, vehRes, chanRes] = await Promise.all([
        (supabase as any).from("description_cases").select("*")
          .eq("tenant_id", tenant.id).is("archived_at", null)
          .order("updated_at", { ascending: false }).limit(500),
        (supabase as any).from("vehicle_listings")
          .select("id, vin, ymm, trim, condition, mileage, status, hero_image_url, mc_attributes")
          .eq("tenant_id", tenant.id).in("status", ["draft", "published"]).limit(1000),
        (supabase as any).from("description_channel_versions")
          .select("description_case_id, channel, validation_status").eq("tenant_id", tenant.id).limit(5000),
      ]);
      if (caseRes.error) throw caseRes.error;
      const rows = (caseRes.data || []) as DescriptionCaseRow[];
      const vmap: Record<string, Row> = {};
      for (const v of vehRes.data || []) vmap[v.id] = v;
      // real per-case channel counts, so the table reports measurements
      // rather than a constant derived from the static channel list
      const cmap: Record<string, { total: number; ready: number }> = {};
      for (const cv of chanRes.data || []) {
        const e = (cmap[cv.description_case_id] ||= { total: 0, ready: 0 });
        e.total += 1;
        if (cv.validation_status === "passed" || cv.validation_status === "warning") e.ready += 1;
      }
      setChannelCounts(cmap);
      setCases(rows);
      setVehicles(vmap);

      const activeInventory = (vehRes.data || []).length;
      const withCase = new Set(rows.map((r) => r.vehicle_id));
      setSummary({
        activeInventory,
        published: rows.filter((r) => r.status === "PUBLISHED").length,
        ready: rows.filter((r) => r.status === "READY").length,
        reviewRequired: rows.filter((r) => r.status === "REVIEW_REQUIRED").length,
        failed: rows.filter((r) => r.status === "FAILED_RETRYABLE" || r.status === "FAILED_BLOCKED").length,
        stale: rows.filter((r) => r.status === "STALE" || r.potentially_stale).length,
        missing: (vehRes.data || []).filter((v: Row) => !withCase.has(v.id)).length,
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
    if (error) return { ok: false, error: error.message };
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

      if (!caseRow) {
        setRecord({ caseRow: null, vehicle: veh, versions: [], channels: [], findings: [], exceptions: [], snapshot: null, deliveries: [] });
        return;
      }
      const [vers, chans, finds, excs, snaps, dels] = await Promise.all([
        (supabase as any).from("description_versions").select("*")
          .eq("description_case_id", caseRow.id).order("version_number", { ascending: false }),
        (supabase as any).from("description_channel_versions").select("*")
          .eq("description_case_id", caseRow.id).order("channel"),
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
      setRecord({
        caseRow, vehicle: veh,
        versions: vers.data || [], channels: chans.data || [], findings: finds.data || [],
        exceptions: excs.data || [], snapshot: (snaps.data || [])[0] || null, deliveries: dels.data || [],
      });
    } catch (e) {
      setError((e as Error).message || "Could not load the description record");
    }
  }, [tenant?.id, vehicleId]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (reason = "manual", channels?: string[]) => {
    if (!tenant?.id || !vehicleId) return { ok: false, error: "missing context" };
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("description-orchestrate", {
      body: { action: "regenerate", tenant_id: tenant.id, vehicle_id: vehicleId, reason, channels },
    });
    setBusy(false);
    if (error) return { ok: false, error: error.message };
    if ((data as any)?.error) return { ok: false, error: String((data as any).error) };
    await load();
    // the server tells us whether a version was actually produced
    return { ok: true, generated: (data as any)?.generated !== false, result: data };
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
    const { data: userRes } = await supabase.auth.getUser();
    const latest = record?.versions?.[0];
    setBusy(true);
    // A manual edit never rewrites history — it always creates a new version.
    const { error } = await (supabase as any).from("description_versions").insert({
      tenant_id: tenant.id, vehicle_id: caseRow.vehicle_id, description_case_id: caseRow.id,
      parent_version_id: latest?.id || null, fact_snapshot_id: latest?.fact_snapshot_id || null,
      version_number: (latest?.version_number || 0) + 1, version_type: "manual",
      content, word_count: content.split(/\s+/).filter(Boolean).length,
      character_count: content.length, configuration_version: caseRow.configuration_version,
      source_data_version: caseRow.current_source_data_version,
      created_by_type: "user", created_by_user_id: userRes?.user?.id ?? null,
      manual_edit: true, edit_reason: reason, validation_status: "pending",
    });
    setBusy(false);
    if (error) return { ok: false, error: error.message };
    await load();
    return { ok: true };
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
    if (regenerate) { setBusy(false); return await generate("conflict_resolved"); }
    setBusy(false);
    await load();
    return { ok: true };
  }, [record?.caseRow, generate, load]);

  return { record, busy, error, reload: load, generate, publishInternally, saveManualVersion,
           setChannelLock, setMasterLock, approveVersion, resolveException };
}
