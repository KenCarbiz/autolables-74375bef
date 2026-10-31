import type { ReliabilityModel } from "@/lib/platformConsole/live/reliability";
import type { MonitoringModel } from "@/lib/platformConsole/live/monitoring";

// Synthetic data for references D15, D20, S01 and S02.
const prov = { source: "fixture", asOf: "2026-10-31T09:30:00Z", state: "healthy" as const, scope: "Synthetic workflows" };

export const RELIABILITY_FIXTURE: ReliabilityModel = {
  metrics: [
    { key: "journeys", icon: "activity", label: "Journey checks", value: "5 / 6", tone: "bad", helper: "One current failure", provenance: prov },
    { key: "api", icon: "clock", label: "API response p95", value: "420 ms", tone: "info", helper: "Successful requests · 24h", provenance: prov },
    { key: "queue", icon: "layers", label: "Oldest queued job", value: "2 min", tone: "info", helper: "Threshold configured per workflow", provenance: prov },
    { key: "restore", icon: "archive", label: "Restore verification", value: "Oct 24", tone: "good", helper: "Isolated test, evidence available", provenance: prov },
  ],
  journeys: [
    { id: "login", name: "Login / store selection", result: { label: "Passed", tone: "good" }, impact: "Synthetic store" },
    { id: "passport", name: "Passport / estimate", result: { label: "Passed", tone: "good" }, impact: "Price basis checked" },
    { id: "document", name: "Document download", result: { label: "Failed", tone: "bad" }, impact: "Store C · INC-029" },
    { id: "lead", name: "Lead → assignment", result: { label: "Passed", tone: "good" }, impact: "No real customer message" },
  ],
  recoveryHelper: "Database and stored objects are separate",
  recoveryLines: ["Database backup: last success 02:00", "Object backup: last success 02:15", "Restore drill: Oct 24 · 18 minutes"],
  releaseHelper: "Relate symptoms to frontend, edge functions, migrations and configuration changes.",
  releaseText: "09:00 UI build demo-18    |    08:30 document worker demo-7    |    Config v12 · observed, not inferred",
};

export const MONITORING_FIXTURE: MonitoringModel = {
  metrics: [
    { key: "instrumented", icon: "activity", label: "Instrumented workflows", value: "8 / 10", tone: "warn", helper: "2 missing application signals", provenance: prov },
    { key: "alert", icon: "bell", label: "Alert delivery check", value: "Passed", tone: "good", helper: "Synthetic alert routed to test sink", provenance: prov },
    { key: "lag", icon: "clock", label: "Metric ingest lag", value: "12 sec", tone: "info", helper: "Last collector heartbeat", provenance: prov },
    { key: "retention", icon: "archive", label: "Retention", value: "30 days", tone: "info", helper: "Configured operational logs", provenance: prov },
  ],
  rows: [
    { id: "feed", workflow: "Files.com → publication", coverage: { label: "Measured", tone: "good" }, lastSignal: "12 seconds ago", next: { label: "Inspect trace", href: "/platform-console/data" } },
    { id: "email", workflow: "Email delivery", coverage: { label: "Not monitored", tone: "warn" }, lastSignal: "No delivery signal", next: { label: "Connect telemetry", href: null } },
    { id: "sticker", workflow: "Window sticker cost", coverage: { label: "Unknown", tone: "warn" }, lastSignal: "Provider disabled", next: { label: "Keep disabled", href: null } },
    { id: "journey", workflow: "Customer document journey", coverage: { label: "Measured", tone: "good" }, lastSignal: "1 minute ago", next: { label: "Inspect failure", href: "/platform-console/incidents/INC-029" } },
    { id: "restore", workflow: "Object restore drill", coverage: { label: "Measured", tone: "good" }, lastSignal: "Oct 24", next: { label: "Inspect evidence", href: "/platform-console/reliability" } },
  ],
  note: "A failed monitoring collector cannot turn the platform green. Show stale telemetry and preserve last-known state.",
  unavailable: false,
  lastVerified: "09:12",
};

/** S02: the collector produced no successful measurement. */
export const MONITORING_UNINSTRUMENTED_FIXTURE: MonitoringModel = { ...MONITORING_FIXTURE, unavailable: true };
