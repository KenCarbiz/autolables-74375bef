import type { ConsoleFixture } from "@/lib/platformConsole/dataSource";
import { OVERVIEW_FIXTURE } from "./overview";
// builder B
import { INCIDENT_FIXTURE, INCIDENT_PHONE_FIXTURE } from "./incident";
import { USAGE_FIXTURE, USAGE_PHONE_FIXTURE } from "./usage";
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
  "M01-overview": { path: "/platform-console", frame: "phone", fixture: base("M01-overview", { overview: OVERVIEW_FIXTURE }) },
  // builder B
  "D16-incident": { path: "/platform-console/incidents/INC-028", frame: "desktop", fixture: base("D16-incident", { incident: INCIDENT_FIXTURE }) },
  "M04-incident": { path: "/platform-console/incidents/INC-028", frame: "phone", fixture: base("M04-incident", { incident: INCIDENT_PHONE_FIXTURE }) },
  "D11-usage": { path: "/platform-console/usage", frame: "desktop", fixture: base("D11-usage", { usage: USAGE_FIXTURE }) },
  "M05-usage": { path: "/platform-console/usage", frame: "phone", fixture: base("M05-usage", { usage: USAGE_PHONE_FIXTURE }) },
  // end builder B
};
