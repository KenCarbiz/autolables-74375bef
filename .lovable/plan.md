# RooftopOS bidirectional adapters — audit and implementation plan

Read-only step. Nothing has been edited, migrated, deployed or called. Commit audited: `24fdaac0`.

## 1. What already exists (source evidence)

| Area | Status | Where |
|---|---|---|
| Vehicle rows | Inventory-keyed: `vehicle_listings` unique on `(tenant_id, vin)`. VIN is acting as an inventory key, not a global identity | `vehicle_listings`, `autocurb-sync` upsert |
| Duplicate/alias handling | Exists (aliases, dedupe batches/previews/operations) | `drizzle/migrations/0014_inventory_duplicate_reconciliation.sql:304` |
| Lifecycle | 22-state machine per listing, `UNIQUE(tenant_id, vehicle_id)` — one lifecycle per listing, no episodes | `supabase/migrations/20260726220000_vehicle_lifecycle_foundation.sql:29` |
| Provenance | `vehicle_source_records`, `vehicle_facts`, `vehicle_fact_conflicts`, `vehicle_ingest_ledger`, `factAuthority` precedence | `20260727120000_vehicle_truth_layer.sql:72`, `20260729010000_vehicle_ingest_ledger.sql:28`, `_shared/factorySticker/lib/vehicleTruth/precedence.ts` |
| Per-store snapshots | Transactional apply with shrink guard and completeness hold | `inventory_apply_store_snapshot` (0012, 0016) |
| Change history | `vehicle_change_history`, `vehicle_value_history`, `vehicle_work_events` | `20260705000000_prep_work_events.sql:6` |
| AutoCurb inbound | Signed HMAC vehicle push to draft listing; no revision, no dedupe key, no appraisal/acquisition type | `supabase/functions/autocurb-sync/index.ts` |
| AutoCurb outbound | One-shot dealer notify (HMAC) | `supabase/functions/notify-autocurb` |
| AutoFilm outbound | Pull-only list/detail feed, shared secret, `detail_version` content hash, cursor paging | `supabase/functions/autofilm-feed/index.ts` |
| AutoFilm inbound | None — no receiver for inspections, measurements or service completion | — |
| AutoFrame | None — no photo metadata contract | — |
| Trade-ins | `trade_in_records` (tenant-scoped) | `20260419030000_leads_and_trade_ins.sql:73` |
| Outbox / inbox / event envelope | None | — |
| Episodes across sales | None — a resold VIN reuses or collides with the same listing row | — |
| Store registry | Only proposed, not applied | `supabase/proposed/20261108000000_canonical_store_registry.sql` |
| Fail-closed provider budget | Only proposed | `supabase/proposed/20261106000000_provider_budget_fail_closed.sql` |
| RooftopOS spine PR#36, lifecycle PR#46 | Not mirrored here. No branch or commit found; must be reviewed on GitHub before step 2 | — |

Not verified: deployed versions of `autocurb-sync` and `autofilm-feed`; live row counts; whether Passport 2.0 read models (isolated in `src/lib/intelligence/*`) are planned to consume projections.

## 2. Target design (minimum)

```text
global_vehicles (vin PK-like, immutable)
   └─ vehicle_episodes (vehicle, tenant, rooftop/store, opened_at, closed_at, close_reason)
        └─ vehicle_listings.episode_id  (inventory row stays as is)
outbox_events ──bounded dispatcher──> partner (staging no-op during pilot)
partner ──signed POST──> inbox_events ──bounded projector──> projections
```

**Envelope (one type, versioned)**
`event_id uuid, schema "rooftop.v1", type, source_app, tenant_id, store_id, vin, episode_id, source_revision bigint, occurred_at, emitted_at, idempotency_key, payload (typed per type, no customer PII), payload_sha256`.

