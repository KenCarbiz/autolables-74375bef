# rtgip/2 — RooftopOS Gateway Interoperability Protocol, version 2

**Status: specification + parked reference implementation. Transport is hard OFF. Nothing here is deployed, migrated or connected.**
The same spec, core code (`protocol.ts`, `delivery.ts`, `produce.ts`, `harness.ts`, `fixtures.ts`), proposed SQL and corpus are kept byte-identical in AutoLabels (`src/lib/rooftopos-parked/rtgip2/`), AutoCurb (`src/lib/rooftopos/rtgip2/`) and AutoFrame (`showroom-photo-polish`, `src/lib/af/rtgip2/`).

## 1. Why a new version

Four HMAC formats exist today and two share the `v1=` prefix while signing different bytes:

| Dialect id | Where | Preimage | Status in rtgip/2 |
|---|---|---|---|
| `autolabels.rooftopos/1` | AutoLabels PR #46 `signing.ts` | `rooftopos.v1\n{ts}\n{kid}\n{sha256(raw)}` | Legacy, verify-only, no nonce (event_id is the replay key) |
| `gateway.operator/1` | Gateway DEV operator mode, AutoCurb Phase 2 `hmac.ts` | `{ts}.{nonce}.{compact sorted JSON}` | Legacy, verify-only, body must be canonical |
| `autoframe.raw-hash/1` | AutoFrame DEV receiver | `{ts}.{nonce}.{sha256(jsonb::text)}` | Legacy, verify-only |
| `autoframe.ts-body/0` | AutoFrame `signature.ts` design | `{ts}.{rawBody}` | HELD (design only) |
| `gateway.service/1`, `gw.extension/1` | Gateway private service mode / extensions | not pinned | HELD until Gateway publishes a pinned spec and fixtures |

**Rule:** every key is pinned to exactly one dialect. A signature valid in one dialect is never accepted in another, even when the prefix and secret look compatible. rtgip/2 signatures use the distinct prefix `rtgip2=`.

## 2. Envelope (canonical, strict)

Fields (no others allowed): `protocol` (`"rtgip/2"`), `schema_version` (event schema, currently `2`), `event_id` (UUID, derivation `rtgip/2-event/v2`: SHA-256 over the canonical array `["rtgip/2-event/v2", source_app, tenant_id, rooftop_id, instance_id, episode_id, origin_event_id, route]` in UUID layout; `sealEnvelope` always overwrites any supplied id and every verifier recomputes it and refuses a mismatch with `event_id_not_derived`, so ids from different tenants, rooftops, instances, episodes, sources or routes can never collide), `event_type`, `source_app`, `target_app`, `route` (`source->target`), `purpose`, `tenant_id`, `rooftop_id`, `vehicle {vin, instance_id, episode_id, service_visit_id?}`, `aggregate {domain, type, id, revision, prev_revision}`, `origin {app, event_id, revision}`, `correlation_id`, `causation_id`, `occurred_at`, `emitted_at` (UTC `Z`), `classification` (`shared_vehicle_fact` | `shared_media_meta`), `payload_sha256`, `payload`.

- One envelope per target route. The source authorizes the destination; the Gateway verifies it again.
- `payload` is validated against a per-event strict schema (`EVENT_CATALOG`). Unknown fields are rejected.
- Forbidden at any depth: confidential valuation and finance keys (ACV, offers, cost, payoff, APR, profit…), customer PII keys, and media access keys (url, signed_url, bytes, base64, token…). Values that look like URLs, emails, phone numbers or SSNs are rejected.
- `vehicle` always carries tenant-scoped instance and episode ids. A VIN alone is never an identity. `acq:` refs are AutoCurb provisional refs that AutoLabels reconciles by review, never by auto-creation.

### Serialization
Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, `undefined` dropped, only safe integers (floats refused), strings via `JSON.stringify`. The body on the wire **must equal** `canonicalize(JSON.parse(body))`; this also rejects duplicate keys and alternate encodings. `payload_sha256 = sha256(canonicalize(payload))`.

## 3. Signing

Headers: `rtgip-protocol: rtgip/2`, `rtgip-key-id`, `rtgip-signer` (an app id or `gateway`), `rtgip-timestamp` (unix seconds), `rtgip-nonce` (`[A-Za-z0-9_-]{16,128}`), `rtgip-scope` (`source;target;tenant;rooftop;event_type;schema_version;purpose;event_id`), `rtgip-signature: rtgip2=<hex>`.

Preimage (LF-joined): `rtgip/2`, key id, signer, timestamp, nonce, scope, `sha256(raw body)`. HMAC-SHA256 with the key's server-held secret.

Verification order (fail closed at the first failure): protocol header → prefix → nonce format → key exists → key dialect is `rtgip/2` → key not revoked and inside `not_before..not_after` → signer equals key owner → expected signer (source at Gateway admission, `gateway` at a target) → timestamp within ±300 s → body ≤ 64 KiB → HMAC → **then** nonce claim (so a forged request cannot burn a nonce) → JSON parse → canonical form → envelope schema → scope header equals envelope → payload hash → event id equals its derivation → receiver equals `target_app` → signer is the source or the Gateway → route authorization → key bound to the authorized connection.

