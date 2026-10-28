import type { AdminScreenFixture } from "@/pages/admin/fixtures";
import type { SyncRunFixture } from "@/pages/admin/children/SyncRunPage";
import { FIXTURE_NOW, RUN_RATE_LIMITED, RUN_SUCCESS } from "./integrationsData";

// Screen 13: Inventory sync run detail for a provider rate-limit refusal.

const run: SyncRunFixture = {
  run: RUN_RATE_LIMITED,
  errors: [],
  lastSuccessAt: RUN_SUCCESS.started_at,
};

export const FIXTURE_13: AdminScreenFixture = {
  childPath: "/admin/integrations/runs/:runId",
  fixture: {
    label: "Integrations: Inventory sync run (provider rate limited)",
    now: FIXTURE_NOW,
    views: { "sync-run": run },
  },
};
