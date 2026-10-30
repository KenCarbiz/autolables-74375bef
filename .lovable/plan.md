# Files.com inventory connection: findings and phase-1 plan

Read-only investigation at repo HEAD `d142de44`. No edits, deploys, invocations, provider calls or secret changes.

## What exists today
- **No Files.com connector.** No code in `src/` or `supabase/functions/` mentions files.com, and no Files.com secret is set.
- **No CSV importer on the server.** `src/components/saturday/InventoryIngestion.ts` lists `"csv"` as a source type, and line 313 is a TODO: "Wire CSV upload/import rows into ingestInventoryVehicles()". It runs in the browser only.
- **`supabase/functions/dms-webhook`** accepts JSON only. It checks one HMAC per provider (`DMS_SECRET_VAUTO` and so on) and then trusts the `X-Dms-Tenant` header. Anyone holding the vAuto secret can write to any tenant, so the header comment's isolation claim is false. No `DMS_SECRET_*` is set, so today the endpoint returns 500. Do not reuse it.
- **Run ledger.** `inventory_sync_runs` (tenant_id, source, status, seen, new_vehicles, updated_vehicles, removed, raw...) and `inventory_sync_errors` are shared with `marketcheck-sync`. The other ledgers are `vehicle_source_records` (source_kind, payload_checksum) and `vehicle_ingest_ledger`.
- **Sold handling.** `marketcheck-sync` retires a VIN instead of deleting it, using a per-segment gate (around index.ts:1172 and 1682-1748). A missing VIN goes to an exception queue as "not marked sold". There is no source-owned sold rule for file feeds.
- **Admin screens.** `src/pages/admin/views/integrations/InventoryFeedView.tsx` and `FeedSettingsCard.tsx`, `src/pages/InventorySyncCenter.tsx`, `src/pages/SourceAuthoritySettings.tsx`, plus the `source_authority_rules` table. Nothing maps external files to dealers.
- **Tenant table.** `tenants` has no external-feed identifier column, so the `MP#####` codes map to nothing today.

## Phase 1: smallest safe version (dry run only, no inventory writes)
1. **Mapping table `inventory_feed_bindings`.** Columns: provider = 'filescom', exact path such as `/prod/inventory/vauto/inbound/MP15395_inventory.csv`, tenant_id, status (pending/approved/disabled), approved_by, approved_at. Only platform admins can write it (RLS uses the wrapped `(SELECT auth.uid())` pattern plus a check on the admin role). A file with no approved binding is quarantined. Filenames alone never decide the dealer.
2. **Queue table `inventory_feed_files`.** Holds path, Files.com file id, size, mtime, sha256 of the content and status (received/validating/validated/rejected). It has a unique key on (provider, path, sha256) for idempotency, and the notification event id is stored once so replays are dropped.
3. **Edge function `files-inventory-notify`**, with JWT verification off. It runs these checks:
   - Constant-time comparison of a shared secret sent in a custom header.
   - Timestamp window check, with rejection of event ids already seen.
   - Path must sit under the allowed prefix.
   - Adds the file to the queue and returns 202.

   It does not fetch the file or write inventory.
4. **Edge function `files-inventory-validate`**, triggered by an admin or a cron call with `CRON_SHARED_SECRET`:
   - Downloads the file through the Files.com REST API with a read-only key.
   - Checks the hash and parses the CSV.
   - Validates the headers, VINs, duplicates and price fields.
   - Writes only a dry-run report: counts plus would-insert, would-update and would-retire against the bound tenant's `vehicle_listings`, stored in `inventory_sync_runs` with source 'filescom' and status 'dry_run'.

   It makes no MarketCheck calls, writes nothing to `vehicle_listings`, and does not change the price fields used by the Passport.
5. **Admin screen.** A "Files.com feeds" panel under Integrations lists the files found, offers approve/disable for each binding, and shows the dry-run report.
6. **Tests.** Cover rejection of a bad or replayed signature, quarantine of unbound files, idempotency, and confirm that the dry run makes zero writes to `vehicle_listings`.

Deferred to phase 2, each needing its own approval: real upserts, source-owned sold or retire rules, inventory sharing between stores with separate MarketCheck permission, and any cron changes.

## Secret names needed (you add the values)
- `FILESCOM_API_KEY`: a Files.com API key for a user restricted to read-only access on `/prod/inventory/vauto/inbound`.
- `FILESCOM_WEBHOOK_SECRET`: a random value you create. Set the same value as a custom header on the Files.com webhook.
- `FILESCOM_SITE_URL` = `https://autocurb.files.com` (not sensitive, so it can also be config).
- `CRON_SHARED_SECRET`: already set, and reused for the validate trigger.

## Callback URL
`<backend functions base>/functions/v1/files-inventory-notify`, the same base used by the existing `dms-webhook`. Configure it as a Files.com webhook behavior on `/prod/inventory/vauto/inbound` for upload/update events. I can give the exact URL once the function is deployed.

## Unverified
- Whether Files.com webhooks can sign the request body. If they cannot, the custom-header secret plus replay checks are the fallback.
- What the vAuto CSV columns are, since no sample file was read.
- How each MP code maps to a dealer. This needs your explicit approval for each file.
