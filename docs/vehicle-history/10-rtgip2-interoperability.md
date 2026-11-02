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

Fields (no others allowed): `protocol` (`"rtgip/2"`), `schema_version` (event schema, currently `2`), `event_id` (UUID, derived per route from the origin event: `deriveEventId(origin_event_id, route)`), `event_type`, `source_app`, `target_app`, `route` (`source->target`), `purpose`, `tenant_id`, `rooftop_id`, `vehicle {vin, instance_id, episode_id, service_visit_id?}`, `aggregate {domain, type, id, revision, prev_revision}`, `origin {app, event_id, revision}`, `correlation_id`, `causation_id`, `occurred_at`, `emitted_at` (UTC `Z`), `classification` (`shared_vehicle_fact` | `shared_media_meta`), `payload_sha256`, `payload`.

- One envelope per target route. The source authorizes the destination; the Gateway verifies it again.
- `payload` is validated against a per-event strict schema (`EVENT_CATALOG`). Unknown fields are rejected.
- Forbidden at any depth: confidential valuation and finance keys (ACV, offers, cost, payoff, APR, profit…), customer PII keys, and media access keys (url, signed_url, bytes, base64, token…). Values that look like URLs, emails, phone numbers or SSNs are rejected.
- `vehicle` always carries tenant-scoped instance and episode ids. A VIN alone is never an identity. `acq:` refs are AutoCurb provisional refs that AutoLabels reconciles by review, never by auto-creation.

### Serialization
Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, `undefined` dropped, only safe integers (floats refused), strings via `JSON.stringify`. The body on the wire **must equal** `canonicalize(JSON.parse(body))`; this also rejects duplicate keys and alternate encodings. `payload_sha256 = sha256(canonicalize(payload))`.

## 3. Signing

Headers: `rtgip-protocol: rtgip/2`, `rtgip-key-id`, `rtgip-signer` (an app id or `gateway`), `rtgip-timestamp` (unix seconds), `rtgip-nonce` (`[A-Za-z0-9_-]{16,128}`), `rtgip-scope` (`source;target;tenant;rooftop;event_type;schema_version;purpose;event_id`), `rtgip-signature: rtgip2=<hex>`.

Preimage (LF-joined): `rtgip/2`, key id, signer, timestamp, nonce, scope, `sha256(raw body)`. HMAC-SHA256 with the key's server-held secret.

Verification order (fail closed at the first failure): protocol header → prefix → nonce format → key exists → key dialect is `rtgip/2` → key not revoked and inside `not_before..not_after` → signer equals key owner → expected signer (source at Gateway admission, `gateway` at a target) → timestamp within ±300 s → body ≤ 64 KiB → HMAC → **then** nonce claim (so a forged request cannot burn a nonce) → JSON parse → canonical form → envelope schema → scope header equals envelope → payload hash → receiver equals `target_app` → signer is the source or the Gateway → route authorization → key bound to the authorized connection.

Nonce claims are per key, kept ≥ 900 s. Same nonce + same bytes = exact retry (accepted, flagged duplicate, no new effect). Same nonce + different bytes = `nonce_reused`.

**Trusted re-signing** (`translateAndResign`): authenticate the legacy message in its own pinned dialect, map it, validate it as rtgip/2, authorize source/target/tenant/rooftop/event/purpose, confirm both keys are bound to the connection, then sign with a separate Gateway key that has a different id and secret. Translation never upgrades trust.

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
- **Three signed receipts**, each bound to event id + payload hash + issuer key: `gateway_admission` → `target_inbox` (outcome `applied|duplicate|stale_ignored|held|quarantined`) → `consumer_commit`. An HTTP 2xx without a verified receipt never advances state.
- **Inbox:** idempotent on `(tenant, origin app, event_id)`; a different hash under the same id is quarantined, never applied. Inbox row, watermark and consumer effect commit in one transaction.
- **Revision chains** are per route and per `(tenant, rooftop, origin app, domain, aggregate type, aggregate id)`. Each domain has its own chain, so AutoLabels identity, AutoCurb acquisition and AutoFrame media revisions never overwrite one another. `prev_revision` must equal the receiver's watermark: lower or equal revisions are recorded as `stale_ignored`; gaps are `held` and drained automatically when the predecessor commits.
- **Retry:** bounded exponential backoff with jitter (5 s base, 900 s cap, 10 attempts), then `dead_letter`, kept forever and re-drivable by an audited operator action. Leases expire so a dead worker's row is picked up by another.
- **Reconciliation** only reports (missing, hash mismatch, duplicate effects, invalid ack, revision gaps, quarantined, stale, unacknowledged commits). It never deletes or rewrites evidence.

## 7. Business invariants enforced in code

- AutoCurb: `offer_accepted`, `deal_finalized`, `title_ownership_verified`, `check_request_submitted` → `acquisition.milestone_recorded` with `custody_transferred: false` (schema-enforced). `acquisition.purchase_completed` only from `purchase_complete` with a trusted audit that followed a check request and verified custody. `appraisal.completed` only when finalized + verified + audited + a real ACV exists; the ACV is never transmitted.
- AutoLabels: a closed (sold/archived) episode can never report an active status, price or availability; a returning vehicle needs a new episode and a resolved reappearance review; sale milestones must be server-verified; advertised price is carried from the published price card, not recalculated.
- AutoFrame: only currently-approved media for an unsold vehicle is published; storage refs are private object keys scoped to `tenant/rooftop/instance/`; a revocation carries a higher revision so a stale approval cannot resurrect the image.
- Future service evidence (AutoFilm, reserved) attaches to a registered service visit and never changes the episode.

## 8. Evidence

See the PR description for exact commands and results. Local verification is not physical staging; no route is production-live.
