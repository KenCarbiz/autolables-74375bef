import type { ConsoleFixture } from "@/lib/platformConsole/dataSource";
import { OVERVIEW_FIXTURE } from "./overview";
import { STORES_FIXTURE, STORE_FIXTURE } from "./stores";
import { FEEDS_FIXTURE, IMPORT_FIXTURE, LINEAGE_FIXTURE, QUALITY_FIXTURE, RATINGS_FIXTURE } from "./data";
import { ACTION_FIXTURE, ACTION_PHONE_FIXTURE, CONNECTIONS_FIXTURE, FILESCOM_FIXTURE, MAPPING_FIXTURE } from "./connections";

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
  // builder A
  "D02-stores": { path: "/platform-console/stores", frame: "desktop", fixture: base("D02-stores", { stores: STORES_FIXTURE }) },
  "D03-store": { path: "/platform-console/stores/store-a", frame: "desktop", fixture: base("D03-store", { store: STORE_FIXTURE }) },
  "D04-connections": { path: "/platform-console/connections", frame: "desktop", fixture: base("D04-connections", { connections: CONNECTIONS_FIXTURE }) },
  "D05-files": { path: "/platform-console/connections/files-com", frame: "desktop", fixture: base("D05-files", { "files-com": FILESCOM_FIXTURE }) },
  "D18-mapping": { path: "/platform-console/connections/mapping", frame: "desktop", fixture: base("D18-mapping", { mapping: MAPPING_FIXTURE }) },
  "D17-action": { path: "/platform-console/actions/replay-import.IMP-1042", frame: "desktop", fixture: base("D17-action", { action: ACTION_FIXTURE }) },
  "T02-files": { path: "/platform-console/connections/files-com", frame: "tablet", fixture: base("T02-files", { "files-com": FILESCOM_FIXTURE }) },
  "M02-files": { path: "/platform-console/connections/files-com", frame: "phone", fixture: base("M02-files", { "files-com": FILESCOM_FIXTURE }) },
  "M06-action": { path: "/platform-console/actions/replay-import.IMP-1042", frame: "phone", fixture: base("M06-action", { action: ACTION_PHONE_FIXTURE }) },
  "D06-feeds": { path: "/platform-console/data", frame: "desktop", fixture: base("D06-feeds", { feeds: FEEDS_FIXTURE }) },
  "D07-import": { path: "/platform-console/data/imports/IMP-1042", frame: "desktop", fixture: base("D07-import", { import: IMPORT_FIXTURE }) },
  "D08-quality": { path: "/platform-console/data/quality", frame: "desktop", fixture: base("D08-quality", { quality: QUALITY_FIXTURE }) },
  "D09-lineage": { path: "/platform-console/data/vehicles/EX-001", frame: "desktop", fixture: base("D09-lineage", { lineage: LINEAGE_FIXTURE }) },
  "D10-ratings": { path: "/platform-console/data/ratings", frame: "desktop", fixture: base("D10-ratings", { ratings: RATINGS_FIXTURE }) },
  "M03-import": { path: "/platform-console/data/imports/IMP-1042", frame: "phone", fixture: base("M03-import", { import: IMPORT_FIXTURE }) },
  // end builder A
};
