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
  /** Item failures already at repair_state='passed_on_reinspection'. */
  resolvedFailures?: number;
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
  /** The next REQUIRED task in the order of operations, named for the drawer. */
  nextTask: string;
  /** Plain-language reason the vehicle is parked on this task, when blocked. */
  nextWhy: string | null;
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
  // A signed fail whose FILED failures have all passed reinspection (open = 0,
  // resolved > 0) is also waiting on the reinspection, not on repair — the
  // red "Resolve failed items" state would have nothing left to resolve.
  const readyForReinspection = failed && (
    ctx.inspectionState === "ready_for_reinspection"
    || (openFailures > 0 && (ctx.failuresReadyForReinspection ?? 0) === openFailures)
    || (openFailures === 0 && (ctx.resolvedFailures ?? 0) > 0));
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

  // Order of operations (SERVICE_DESK correction): the K-208 safety inspection
  // is the FIRST required task for every used/CPO vehicle. "Start Get Ready"
  // never renders while the K-208 is next — repair/prep work is downstream of
  // certification and manager authorization.
  let bannerKey: string, bannerLabel: string, tone: Tone, nextLabel: string, nextTone: ServiceStatus["nextTone"];
  let nextTask: string, nextWhy: string | null;
  if (awaiting) {
    bannerKey = "awaiting"; bannerLabel = "Additional work awaiting approval"; tone = "amber";
    nextLabel = "Review request"; nextTone = "primary";
    nextTask = "Additional-work approval"; nextWhy = "A work request is waiting on a manager decision.";
  } else if (readyForReinspection) {
    // All repaired: the loop is waiting on an authorized reinspection, not on
    // more repair work — amber, matching deriveWorkspaceStatus.
    bannerKey = "ready_for_reinspection"; bannerLabel = "Ready for reinspection"; tone = "amber";
    nextLabel = "Verify Repair"; nextTone = "primary";
    nextTask = "Repair verification"; nextWhy = "Repaired items are waiting for reinspection.";
  } else if (failed) {
    bannerKey = "failed"; bannerLabel = "Failed items require repair"; tone = "red";
    nextLabel = "Resolve failed items"; nextTone = "danger";
    nextTask = "Repair failed items"; nextWhy = "The signed inspection recorded failed items that are still open.";
  } else if (recallBlocking) {
    bannerKey = "blocked"; bannerLabel = "Delivery blocked — open recall"; tone = "red";
    nextLabel = "Record recall outcome"; nextTone = "danger";
    nextTask = "Recall resolution"; nextWhy = "An open do-not-drive recall blocks delivery.";
  } else if (cleared) {
    bannerKey = "cleared"; bannerLabel = "Cleared for delivery"; tone = "emerald";
    nextLabel = "View Completed Inspection"; nextTone = "ghost";
    nextTask = "None — cleared for delivery"; nextWhy = null;
  } else if (k208State === "executed") {
    // Executed, but the stored clearance is missing or still blocked — say so;
    // never claim cleared from derivation alone.
    bannerKey = "awaiting_clearance"; bannerLabel = "K-208 executed — delivery clearance pending"; tone = "amber";
    nextLabel = "Review delivery clearance"; nextTone = "primary";
    nextTask = "Delivery clearance"; nextWhy = "The K-208 is executed; the stored clearance has not released the vehicle.";
  } else if (k208State === "ready") {
    bannerKey = "ready"; bannerLabel = "Awaiting certification"; tone = "blue";
    nextLabel = "Review & Certify K-208"; nextTone = "primary";
    nextTask = "K-208 certification"; nextWhy = "The inspection is signed and waiting on the licensee's certification.";
  } else if (k208State === "voided") {
    bannerKey = "voided"; bannerLabel = "K-208 voided"; tone = "slate";
    nextLabel = "Correct Inspection"; nextTone = "primary";
    nextTask = "K-208 Safety Inspection"; nextWhy = "The prior inspection was voided and must be redone.";
  } else if (ctx.inspectionState === "in_progress") {
    bannerKey = "inspection_in_progress"; bannerLabel = "K-208 inspection in progress"; tone = "blue";
    nextLabel = "Continue K-208 Inspection"; nextTone = "primary";
    nextTask = "K-208 Safety Inspection"; nextWhy = null;
  } else if (grState === "in_progress") {
    // Prep items may be moving, but the required inspection still has not
    // started — the K-208 remains the one next required task.
    bannerKey = "in_progress"; bannerLabel = "Get Ready in progress — K-208 not started"; tone = "amber";
    nextLabel = "Start K-208 Inspection"; nextTone = "primary";
    nextTask = "K-208 Safety Inspection"; nextWhy = "Required safety inspection has not been started.";
  } else {
    bannerKey = "not_started"; bannerLabel = "K-208 not started"; tone = "slate";
    nextLabel = "Start K-208 Inspection"; nextTone = "primary";
    nextTask = "K-208 Safety Inspection"; nextWhy = "Required safety inspection has not been started.";
  }

  const priority: ServiceStatus["priority"] = (awaiting || blocked) ? "High" : cleared ? "Low" : "Medium";
  return { grState, k208State, awaiting, blocked, cleared, bannerKey, bannerLabel, tone, nextLabel, nextTone, nextTask, nextWhy, priority };
}
