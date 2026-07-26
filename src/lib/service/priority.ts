// Deterministic queue priority (SERVICE_DESK_SPEC "Priority logic"): one
// ordered rule list, a stored-style reason code per rank, and a plain-language
// rendering. The queue sorts by (rank asc, age desc) so the same inputs always
// produce the same order — nothing is invented per render.

export const SERVICE_PRIORITY_CODES = [
  "DELIVERY_TODAY_INSPECTION_NOT_STARTED",
  "DELIVERY_TODAY_DELIVERY_BLOCKED",
  "SOLD_VEHICLE_FAILED_ITEMS_OPEN",
  "REINSPECTION_REQUIRED",
  "K208_READY_NOT_EXECUTED",
  "INSPECTION_OVERDUE",
  "INSPECTION_UNASSIGNED",
  "OLDEST_PENDING_INSPECTION",
  "NEW_INVENTORY_PENDING_INSPECTION",
  "NO_ACTION_REQUIRED",
] as const;

export type ServicePriorityCode = (typeof SERVICE_PRIORITY_CODES)[number];

export const SERVICE_PRIORITY_LABELS: Record<ServicePriorityCode, string> = {
  DELIVERY_TODAY_INSPECTION_NOT_STARTED: "Delivery today, inspection not started",
  DELIVERY_TODAY_DELIVERY_BLOCKED: "Delivery today, delivery blocked",
  SOLD_VEHICLE_FAILED_ITEMS_OPEN: "Sold vehicle with failed items open",
  REINSPECTION_REQUIRED: "Repaired, awaiting reinspection",
  K208_READY_NOT_EXECUTED: "Passed, K-208 ready to execute",
  INSPECTION_OVERDUE: "Inspection overdue",
  INSPECTION_UNASSIGNED: "Not assigned to a technician",
  OLDEST_PENDING_INSPECTION: "Pending inspection",
  NEW_INVENTORY_PENDING_INSPECTION: "New arrival, pending inspection",
  NO_ACTION_REQUIRED: "No service action required",
};

export interface ServicePriorityInput {
  sold: boolean;
  deliveryToday: boolean;
  /** Any active delivery blocker (failed items, recall, unexecuted K-208). */
  blocked: boolean;
  failedItemsOpen: boolean;
  awaitingReinspection: boolean;
  /** All required items passed, K-208 not yet executed. */
  readyForK208: boolean;
  inspectionStarted: boolean;
  overdue: boolean;
  /** Whole days past the store's overdue threshold (0 when not overdue). */
  overdueDays?: number;
  assigned: boolean;
  ageHours: number;
  cleared: boolean;
}

export interface ServicePriority {
  rank: number;
  code: ServicePriorityCode;
  label: string;
  level: "High" | "Medium" | "Low";
}

const levelFor = (rank: number): ServicePriority["level"] =>
  rank <= 2 ? "High" : rank <= 5 ? "Medium" : "Low";

const make = (rank: number, code: ServicePriorityCode): ServicePriority => ({
  rank,
  code,
  label: SERVICE_PRIORITY_LABELS[code],
  level: levelFor(rank),
});

/** Age past this many days overdue is a High-priority exception, whatever the
 *  rule that matched — a 38-day-old pending inspection is never "Medium". */
const OVERDUE_ESCALATION_DAYS = 7;

/** Spec order, first match wins: sold+today+blocked, sold+failure,
 *  reinspection, K-208 ready, overdue, unassigned, oldest pending, new.
 *  Severely overdue vehicles escalate to High and say how many days. */
export function deriveServicePriority(i: ServicePriorityInput): ServicePriority {
  if (i.cleared) return { rank: 9, code: "NO_ACTION_REQUIRED", label: SERVICE_PRIORITY_LABELS.NO_ACTION_REQUIRED, level: "Low" };
  const days = Math.max(0, Math.floor(i.overdueDays ?? 0));
  const escalate = (p: ServicePriority): ServicePriority =>
    i.overdue && days >= OVERDUE_ESCALATION_DAYS && p.level !== "High"
      ? { ...p, level: "High", label: `${p.label} — ${days} days overdue` }
      : p;
  if (i.sold && i.deliveryToday && i.blocked) {
    return make(1, i.inspectionStarted ? "DELIVERY_TODAY_DELIVERY_BLOCKED" : "DELIVERY_TODAY_INSPECTION_NOT_STARTED");
  }
  if (i.sold && i.failedItemsOpen) return make(2, "SOLD_VEHICLE_FAILED_ITEMS_OPEN");
  if (i.awaitingReinspection) return escalate(make(3, "REINSPECTION_REQUIRED"));
  if (i.readyForK208) return escalate(make(4, "K208_READY_NOT_EXECUTED"));
  if (i.overdue) {
    const p = make(5, "INSPECTION_OVERDUE");
    return days >= 1
      ? { ...p, label: `Inspection overdue ${days} ${days === 1 ? "day" : "days"}`, level: days >= OVERDUE_ESCALATION_DAYS ? "High" : p.level }
      : p;
  }
  if (!i.assigned) return make(6, "INSPECTION_UNASSIGNED");
  if (i.ageHours >= 24) return make(7, "OLDEST_PENDING_INSPECTION");
  return make(8, "NEW_INVENTORY_PENDING_INSPECTION");
}

/** Stable comparator for the queue: rank first, then oldest first. */
export const compareServicePriority = (
  a: { priority: ServicePriority; ageHours: number },
  b: { priority: ServicePriority; ageHours: number },
): number => (a.priority.rank - b.priority.rank) || (b.ageHours - a.ageHours);
