# Admin V3 Verification Register

Scope: the eight catalog items marked "verify" (D04, R11, X10, X17, W07, I08, I27, I28) plus gaps found while tracing writers.
Method: static read of the repo only. No git state changes, no network, no Supabase, MarketCheck or deploy. No live DB check was possible, so "applied status" of any migration is unknown.

Caveats
- `supabase/migrations/20261029001000_admin_v2_settings_authority.sql` is "prepared; apply only on authorization". Whether it is live is unknown.
- `supabase/migrations/20261031130000_passport_payment_estimator.sql` is headed "Prepared, not applied". Live status unknown.
- `src/lib/admin/categories.ts` is untracked work by another engineer; `sections.ts`, `AdminShell.tsx`, `AdminV2.tsx`, `tailwind.config.ts` are in flux and were not touched.
- The multistore/network schema lives in `drizzle/migrations/0006+`, not `supabase/migrations`. Applied status unknown.
- "Not found" means a grep of `src/`, `supabase/functions/` and `supabase/migrations/` returned nothing.

Disposition vocabulary
- Supported: an existing editor persists the setting end to end (location named).
- Partially supported: some inputs persist or only read-only visibility exists.
- Unavailable: no persistence at all.
- Blocked: needs a schema or server change (named).

## 1. Summary table

| Id | Item | Disposition | Where / blocker |
|---|---|---|---|
| D04 | Holiday hours | Unavailable (Blocked: schema + routing resolver) | No holiday/exception persistence anywhere |
| R11 | CPO program editor | Partially supported | `OemWarrantyPanel.tsx`; no verification/source fields |
| X10 | Email/message template preview vs test send | Unavailable (Blocked: template store + render-only preview endpoint) | No stored templates |
| X17 | Payment estimator inputs | Partially supported | Per-store editor; migration prepared, applied unknown |
| W07 | Inspection signer grants | Supported, outside Admin sections | `/service/settings`, key `k208_authorized_users` |
| I08 | Feed schedule vs enrichment cadence | Partially supported (split) | MarketCheck editable; Files.com manual SQL; enrichment record-only |
| I27 | Job families | Partially supported (read-only) | 13 catalog entries vs 22 crons + 3 ledgers |
| I28 | Webhook config/diagnostics | Partially supported | Diagnostics read-only; config is env/secret |

## 2. Item detail

### D04 Holiday hours - Unavailable
- Hours are `dealer_hours` free text (`supabase/functions/public-listing-view/index.ts:284`).
- Routing hours are `businessHours: WorkingHoursBlock[]` with `dayOfWeek`, `startTime`, `endTime` (`supabase/functions/_shared/passport-routing.ts:26-30,114`); agents have `workingHours` plus `manualOverride`.
- No date-keyed, holiday or special-hours field in any of these. `grep -i holiday` hits only sticker template copy and the `categories.ts:434` note.
- Blocked on: a schema addition (date exceptions per tenant/store) and resolver support in `passport-routing.ts`. A free-text note in `dealer_hours` is the only workaround today and is not machine-read by routing.

### R11 CPO program editor - Partially supported
- Editor: `OemWarrantyPanel.tsx:197-276`; save at `:66` into settings key `cpo_programs` (server class: addon).
- Schema `CpoProgram` (`src/lib/oemWarranty.ts:39-60`): id, name, kind (oem|dealer), brand, enabled, basic/powertrain months and miles, coverage_from (in_service|purchase), deductible, transferable, max_age_years, max_mileage, inspection_points, benefits, disclosure, show_on_passport. `UNLIMITED_MILES = -1` sentinel.
- Matching: `matchCpoPrograms` (`oemWarranty.ts:136-147`) matches oem programs by brand substring (length > 1) and applies dealer programs to any make; `public-listing-view/index.ts:414-425` repeats this for `cond==="cpo"`.
- Gap: no verified / source / actor / date evidence on `CpoProgram`. `OemFactoryWarranty` has `verified`, `verified_at`, `verified_by` (`OemWarrantyPanel.tsx:88-94`).
- `dealer_cpo_programs` table exists with no code use (dormant).
- Needed for full support: add verification fields to the `CpoProgram` JSON shape (no schema change; it is a JSON value) and a UI for them.

### X10 Email/message template preview vs test send - Unavailable
- No stored email or message template and no preview capability found.
- `send-email` takes caller-supplied `to`, `subject`, `html` (`supabase/functions/send-email/index.ts:43`).
- Only test send found: platform-only `ProviderBudgetsPanel.tsx:150` ("Send a test", via `provider-budget-alerts`).
- `RoutingPreview.tsx` previews the routing outcome, not message content.
- Blocked on: a template store (table or settings key) and a render-only preview endpoint that does not send.