Nonce claims are per key, kept ≥ 900 s. Same nonce + same bytes = exact retry (accepted, flagged duplicate, no new effect). Same nonce + different bytes = `nonce_reused`.

**Trusted re-signing** (`translateAndResign`): authenticate the legacy message in its own pinned dialect, map it, validate it as rtgip/2, authorize source/target/tenant/rooftop/event/purpose, confirm both keys are bound to the connection, then sign with a separate Gateway key that has a different id and secret. The legacy body must itself carry `tenant_id`, `rooftop_id` and its source app, and they must equal the mapped envelope (`legacy_scope_claims_missing`, `legacy_scope_mismatch`, `source_impersonation`). Translation never upgrades trust.

## 4. Service identity and authorization

`ServiceConnection {connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status}` and `ServiceKey {key_id, owner, dialect, connection_ids, status current|previous|revoked, not_before, not_after, secret (server-only)}`. No browser key, service-role key, or human admin bearer token is ever an app identity. Rotation: one `current` key signs; `previous` keys verify until `not_after`; `revoked` keys fail immediately.

`authorize()` checks, in order: route exists → route is in this phase (AutoFilm routes return `route_reserved`) → event is on the route → source is the event's owner (`not_source_authority`) → purpose allowed → an active connection exists for the tenant → rooftop granted → event and purpose granted → producer and reader both enabled.

## 5. Routes and source authority

| Route | Events | Owner |
|---|---|---|
| AutoLabels → AutoCurb | identity_registered, inventory.status_changed, custody.episode_opened/closed, sale.milestone_recorded, listing.price_published (advertised only) | AutoLabels |
| AutoCurb → AutoLabels | appraisal.completed, acquisition.milestone_recorded, acquisition.purchase_completed | AutoCurb |
| AutoLabels → AutoFrame | identity_registered, inventory.status_changed, custody.episode_opened/closed, sale.milestone_recorded, listing.availability_changed | AutoLabels |
| AutoFrame → AutoLabels | media.approved, media.revoked | AutoFrame |
| AutoCurb → AutoFrame | appraisal.completed, acquisition.purchase_completed | AutoCurb |
| AutoFrame → AutoCurb | media.approved, media.revoked | AutoFrame |
| 6 AutoFilm routes | none active; frozen in `RESERVED_AUTOFILM_EVENTS` | — |

## 6. Delivery, acknowledgment and ordering

- **Outbox:** written in the same transaction as the business change; identical bytes are a no-op, a different body under the same event id is refused.
- **Three signed receipts**: `gateway_admission` (outcome `admitted`) → `target_inbox` (`applied|duplicate|stale_ignored|held|quarantined`) → `consumer_commit` (only `applied|stale_ignored`). Each receipt carries and is verified against the exact delivery: `event_id, route, source_app, target_app, tenant_id, rooftop_id, connection_id, payload_sha256`, plus `issuer`, `issued_at`, `key_id`. Signature: `HMAC(secret, "rtgip/2-receipt\n" + canonicalize(receipt without signature))`. The key must be owned by the issuer, of dialect `rtgip/2`, not revoked, valid at `issued_at`, and bound to the connection; the connection must still be active and grant the rooftop; `issued_at` may not be more than 300 s in the future. An HTTP 2xx without a verified receipt never advances state.
- **Commit semantics (C1):** a quarantined or held event never produces a `consumer_commit`. A redelivered duplicate repeats the original `held`/`quarantined` outcome with `committed=false`; only a duplicate of a committed event is acknowledged as `duplicate` and may carry the original committed outcome. The source treats a commit that contradicts the inbox outcome as `ack_commit_contradicts_inbox`.
- **Outbox transitions (enforced in SQL by `rtgip.outbox_advance` and a table trigger):** `pending|retry_wait → in_flight → gateway_admitted → target_persisted → consumer_committed`; `gateway_admitted → target_quarantined` (terminal); `held` records the receipt and returns the row to retry. `consumer_committed`, `target_quarantined` and `dead_letter` are terminal. The SQL verifies the receipt HMAC itself with the issuer's Vault secret; the caller's word is never trusted.
- **Least privilege (SQL):** all entry points are `SECURITY DEFINER` with an empty `search_path`; EXECUTE is revoked from `PUBLIC`, `anon`, `authenticated` and `service_role` and granted per duty to NOLOGIN roles `rtgip_outbox_writer`, `rtgip_dispatcher`, `rtgip_inbox_receiver`, `rtgip_operator` (read-only). `delivery_config.local_app` pins the one app a database may enqueue as and receive for.
- **Inbox:** idempotent on `(tenant, origin app, event_id)`; a different hash under the same id is quarantined, never applied. Inbox row, watermark and consumer effect commit in one transaction.
- **Revision chains** (watermark key) are `tenant | rooftop | route | origin app | domain | aggregate type | aggregate id | instance | episode` (the episode is `*` for `vehicle_instance` identity, which spans episodes). A returning vehicle's new episode therefore starts a fresh chain and cannot be suppressed by the prior episode. Each domain has its own chain, so AutoLabels identity, AutoCurb acquisition and AutoFrame media revisions never overwrite one another. `prev_revision` must equal the receiver's watermark: lower or equal revisions are recorded as `stale_ignored`; gaps are `held` and drained automatically when the predecessor commits.
- **Retry:** bounded exponential backoff with jitter (5 s base, 900 s cap, 10 attempts), then `dead_letter`, kept forever and re-drivable by an audited operator action. Leases expire so a dead worker's row is picked up by another.
- **Reconciliation** only reports (missing, hash mismatch, duplicate effects, invalid ack, revision gaps, quarantined, stale, unacknowledged commits). It never deletes or rewrites evidence.

