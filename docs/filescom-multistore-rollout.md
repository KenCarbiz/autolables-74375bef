# Files.com multi-store inventory: deployment and rollout

Owner-requested deployment instructions for connector phase 2 (dealer groups,
stores, per-store ingestion, sibling-store sharing, per-store MarketCheck
policy). Nothing here has been deployed. Every step that touches production is
an explicit platform-admin action.

## What ships

| Piece | Where | Effect when deployed |
| --- | --- | --- |
| Migration `0006_multistore_inventory_network.sql` | `drizzle/migrations/` | Additive tables and functions. Backfills one `dealer_groups` row per tenant. Creates no stores, mappings or sharing rules. Seeds ingestion **paused**. Adds nullable `owning_store_id` / `inventory_record_id` to `vehicle_listings` (legacy rows stay NULL) and a guard trigger. Replaces `filescom_record_event` with the same behaviour plus an enqueue step for approved feeds. |
| `files-inventory-worker` (new) | `supabase/functions/` | Drains the import queue and runs reconciliation. Only runs when scheduled or invoked with the service-role key. |
| `files-inventory-admin` (changed) | `supabase/functions/` | Adds `partition_dry_run` and `import_now`. Existing actions unchanged except binding approval also accepts a partition dry run (requires explicit group confirmation). |
| `_shared/providerBudget.ts` (changed) | shared by every MarketCheck caller | Per-VIN MarketCheck calls for store-owned vehicles must pass `store_enrichment_admit`. Legacy tenant vehicles are unaffected. Takes effect for each function only when that function is redeployed. |
| `lead-alert` (changed) | `supabase/functions/` | Keeps the group-inventory context on a lead when it stamps routing. |
| `files-inventory-notify` | unchanged | Signature verification, dedup and the 202 acknowledgement are untouched. The enqueue happens inside the SQL function it already calls. |
| Migration `0007_marketcheck_pilot_coordinator.sql` | `drizzle/migrations/` | Account-wide MarketCheck coordinator: `provider_accounts` (5,000-call pilot, 1,000 protected reserve, priority floors, optional dollar cap, rate limit), account product catalog (all rates are list-price estimates and every right is unknown until verified), reservation ledger `provider_requests`, per-VIN result states, staff-AI tool allowlist (all off). Adds `account_ref` and `required_fields` to store policies and blocks paid bulk work until the catalog is verified. |
| Migration `0008_marketcheck_bulk_feeds.sql` | `drizzle/migrations/` | Separate timing for supplier delivery, import and paid enrichment per integration; capability tables for future MarketCheck bulk feeds (contracts, schema releases, deliveries, parts, exceptions). No feed is contracted or enabled. |
| `_shared/providerBudget.ts` (changed again) | every MarketCheck caller | After the store gate and platform budget, every MarketCheck request reserves account quota through `provider_reserve` and settles through `provider_settle_event` (timeouts and 5xx settle as billing uncertain and are held from automatic retry). Tolerates only the coordinator not being installed yet. |
| `_shared/marketcheck/` (new) | shared | Deterministic least-cost bundle planner, decode-state classifier, confidence-scale detection, data-delivery-date naming, quota-header reader. |
| `_shared/marketcheckBulk/` (new) | shared | Schema-aware CSV / JSONL / Parquet adapters with streaming and resource limits, multipart completion rules, and a separate (unconfigured, fail-closed) webhook verifier for future MarketCheck delivery notices. Not wired to any endpoint. |
| Admin console | `/admin/integrations/inventory-network` | Platform admins only. |

## Order of operations

1. **Apply the migrations 0006, 0007, 0008 in order** (Lovable SQL or `drizzle-kit migrate`). Verify:
   `select ingestion_paused, emergency_stop from inventory_feed_controls;` returns `true, false`,
   and `select count(*) from dealer_groups;` equals the tenant count, and
   `select monthly_call_quota, protected_reserve from provider_accounts;` returns `5000, 1000`.
   Note: once 0007 and the redeployed MarketCheck callers are live, non-essential
   calls default to priority 4 and stop when fewer than 1,750 calls remain
   (1,000 reserve + 750 floor); essential syndication calls are priority 1.
2. **Deploy functions**: `files-inventory-admin`, `files-inventory-worker`, `lead-alert`.
   Do not redeploy `files-inventory-notify` (no change). The MarketCheck callers
   (`vehicle-enrich`, `marketcheck-*`, `enrich-sweep`, ...) pick up the store gate
   on their next deploy; until then no store-owned VIN can reach them anyway,
   because store inventory lives in `store_inventory` and only reaches
   `vehicle_listings` when a store's listing sync is switched on.
3. **Publish the frontend** (Lovable) so the console is available.
4. **Create stores** for the Harte group from verified feed identities (see below).
5. **Dry run all six feeds** with `Dry run` in the console.
6. **Map and approve** each DealerId to its store; approve each file binding.
7. **Resume ingestion** in the console and run `Import now` per approved feed.
8. **Schedule the worker** once imports look right: first run `supabase/manual/files_inventory_worker_schedule.sql` in the Supabase SQL editor (it reads Vault, so the Lovable migration tool will not apply it), then
   `select schedule_files_inventory_worker('*/10 * * * *');` (needs the Vault
   entries `supabase_url` and `service_role_key`, same as the MarketCheck sync).
   Then turn on Reconciliation in the console. To stop: `select unschedule_files_inventory_worker();`
9. Sharing, the customer browser and MarketCheck enrichment stay off until
   configured per store.