### X17 Payment estimator inputs - Partially supported
- Store: `passport_payment_estimator_settings` plus `_versions`, RPC `apply_payment_estimator_settings` (`supabase/migrations/20261031130000_passport_payment_estimator.sql`; also `drizzle/migrations/0009`). Per (tenant, store).
- Config: down payment (amount or percent), enabled terms with per-term APR, default term, model-year rule ranges. Validated by `payment_estimator_config_errors`; compare-and-swap versioning; audited. Apply roles: owner, admin, general_manager, gsm.
- UI: `PaymentEstimatorAl97Page`, `PaymentAssumptionsPage`, `paymentEstimator/data.ts:170` (shows "pending migration" when the table is missing).
- Public read: `public-listing-view/index.ts:185`.
- Adjacent/legacy inputs: `financing_disclosure_apr` (no writer; read at `Index.tsx:1821`), `passport_payment_display` (no writer; `passportV2Data.ts:600` says toggles no longer hide values), `todays_price_custom`.
- Uncertain: whether the migration is applied.

### W07 Inspection signer grants - Supported (existing editor), not in Admin sections
- Per-user grants: settings key `k208_authorized_users`, edited at `ServiceSettings.tsx:186` (route `/service/settings`, `App.tsx:446`; capability `can_manage_service_settings`). Roles: `k208_authority_roles`, list `AUTHORITY_ROLES` at `ServiceSettings.tsx:24-30`.
- Server enforcement `k208_signer_allowed` (`20260726105000_k208_execution_authority.sql`): platform admin always allowed; signer must be an accepted member; user list OR role list; compat rule: if neither list is configured, manager-level roles are allowed.
- `certify_safety_inspection` requires `auth.uid()`; no anonymous K-208 signing. `can_execute_k208` is deliberately granted to no role (`dealerRoleCapabilities.ts:94`).
- Keys are in the service key class (audited). V2 `ServicePolicyView` has no per-user grant UI, only link text at `:134`; the same K-208 keys are also written by `ServiceSettings.tsx:55` (duplicate writer, see traceability section 5).
- `/install/:token` (`App.tsx:287`, installer proof) is a different anonymous flow, not a signer grant.

### I08 Feed schedule vs enrichment cadence - Partially supported (split)
- MarketCheck sync: editable per tenant (enabled, source, cap, frequency nightly|weekly|biweekly|monthly, day_of_week, run_hour) via `save_marketcheck_config` -> `marketcheck_sync_config` (`FeedSettingsCard.tsx`, `queries.ts:386`). Gate: platform admin or tenant owner/admin. Cron `marketcheck-sync` runs hourly and each tenant fires at its run_hour (`marketcheck-sync/index.ts:67`).
- Files.com import worker: schedule is manual only (`supabase/manual/files_inventory_worker_schedule.sql`). `WorkerSetupPage.tsx` keeps controls disabled (`WORKER_APPROVAL_REASON`).
- `integration_timing` (RPC `inv_admin_save_timing`, `drizzle/0008:311`; `DeliveriesSection.tsx:112`, platform admin) stores delivery, import, reconciliation, enrichment cron/mode. Nothing in `supabase/functions` or crons reads `import_cron`, `reconciliation_cron`, `enrichment_cron` (only the lateness check in 0008 ~line 295 and the UI). Treat as recorded expectations, not schedulers.
- A guard trigger blocks paid enrichment without a verified catalog and blocks enrichment for filescom.
- Enrichment cron `enrich-sweep-nightly` is paused (`20261027204000_pause_enrich_sweep_nightly.sql`) and not editable in UI.
- Design implication: show feed schedule as editable only for MarketCheck; present Files.com and enrichment cadence as read-only/platform-managed.

### I27 Job families - Partially supported (read-only)
- `admin_job_status` (`20261029000000_admin_v2_policy_apply.sql:452-`) reads 22 cron names plus 3 tenant ledger rows: `inventory_sync`, `price_crawl`, `description_pipeline`.
- `JOB_CATALOG` (`src/lib/admin/integrations/jobs.ts:23-36`) has 13 entries: inventory_sync, price_crawl, enrich_sweep, recall_refresh, description_reconcile, lead_escalation, incentives, specs_backfill, factory_sticker, title_reminders, price_drop, passport_delivery, get_ready.
- 10 cron names are not in the catalog: ingest-orchestrate-sweep, intake-draft-sweep, getready-install-safety-net, epa-fuel-economy-sweep, carfax-link-sweep, equipment-proof-sweep, oem-document-copy-sweep, packet-backfill, compliance-forms-sweep, ct-compliance-digests.
- Other families outside cron: inventory network (`inventory_feed_jobs`, `inventory_feed_runs`, `inventory_feed_events`, bulk deliveries/exceptions, dedupe operations) and description jobs.
- Views: `JobsView`, `JobsPipelinesPage`, `JobDetailPage`. No job editing exists.