## 7. Business invariants enforced in code

- **Source authority comes from records, never from caller booleans (H5).** Producers take the authoritative rows the server re-reads in the publishing transaction and derive every fact from them.
- AutoCurb: facts come from `public.submissions` plus the proposed trigger-written, append-only `rtgip_src.submission_ledger` (`NEVER_APPLY_rtgip_source_ledger.sql`); `public.activity_log` is not an authority because staff browsers can insert into it. `offer_accepted`, `deal_finalized`, `title_ownership_verified`, `check_request_submitted` → `acquisition.milestone_recorded` with `custody_transferred: false`. `acquisition.purchase_completed` only when the ledger shows `check_request_submitted → purchase_complete`, a ledger-recorded `check_request_done = true`, an attributed actor, and ownership and condition evidence. `appraisal.completed` only when the ledger shows the finalization by an attributed user and a real ACV exists; the ACV is never transmitted.
- AutoLabels: episode facts come from PR #46 records (`vehicle_instances`, `vehicle_custody_milestones`, `vehicle_reappearance_reviews`). A reacquisition needs a predecessor episode whose custody ended (`delivered|transferred_out|archived`), confirmed by a terminal milestone that was not later reverted, and a resolved reappearance review that names this episode (H4). Sale milestones must come from a trusted source (`staff` with a confirmer, `dms`, `autocurb`) and must not be superseded. A closed episode can never report an active status, price or availability; advertised price is carried from the published price card, not recalculated.
- Consumers (H3): an episode that reached a terminal state (sold, delivered, wholesale, archived) cannot be reopened or relisted by a delayed or replayed `episode_opened` or status event; only `sale_voided` on an open episode clears it. AutoFrame derives `approvals_allowed` only from a live episode.
- AutoFrame (H6): only media whose current row is approved, for an in-inventory vehicle in the same episode, with the approved rendition, is published; storage refs are private object keys scoped to `tenant/rooftop/instance/`. Revocations leave a tombstone at the receiver. A later approval of a revoked image must carry `reinstatement_audit_ref` naming an audited reinstatement (once per revocation); otherwise it is quarantined (`revoked_media_requires_reinstatement`).
- Byte fixtures (H7): AutoFrame's `payload_hash` is `sha256(jsonb::text)`. `scripts/rtgip-jsonb-fixtures.sh` (AutoFrame repo) records real PostgreSQL output; verifiers must hash the received bytes and never re-serialize (numeric scale is lost on re-parse). Gateway-owned fixtures for `gateway.service/1` and `gw.extension/1` are still outstanding, so those dialects stay HELD.
- Future service evidence (AutoFilm, reserved) attaches to a registered service visit and never changes the episode.

## 8. Evidence

See the PR description for exact commands and results. Three kinds of evidence are kept separate: **in-memory** (Vitest, including the six-direction matrix and the corpus), **real database** (throwaway local PostgreSQL clusters in CI; never Supabase), and **physical staging** (none performed). No route is production-live.

## 9. Staging and rollback checklist (for a future, separately approved phase)

Nothing below is authorized by this document. Each step needs its own owner approval.

1. Freeze the core: confirm `VENDORED.json` SHA-256 values match in all three repos and all CI is green on the exact commits to be staged.
2. Apply `rtgip_v2_delivery` (and, for AutoCurb, `rtgip_source_ledger`) to a **staging** database only, by a privileged operator; run the PG harness against a restored copy first. `transport_enabled` stays `false` (CHECK-pinned).
3. Provision synthetic staging keys in Vault (never the DEV literals in `fixtures.ts`); create one login per duty role; grant only that role.
4. Set `delivery_config.local_app`; create connections as `suspended`; enable one route at a time with producer/reader flags.
5. Run the six-direction matrix against staging with synthetic tenants; reconcile; verify zero `invalid_ack`, zero commits for quarantined events, and the dead-letter path.
6. Rollback: set every connection to `suspended` (stops new receipts verifying), revoke the staging keys, and leave all ledger tables in place (append-only evidence). Business tables are unaffected because enqueue is the only coupling. The proposed SQL has no destructive down-migration by design.
7. Production remains out of scope until a separate review of staging evidence.
