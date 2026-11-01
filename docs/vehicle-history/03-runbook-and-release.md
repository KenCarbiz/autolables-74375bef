# Runbook and release package

Nothing in this document has been done in production. Every step below needs its own approval from Ken.

## 1. Operational runbook (after an approved release)

**Pause application, keep capture.** Set `integration.apply_paused = true` at tenant (one dealer) or platform (everyone) in Vehicle records & lifecycle > Settings, with a reason. Ingest keeps writing the inbox; `integration_claim_inbox` stops leasing. Resume by setting it back (a new version). Nothing is dropped.

**Pause delivery.** `integration.delivery_paused = true`. Outbox rows stay `pending`; dispatch reports `skipped_paused`. If the pause state cannot be read, dispatch does not deliver.

**Emergency stop for lifecycle writes.** `lifecycle.emergency_hold = true` at any level. Milestones and reappearance decisions are refused with `emergency_hold`. A tenant cannot clear a platform hold.

**Unmatched or conflicting service event.** Sync activity & exceptions shows the quarantine row and reason (`service_visit_vin_conflict`, `service_only_disabled`, `unknown_vehicle`). Fix the cause (VIN correction, policy approval, mapping), then replay the specific rows. Replay is capped by `integration.replay_max_batch`, needs a reason, only touches `dead`/`unmatched` rows of that tenant, and stays idempotent because the version watermark and inbox status guard still run.

**Archived VIN reappears.** A review opens (one per tenant/VIN). Choose: restore the archived episode (only if it was archived, not delivered), start a new episode (reacquisition), wrong store mapping, reject source, or keep in review. No choice publishes, merges or deletes a listing or grants customer access. Listing reactivation stays in the existing listing workflow.

**Sale voided or delivery date wrong.** Record `sale_voided` or `delivery_corrected` (pointing at the original) with a reason. Original rows and documents remain; history is append-only.

**VIN typed wrong on a service record.** Create a correction listing the exact records; a second owner/admin applies it. Documents never move; only the listed visit/inspection/repair rows change VIN, with before/after in the audit.

**Key rotation.** Spine model: add a new key (status `active`), move the old one to `retiring` with `not_after`, confirm the producer signs with the new key, then `revoked`. Secrets live in Vault (`vault_secret_name`), never in tables, logs or payloads.

**Access revocation.** `end_relationship` stops future records at the effective time; `revoke` removes access entirely. Both apply on the next call because `vehicle_history_owner_view` evaluates grants on every read (no cached grant). Restricted files must use short-lived signed URLs from existing storage policies; nothing here creates a public URL.

**Archive restore.** No cold-storage tier exists today. Retained rows stay in Postgres; there is no restore queue to operate and none is promised.

## 2. Proposed migration order

| # | File | Depends on | Preflight | Rollback |
|---|---|---|---|---|
| 1 | `supabase/proposed/20261030000000_rooftopos_spine.sql` | `tenants`, `tenant_members`, `vehicle_listings`, Vault | No existing objects with the spine table names; `update_updated_at_column()` exists | Not merging/applying is the rollback; once applied, the spine is inert until env flag + direction flags |
| 2 | `supabase/proposed/20261109000000_vehicle_history_foundation.sql` | #1, `user_roles`, `dealer_stores` (drizzle 0006), `vehicle_files` | #1 applied; no rows in `inspection_evidence`/`repair_items` violating the new anchor CHECK (empty today) | `20261109000000_vehicle_history_foundation.rollback.sql`: platform holds on, client EXECUTE revoked, all data kept |

Drizzle journal numbering: production is at 0017 (memory). If these go through Lovable's migration tool they need the next free numbers at the time (0018+ today), checked against open branches. They must not be placed in `supabase/migrations/` before approval.

Both files ran twice on a scratch Postgres 16 loaded with the repo's full migration history, producing an identical schema (idempotent).

## 3. Staged rollout (each stage is a separate approval)

1. Apply #1 and #2 with every flag at its safe default (all new behaviour off). Verify: schema checks, RLS checks from `supabase/tests/*.sql` adapted to staging, no change in existing screens.
2. Backfill custody episodes for one tenant: `vehicle_history_backfill_tenant(tenant, true)` (dry run) and review counts, then `false`. Creates episodes from listings only; marks archived listings `archived`. No sale/delivery dates are invented.
3. Shadow pilot, one tenant (Harte INFINITI candidate): create an AutoFilm connection + key, `film_to_labels` direction on, `service.attach_enabled` on for that tenant only, `ROOFTOP_INTEGRATIONS_ENABLED=true` on the four integration functions only. Watch received/applied/unmatched/quarantine counts and lag for at least a week.
4. Enable outbound capture (`integration.outbound_capture_enabled`) and delivery to a verified consumer only after the other app has a tested receiver.
5. Legacy cutover per dealer (`autofilm-feed`, `autocurb-sync`, `dms-webhook`) only after parity is shown.

Monitoring gates before each step: zero cross-tenant reads in the RLS checks; quarantine and dead-letter counts reviewed; no growth in `unmatched` without a reason code; integration health shows Unknown (never green) where telemetry is missing.

## 4. Release checklist: exact production changes proposed

| Change | Type | Approval needed | Notes |
|---|---|---|---|
| Spine migration | DB | Ken | From PR #36, relocated to `supabase/proposed/` |
| Vehicle history migration | DB | Ken | This branch |
| `integration-ingest`, `integration-apply`, `integration-dispatch`, `integration-health` | Edge deploy | Ken | Dormant without the env flag; not on the deploy hold list, but never deployed |
| `ROOFTOP_INTEGRATIONS_ENABLED` env | Config | Ken | Per environment |
| Cron for apply/dispatch | Job | Ken | None exists; do not add without approval |
| Frontend: Vehicle records & lifecycle admin screen | Publish | Ken (per thread brief) | Renders "Not installed" until the migration is applied |
| Settings marked `awaiting_approval` | Policy | Ken | Service attach, service-only vehicles, outbound capture, replay cap, prior-owner transaction access |

Held and untouched by this branch: `vehicle-enrich`, `public-listing-view`, `marketcheck-recalls`, `marketcheck-specs` (deploy hold); MarketCheck pause and pilot quota; crawler pause; Stage 2 (PR #42); duplicate reconciliation (detection only, no purge); the Harte Subaru 013354 reactivation and the pending QX80 decision; `/platform-admin` (scored screen 34); the customer Passport layout. No paid provider call exists on any new path.

## 5. Verification record (local only)

| Layer | What ran | Result |
|---|---|---|
| Build time | `bunx tsc -p tsconfig.app.json --noEmit`, `bun run build` | See PR description |
| Unit | `bunx vitest run supabase/functions/_shared/integrations` | 88 passed |
| Scratch database | `supabase/tests/rooftopos_harness.sh` (Postgres 16, real migration history, spine + foundation applied twice, RLS/apply/scenario SQL, Deno HTTP + concurrency, rollback) | All pass: spine RLS 10, spine apply 10, vehicle history 28 scenario checks, Deno 26 |
| Runtime against Supabase | Not run | Not verified |
| Live production | Not run | Not verified |
