import { describe, expect, it } from "vitest";
import type { InventoryFeedJob, StoreOverview } from "@/lib/inventoryNetwork/api";
import { buildOverviewModel, type OverviewInputs } from "./overviewModel";

const NOW = Date.parse("2026-10-31T20:16:10Z");
const job = (over: Partial<InventoryFeedJob>): InventoryFeedJob => ({
  id: "j", provider: "filescom", path: "/example.csv", kind: "import", trigger: "webhook", status: "queued", attempts: 0, max_attempts: 5,
  next_attempt_at: "2026-10-31T19:51:10Z", run_id: null, last_error: null, result: null, created_at: "2026-10-31T19:51:10Z", started_at: null, finished_at: null, ...over,
});
const store = { store: { id: "s1", tenant_id: "t", display_name: "Example Store", is_primary_inventory_store: true, inventory_feed_enabled: true, feed_import_paused: false, status: "active" }, state: null, policy: null, mappings: [{ id: "m", source_dealer_id: "x", status: "approved", approved_at: null }], last_snapshot: null } as unknown as StoreOverview;
const base: OverviewInputs = { now: NOW, stores: [store], controls: null, jobs: [], snapshots: [], bindings: [], preview: undefined, heartbeatAt: null };

describe("overview model", () => {
  it("shows the overdue banner only when a queued job is past due", () => {
    expect(buildOverviewModel({ ...base, jobs: [job({})] }).banner?.detail).toContain("Import queued for 25 minutes.");
    expect(buildOverviewModel({ ...base, jobs: [job({ next_attempt_at: "2026-10-31T21:00:00Z" })] }).banner).toBeNull();
    expect(buildOverviewModel({ ...base, jobs: [job({ status: "succeeded", finished_at: "2026-10-31T19:52:00Z" })] }).banner).toBeNull();
    expect(buildOverviewModel({ ...base, jobs: null }).banner).toBeNull();
  });

  it("reports the heartbeat as not recorded and never as healthy without one", () => {
    const m = buildOverviewModel({ ...base, jobs: [job({})] });
    expect(m.controls.heartbeat).toEqual({ label: "Not recorded", tone: "amber" });
    expect(m.flow[2].note).toBe("Worker heartbeat missing");
  });

  it("keeps ingestion permission separate from the heartbeat", () => {
    const controls = { id: 1 as const, ingestion_paused: false, emergency_stop: false, reconcile_enabled: true, reason: null, updated_at: "" };
    const m = buildOverviewModel({ ...base, controls });
    expect(m.controls.ingestion.label).toBe("On");
    expect(m.controls.heartbeat.label).toBe("Not recorded");
    expect(buildOverviewModel({ ...base, controls: { ...controls, ingestion_paused: true } }).controls.ingestion.tone).toBe("amber");
    expect(buildOverviewModel(base).controls.ingestion.label).toBe("Unknown");
  });

  it("says Unknown when a ledger was not read", () => {
    const m = buildOverviewModel({ ...base, jobs: null, snapshots: null });
    expect(m.stats[1].value).toBe("Unknown");
    expect(m.stats[2].value).toBe("Unknown");
    expect(m.stats[3].value).toBe("Unknown");
    expect(m.flow[0].chip.label).toBe("Unknown");
  });
});
