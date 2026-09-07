// ──────────────────────────────────────────────────────────────────────
// The canonical vehicle_lifecycle vocabulary — one copy, for every screen.
//
// The authority is the CHECK constraint in
// supabase/migrations/20260726220000_vehicle_lifecycle_foundation.sql. Nothing
// here invents or derives a state; states.test.ts reads that migration and
// fails if this list and the constraint ever disagree.
//
// Every desk (service manager, service writer, technician, used-car manager,
// the Vehicle File) used to keep its own copy of these strings. Two copies of
// a state vocabulary drift, and this one already had: the same state was
// labelled differently on two screens. Presentation that is genuinely
// desk-specific (a CTA label, a status-pill tone) stays with its screen, but
// it is keyed off this union so a state can never be silently missed.
// ──────────────────────────────────────────────────────────────────────

export const LIFECYCLE_STATES = [
  "INGESTED",
  "PRELOAD_RUNNING",
  "PRELOAD_EXCEPTION",
  "AWAITING_MANAGER_AUTHORIZATION",
  "AUTHORIZED_FOR_GET_READY",
  "SERVICE_UNASSIGNED",
  "K208_IN_PROGRESS",
  "SERVICE_FINDINGS_RECORDED",
  "WAITING_FOR_MANAGER_DECISION",
  "RETURNED_FOR_CLARIFICATION",
  "WORK_AUTHORIZED",
  "REPAIR_IN_PROGRESS",
  "REPAIR_VERIFICATION_REQUIRED",
  "K208_READY_TO_CERTIFY",
  "K208_FINALIZED",
  "DETAIL_PENDING",
  "DETAIL_IN_PROGRESS",
  "FINAL_READY_VERIFICATION",
  "RETAIL_READY",
  "ON_HOLD",
  "WHOLESALE",
  "REMOVED",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const STATE_SET: ReadonlySet<string> = new Set<string>(LIFECYCLE_STATES);

export const isLifecycleState = (value: string | null | undefined): value is LifecycleState =>
  !!value && STATE_SET.has(value);

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
// from a job title shown on a page.
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

// The states a vehicle is physically being worked in. The intake gate, the
// resting state and the manager gate states are somebody else's queue, so the
// service desks filter on this set rather than on "every state we have a label
// for".
export const SERVICE_FLOOR_STATES = [
  "AUTHORIZED_FOR_GET_READY",
  "SERVICE_UNASSIGNED",
  "K208_IN_PROGRESS",
  "SERVICE_FINDINGS_RECORDED",
  "WAITING_FOR_MANAGER_DECISION",
  "RETURNED_FOR_CLARIFICATION",
  "WORK_AUTHORIZED",
  "REPAIR_IN_PROGRESS",
  "REPAIR_VERIFICATION_REQUIRED",
  "K208_READY_TO_CERTIFY",
  "K208_FINALIZED",
  "DETAIL_PENDING",
  "DETAIL_IN_PROGRESS",
  "FINAL_READY_VERIFICATION",
] as const;

export type ServiceFloorState = (typeof SERVICE_FLOOR_STATES)[number];

export const stateLabel = (state: string | null | undefined): string =>
  isLifecycleState(state) ? STATE_LABEL[state] : (state || "");
