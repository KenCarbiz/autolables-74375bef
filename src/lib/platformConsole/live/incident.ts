import type { IncidentStatus, Severity, TimelineItem } from "../types";

export type IncidentAction = "assign" | "acknowledge" | "snooze" | "resolve" | "reopen";

export interface IncidentRecord {
  kind: "incident";
  id: string;
  status: IncidentStatus;
  severity: Severity;
  /** Header chip, e.g. "HIGH · DATA HELD". */
  badge: string;
  subtitle: string;
  impactHelper: string;
  scope: string;
  cause?: string;
  owner?: string;
  next: string;
  note: string;
  timeline: TimelineItem[];
  evidenceHelper: string;
  importId: string | null;
  importLabel: string;
  internalNote: string;
  actions: IncidentAction[];
}

export interface IncidentNotMonitored {
  kind: "not_monitored";
  id: string;
  reason: string;
}

export type IncidentModel = IncidentRecord | IncidentNotMonitored;

/**
 * There is no incident store yet, so live never reports an incident as open,
 * acknowledged or resolved: it says the incident is not monitored.
 */
export async function loadIncident(id: string): Promise<IncidentModel> {
  return {
    kind: "not_monitored",
    id,
    reason: "Incident records are not stored yet, so no status, owner or timeline exists for this identifier. Nothing here is acknowledged, assigned or resolved.",
  };
}
