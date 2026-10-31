import type { MetricModel, Tone } from "../types";
import { consolePath } from "../sections";
import { readRows, relativeAge, settle } from "./read";

export interface MonitoringRow {
  id: string;
  workflow: string;
  coverage: { label: string; tone: Tone };
  lastSignal: string;
  next: { label: string; href: string | null };
}

export interface MonitoringModel {
  metrics: MetricModel[];
  rows: MonitoringRow[];
  note: string;
  /** True when no workflow has a successful measurement: shown as Monitoring not available. */
  unavailable: boolean;
  /** Time of the last verified state, shown when live updates are disconnected. */
  lastVerified: string;
}

interface EventRow { id: string; received_at: string }

const NM = { label: "Not monitored", tone: "warn" as Tone };
const NOTE = "A failed monitoring collector cannot turn the platform green. Show stale telemetry and preserve last-known state.";
const metric = (key: string, icon: MetricModel["icon"], label: string, value: string, tone: Tone, helper: string, state: MetricModel["provenance"]["state"], source: string, asOf: string | null): MetricModel => ({ key, icon, label, value, tone, helper, provenance: { source, asOf, state, scope: label } });

/**
 * Coverage is measured where a signal exists (feed events) and otherwise says
 * Not monitored or Unknown. Nothing here is green by default.
 */
export async function loadMonitoring(now = Date.now()): Promise<MonitoringModel> {
  const events = await settle(readRows<EventRow>("inventory_feed_events", "id,received_at", { order: "received_at", limit: 1 }));
  const asOf = new Date(now).toISOString();
  const last = events.ok && events.value.length ? events.value[0].received_at : null;
  const rows: MonitoringRow[] = [
    last
      ? { id: "feed", workflow: "Files.com → publication", coverage: { label: "Measured", tone: "good" }, lastSignal: `${relativeAge(last, now)} ago`, next: { label: "Inspect trace", href: consolePath.feeds() } }
      : { id: "feed", workflow: "Files.com → publication", coverage: events.ok ? NM : { label: "Unknown", tone: "warn" }, lastSignal: events.ok ? "No feed events recorded" : "Feed events not readable", next: { label: "Connect telemetry", href: null } },
    { id: "email", workflow: "Email delivery", coverage: NM, lastSignal: "No delivery signal", next: { label: "Connect telemetry", href: null } },
    { id: "sticker", workflow: "Window sticker cost", coverage: { label: "Unknown", tone: "warn" }, lastSignal: "Cost is not metered", next: { label: "Keep disabled", href: null } },
    { id: "journey", workflow: "Customer document journey", coverage: NM, lastSignal: "No synthetic check", next: { label: "Connect telemetry", href: null } },
    { id: "restore", workflow: "Object restore drill", coverage: NM, lastSignal: "No drill recorded", next: { label: "Connect telemetry", href: null } },
  ];
  const measured = rows.filter((r) => r.coverage.label === "Measured").length;
  return {
    metrics: [
      metric("instrumented", "activity", "Instrumented workflows", `${measured} / ${rows.length}`, "warn", `${rows.length - measured} missing application signals`, "healthy", "inventory_feed_events", asOf),
      metric("alert", "bell", "Alert delivery check", "Not monitored", "neutral", "No synthetic alert test is recorded", "not_monitored", "none", null),
      metric("lag", "clock", "Metric ingest lag", "Not monitored", "neutral", "No collector heartbeat is recorded", "not_monitored", "none", null),
      metric("retention", "archive", "Retention", "Unknown", "neutral", "Log retention is not recorded here", "unknown", "none", null),
    ],
    rows,
    note: NOTE,
    unavailable: measured === 0,
    lastVerified: new Date(now).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}