### I28 Webhook config/diagnostics - Partially supported
- Receivers: `files-inventory-notify` (env `FILESCOM_WEBHOOK_SECRET`, signature V2, dedup on body digest, records an event, never downloads or touches inventory), `dms-webhook`, `signalhouse-webhook`, `stripe-webhook`.
- Diagnostics (read-only): `lib/platformConsole/live/connections.ts:145-149,213` ("Receiving / No events" from `inventory_feed_events`), `ConnectionsBillingPage`, RPC `inv_admin_delivery_timeline` (`api.ts:533`), `InventoryFeedJob.trigger: "webhook"|...` with `run_id` (`api.ts:66-71`), `JobDetail.tsx`, `BillingHandshakeDiagnostic`.
- Only editable item: `bulk_feed_contracts.webhook_secret_ref` (a secret name; input `DeliveriesSection.tsx:184`, RPC `inv_admin_save_bulk_contract`, platform admin).
- Not found: endpoint URL/secret editor, replay or test UI (RPC `bulk_feed_request_replay` exists in 0008 without UI), per-delivery signature-failure log (function only `console.log`s `authLog`).

## 3. Discovered gaps

| Id | Severity | Finding | Blocking change |
|---|---|---|---|
| G1 | High | `invite_tenant_member` and `remove_tenant_member` insert no `audit_log` row (`20260630000000_job_roles.sql:64-80`); only `set_tenant_member_role` audits (`20260726191000:48`). `InvitationsView.tsx:90` says invitations are not in the ledger. RPC sends no email (access starts at sign-in). | Add audit inserts in RPCs |
| G2 | High | Grant drift: `20260627175334_7c96133c-...sql:79` and nearby REVOKE EXECUTE from authenticated on `save_marketcheck_config`, `admin_set_tenant_features`, `get_cron_job_status`, `admin_*`. No later GRANT found, yet the front end calls them with user sessions. Live state unverifiable. | Verify live grants before relying on these editors |
| G3 | High | `feature_*` entitlement flags (incl. `feature_price_verification`) are in the unprotected key class: any settings role (owner, admin, general_manager, gsm, manager) can write them via `merge_dealer_settings`. | Add an entitlement key class in the authority migration |
| G4 | Medium | Calibration: `dealer_print_settings` `UNIQUE (tenant_id, location_id)` with NULL `location_id` does not conflict under default NULL semantics, so duplicate rows are possible (read uses `.is("location_id", null).maybeSingle()`, `useDealerPrintSettings.ts:28-29`). Two safe-margin column families exist (`top_safe_margin_inches`/`left_safe_margin_inches` in `20260620070000_print_settings_calibration.sql` vs `safe_margin_top/right/bottom/left_inches` in `20260620232625_...sql`); UI writes the first. Every save overwrites `window_label_size`/`addendum_label_size` with constants "8.5x11"/"4.5x11" (`useDealerPrintSettings.ts:53-56`). No "calibration verified"/"test sheet printed" persistence; `readiness.ts:58` returns `testedAt: null` and uses row existence/`updated_at` as proxy. RLS FOR ALL for any tenant member. | Unique index with NULLS NOT DISTINCT, drop one margin family, add verified columns |
| G5 | Medium | `passport_delivery_settings` has no UI writer (`savePassportDeliverySettings` has no caller) and a SELECT policy `USING (true)` for authenticated (`20260622141144:245`; recreated in `20260622160526:34`, content not re-read). | Decide owner; tighten policy |
| G6 | Low | `dealer_automation_settings` (`AutomationRulesPanel.tsx:95`) has no importer; its approval vocabulary overlaps `document_rules`. | Retire or merge |
| G7 | Low | Eight dormant shadow tables with no code use (listed in the analysis; `dealer_cpo_programs` is one). | Confirm and drop or adopt |
| G8 | Medium | `save_description_settings` is a full-row upsert; a partial payload would blank columns. Voice profile has versioning and approval; `description_settings` has neither. | Make patch-style or add versioning |
| G9 | Medium | Proposed policy-B SQL would make `merge_dealer_settings` refuse `doc_fee_*`; `advertised_includes_doc_fee` has no writer. | Apply policy B, add writer |
| G10 | Medium | `PlatformTenants.tsx:622-627` writes `dealer_profiles.settings` directly (read-modify-write), bypassing `merge_dealer_settings` and its key-class gate. | Route through RPC |
| G11 | Medium | `email_recipients`, `installer_contacts`, `get_ready_invoices`, `dealer_print_settings` are RLS-gated only by tenant membership, no role check. | Add role checks |
| G12 | Low | Write policy for `tenant_incentive_settings` not found; only a public read policy seen. | Locate or add policy |
| G13 | Low | `feature_spanish_buyers_guide`, `feature_multilang_buyers_guide`, `feature_inventory`, `feature_analytics`, `feature_marketcheck_sync`, `feature_payroll` have no consumer found by name. | Confirm before retiring |
| G14 | Medium | Network schema lives in `drizzle/migrations/0006+`; `inv_admin_*` RPCs are platform-admin only (`inv_require_platform_admin`); applied status unknown. | Verify live schema |

## 4. Open uncertainties
- Applied status of the settings-authority, payment-estimator, doc-fee policy B, pricing-delegation and store-registry SQL (the last three are in `supabase/proposed/`, unapplied by definition).
- Which of `description_settings` and the voice profile the generator prefers when they disagree.
- Policy text of `20260622160526` (G5).
- Everything above is static analysis; no live data was queried.
