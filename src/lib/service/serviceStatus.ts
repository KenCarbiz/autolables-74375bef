// One shared derivation of a vehicle's service state, read by BOTH the Service
// Desk queue and the per-vehicle status banner — so every surface agrees on the
// status and the single next action. Computed from data we already keep
// (get_ready_records items + the signed safety_inspection + a pending
// service_request + the STORED vehicle_delivery_clearance row), no new
// "task" table.

import { isExecutedSignoff, isFailedInspection } from "@/lib/commandCenter/inspectionState";

export type GRState = "not_started" | "in_progress" | "complete" | "failed";
// Renamed from K208State: inspectionState.ts exports the row-level K208State
// ("signed"/"failed"/…); this is the workflow stage the queue chips render.
// "voided" renders where the newest inspection row is status='voided' and no
// signed row stands; "superseded" is deliberately unbuilt — nothing writes it.
export type K208Stage = "waiting" | "ready" | "executed" | "blocked" | "voided";
export type Tone = "slate" | "amber" | "red" | "blue" | "emerald";

export interface ServiceStatusContext {
  /** Stored vehicle_delivery_clearance.state; null when no row exists yet. */
  clearanceState?: string | null;
  /** Item failures for the VIN with repair_state != passed_on_reinspection. */
  openFailures?: number;
  /** Of those, how many sit at repair_state='ready_for_reinspection'. */
  failuresReadyForReinspection?: number;
  /** Newest non-voided safety_inspections.inspection_state, when read. */
  inspectionState?: string | null;
  /** Newest inspection row for the VIN is status='voided'. */
  newestVoided?: boolean;
}

export interface ServiceStatus {
  grState: GRState;
  k208State: K208Stage;
  awaiting: boolean;   // an additional-work request is pending a manager decision
  blocked: boolean;    // delivery blocked (failed safety / open failures / recall)
  cleared: boolean;    // stored clearance says cleared_for_delivery — never derived
  bannerKey: string;
  bannerLabel: string;
  tone: Tone;
  nextLabel: string;
  nextTone: "primary" | "danger" | "ghost";
  priority: "High" | "Medium" | "Low";
}

// deno-lint-ignore no-explicit-any
export function deriveServiceStatus(v: any, gr: any, si: any, awaiting: boolean, ctx: ServiceStatusContext = {}): ServiceStatus {
  const openFailures = ctx.openFailures ?? 0;
  const clearanceState = ctx.clearanceState ?? null;
  const items: { status?: string }[] = Array.isArray(gr?.items) ? gr.items : [];
  const anyItems = items.length > 0;
  const someComplete = items.some((i) => i.status === "complete");
  const allComplete = anyItems && items.every((i) => i.status === "complete");
  const grComplete = !!gr?.get_ready_complete_date || allComplete;
  const rs = String(v?.recall_status || "").toLowerCase();
  const recallBlocking = rs.includes("do_not_drive") || rs.includes("do-not-drive");
  // Both callers query .eq("status","signed") (the banner's select even omits
  // the status column), so `si` IS the newest signed row — normalize it and let
  // the ONE predicate decide. A legacy signed row with a NULL result counts;
  // spelling this `result === 'pass'` silently dropped those rows to "waiting".
  const signedRow = si ? { status: "signed", result: (si.result ?? null) as string | null } : null;
  const siPass = isExecutedSignoff(signedRow);
  const siFail = isFailedInspection(signedRow);
  const certified = !!(si && si.licensee_certified_at);
  // A newer signed pass never launders unresolved item failures from an
  // earlier inspection — the failure loop dominates until reinspection.
  const failed = siFail || openFailures > 0;
  // Mirrors deriveWorkspaceStatus: the failure loop is "ready for
  // reinspection" (amber) once the workflow state says so, or once every open
  // item failure sits at repair_state='ready_for_reinspection'.
  const readyForReinspection = failed && (
    ctx.inspectionState === "ready_for_reinspection"
    || (openFailures > 0 && (ctx.failuresReadyForReinspection ?? 0) === openFailures));
  const voided = !!ctx.newestVoided && !si;

  const grState: GRState = failed ? "failed"
    : !gr ? "not_started"
    : grComplete ? "complete"
    : (someComplete || (gr.status && gr.status !== "pending")) ? "in_progress"
    : "not_started";

  const k208State: K208Stage = (recallBlocking || failed) ? "blocked"
    : certified ? "executed"
    : siPass ? "ready"
    : voided ? "voided"
    : "waiting";

  const blocked = failed || recallBlocking;
  // The STORED clearance row is the only authority for "cleared". A vehicle
  // whose derived state looks done but has no cleared_for_delivery row is
  // never shown as cleared.
  const cleared = clearanceState === "cleared_for_delivery" && !blocked && !awaiting;

  let bannerKey: string, bannerLabel: string, tone: Tone, nextLabel: string, nextTone: ServiceStatus["nextTone"];
  if (awaiting) {
    bannerKey = "awaiting"; bannerLabel = "Additional work awaiting approval"; tone = "amber";
    nextLabel = "Review request"; nextTone = "primary";
  } else if (readyForReinspection) {
    // All repaired: the loop is waiting on an authorized reinspection, not on
    // more repair work — amber, matching deriveWorkspaceStatus.
    bannerKey = "ready_for_reinspection"; bannerLabel = "Ready for reinspection"; tone = "amber";
    nextLabel = "Reinspect repaired items"; nextTone = "primary";
  } else if (failed) {
    bannerKey = "failed"; bannerLabel = "Failed items require repair"; tone = "red";
    nextLabel = "Resolve failed items"; nextTone = "danger";
  } else if (recallBlocking) {
    bannerKey = "blocked"; bannerLabel = "Delivery blocked — open recall"; tone = "red";
    nextLabel = "Record recall outcome"; nextTone = "danger";
  } else if (cleared) {
    bannerKey = "cleared"; bannerLabel = "Cleared for delivery"; tone = "emerald";
    nextLabel = "View completed record"; nextTone = "ghost";
  } else if (k208State === "executed") {
    // Executed, but the stored clearance is missing or still blocked — say so;
    // never claim cleared from derivation alone.
    bannerKey = "awaiting_clearance"; bannerLabel = "K-208 executed — delivery clearance pending"; tone = "amber";
    nextLabel = "Review delivery clearance"; nextTone = "primary";
  } else if (k208State === "ready") {
    bannerKey = "ready"; bannerLabel = "Ready for K-208"; tone = "blue";
    nextLabel = "Review & sign K-208"; nextTone = "primary";
  } else if (k208State === "voided") {
    bannerKey = "voided"; bannerLabel = "K-208 voided"; tone = "slate";
    nextLabel = "Start new inspection"; nextTone = "primary";
  } else if (grState === "in_progress") {
    bannerKey = "in_progress"; bannerLabel = "Get Ready in progress"; tone = "amber";
    nextLabel = "Continue work"; nextTone = "primary";
  } else {
    bannerKey = "not_started"; bannerLabel = "Work not started"; tone = "slate";
    nextLabel = "Start Get Ready"; nextTone = "primary";
  }

  const priority: ServiceStatus["priority"] = (awaiting || blocked) ? "High" : cleared ? "Low" : "Medium";
  return { grState, k208State, awaiting, blocked, cleared, bannerKey, bannerLabel, tone, nextLabel, nextTone, priority };
}
