// user_notifications type + dedupe-key vocabulary (20260726106000). Every
// producer builds keys through these helpers so a retried cron sweep or a
// double-clicked decision can never double-notify — the UNIQUE(dedupe_key)
// insert becomes a no-op.

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
