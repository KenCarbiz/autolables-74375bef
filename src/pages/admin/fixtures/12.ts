import type { AdminScreenFixture } from "@/pages/admin/fixtures";
import type { FeedViewFixture } from "@/pages/admin/views/integrations/InventoryFeedView";
import { FIXTURE_CONFIG, FIXTURE_COUNTS, FIXTURE_NOW, FIXTURE_RUNS, RUN_RATE_LIMITED, RUN_SUCCESS } from "./integrationsData";

// Screen 12: Integrations & Data, Inventory feed, with the provider rate
// limiting the last attempt and the rooftop pin retained.

const feed: FeedViewFixture = {
  config: FIXTURE_CONFIG,
  latestRun: RUN_RATE_LIMITED,
  latestRealRun: RUN_RATE_LIMITED,
  lastSuccessAt: RUN_SUCCESS.started_at,
  runs: { rows: FIXTURE_RUNS, total: FIXTURE_RUNS.length },
  counts: FIXTURE_COUNTS,
  viewer: { canManageSettings: true, canClearScope: false, timeZone: "America/New_York" },
};

export const FIXTURE_12: AdminScreenFixture = {
  tabId: "inventory-feed",
  fixture: {
    label: "Integrations: Inventory feed (provider rate limited)",
    now: FIXTURE_NOW,
    views: { "inventory-feed": feed },
  },
};
