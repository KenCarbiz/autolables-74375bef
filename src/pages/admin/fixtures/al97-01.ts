import type { AdminScreenFixture } from "./index";
import type { DealerGroup, DealerStore, GroupInventoryVehicle, InventoryFeedJob, InventoryStoreSnapshot, StoreOverview } from "@/lib/inventoryNetwork/api";
import type { InventoryNetworkFixture } from "@/pages/admin/children/inventoryNetwork/overviewModel";

// AL97 screen 01, Inventory network overview. Synthetic design fixture only:
// store names, counts and times are invented for the parity harness and are
// never written anywhere.

const NOW = Date.parse("2026-10-31T20:16:10Z");
const SNAP_AT = "2026-10-31T19:51:00Z";
const PATH = "/example/inventory/harte-feed.csv";
const iso = "2026-10-01T00:00:00Z";

const group: DealerGroup = { id: "g-al97", tenant_id: "t-al97", name: "Harte Auto Group", legal_name: null, created_at: iso, updated_at: iso };

const store = (id: string, name: string, over: Partial<DealerStore> = {}): DealerStore => ({
  id, group_id: group.id, tenant_id: group.tenant_id, display_name: name, legal_name: null,
  street: null, city: "Hartford", state: "CT", zip: null, phone: null, website: null,
  status: "active", subscription_status: "subscribed", is_primary_inventory_store: false,
  inventory_feed_enabled: true, feed_import_paused: true, inventory_sharing_enabled: false, customer_browser_enabled: false,
  listing_sync_enabled: false, feed_price_updates_listing: false, adopt_legacy_matches: false, retirement_automation_enabled: false,
  missing_snapshot_threshold: 3, max_invalid_rows: 0, provider_ids: {}, created_at: iso, updated_at: iso, ...over,
});

const overviewStore = (s: DealerStore, extra: Partial<StoreOverview> = {}): StoreOverview => ({
  store: s, state: null, policy: null,
  counts: { present: 0, missing: 0, retirement_review: 0, retired: 0, price_unknown: 0, no_photos: 0 },
  mappings: [], open_conflicts: 0, last_snapshot: null, sharing_out: 0, sharing_in: 0, ...extra,
});

const stores: StoreOverview[] = [
  overviewStore(store("s1", "Harte INFINITI", { is_primary_inventory_store: true, feed_import_paused: false }), {
    state: { store_id: "s1", last_applied_snapshot_id: "sn1", last_applied_source_mtime: SNAP_AT, last_applied_sha256: null, last_applied_at: SNAP_AT, last_run_id: "r1", last_failure_at: null, last_failure_reason: null, updated_at: SNAP_AT },
    counts: { present: 100, missing: 0, retirement_review: 0, retired: 0, price_unknown: 0, no_photos: 0 },
    mappings: [{ id: "m1", source_dealer_id: "EXAMPLE-1", status: "approved", approved_at: iso }],
    last_snapshot: { id: "sn1", status: "applied", reason: null, created_at: "2026-10-31T19:50:30Z", run_id: "r1" },
  }),
  overviewStore(store("s2", "Harte Nissan")),
  overviewStore(store("s3", "George Harte Nissan"), { mappings: [{ id: "m3", source_dealer_id: "EXAMPLE-3", status: "pending", approved_at: null }] }),
  overviewStore(store("s4", "Harte Hyundai")),
  overviewStore(store("s5", "Harte Honda")),
  overviewStore(store("s6", "Harte Kia")),
];

const job = (id: string, over: Partial<InventoryFeedJob>): InventoryFeedJob => ({
  id, provider: "filescom", path: PATH, kind: "import", trigger: "webhook", status: "succeeded", attempts: 1, max_attempts: 5,
  next_attempt_at: SNAP_AT, run_id: "r1", last_error: null, result: null, created_at: "2026-10-31T19:49:00Z", started_at: "2026-10-31T19:50:00Z", finished_at: SNAP_AT, ...over,
});

const snapshot: InventoryStoreSnapshot = {
  id: "sn1", run_id: "r1", job_id: "j1", path: PATH, source_dealer_id: "EXAMPLE-1", store_id: "s1", group_id: group.id, mapping_id: "m1", clean: true,
  status: "applied", reason: null, row_count: 100, valid_count: 100, invalid_count: 0, duplicate_count: 0, price_missing_count: 0, photo_missing_count: 0,
  created_at: "2026-10-31T19:50:30Z", applied_at: SNAP_AT,
};

const vehicles: GroupInventoryVehicle[] = Array.from({ length: 60 }, (_, n) => ({
  id: `v${n}`, rank: n + 1, inventory_group: "home", owning_store: { id: "s1", name: "Harte INFINITI", city: "Hartford", state: "CT" },
  vin: `EXAMPLE${String(n).padStart(10, "0")}`, stock_number: null, condition: "used", certified: false, year: 2022, make: "Example", model: "Sedan", trim: null,
  mileage: 20000, exterior_color: null, interior_color: null, price: 25000, price_status: "known", photo: null, photo_count: 0, enrichment_status: "none",
}));

const data: InventoryNetworkFixture = {
  groups: [group],
  overview: {
    group,
    controls: { id: 1, ingestion_paused: false, emergency_stop: false, reconcile_enabled: true, reason: null, updated_at: iso },
    stores,
    exceptions: { open_conflicts: 0, retirement_review: 0, quarantined_partitions_7d: 0, failed_jobs: 0, pending_mappings: 1 },
  },
  jobs: [
    job("j2", { status: "queued", attempts: 0, run_id: null, next_attempt_at: "2026-10-31T19:51:10Z", created_at: "2026-10-31T19:51:10Z", started_at: null, finished_at: null }),
    job("j1", {}),
  ],
  snapshots: [snapshot],
  bindings: [],
  preview: { enabled: true, home_store: { id: "s1", name: "Harte INFINITI", city: "Hartford", state: "CT" }, additional_sources: [], total: 60, vehicles },
  heartbeatAt: null,
};

export const al97Fixture01: AdminScreenFixture = {
  childPath: "/admin/integrations/inventory-network",
  fixture: { label: "AL97 01 Inventory network", now: NOW, views: { "inventory-network": data } },
};
