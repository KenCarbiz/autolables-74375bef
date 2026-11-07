// L03: a store whose next import is queued past due never reads "Feed healthy".
import { describe, it, expect } from "vitest";
import { overdueImports } from "./overviewModel";
import { feedHealth } from "./OverviewSection";
import type { InventoryFeedJob, InventoryStoreSnapshot, StoreOverview } from "@/lib/inventoryNetwork/api";

const NOW = Date.parse("2026-11-07T19:00:00Z");
const job = (o: Partial<InventoryFeedJob>): InventoryFeedJob => ({
  id: "j1", provider: "filescom", path: "/harte/MP15396.csv", kind: "import", trigger: "webhook", status: "queued",
  attempts: 0, max_attempts: 5, next_attempt_at: "2026-11-07T01:00:00Z", run_id: null, last_error: null, result: null,
  created_at: "2026-11-07T01:00:00Z", started_at: null, finished_at: null, ...o,
});
const snapRow = (o: Partial<InventoryStoreSnapshot>): InventoryStoreSnapshot => ({
  id: "s1", run_id: null, job_id: null, path: "/harte/MP15396.csv", source_dealer_id: "MP15396", store_id: "store-a", group_id: null,
  mapping_id: null, clean: true, status: "applied", reason: null, row_count: 100, valid_count: 100, invalid_count: 0, duplicate_count: 0,
  price_missing_count: 0, photo_missing_count: 0, created_at: "2026-10-31T19:51:00Z", applied_at: "2026-10-31T19:51:00Z", ...o,
});
const store = (id: string): StoreOverview => ({
  store: { id, display_name: id, inventory_feed_enabled: true, feed_import_paused: false } as StoreOverview["store"],
  state: null, policy: null, counts: { present: 100, missing: 0, retirement_review: 0, retired: 0, price_unknown: 0, no_photos: 0 },
  mappings: [], open_conflicts: 0, last_snapshot: { id: "s1", status: "applied", reason: null, created_at: "2026-10-31T19:51:00Z", run_id: null },
  sharing_out: 0, sharing_in: 0,
});

describe("L03 — honest feed health", () => {
  it("a queued, past-due import marks its store overdue", () => {
    const q = overdueImports([job({})], [snapRow({})], NOW);
    expect(q.known).toBe(true);
    expect(q.total).toBe(1);
    expect([...q.stores]).toEqual(["store-a"]);
  });

  it("an applied last snapshot is not 'healthy' while an import is overdue", () => {
    expect(feedHealth(store("store-a"), true).label).toBe("Import overdue");
    expect(feedHealth(store("store-a"), false).label).toBe("Last import applied");
  });

  it("an unread queue is unknown, never healthy", () => {
    expect(overdueImports(null, [snapRow({})], NOW).known).toBe(false);
    const h = feedHealth(store("store-a"), null);
    expect(h.label).toBe("Last import applied, queue unknown");
    expect(h.label).not.toMatch(/healthy/i);
  });

  it("a job not yet due is not overdue", () => {
    const q = overdueImports([job({ next_attempt_at: "2026-11-07T20:00:00Z" })], [snapRow({})], NOW);
    expect(q.total).toBe(0);
  });
});
