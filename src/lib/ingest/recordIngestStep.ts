// The one client-side write path into vehicle_ingest_ledger. Goes through the
// record_ingest_step RPC (SECURITY DEFINER) rather than a direct insert, so
// the tenant check and the non-empty-reason rule are enforced in one place
// for every caller, edge or browser.
//
// It returns whether the write actually landed. Callers must not report
// success on a false — a discarded write here is exactly the failure mode
// this ledger exists to expose.

import { supabase } from "@/integrations/supabase/client";
import { RECORDABLE_STATUSES, type IngestStep, type IngestStepStatus } from "./ingestOutcome";

export type RecordableStatus = Exclude<IngestStepStatus, "not_run">;

export interface RecordIngestStepArgs {
  tenantId: string | null | undefined;
  vin: string | null | undefined;
  step: IngestStep;
  status: RecordableStatus;
  reason: string;
  vehicleId?: string | null;
  detail?: Record<string, unknown>;
}

export async function recordIngestStep(args: RecordIngestStepArgs): Promise<boolean> {
  const tenantId = String(args.tenantId || "").trim();
  const vin = String(args.vin || "").trim().toUpperCase();
  const reason = String(args.reason || "").trim();
  if (!tenantId || !vin || !reason) return false;
  if (!RECORDABLE_STATUSES.includes(args.status)) return false;
  try {
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).rpc("record_ingest_step", {
      p_tenant_id: tenantId,
      p_vin: vin,
      p_step: args.step,
      p_status: args.status,
      p_reason: reason,
      p_vehicle_id: args.vehicleId ?? null,
      p_detail: args.detail ?? {},
    });
    if (error) {
      console.error("[ingest-ledger] record_ingest_step failed:", error.message || error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[ingest-ledger] record_ingest_step threw:", e);
    return false;
  }
}
