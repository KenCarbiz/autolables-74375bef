# Contracts, controls and permissions

## 1. Envelope versions

| Version | Status | Difference |
|---|---|---|
| 1.0.0 | PR #36 spine | Baseline: `event_id`, `event_type`, `producer`, `source_record_id`, `source_version`, `idempotency_key`, `correlation_id`, `causation_id`, `occurred_at`, `observed_at`, `sent_at`, `vin`, `tenant_ref` (never trusted for authorization), `instance_ref`, `visibility`, `evidence_refs`, `payload_checksum`, `payload`. |
| 1.1.0 | This branch | Adds optional `service_visit_ref: {app, id}`. A 1.0.x envelope carrying it is rejected as `unknown_field:service_visit_ref`. `instance_ref` may be `null` with a visit ref (sold car). |

Code: `supabase/functions/_shared/integrations/envelope.ts` (`supportsServiceVisitRef`, `downgradeToV10`). Tests: `envelopeV11.test.ts`.

Outbound compatibility: `integration-dispatch` sends `downgradeToV10(envelope)` to every `rooftop.v1` connection, because no consumer has declared 1.1 support. AutoFilm connections receive AutoFilm's own `{event, event_id, schema_version:"1", tenant_id, data}` shape, which never carried visit refs.

Signing is unchanged from the spine: `X-Rooftop-Key-Id`, `X-Rooftop-Timestamp`, `X-Rooftop-Signature` = HMAC-SHA256 over a domain-separated canonical input of timestamp, key id and raw body (`signing.ts`), 5-minute window, constant-time compare, tenant from the key's connection. `tenant_ref` never selects the tenant; when the connection is bound to an external rooftop, a body naming a different rooftop is rejected with 403 `tenant_ref_mismatch` (added on this branch, `ingestDecision.ts`; the AutoFilm adapter already rejected `rooftop_mismatch`).

## 2. Event families

| Producer | Event | Scope | Effect in AutoLabels | Status |
|---|---|---|---|---|
| AutoLabels | `vehicle.sold`, `vehicle.delivered`, `vehicle.sale_voided`, `vehicle.archived` | vehicle:read | Written to `integration_outbox` in the same transaction as the custody milestone, only when `integration.outbound_capture_enabled` is on | Implemented locally; no consumer verified |
| AutoLabels | `vehicle.listed/updated/price_changed`, `passport.published/revoked`, `market.handoff` | vehicle/passport/market:read | Catalogued; no writer yet | Not implemented |
| AutoFilm | `inspection.completed/corrected/revoked` | inspection:write | `inspection_evidence` upsert anchored to VIN + visit or episode | Implemented locally (AutoLabels side only) |
| AutoFilm | `repair.recommended/approved/declined/completed/completed_verified/corrected`, `repair_order.decisions_submitted` | repair:write | `repair_items` upsert + status history; verified completion needs evidence ref | Implemented locally (AutoLabels side only) |
| AutoFilm | `video.published/revoked`, `finding.*` | video/inspection:write | Accepted and recorded, no domain effect | Recorded only |
| AutoCurb | `acquisition.*`, `appraisal.*`, `trade.captured`, `valuation.updated`, `inspection.requested` | various | Recorded in the inbox; `acquisition_records` is service-role only | No domain effect yet |
| AutoFrame | none | - | - | Not implemented; no contract version exists |

## 3. Producer/consumer compatibility matrix

| Pair | AutoLabels side | Other side | End-to-end |
|---|---|---|---|
| AutoFilm -> AutoLabels (MPI, repairs) | Receiving path passes local tests, incl. sold -> delivered -> MPI through the real adapter (`supabase/tests/deno/sold_then_mpi.test.ts`) | AutoFilm repo not available in this session: unverified | Not verified |
| AutoLabels -> AutoFilm (custody events) | Outbox + dispatch implemented; AF shape renderer from the spine | Not available | Not verified |
| AutoCurb <-> AutoLabels | Inbox accepts and records; `autocurb-sync` hardened (signed mode, archived hold) and passes local HTTP tests | AutoCurb repo (`hartecash-2edb8fec`) has no caller of `autocurb-sync` and no receiver for AutoLabels events: unimplemented | Not verified |
| AutoFrame | None | None | Not started |

