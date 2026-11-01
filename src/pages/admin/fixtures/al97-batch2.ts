import type { AdminScreenFixture } from "./index";
import type {
  DealerGroup, DealerStore, DedupeControls, DedupeListing, DedupeOverview, DedupeScore, FeedBinding, FeedFile, FeedRun, GroupInventoryVehicle, InventoryFeedJob, InventorySourceMapping, InventoryStoreSnapshot, PartitionReportItem, StoreOverview,
} from "@/lib/inventoryNetwork/api";
import type { InventoryNetworkFixture } from "@/pages/admin/children/inventoryNetwork/overviewModel";

// AL97 screens 02, 03, 23, 04 and 22. Synthetic design fixtures only: store
// names, DealerIds, hashes, counts and times are invented for the parity
// harness, are labelled synthetic on screen, and are never written anywhere.

const NOW = Date.parse("2026-10-31T21:25:00Z");
const iso = "2026-10-01T00:00:00Z";
const APPLIED = "2026-10-31T19:51:00Z";
const group: DealerGroup = { id: "g-al97", tenant_id: "t-al97", name: "Harte Auto Group", legal_name: null, created_at: iso, updated_at: iso };
const pathOf = (dealer: string) => `/inbound/${dealer}_inventory.csv`;

const STORES: Array<[string, string, string]> = [
  ["s1", "Harte INFINITI", "MP15398"],
  ["s2", "Harte Nissan", "MP15397"],
  ["s3", "George Harte INFINITI", "MP15395"],
  ["s4", "George Harte Nissan", "MP15396"],
  ["s5", "Harte Volkswagen of Meriden", "MP19635"],
  ["s6", "Harte Hyundai of Old Saybrook", "MP25214"],
];

const dealerStore = (id: string, name: string, over: Partial<DealerStore> = {}): DealerStore => ({
  id, group_id: group.id, tenant_id: group.tenant_id, display_name: name, legal_name: null,
  street: null, city: "Hartford", state: "CT", zip: null, phone: null, website: null,
  status: "active", subscription_status: "subscribed", is_primary_inventory_store: id === "s1",
  inventory_feed_enabled: true, feed_import_paused: id !== "s1", inventory_sharing_enabled: false, customer_browser_enabled: false,
  listing_sync_enabled: false, feed_price_updates_listing: false, adopt_legacy_matches: false, retirement_automation_enabled: false,
  missing_snapshot_threshold: 3, max_invalid_rows: 0, provider_ids: {}, created_at: iso, updated_at: iso, ...over,
});

const storeOverview = (id: string, name: string, dealer: string, over: Partial<DealerStore> = {}): StoreOverview => ({
  store: dealerStore(id, name, over),
  state: id === "s1" ? { store_id: id, last_applied_snapshot_id: "sn1", last_applied_source_mtime: APPLIED, last_applied_sha256: null, last_applied_at: APPLIED, last_run_id: "r1", last_failure_at: null, last_failure_reason: null, updated_at: APPLIED } : null,
  policy: null,
  counts: { present: id === "s1" ? 100 : 0, missing: 0, retirement_review: 0, retired: 0, price_unknown: 0, no_photos: 0 },
  mappings: [{ id: `m-${id}`, source_dealer_id: `${dealer}_inventory`, status: "approved", approved_at: iso }],
  open_conflicts: 0,
  last_snapshot: id === "s1" ? { id: "sn1", status: "applied", reason: null, created_at: APPLIED, run_id: "r1" } : null,
  sharing_out: 0, sharing_in: 0,
});

