// One shared derivation of a vehicle's service state, read by BOTH the Service
// Desk queue and the per-vehicle status banner — so every surface agrees on the
// status and the single next action. Computed from data we already keep
// (get_ready_records items + the signed safety_inspection + a pending
// service_request), no new "task" table.

export type GRState = "not_started" | "in_progress" | "complete" | "failed";
export type K208State = "waiting" | "ready" | "executed" | "blocked";
export type Tone = "slate" | "amber" | "red" | "blue" | "emerald";

export interface ServiceStatus {
  grState: GRState;
  k208State: K208State;
  awaiting: boolean;   // an additional-work request is pending a manager decision
  blocked: boolean;    // delivery blocked (failed safety / recall)
  cleared: boolean;    // all get-ready complete + K-208 executed
  bannerKey: string;
  bannerLabel: string;
  tone: Tone;
  nextLabel: string;
  nextTone: "primary" | "danger" | "ghost";
  priority: "High" | "Medium" | "Low";
}

// deno-lint-ignore no-explicit-any
export function deriveServiceStatus(v: any, gr: any, si: any, awaiting: boolean): ServiceStatus {
  const items: { status?: string }[] = Array.isArray(gr?.items) ? gr.items : [];
  const anyItems = items.length > 0;
  const someComplete = items.some((i) => i.status === "complete");
  const allComplete = anyItems && items.every((i) => i.status === "complete");
  const grComplete = !!gr?.get_ready_complete_date || allComplete;
  const rs = String(v?.recall_status || "").toLowerCase();
  const recallBlocking = rs.includes("do_not_drive") || rs.includes("do-not-drive");
  const siPass = si && si.result === "pass";
  const siFail = si && si.result === "fail";
  const certified = !!(si && si.licensee_certified_at);

  const grState: GRState = siFail ? "failed"
    : !gr ? "not_started"
    : grComplete ? "complete"
    : (someComplete || (gr.status && gr.status !== "pending")) ? "in_progress"
    : "not_started";

  const k208State: K208State = (recallBlocking || siFail) ? "blocked"
    : certified ? "executed"
    : siPass ? "ready"
    : "waiting";

  const blocked = siFail || recallBlocking;
  const cleared = grComplete && k208State === "executed" && !blocked && !awaiting;

  let bannerKey: string, bannerLabel: string, tone: Tone, nextLabel: string, nextTone: ServiceStatus["nextTone"];
  if (awaiting) {
    bannerKey = "awaiting"; bannerLabel = "Additional work awaiting approval"; tone = "amber";
    nextLabel = "Review request"; nextTone = "primary";
  } else if (siFail) {
    bannerKey = "failed"; bannerLabel = "Failed items require repair"; tone = "red";
    nextLabel = "Resolve failed items"; nextTone = "danger";
  } else if (recallBlocking) {
    bannerKey = "blocked"; bannerLabel = "Delivery blocked — open recall"; tone = "red";
    nextLabel = "Record recall outcome"; nextTone = "danger";
  } else if (cleared) {
    bannerKey = "cleared"; bannerLabel = "Cleared for delivery"; tone = "emerald";
    nextLabel = "View completed record"; nextTone = "ghost";
  } else if (k208State === "ready") {
    bannerKey = "ready"; bannerLabel = "Ready for K-208"; tone = "blue";
    nextLabel = "Review & sign K-208"; nextTone = "primary";
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
