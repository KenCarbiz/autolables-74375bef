// user_notifications type + dedupe-key vocabulary (20260726106000). Every
// producer builds keys through these helpers so a retried cron sweep or a
// double-clicked decision can never double-notify — the UNIQUE(dedupe_key)
// insert becomes a no-op.

// Wired producers today: failure_entered / k208_ready / ready_for_reinspection /
// k208_executed (ServiceVehicleWorkspace), service_request_decision
// (decide_service_request, 20260726107000), service_request_clarified
// (respond_service_clarification, 20260726162000). The remaining types are the
// SERVICE_DESK_SPEC forward vocabulary (cron/threshold alerts not built yet) —
// keep them declared so the bell renders any early producer, but do not treat
// them as emitted.
export const SERVICE_NOTIFICATION_TYPES = [
  "service_task_created",
  "inspection_overdue",
  "sold_still_blocked",
  "failure_entered",
  "ready_for_reinspection",
  "k208_ready",
  "k208_executed",
  "k208_unsigned_past_threshold",
  "service_request_decision",
  "service_request_clarified",
  "storage_failure",
  "delivery_compliance_conflict",
] as const;

export type ServiceNotificationType = (typeof SERVICE_NOTIFICATION_TYPES)[number];

/**
 * Stable dedupe key: type + subject (vin or row id) + optional qualifier for
 * events that legitimately recur (e.g. one key per decision, per day-bucket).
 * Must stay in lockstep with SQL producers — decide_service_request builds
 * 'service_request:<id>:<decision>' with the same shape.
 */
export const notificationDedupeKey = (
  type: ServiceNotificationType | string,
  subject: string,
  qualifier?: string,
): string => `${type}:${subject.toUpperCase()}${qualifier ? `:${qualifier}` : ""}`;

/** Plain-language bell renderings; the type stays the stored vocabulary. */
export const SERVICE_NOTIFICATION_LABELS: Record<ServiceNotificationType, string> = {
  service_task_created: "New service task",
  inspection_overdue: "Inspection overdue",
  sold_still_blocked: "Sold vehicle still blocked",
  failure_entered: "Failed item recorded",
  ready_for_reinspection: "Ready for reinspection",
  k208_ready: "K-208 ready to execute",
  k208_executed: "K-208 executed",
  k208_unsigned_past_threshold: "K-208 unsigned past threshold",
  service_request_decision: "Additional-work decision",
  service_request_clarified: "Additional-work clarification",
  storage_failure: "Document storage failure",
  delivery_compliance_conflict: "Delivery compliance conflict",
};

export const serviceNotificationLabel = (type: string): string =>
  SERVICE_NOTIFICATION_LABELS[type as ServiceNotificationType]
    ?? type.replace(/_/g, " ").replace(/\b\w/, (c) => c.toUpperCase());

export interface UserNotificationRow {
  id: string;
  tenant_id: string;
  user_id: string;
  type: string;
  dedupe_key: string | null;
  vin: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export const isUnread = (n: Pick<UserNotificationRow, "read_at">): boolean => !n.read_at;
