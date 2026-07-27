import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// The client seam onto the shared VIN truth snapshot. Every panel that
// wants to know what a vehicle IS reads it from here rather than picking
// through mc_attributes for itself — the same reason the generators read
// it server-side.

export interface TruthSnapshotRow {
  id: string;
  snapshot_version: number;
  snapshot_json: Record<string, unknown>;
  content_checksum: string;
  material_changes: Array<{ field: string; label: string; previous: unknown; next: unknown }>;
  affected_families: string[];
  source_kinds: string[];
  has_unresolved_conflicts: boolean;
  created_at: string;
}

export interface TruthFactRow {
  fact_key: string;
  fact_value: { v: unknown };
  source_kind: string;
  confidence: string;
  authority: string;
  usable_in_copy: boolean;
  evidence: Record<string, unknown>;
  observed_at: string | null;
  overridden_by: string | null;
}

export interface TruthConflictRow {
  id: string;
  fact_key: string;
  authority: string;
  candidates: Array<{ value: unknown; sourceKind: string; confidence: string; observedAt: string | null }>;
  status: string;
  blocks_generation: boolean;
  created_at: string;
}

export interface TruthSourceRow {
  id: string;
  source_kind: string;
  source_name: string;
  retrieved_at: string;
  billable: boolean;
}

export interface VehicleTruth {
  snapshot: TruthSnapshotRow | null;
  facts: TruthFactRow[];
  conflicts: TruthConflictRow[];
  sources: TruthSourceRow[];
}

const EMPTY: VehicleTruth = { snapshot: null, facts: [], conflicts: [], sources: [] };

export function useVehicleTruth(tenantId?: string | null, vehicleId?: string | null) {
  const [truth, setTruth] = useState<VehicleTruth>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId || !vehicleId) { setTruth(EMPTY); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke("factory-sticker-orchestrate", {
        body: { action: "vehicle_truth", tenant_id: tenantId, vehicle_id: vehicleId },
      });
      const payload = (data || {}) as Record<string, unknown>;
      if (err || payload.success !== true) {
        throw new Error(String(err?.message || payload.error || "could not load vehicle truth"));
      }
      setTruth({
        snapshot: (payload.snapshot as TruthSnapshotRow | null) ?? null,
        facts: (payload.facts as TruthFactRow[]) ?? [],
        conflicts: (payload.conflicts as TruthConflictRow[]) ?? [],
        sources: (payload.sources as TruthSourceRow[]) ?? [],
      });
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setTruth(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [tenantId, vehicleId]);

  useEffect(() => { void load(); }, [load]);

  /** Re-resolve from data already saved. Reads nothing from a provider. */
  const refresh = useCallback(async () => {
    if (!tenantId || !vehicleId) return null;
    setLoading(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("factory-sticker-orchestrate", {
        body: { action: "refresh_truth", tenant_id: tenantId, vehicle_id: vehicleId },
      });
      const payload = (data || {}) as Record<string, unknown>;
      if (err || payload.success !== true) {
        throw new Error(String(err?.message || payload.error || "refresh failed"));
      }
      await load();
      return payload as { created?: boolean; version?: number; reason?: string };
    } catch (e) {
      setError(String((e as Error)?.message || e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [tenantId, vehicleId, load]);

  return { truth, loading, error, reload: load, refresh };
}
