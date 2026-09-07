import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

export type LifecycleState =
  | "INGESTED" | "PRELOAD_RUNNING" | "PRELOAD_EXCEPTION"
  | "AWAITING_MANAGER_AUTHORIZATION" | "AUTHORIZED_FOR_GET_READY"
  | "SERVICE_UNASSIGNED" | "K208_IN_PROGRESS" | "SERVICE_FINDINGS_RECORDED"
  | "WAITING_FOR_MANAGER_DECISION" | "RETURNED_FOR_CLARIFICATION"
  | "WORK_AUTHORIZED" | "REPAIR_IN_PROGRESS" | "REPAIR_VERIFICATION_REQUIRED"
  | "K208_READY_TO_CERTIFY" | "K208_FINALIZED"
  | "DETAIL_PENDING" | "DETAIL_IN_PROGRESS" | "FINAL_READY_VERIFICATION"
  | "RETAIL_READY" | "ON_HOLD" | "WHOLESALE" | "REMOVED";

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

export const STATE_LABEL: Record<LifecycleState, string> = {
  INGESTED: "Ingested",
  PRELOAD_RUNNING: "Preload running",
  PRELOAD_EXCEPTION: "Preload exception",
  AWAITING_MANAGER_AUTHORIZATION: "Awaiting manager authorization",
  AUTHORIZED_FOR_GET_READY: "Authorized for get ready",
  SERVICE_UNASSIGNED: "Service unassigned",
  K208_IN_PROGRESS: "Inspection in progress",
  SERVICE_FINDINGS_RECORDED: "Service findings recorded",
  WAITING_FOR_MANAGER_DECISION: "Waiting for manager decision",
  RETURNED_FOR_CLARIFICATION: "Returned for clarification",
  WORK_AUTHORIZED: "Work authorized",
  REPAIR_IN_PROGRESS: "Repair in progress",
  REPAIR_VERIFICATION_REQUIRED: "Ready for reinspection",
  K208_READY_TO_CERTIFY: "Awaiting K-208 certification",
  K208_FINALIZED: "K-208 finalized",
  DETAIL_PENDING: "Detail pending",
  DETAIL_IN_PROGRESS: "Detail in progress",
  FINAL_READY_VERIFICATION: "Final ready verification",
  RETAIL_READY: "Retail ready",
  ON_HOLD: "On hold",
  WHOLESALE: "Wholesale",
  REMOVED: "Removed",
};

// The desk accountable for moving the vehicle out of the state. Never a
// signing authority: K-208 certification comes from the store's K-208 policy
// (k208_authority_roles / k208_authorized_users, enforced server-side), never
// from a job title shown on this page.
export const STATE_OWNER: Record<LifecycleState, string> = {
  INGESTED: "Inventory intake",
  PRELOAD_RUNNING: "Inventory intake",
  PRELOAD_EXCEPTION: "Inventory intake",
  AWAITING_MANAGER_AUTHORIZATION: "Used car manager",
  AUTHORIZED_FOR_GET_READY: "Service",
  SERVICE_UNASSIGNED: "Service",
  K208_IN_PROGRESS: "Service",
  SERVICE_FINDINGS_RECORDED: "Service",
  WAITING_FOR_MANAGER_DECISION: "Used car manager",
  RETURNED_FOR_CLARIFICATION: "Service",
  WORK_AUTHORIZED: "Service",
  REPAIR_IN_PROGRESS: "Service",
  REPAIR_VERIFICATION_REQUIRED: "Service",
  K208_READY_TO_CERTIFY: "Service",
  K208_FINALIZED: "Service",
  DETAIL_PENDING: "Detail",
  DETAIL_IN_PROGRESS: "Detail",
  FINAL_READY_VERIFICATION: "Used car manager",
  RETAIL_READY: "Sales",
  ON_HOLD: "Used car manager",
  WHOLESALE: "Used car manager",
  REMOVED: "Used car manager",
};

export const STATE_NEXT_ACTION: Record<LifecycleState, string> = {
  INGESTED: "Wait for the preload to finish",
  PRELOAD_RUNNING: "Wait for the preload to finish",
  PRELOAD_EXCEPTION: "Clear the preload exception",
  AWAITING_MANAGER_AUTHORIZATION: "Authorize this vehicle for get ready",
  AUTHORIZED_FOR_GET_READY: "Start the safety inspection",
  SERVICE_UNASSIGNED: "Assign a technician",
  K208_IN_PROGRESS: "Continue the inspection",
  SERVICE_FINDINGS_RECORDED: "Review the findings and decide on the work",
  WAITING_FOR_MANAGER_DECISION: "Approve, limit, or decline the requested work",
  RETURNED_FOR_CLARIFICATION: "Answer the manager's question",
  WORK_AUTHORIZED: "Start the authorized work",
  REPAIR_IN_PROGRESS: "Finish the repairs",
  REPAIR_VERIFICATION_REQUIRED: "Run the reinspection",
  K208_READY_TO_CERTIFY: "Certify the K-208 under the store's K-208 policy",
  K208_FINALIZED: "Send the vehicle to detail",
  DETAIL_PENDING: "Start the detail",
  DETAIL_IN_PROGRESS: "Finish the detail",
  FINAL_READY_VERIFICATION: "Confirm delivery clearance and mark retail ready",
  RETAIL_READY: "Merchandise and list the vehicle",
  ON_HOLD: "Release the hold or move the vehicle out of inventory",
  WHOLESALE: "Complete the wholesale disposition",
  REMOVED: "Return the vehicle to review to put it back in inventory",
};

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