**Outbound types**: `inventory.upserted`, `price.changed` (fee-inclusive totals from existing `buildPassportSaleCard` arithmetic, never recomputed), `status.changed`, `passport.published` (slug + identity only).
**Inbound types**: `autofilm.inspection_verified`, `autofilm.service_completed`, `autocurb.appraisal_recorded`, `autocurb.acquisition_recorded`, `autoframe.photo_approved` (metadata + URL, no binary).

**Rules**
- VIN anchors `global_vehicles`; inventory stays keyed per episode. Sold/closed episodes and their Passport slugs are kept read-only; service updates after sale attach to the vehicle and the closed episode, never reopen inventory.
- Monotonic `source_revision` per (source_app, tenant, vin): older or equal revisions are recorded as `stale` and not projected.
- Cross-target order: lifecycle transitions validated against the existing 22-state machine plus an episode rule (no `acquisition` after a newer `sold` without opening a new episode).
- Dedupe: unique `(source_app, idempotency_key)` on inbox; unique `(event_id)` on outbox.
- Auth fail-closed: per-partner HMAC-SHA256 over raw body + timestamp (5-min window), key id header, tenant derived only from an admin-approved partner-tenant binding (same pattern as Files.com), never from the body. Missing secret, binding or switch → 401/503 with no write.
- Switches default off: per partner, per direction, per tenant. Dispatcher has a `staging_noop` mode that marks events "would_send" without network.
- No production provider calls (MarketCheck cap stays 0); adapters never trigger enrichment.

## 3. Implementation tasks (each needs separate approval)

1. Review PR#36/#46 on GitHub; reconcile naming with this design. Dependency for all below.
2. Migration A (additive): `global_vehicles`, `vehicle_episodes`, nullable `vehicle_listings.episode_id`, backfill function (dry-run first, report-only).
3. Migration B: `rooftop_partner_bindings`, `rooftop_adapter_switches`, `outbox_events`, `inbox_events`, `inbox_dead_letters`; RLS per CLAUDE.md pattern; service_role-only writes.
4. Shared `_shared/rooftop/envelope.ts`: zod schemas, canonical JSON, HMAC sign/verify, revision comparator. Pure, unit-tested.
5. Outbox producers: SQL triggers on listing price/status/publish that insert envelopes only when the tenant switch is on.
6. `rooftop-dispatch` edge function: claims ≤N rows with `FOR UPDATE SKIP LOCKED`, exponential backoff, max attempts → dead letter; staging no-op default.
7. `rooftop-inbox` edge function: verify, bind tenant, dedupe, store; returns 202. No projection inline.
8. `rooftop-project` function: bounded batches into evidence tables (inspection measurements → `vehicle_facts` with provenance; appraisals → `trade_in_records`; photos → metadata table). Passport reads only verified projections.
9. Reconcile job: compare outbox high-water revision vs partner ack; report drift, no auto-fix.
10. Platform-admin UI: switches, queue depth, dead letters, replay one event, monthly cost estimate.
11. Retrofit `autocurb-sync` and `autofilm-feed` behind the envelope later; keep current contracts until partners migrate.

## 4. Tests and benchmarks

- Unit: signature (valid, tampered, expired, wrong key id), revision ordering, dedupe, envelope PII denylist, episode rules (resold VIN keeps old Passport).
- SQL (`supabase/tests/rooftop/*`): RLS cross-tenant denial, switch-off writes nothing, stale revision ignored, replay idempotent.
- Integration in staging no-op: 10k events dispatched with zero network calls.
- Benchmarks: inbox accept p95 < 150 ms; projector ≥ 500 events/min per worker; claim query uses index only at 1M rows; queue backpressure stops claims above configured depth.

## 5. Cost and control notes

- Bounded batch size and cron cadence cap function invocations; switches off means zero cost.
- No paid provider calls anywhere in the adapter path.
- Rollout: sandbox acceptance → one tenant, inbound only → outbound staging no-op → live outbound, each with owner sign-off.