const counts = (rows: number) => ({ rows, valid: rows, invalid: 0, duplicateIdentical: 0, duplicateConflicts: 0, priceMissing: 0, priceZero: 0, photoMissing: 0 });
const partition = (id: string, name: string, dealer: string, rows: number): PartitionReportItem => ({
  sourceDealerId: `${dealer}_inventory`,
  identity: { dealerId: `${dealer}_inventory`, dealerName: name, address: "", city: "Hartford", postal: "", region: "CT" },
  identityVariants: 1,
  mapping: { id: `m-${id}`, status: "approved", storeId: id, storeName: name },
  comparison: { verdict: "match", fields: { name: "match", address: "match", city: "match", postal: "match", region: "match" } },
  outcome: "ready", reasons: [], counts: counts(rows), errors: [], warnings: [], inventoryDiff: null,
});
const dryRun = (id: string, name: string, dealer: string, rows: number, hash: string): FeedRun => ({
  id: `dr-${dealer}`, path: pathOf(dealer), kind: "dry_run", status: "passed", failure_reason: null,
  started_at: "2026-10-31T18:30:00Z", finished_at: "2026-10-31T18:30:05Z", affected_store_ids: [], job_id: null, content_sha256: hash, remote_mtime: null,
  report: { kind: "partition_dry_run", outcome: "passed", rejectReasons: [], headers: { missing: [], extra: [] }, identities: 1, partitions: [partition(id, name, dealer, rows)], inventoryWrites: 0, providerCalls: 0 },
});
const feedFile = (dealer: string, hash: string): FeedFile => ({
  id: `f-${dealer}`, path: pathOf(dealer), status: "discovered", quarantine_reason: null, remote_size: null, remote_mtime: null,
  latest_event_at: null, discovered_at: iso, last_run_id: null, last_content_sha256: hash,
});
const sourceMapping = (id: string, name: string, dealer: string): InventorySourceMapping => ({
  id: `m-${id}`, provider: "vauto", source_dealer_id: `${dealer}_inventory`, group_id: group.id, store_id: id, status: "approved",
  observed_identity: { dealerName: name }, evidence: { verdict: "match", computed_by: "server" }, identity_acknowledged: false, note: null,
  proposed_at: iso, approved_at: iso, revoked_at: null, created_at: iso, updated_at: iso,
});

const snapshot = (over: Partial<InventoryStoreSnapshot> = {}): InventoryStoreSnapshot => ({
  id: "sn1", run_id: "r1", job_id: "j-earlier", path: pathOf("MP15398"), source_dealer_id: "MP15398_inventory", store_id: "s1", group_id: group.id, mapping_id: "m-s1", clean: true,
  status: "applied", reason: null, row_count: 100, valid_count: 100, invalid_count: 0, duplicate_count: 0, price_missing_count: 0, photo_missing_count: 0,
  created_at: APPLIED, applied_at: APPLIED, ...over,
});

const job = (id: string, over: Partial<InventoryFeedJob>): InventoryFeedJob => ({
  id, provider: "filescom", path: pathOf("MP15398"), kind: "import", trigger: "webhook", status: "succeeded", attempts: 1, max_attempts: 5,
  next_attempt_at: APPLIED, run_id: "r1", last_error: null, result: null, created_at: "2026-10-31T19:49:00Z", started_at: "2026-10-31T19:50:00Z", finished_at: APPLIED, ...over,
});

const vehicles: GroupInventoryVehicle[] = Array.from({ length: 60 }, (_, n) => ({
  id: `v${n}`, rank: n + 1, inventory_group: "home", owning_store: { id: "s1", name: "Harte INFINITI", city: "Hartford", state: "CT" },
  vin: `EXAMPLE${String(n).padStart(10, "0")}`, stock_number: null, condition: "used", certified: false, year: 2022, make: "Example", model: "Sedan", trim: null,
  mileage: 20000, exterior_color: null, interior_color: null, price: 25000, price_status: "known", photo: null, photo_count: 0, enrichment_status: "none",
}));

const binding = (dealer: string, status: FeedBinding["status"]): FeedBinding => ({ id: `b-${dealer}`, path: pathOf(dealer), tenant_id: group.tenant_id, status, approved_at: status === "approved" ? iso : null });

const base = (stores: StoreOverview[], extra: Partial<InventoryNetworkFixture>): InventoryNetworkFixture => ({
  groups: [group],
  overview: {
    group,
    controls: { id: 1, ingestion_paused: false, emergency_stop: false, reconcile_enabled: true, reason: null, updated_at: iso },
    stores,
    exceptions: { open_conflicts: 0, retirement_review: 0, quarantined_partitions_7d: 0, failed_jobs: 0, pending_mappings: 0 },
  },
  ...extra,
});