Rollback: pause or emergency-stop in the console (immediate), unschedule the
worker, redeploy the previous function versions. The migration is additive; to
fully remove it drop the new tables/functions, the two `vehicle_listings`
columns and trigger, restore the two `inventory_feed_runs` check constraints to
their 0004 form and re-run the 0004 definition of `filescom_record_event`.
0007 and 0008 are also additive: drop their tables and functions, the two
`store_enrichment_policies` columns and its bulk-guard trigger, and restore the
0006 `store_enrichment_products()`. Redeploying the previous `_shared/providerBudget.ts`
removes the account reservation from every caller.

## Platform-admin configuration still required

- Stores: create one store per rooftop with display/legal name, street, city,
  state, ZIP and subscription status. Mark the one primary inventory store.
- Mappings: for each feed partition, propose and approve DealerId -> store.
  Approval without a full identity match requires an explicit acknowledgement.
- Bindings: approve each of the six original `*_inventory.csv` paths for the
  Harte tenant. Never the copies in the quarantine folder.
- Per store: enable the feed; decide listing sync (subscribed stores only),
  whether the feed price may update listing prices (default off, because price
  changes need their own approval), legacy adoption (default off), and the
  missing-snapshot threshold. Retirement automation stays off until validated.
- Sharing: one rule per source -> destination with channels, conditions,
  priority and price/detail visibility. Default: none.
- MarketCheck: every store is Feed only until a policy names the credential,
  a verified MarketCheck rooftop id, approved products and caps.
  **Before enabling listing sync for the store that matches the tenant's
  current MarketCheck rooftop (Harte Infiniti, 150 Weston St), set its policy
  to Enrichment with the products it uses today**, or per-VIN enrichment for
  those listings will stop once they are linked to the store.
- Customer browser: enable per subscribed store only after the preview looks
  right. There is no customer-facing route yet (the passport is locked); the
  service and component are ready behind that flag.

## MarketCheck pilot: account configuration still required

- Confirm the plan: monthly call limit, whether all keys share it, and the
  dollar cap (none is set by default). Edit in the console, MarketCheck pilot.
- Verify each catalog product against the MarketCheck agreement or invoices:
  rate and billing unit, repeat-charge policy and window, whether repeats use
  quota, retention, cross-store reuse and customer display rights. Until then
  rates are list-price estimates, repeats are treated as charged, and paid
  backfills or scheduled refreshes are refused by the database.
- Confirm the quota header names and the reset format from a real response,
  and the scale of `record_confidence` (production has no stored sample:
  `mc_attributes.neovin_confidence` is empty on all 330 decoded listings).
- Staff AI / MCP tools: enable individually only if wanted. They are priority
  3 at most, must carry the person, purpose and invocation, and count against
  the same quota. Use of the MarketCheck MCP outside the app shows up as
  unattributed usage once provider headers are reconciled.
- Bulk feeds: nothing is subscribed. A contract, its evidence, storage /
  replay / sharing rights, the schema, and the provider's webhook signing
  scheme are all required before a feed can be enabled.

## Safeguards (unchanged or added)

- Webhook: HMAC-SHA256 `X-Files-Signature-V2` over raw bytes, no MD5, digest
  dedup, prompt 202. Heavy work never runs in the webhook.
- Files.com: fixed origin, redirects refused, 25 MB cap, 60 s timeout, path
  validation, metadata checked before and after download.
- Queue: one open job per file, bounded retries with exponential backoff, dead
  jobs stay visible, one processing claim per file version.
- Snapshots: per store, applied in one transaction; older or duplicate versions
  are superseded; empty, incomplete, quarantined or failed snapshots change
  nothing; only clean snapshots count absences; no hard deletes; no automatic
  retirement unless enabled per store.
- Shrink guard (0012): a clean snapshot that is missing more than
  max(5, max_snapshot_shrink_pct of the store's live cars; default 20) holds
  absence, still applies additions and updates, and writes a
  `shrink_guard_held` audit row. Confirm a genuine sell-down with
  `inv_admin_set_shrink_guard(store, pct, reason)`. Apply 0012 and redeploy
  files-inventory-worker before enabling ingestion automation.
- Completeness hold (proposed, supabase/proposed/feed_completeness_hold.sql,
  applies after 0014): a suspicious full snapshot is held whole (status
  `held`): no additions, price or listing changes, missing counters or
  baseline move. Rules: absent-vs-live (0012 percentage, floor from
  `min_absent_vehicles`, NULL keeps 6) and count-drop-vs-last-trusted
  (`max_count_drop_pct`, NULL = off). `feed_semantics` = full_snapshot or
  incremental (incremental never counts absence). Admins decide in Runs >
  Held files (apply as complete, apply without missing counts, reject; reason
  required, audited). The worker reports a dealer the file delivered before but
  omits now as `partition_missing`. Proposed thresholds for owner approval:
  min_absent_vehicles 2, max_count_drop_pct 20, keep max_snapshot_shrink_pct 20,
  feed_semantics full_snapshot for vAuto. Requires a files-inventory-worker
  redeploy and a frontend publish.
- Ownership: one live owner per VIN per group; a VIN seen at another store is a
  conflict until an admin transfers it; legacy listings are never assigned
  automatically unless the store opts in.
- MarketCheck: no call from feeds, webhooks, browsing, sharing or duplicate
  VINs; per-store gate with daily/monthly/USD caps and hard stop; every store
  decision metered by store, group, product and reason; prices are list-price
  estimates.

## Verification commands

- SQL behaviour tests (local Postgres): `PGHOST=... ./scripts/test-inventory-network-sql.sh`
- Quota race (after the SQL tests): `PGHOST=... ./scripts/test-provider-concurrency.sh`
- Unit tests: `bunx vitest run supabase/functions/_shared/filescom supabase/functions/_shared/marketcheck supabase/functions/_shared/marketcheckBulk`
