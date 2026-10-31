// Shared vocabulary for the platform operations console. Configuration,
// operational work, publication safety, monitoring freshness, entitlement and
// budget are separate fields; none of them collapses into one "Connected" badge.

export type TelemetryState =
  | "healthy"
  | "degraded"
  | "failed"
  | "paused"
  | "not_configured"
  | "unknown"
  | "not_monitored"
  | "stale";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

export const STATE_TONE: Record<TelemetryState, Tone> = {
  healthy: "good",
  degraded: "warn",
  failed: "bad",
  paused: "warn",
  not_configured: "neutral",
  unknown: "neutral",
  not_monitored: "neutral",
  stale: "warn",
};

export const STATE_LABEL: Record<TelemetryState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failed: "Failed",
  paused: "Paused",
  not_configured: "Not configured",
  unknown: "Unknown",
  not_monitored: "Not monitored",
  stale: "Stale",
};

/** Where a number came from. Every telemetry view carries one. */
export interface Provenance {
  source: string;
  /** ISO time of the reading, or null when nothing has been read. */
  asOf: string | null;
  state: TelemetryState;
  scope: string;
}

/** A metric card. `value` is display text; when the reading is missing it says so in words. */
export interface MetricModel {
  key: string;
  icon: ConsoleIconName;
  label: string;
  value: string;
  tone: Tone;
  helper: string;
  provenance: Provenance;
}

export type Severity = "high" | "medium" | "low";
export type IncidentStatus = "open" | "acknowledged" | "investigating" | "resolved" | "reopened";

export interface AttentionRow {
  id: string;
  severity: Severity;
  store: string;
  issue: string;
  age: string;
  actionLabel: string;
  href: string;
  detail?: string;
}

export interface TimelineItem {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
}

export interface StageModel {
  key: string;
  label: string;
  value: string;
  tone: Tone;
}

export type ConsoleIconName =
  | "activity" | "archive" | "back" | "bell" | "calculator" | "calendar" | "car" | "check" | "chevron" | "clock"
  | "close" | "copy" | "database" | "dollar" | "download" | "edit" | "file" | "history" | "info" | "layers"
  | "lock" | "menu" | "network" | "pause" | "percent" | "plug" | "plus" | "preview" | "rates" | "retry"
  | "search" | "settings" | "shield" | "store" | "users" | "warning";

/** Action lifecycle: proposed -> preview -> reason/authorization -> revalidated -> queued/running -> completed/held/failed. */
export type ActionPhase = "proposed" | "previewed" | "authorized" | "revalidated" | "queued" | "running" | "completed" | "held" | "failed";

export interface ActionRequest {
  kind: string;
  operationKey: string;
  reason: string;
  scope: string;
  previewVersion: string;
}

export interface ActionResult {
  phase: ActionPhase;
  message: string;
}