const screen = (label: string, data: InventoryNetworkFixture): AdminScreenFixture => ({
  childPath: "/admin/integrations/inventory-network",
  fixture: { label, now: NOW, views: { "inventory-network": data } },
});

const allStores = () => STORES.map(([id, name, dealer]) => storeOverview(id, name, dealer));

export const AL97_02 = screen("AL97 02 Stores and import readiness", base(allStores(), {
  snapshots: [snapshot()],
  runs: STORES.slice(1).map(([id, name, dealer]) => dryRun(id, name, dealer, 0, `fixture-${dealer}`)),
  bindings: [binding("MP15398", "approved"), binding("MP15396", "pending")],
}));

const nissan = (over: Partial<DealerStore>) => STORES.map(([id, name, dealer]) => storeOverview(id, name, dealer, id === "s2" ? over : {}));
const nissanLedgers = (status: FeedBinding["status"]): Partial<InventoryNetworkFixture> => ({
  files: [feedFile("MP15397", "fixture-164")],
  runs: [dryRun("s2", "Harte Nissan", "MP15397", 164, "fixture-164")],
  bindings: [binding("MP15397", status)],
  mappings: [sourceMapping("s2", "Harte Nissan", "MP15397")],
  snapshots: [snapshot()],
});

export const AL97_03 = screen("AL97 03 Feed mapping review", base(nissan({}), {
  ...nissanLedgers("pending"),
  heartbeatAt: null,
  copy: { caption: " · synthetic preview of required setup", "dryrun.rows": "Illustrative snapshot" },
}));

export const AL97_23 = screen("AL97 23 Feed mapping ready", base(nissan({ feed_import_paused: false }), {
  ...nissanLedgers("approved"),
  heartbeatAt: "2026-10-31T21:24:00Z",
  copy: {
    caption: " · synthetic readiness fixture", "worker.verified": "Verified in fixture", "source.version": "Pinned fixture file hash",
    "bounds.price": "Off for fixture", "bounds.retirement": "Off for fixture",
  },
}));

export const AL97_04 = screen("AL97 04 Import job queued", base(allStores(), {
  jobs: [
    job("1042", { status: "queued", attempts: 0, run_id: null, created_at: "2026-10-31T21:00:00Z", next_attempt_at: "2026-10-31T21:00:00Z", started_at: null, finished_at: null }),
    job("j-earlier", { trigger: "manual" }),
  ],
  snapshots: [snapshot()],
  runs: [],
  providerUsage: [],
  heartbeatAt: null,
  workerSchedule: "not_found",
  copy: { caption: " · synthetic diagnostic state" },
}));

export const AL97_22 = screen("AL97 22 Import job completed", base(allStores(), {
  jobs: [job("DEMO-1043", { run_id: "run-1043", created_at: "2026-10-31T21:00:00Z", started_at: "2026-10-31T21:00:30Z", finished_at: "2026-10-31T21:01:10Z" })],
  snapshots: [snapshot({ id: "DEMO-001", job_id: "DEMO-1043", run_id: "run-1043" })],
  runs: [{ id: "run-1043", path: pathOf("MP15398"), kind: "import", status: "succeeded", failure_reason: null, started_at: "2026-10-31T21:00:30Z", finished_at: "2026-10-31T21:01:10Z", affected_store_ids: ["s1"], job_id: "DEMO-1043", report: null, content_sha256: "fixture-sha256-1043" }],
  providerUsage: [],
  preview: { enabled: true, home_store: { id: "s1", name: "Harte INFINITI", city: "Hartford", state: "CT" }, additional_sources: [], total: 60, vehicles },
  copy: {
    caption: " · synthetic import fixture",
    "job.bannerDetail": "This fixture proves the intended outcome model; it does not claim the live worker has been activated.",
    "job.hash": "Exact fixture SHA-256", "job.times": "Fixed fixture timestamps", "job.held": "Reviewable with reasons",
  },
}));

