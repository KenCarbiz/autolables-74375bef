import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────────────
// useRecallTask — the "Open Recall Review Required" service task for a VIN.
//
// The task is created automatically by a DB trigger whenever an open recall is
// written to vehicle_listings (any pull path). This hook reads the current
// task and lets the service department record one of three outcomes. The task
// blocks readiness/publish while status === 'open_review'.
// ──────────────────────────────────────────────────────────────────────

export type RecallOutcome = "recall_completed" | "no_fix_available" | "does_not_apply";

export interface RecallTask {
  id: string;
  vin: string;
  status: "open_review" | "resolved";
  outcome: RecallOutcome | null;
  open_recall_count: number;
  employee_name: string | null;
  service_date: string | null;
  ro_number: string | null;
  notes: string | null;
  documents: string[];
  completed_at: string | null;
}

export interface RecallOutcomeInput {
  employeeName: string;
  roNumber?: string;
  notes?: string;
  serviceDate?: string;
  documents?: string[];
}

// "No fix available" leaves the recall visible but is still a recorded review,
// so it clears the hard publish blocker (dealer publish policy then applies).
export const OUTCOME_LABELS: Record<RecallOutcome, string> = {
  recall_completed: "Recall Completed",
  no_fix_available: "No Fix Available Yet",
  does_not_apply: "Recall Does Not Apply To This Vehicle",
};

export function useRecallTask(vin: string | null | undefined, tenantId: string | null | undefined) {
  const [task, setTask] = useState<RecallTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!vin || !tenantId) { setTask(null); setLoading(false); return; }
    setLoading(true);
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as unknown as { from: (t: string) => any })
      .from("recall_service_tasks")
      .select("id, vin, status, outcome, open_recall_count, employee_name, service_date, ro_number, notes, documents, completed_at")
      .eq("vin", vin)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = Array.isArray(data) && data[0] ? data[0] as RecallTask : null;
    setTask(row);
    setLoading(false);
  }, [vin, tenantId]);

  useEffect(() => { load(); }, [load]);

  const submitOutcome = useCallback(async (outcome: RecallOutcome, input: RecallOutcomeInput) => {
    if (!task) return { ok: false, error: "No recall task to resolve." };
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("submit_recall_service_outcome", {
        _task_id: task.id,
        _outcome: outcome,
        _employee_name: input.employeeName,
        _service_date: input.serviceDate ?? new Date().toISOString(),
        _ro_number: input.roNumber ?? null,
        _notes: input.notes ?? null,
        _documents: input.documents ?? [],
      });
      if (error) return { ok: false, error: error.message };
      await load();
      return { ok: true };
    } finally {
      setSubmitting(false);
    }
  }, [task, load]);

  // The hard blocker: an open recall task that service has not yet reviewed.
  const blocking = !!task && task.status === "open_review";

  return { task, loading, submitting, blocking, submitOutcome, reload: load };
}
