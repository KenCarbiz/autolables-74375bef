import { STATE_LABEL, type LifecycleState } from "@/lib/lifecycle/states";
import { deriveRecallView } from "@/lib/vehicleTruth/recallView";
import type { LifecycleResult } from "./lifecycle";
import type { ReadinessSummary, VehicleRow } from "./types";

// F02: one vehicle was shown "READY" while its lifecycle said it was still
// awaiting manager authorization and an inspection. Five different questions
// were sharing one word. This derives them separately, from state the page
// already holds, and nothing here is invented:
//
//   lifecycle   - the stored vehicle_lifecycle state
//   publication - the listing's publish status
//   retail      - retail readiness: the lifecycle must have reached
//                 RETAIL_READY and no readiness blocker may remain. Publication
//                 never implies it.
//   signing     - prep / inspection sign-off evidence on the listing
//   delivery    - delivery clearance; this page does not read it, so it says so
//
// "Retail ready" is only ever produced when the stored evidence supports it.

export type FactTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface StatusFact {
  label: string;
  value: string;
  tone: FactTone;
  detail?: string;
}

export interface VehicleStatusFacts {
  lifecycle: StatusFact;
  publication: StatusFact;
  retail: StatusFact & { ready: boolean };
  signing: StatusFact;
  delivery: StatusFact;
}

// States in which an inspection or authorization is still outstanding.
const AUTHORIZATION_PENDING: ReadonlySet<LifecycleState> = new Set<LifecycleState>([
  "AWAITING_MANAGER_AUTHORIZATION",
  "WAITING_FOR_MANAGER_DECISION",
  "RETURNED_FOR_CLARIFICATION",
]);
const INSPECTION_PENDING: ReadonlySet<LifecycleState> = new Set<LifecycleState>([
  "SERVICE_UNASSIGNED",
  "K208_IN_PROGRESS",
  "SERVICE_FINDINGS_RECORDED",
  "REPAIR_VERIFICATION_REQUIRED",
  "K208_READY_TO_CERTIFY",
]);

export function deriveStatusFacts(input: {
  vehicle: Pick<VehicleRow, "status" | "condition" | "prep_status" | "recall_status" | "open_recall_count" | "recall_check" | "recall_payload" | "recall_checked_at">;
  ready: Pick<ReadinessSummary, "blockers" | "remaining">;
  lifecycle: Pick<LifecycleResult, "tracked" | "loading" | "error" | "row">;
}): VehicleStatusFacts {
  const { vehicle, ready, lifecycle } = input;
  const state = lifecycle.row?.state ?? null;

  const lifecycleFact: StatusFact = !lifecycle.tracked
    ? { label: "Lifecycle", value: "Not tracked", tone: "neutral", detail: "New stock does not run a get-ready lifecycle" }
    : lifecycle.loading
      ? { label: "Lifecycle", value: "Reading", tone: "neutral" }
      : lifecycle.error
        ? { label: "Lifecycle", value: "Unknown", tone: "warning", detail: "The lifecycle record could not be read" }
        : state
          ? { label: "Lifecycle", value: STATE_LABEL[state], tone: state === "RETAIL_READY" ? "success" : "info" }
          : { label: "Lifecycle", value: "No record yet", tone: "neutral" };

  const publicationFact: StatusFact =
    vehicle.status === "published" ? { label: "Publication", value: "Published", tone: "info", detail: "Listed on the shopper portal. This is not retail readiness." }
      : vehicle.status === "archived" ? { label: "Publication", value: "Archived", tone: "neutral" }
        : { label: "Publication", value: "Not published", tone: "neutral" };

  const prepSigned = !!vehicle.prep_status?.foreman_signed_at;
  const signingFact: StatusFact = state && INSPECTION_PENDING.has(state)
    ? { label: "Signing", value: "Inspection pending", tone: "warning", detail: STATE_LABEL[state] }
    : prepSigned
      ? { label: "Signing", value: "Prep signed", tone: "success" }
      : { label: "Signing", value: "Prep sign-off pending", tone: "warning" };

  // Retail readiness.
  let retail: VehicleStatusFacts["retail"];
  if (lifecycle.tracked) {
    if (lifecycle.loading) {
      retail = { label: "Retail readiness", value: "Reading", tone: "neutral", ready: false };
    } else if (lifecycle.error || !state) {
      retail = { label: "Retail readiness", value: "Unknown", tone: "neutral", ready: false, detail: lifecycle.error ? "Lifecycle could not be read" : "No lifecycle record yet" };
    } else if (state !== "RETAIL_READY") {
      const why = AUTHORIZATION_PENDING.has(state) ? "Authorization pending" : INSPECTION_PENDING.has(state) ? "Inspection pending" : STATE_LABEL[state];
      retail = { label: "Retail readiness", value: "Not retail ready", tone: "warning", ready: false, detail: why };
    } else if (ready.blockers.length > 0) {
      retail = { label: "Retail readiness", value: "Not retail ready", tone: "warning", ready: false, detail: `${ready.blockers.length} blocker${ready.blockers.length === 1 ? "" : "s"}` };
    } else {
      retail = { label: "Retail readiness", value: "Retail ready", tone: "success", ready: true };
    }
  } else if (ready.blockers.length > 0) {
    retail = { label: "Retail readiness", value: "Not retail ready", tone: "warning", ready: false, detail: `${ready.blockers.length} blocker${ready.blockers.length === 1 ? "" : "s"}` };
  } else if (!prepSigned) {
    retail = { label: "Retail readiness", value: "Not retail ready", tone: "warning", ready: false, detail: "Prep sign-off pending" };
  } else {
    retail = { label: "Retail readiness", value: "Retail ready", tone: "success", ready: true };
  }

  const delivery: StatusFact = {
    label: "Delivery clearance",
    value: "Not read here",
    tone: "neutral",
    detail: "Delivery sign-offs are shown on the Compliance tab",
  };

  return { lifecycle: lifecycleFact, publication: publicationFact, retail, signing: signingFact, delivery };
}

/** The recall line on this screen: Unknown is neutral and never reads as cleared. */
export function recallFact(vehicle: Parameters<typeof deriveRecallView>[0]): StatusFact {
  const v = deriveRecallView(vehicle);
  if (v.riskSignalled) {
    const n = v.vin.openCount ?? v.model?.campaignCount ?? 0;
    return {
      label: "Recall",
      value: v.doNotDrive ? "Do-not-drive recall reported" : n > 0 ? `${n} open recall${n === 1 ? "" : "s"}` : "Recall reported",
      tone: "danger",
    };
  }
  if (v.vin.clearClaimAllowed) return { label: "Recall", value: "No open recall for this VIN", tone: "success" };
  return { label: "Recall", value: "Unknown", tone: "neutral", detail: "No VIN-level recall check has answered" };
}