Do not describe any of these as live. A passing local test proves the AutoLabels half only.

Fixtures: `supabase/functions/_shared/integrations/__fixtures__/*.json` (spine), synthetic scenario rows in `supabase/tests/vehicle_history_sql.sql`, and the admin screen fixture (`Synthetic Demo Motors`).

## 4. Setting -> server consumer matrix

Every setting is read through `vehicle_history_effective_setting(tenant, store, key)` at the point of effect. For `all_true` keys the platform level counts as its safe default when it has no row, so a dealer cannot enable a policy the platform has not. Writes go only through `vehicle_history_set_setting` (role check, type and bounds check, parent-cap check, expected-version check under an advisory lock, append-only version row, audit row). A revert is a new version.

| Key | Type / combine | Scopes | Safe default | Server consumer | Policy |
|---|---|---|---|---|---|
| `lifecycle.emergency_hold` | bool, any level true wins | platform, tenant, store | false | `vehicle_history_record_milestone`, `vehicle_history_resolve_reappearance` refuse with `emergency_hold` | approved default |
| `service.attach_enabled` | bool, all levels must agree | platform, tenant, store* | false | `integration_apply_event`: visit path; off = in-stock cars keep 1.0 behaviour, no-stock events are held (not dropped) | awaiting approval |
| `service.allow_service_only_vehicle` | bool, all agree | platform, tenant | false | `integration_apply_event`: VIN unknown to this dealer is quarantined unless on; when on, only from an active connection with a full VIN and an RO number (else `service_only_unverified`) | awaiting approval |
| `integration.apply_paused` | bool, any true wins | platform, tenant | false | `integration_claim_inbox` stops leasing; ingest keeps capturing | approved default |
| `integration.delivery_paused` | bool, any true wins | platform, tenant | false | `integration-dispatch` via `integration_delivery_allowed`; unreadable state = do not deliver | approved default |
| `integration.outbound_capture_enabled` | bool, all agree | platform, tenant | false | `vehicle_history_record_milestone` outbox write | awaiting approval |
| `integration.replay_max_batch` | int, minimum wins, 1-500 | platform, tenant | 25 | `integration_replay_inbox` refuses larger batches; a tenant cannot set above the platform value | awaiting approval |
| `access.prior_owner_keeps_transaction_records` | bool, all agree | platform, tenant | false | `vehicle_history_can_read` / `vehicle_history_owner_view`: own episode only, and only while `transaction_access_until` is set and in the future | awaiting approval |

\* `service.attach_enabled` is evaluated at tenant scope by the apply function today because inbound events do not carry a store; a store row is stored and audited but not yet consumed. The admin screen states this.

Controls in the brief that are **not implemented** (shown as unavailable in the admin screen, never as saved switches): retention periods and legal holds, cold-storage restore, cross-tenant transfer approval, publication queue for MPI evidence, rating policy proposals, export authorization, alert acknowledgement/snooze.

## 5. Permissions and visibility

| Actor | Vehicle history tables | Grants / corrections / audit | Settings | Milestones, reviews, replay | Owner view |
|---|---|---|---|---|---|
| Platform admin (`user_roles.role='admin'`) | Via service tooling only | Via service tooling | Platform scope + any tenant | Backfill (dry run default), replay | No |
| Dealer owner/admin (accepted) | Own tenant (RLS) | Own tenant | Tenant and own stores, never above platform caps | Own tenant | No |
| Dealer staff (other roles) | Own tenant, read only | None | Read effective values | Refused | No |
| Integration principal | None directly; inbox through signed ingest | None | None | None | No |
| Verified customer (grant holder) | None directly | None | None | None | Only records their grant permits, inside its time window, re-evaluated on every call |
| Anonymous / public Passport | None | None | None | None | No (EXECUTE revoked) |

Never returned to a customer: acquisition cost, appraisal, other customers, messages, contracts, signatures, private documents. `vehicle_history_owner_view` returns visit/inspection/repair summaries and, for `transaction_records`, only the grant's own episode milestones.

VIN, stock number and QR knowledge do not authenticate anything in this model: the owner view requires a signed-in user with a grant row.