export const AL97_10 = screen("AL97 10 Provider usage and budgets", base(allStores(), {
  providerAccount: { quota: 5000, reserve: 1000 },
  storeUsage: null,
  copy: { "budget.quotaSub": "Configured pool · example" },
}));

export const AL97_20 = screen("AL97 20 Review store feed activation", base(nissan({}), {
  ...nissanLedgers("approved"),
  heartbeatAt: "2026-10-31T21:24:00Z",
  copy: { "fixture.label": "PROPOSED TARGET · SYNTHETIC DESIGN FIXTURE · NOT A LIVE SCREENSHOT", "fixture.id": "AL97 / 20" },
}));

const dedupeControls: DedupeControls = {
  detection_enabled: true, auto_reconcile_enabled: false, purge_enabled: false, emergency_stop: true,
  max_sets_per_run: 5, max_store_share_pct: 2, max_unresolved_conflicts: 0, max_failures: 1,
  preview_ttl_minutes: 60, approval_ttl_minutes: 30, limits_approved_at: null, reason: null, updated_at: iso,
};
const dedupe = (over: Partial<DedupeOverview> = {}): DedupeOverview => ({
  controls: dedupeControls, policy_version: "fixture", last_checked_at: null, store_controls: [],
  candidates: [], previews: [], operations: [], reconciled: [], batches: [], ...over,
});
const score = (over: Partial<DedupeScore>): DedupeScore => ({ protected: 0, public_identity: 0, evidence: 0, side_effect: 0, unchecked: 0, published: false, linked: false, established: false, ...over });
const listing = (id: string): DedupeListing => ({
  id, slug: null, status: "active", owning_store_id: "s1", inventory_record_id: null, feed_source: "filescom", ymm: "2024 Example Sedan", trim: null, condition: "used",
  mileage: null, price: null, created_at: iso, published_at: null, archived_at: null, archive_reason: null, market_value: null, market_checked_at: null,
});
const PREVIEW_AT = new Date(NOW).toISOString();
const PREVIEW_EXPIRES = new Date(NOW + 60 * 60000).toISOString();

export const AL97_13 = screen("AL97 13 Duplicate handling", base(allStores(), {
  dedupe: dedupe(),
  copy: { "fixture.label": "PROPOSED TARGET · SYNTHETIC DESIGN FIXTURE · NOT A LIVE SCREENSHOT", "fixture.id": "AL97 / 13" },
}));

export const AL97_14 = screen("AL97 14 Review exact reconciliation", base(allStores(), {
  dedupe: dedupe(),
  dedupePreview: {
    id: "preview-demo", status: "pending", status_reason: null, plan_sha256: "fixture-sha256", expires_at: PREVIEW_EXPIRES, approval_expires_at: null, approved_at: null, applied_operation_id: null,
    plan: {
      policy_version: "fixture", preview_id: "preview-demo", expires_at: PREVIEW_EXPIRES, generated_at: PREVIEW_AT, vin_suffix: "DEMO01", store_name: "Harte INFINITI", kind: "duplicate_listings",
      action: "archive_redundant", disposition: "eligible", reasons: [], canonical_listing_id: "LISTING-DEMO-001", redundant_listing_ids: ["LISTING-DEMO-002"], inventory_id: "INV-DEMO-001",
      listings: [listing("LISTING-DEMO-001"), listing("LISTING-DEMO-002")], inventory: null,
      scores: {
        "LISTING-DEMO-001": score({ protected: 1, public_identity: 1, evidence: 1, published: true, linked: true, established: true }),
        "LISTING-DEMO-002": score({ unchecked: 1 }),
      },
      decisions: [], domains: [], conflicts: [{ field: "exterior_color", canonical: "Example", redundant: "Other", rule: "hold" }], blocked_dependencies: [],
      expected_counts: {}, provider_calls: 0, storage_operations: 0, fingerprint: "fixture",
    },
  },
  copy: { "dedupe.candidate": "Synthetic candidate", "fixture.label": "PROPOSED TARGET · SYNTHETIC DESIGN FIXTURE · NOT A LIVE SCREENSHOT", "fixture.id": "AL97 / 14" },
}));
