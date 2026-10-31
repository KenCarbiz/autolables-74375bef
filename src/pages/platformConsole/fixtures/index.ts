import type { ConsoleFixture } from "@/lib/platformConsole/dataSource";
import { OVERVIEW_FIXTURE, OVERVIEW_PHONE_FIXTURE } from "./overview";
// builder B
import { INCIDENT_FIXTURE, INCIDENT_PHONE_FIXTURE } from "./incident";
import { USAGE_FIXTURE, USAGE_PHONE_FIXTURE } from "./usage";
import { BILLING_FIXTURE } from "./billing";
import { ACCESS_FIXTURE } from "./access";
import { TEMPLATES_FIXTURE } from "./templates";
import { AUDIT_FIXTURE } from "./audit";
import { MONITORING_FIXTURE, MONITORING_UNINSTRUMENTED_FIXTURE, RELIABILITY_FIXTURE } from "./reliability";
// end builder B

// Reference screen id -> the console path it renders and the synthetic data it
// needs. Development-only: imported solely by ConsoleDesignFixture.

export interface ConsoleFixtureEntry {
  /** Console path rendered for this reference. */
  path: string;
  fixture: ConsoleFixture;
  /** Viewport family; phone and tablet render without the desktop rail. */
  frame: "desktop" | "tablet" | "phone";
}

const NOW = Date.parse("2026-10-31T09:30:00Z");
const base = (id: string, views: Record<string, unknown>, extra: Partial<ConsoleFixture> = {}): ConsoleFixture => ({ id, views, now: NOW, environment: "PRODUCTION", ...extra });

export const CONSOLE_FIXTURES: Record<string, ConsoleFixtureEntry> = {
  "D01-overview": { path: "/platform-console", frame: "desktop", fixture: base("D01-overview", { overview: OVERVIEW_FIXTURE }) },
  "T01-overview": { path: "/platform-console", frame: "tablet", fixture: base("T01-overview", { overview: OVERVIEW_FIXTURE }) },
  "M01-overview": { path: "/platform-console", frame: "phone", fixture: base("M01-overview", { overview: OVERVIEW_PHONE_FIXTURE }) },
  // builder B
  "D16-incident": { path: "/platform-console/incidents/INC-028", frame: "desktop", fixture: base("D16-incident", { incident: INCIDENT_FIXTURE }) },
  "M04-incident": { path: "/platform-console/incidents/INC-028", frame: "phone", fixture: base("M04-incident", { incident: INCIDENT_PHONE_FIXTURE }) },
  "D11-usage": { path: "/platform-console/usage", frame: "desktop", fixture: base("D11-usage", { usage: USAGE_FIXTURE }) },
  "M05-usage": { path: "/platform-console/usage", frame: "phone", fixture: base("M05-usage", { usage: USAGE_PHONE_FIXTURE }) },
  "D19-billing": { path: "/platform-console/usage/billing", frame: "desktop", fixture: base("D19-billing", { billing: BILLING_FIXTURE }) },
  "D12-access": { path: "/platform-console/access", frame: "desktop", fixture: base("D12-access", { access: ACCESS_FIXTURE }) },
  "D13-templates": { path: "/platform-console/templates", frame: "desktop", fixture: base("D13-templates", { templates: TEMPLATES_FIXTURE }) },
  "D14-audit": { path: "/platform-console/audit", frame: "desktop", fixture: base("D14-audit", { audit: AUDIT_FIXTURE }) },
  "D15-reliability": { path: "/platform-console/reliability", frame: "desktop", fixture: base("D15-reliability", { reliability: RELIABILITY_FIXTURE }) },
  "D20-monitoring": { path: "/platform-console/reliability/monitoring", frame: "desktop", fixture: base("D20-monitoring", { monitoring: MONITORING_FIXTURE }) },
  "S02-uninstrumented": { path: "/platform-console/reliability/monitoring", frame: "desktop", fixture: base("S02-uninstrumented", { monitoring: MONITORING_UNINSTRUMENTED_FIXTURE }) },
  "S01-disconnected": { path: "/platform-console/reliability/monitoring", frame: "desktop", fixture: base("S01-disconnected", { monitoring: MONITORING_FIXTURE }, { connection: "disconnected" }) },
  // end builder B
};
