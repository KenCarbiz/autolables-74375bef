import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LifecycleState } from "@/lib/lifecycle/states";

// ──────────────────────────────────────────────────────────────────────
// The Vehicle File's read of the STORED lifecycle.
//
// vehicle_lifecycle (20260726220000_vehicle_lifecycle_foundation.sql) is the
// single authority: 22 states, one row per used/CPO vehicle, written only by
// recompute_vehicle_lifecycle and set_vehicle_lifecycle_gate. Nothing here
// derives a state — it reads the stored one and describes it.
//
// The Get Ready rail (INTAKE / SERVICE / RECON / PREP / VERIFIED / READY) is a
// PRESENTATION grouping over those same 22 states, in the order the recompute
// actually walks them. It is not a second vocabulary: every stage names the
// canonical states it covers, and the current canonical state is always shown.
// ──────────────────────────────────────────────────────────────────────

export interface LifecycleRow {
  state: LifecycleState;
  previous_state: LifecycleState | null;
  state_changed_at: string;
  gate_reason: string | null;
  authorized_at: string | null;
  retail_ready_at: string | null;
  updated_at: string;
}

export type RailKey = "intake" | "service" | "recon" | "prep" | "verified" | "ready";

export interface RailStage {
  key: RailKey;
  label: string;
  covers: LifecycleState[];
}

// Order follows recompute_vehicle_lifecycle's own first-match cascade:
// intake gate -> service inspection -> repair loop -> certify + detail ->
// final verification -> retail ready.
export const RAIL: RailStage[] = [
  {
    key: "intake",
    label: "Intake",
    covers: ["INGESTED", "PRELOAD_RUNNING", "PRELOAD_EXCEPTION", "AWAITING_MANAGER_AUTHORIZATION", "AUTHORIZED_FOR_GET_READY"],
  },
  {
    key: "service",
    label: "Service",
    covers: ["SERVICE_UNASSIGNED", "K208_IN_PROGRESS", "SERVICE_FINDINGS_RECORDED", "WAITING_FOR_MANAGER_DECISION", "RETURNED_FOR_CLARIFICATION"],
  },
  {
    key: "recon",
    label: "Recon",
    covers: ["WORK_AUTHORIZED", "REPAIR_IN_PROGRESS", "REPAIR_VERIFICATION_REQUIRED"],
  },
  {
    key: "prep",
    label: "Prep",
    covers: ["K208_READY_TO_CERTIFY", "K208_FINALIZED", "DETAIL_PENDING", "DETAIL_IN_PROGRESS"],
  },
  {
    key: "verified",
    label: "Verified",
    covers: ["FINAL_READY_VERIFICATION"],
  },
  {
    key: "ready",
    label: "Ready",
    covers: ["RETAIL_READY"],
  },
];

// Gate states sit off the rail entirely — a manager parked the vehicle.
export const OFF_RAIL: LifecycleState[] = ["ON_HOLD", "WHOLESALE", "REMOVED"];

export const railKeyFor = (state: LifecycleState | null): RailKey | null => {
  if (!state) return null;
  return RAIL.find((s) => s.covers.includes(state))?.key ?? null;
};

export type StageState = "done" | "current" | "future";

export const stageStates = (state: LifecycleState | null): Record<RailKey, StageState> => {
  const key = railKeyFor(state);
  const idx = key ? RAIL.findIndex((s) => s.key === key) : -1;
  const out = {} as Record<RailKey, StageState>;
  RAIL.forEach((s, i) => {
    out[s.key] = idx < 0 ? "future" : i < idx ? "done" : i === idx ? "current" : "future";
  });
  return out;
};

// recompute_vehicle_lifecycle returns early for anything that is not used /
// cpo / certified, so a new vehicle legitimately has no lifecycle row.
export const isLifecycleTracked = (condition: string | null | undefined): boolean =>
  ["used", "cpo", "certified"].includes(String(condition || "used").toLowerCase());

export interface LifecycleResult {
  row: LifecycleRow | null;
  loading: boolean;
  error: string | null;
  tracked: boolean;
  reload: () => void;
}

export function useVehicleLifecycle(
  tenantId: string | null | undefined,
  vehicleId: string | null | undefined,
  condition: string | null | undefined,
): LifecycleResult {
  const tracked = isLifecycleTracked(condition);
  const [row, setRow] = useState<LifecycleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId || !vehicleId || !tracked) { setRow(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // deno-lint-ignore no-explicit-any
      const { data, error: err } = await (supabase as unknown as { from: (t: string) => any })
        .from("vehicle_lifecycle")
        .select("state, previous_state, state_changed_at, gate_reason, authorized_at, retail_ready_at, updated_at")
        .eq("tenant_id", tenantId)
        .eq("vehicle_id", vehicleId)
        .maybeSingle();
      if (err) throw new Error(err.message);
      setRow((data as LifecycleRow | null) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the lifecycle record");
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, vehicleId, tracked]);

  useEffect(() => { void load(); }, [load]);

  return { row, loading, error, tracked, reload: () => { void load(); } };
}
