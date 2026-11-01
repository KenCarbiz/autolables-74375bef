# Legacy feed transition: signed, tenant-scoped feeds

Status: proposed and implemented in code and tests only. Nothing here is deployed, migrated or
verified against a live project. The producer sides (AutoFilm, AutoCurb, DMS vendors) are not
changed and not verified.

Covers three live legacy edge functions: `autofilm-feed` (GET), `autocurb-sync` (POST) and
`dms-webhook` (POST, `?provider=`). Code: `supabase/functions/_shared/legacyFeeds/`.
Migration: `supabase/proposed/20261109010000_legacy_feed_hardening.sql` (+ `.rollback.sql`).
SQL test: `supabase/tests/legacy_feeds_sql.sql`.

## What was wrong

| Feed | Credential | Tenant chosen by | Replay | Archived listing |
| --- | --- | --- | --- | --- |
| autofilm-feed | one global `AUTOLABELS_LOOKUP_SECRET` (`x-lookup-secret` or `x-autofilm-key`) | `tenant_id` in the query | n/a (read) | list is filtered; detail could return an archived-status row |
| autocurb-sync | one global `AUTOCURB_SYNC_SECRET`, HMAC of the raw body | `autocurb_tenant_id` in the body | none (a captured request replays forever) | updated in place |
| dms-webhook | one global secret per provider (`DMS_SECRET_*`), HMAC of the raw body | `X-Dms-Tenant` header | none | updated in place |

A holder of any one of those secrets could read or write every tenant.

## After

| Feed | Legacy mode (unchanged wire format) | Signed mode (new) |
| --- | --- | --- |
| autofilm-feed | same header, same secret, same `tenant_id`; response gains `X-AutoLabels-Auth-Deprecated: legacy-shared-secret`; refused with 401 `legacy_auth_retired` once the tenant's binding is `rejected` | per-connection key; tenant is the key's connection; `tenant_id`, if sent, must match it (else 403 `tenant_mismatch`); the query is covered by the signature |
| autocurb-sync | same | per-connection key; tenant is the key's connection; `autocurb_tenant_id`, if sent, must resolve to it; `Idempotency-Key` required |
| dms-webhook | same | per-connection key; tenant is the key's connection; `X-Dms-Tenant`, if sent, must match; `Idempotency-Key` required; binding is per provider |

Both write feeds now hold, rather than update, a VIN whose existing listing is archived (or has
`archived_at`, or is `sold`/`expired`/unknown status). A held vehicle is not counted in
`upserted`, the listing is never touched, and the response lists it:

```json
{ "upserted": 1, "errors": [], "held": [ { "vin": "1HGCM82633A004352", "reason": "archived_listing_requires_review", "review_id": "<uuid or null>" } ] }
```

`review_id` is the open vehicle reappearance review (`legacy_feed_hold_archived` calls
`vehicle_history_flag_reappearance`). It is null when the migration is not applied yet, or the
VIN is not a valid 17-character VIN; the hold still happens. This guard applies to legacy and
signed requests alike, and does not need the migration to take effect.

`autofilm-feed` detail (`/vehicle/<VIN>`) previously filtered only `archived_at IS NULL`, so a
row with status `archived`, `sold` or `expired` and no `archived_at` could be returned. It now
answers 404 `not_current_inventory` for any such row (and for `archived_at` set, which used to
be a plain 404 `not_found`). Draft and pending rows are still returned by detail, as before. The
list endpoint already restricted to `status in (published, active)` and `archived_at IS NULL`
and is unchanged.

## Signed request format

Headers on every signed request:

| Header | Value |
| --- | --- |
| `X-Rooftop-Key-Id` | the key id issued for the connection |
| `X-Rooftop-Timestamp` | Unix seconds; must be within 300 seconds of server time |
| `X-Rooftop-Signature` | `v1=` + hex HMAC-SHA256 |
| `Idempotency-Key` | POST only; 1-200 characters; unique per logical batch |

Signature: `HMAC-SHA256(secret, "rooftopos.v1\n" + ts + "\n" + keyId + "\n" + sha256hex(signedText))`,
the same function as the RooftopOS spine (`_shared/integrations/signing.ts`).

- POST: `signedText` is the raw request body, byte for byte.
- GET (autofilm-feed): `signedText` is `GET ` + the target, where the target is the path after the
  function name (`/` for the list, `/vehicle/<VIN>` for detail) followed by `?` and the query
  parameters sorted by key then value, each percent-encoded with `encodeURIComponent`
  (no `?` when there are none). Changing `tenant_id`, `cursor`, `vin`, `limit` or
  `updated_since` invalidates the signature.

Worked example (synthetic secret `synthetic-example-secret-0001`, key id `lf_example_key_1`,
timestamp `1893456000`; these exact values are asserted in `auth.test.ts`):

```
POST /functions/v1/autocurb-sync
X-Rooftop-Key-Id: lf_example_key_1
X-Rooftop-Timestamp: 1893456000
X-Rooftop-Signature: v1=d9f9f5b21d8529a8b80c09407f82d34dff549cc2ccefd1ebf8400a26e575cc18
Idempotency-Key: batch-2030-01-01-0001
Content-Type: application/json

{"vehicles":[{"vin":"1HGCM82633A004352","price":19999}]}
```

```
GET /functions/v1/autofilm-feed?tenant_id=11111111-1111-4111-8111-111111111111&limit=100
signed text: GET /?limit=100&tenant_id=11111111-1111-4111-8111-111111111111
X-Rooftop-Signature: v1=4554078e9da32578c1ecd854e4f15ab1adba232b623673c6b298c787ca8584fd
```

Failure responses (signed mode): 401 `unauthorized` (missing headers, unknown or revoked key, key
past `not_after`, bad signature), 401 `stale_request`, 403 `connection_inactive`, 403
`feed_not_bound`, 403 `tenant_mismatch`, 400 `idempotency_key_required`. Replaying the same
`Idempotency-Key` with the same body returns the stored response with status 200 and
`Idempotent-Replay: true` and performs no writes; the same key with a different body is 409
`idempotency_key_reused`; a duplicate while the first is still running is 409
`request_in_progress` (a processing claim older than ten minutes may be retaken). Responses with
status 5xx are not stored, so the producer can retry them.

Limits worth knowing: the `Idempotency-Key` header is not part of the signed text, so a captured
request replayed inside the 300 second window with a different key would run again; the writes
are idempotent upserts, and the window is short. Use a fresh key per logical batch and the same
key on retries.

## Cutover sequence (per tenant, per feed)

1. Create an `integration_connections` row for the tenant (`app` = `autofilm`, `autocurb` or
   `dms`, status `active`) and an `integration_connection_keys` row whose secret is stored in
   Vault under `vault_secret_name`. One key may be `retiring` with a `not_after` while rotating.
2. Insert a `legacy_feed_bindings` row for the tenant, feed (`autofilm_feed`, `autocurb_sync`,
   `dms_webhook` + `provider`) and that connection, leaving `legacy_unsigned = 'allowed'`.
   Legacy callers keep working untouched.
3. The producer switches to signed requests (see below).
4. Verify: signed requests succeed, the legacy caller count for the tenant drops to zero (look
   for the `X-AutoLabels-Auth-Deprecated` response header in the producer's logs), replays
   return `Idempotent-Replay: true`.
5. Set `legacy_unsigned = 'rejected'` on that binding. The shared secret is now refused for that
   tenant and feed with 401 `legacy_auth_retired`.
6. Later, once every tenant is rejected, remove `AUTOLABELS_LOOKUP_SECRET`, `AUTOCURB_SYNC_SECRET`
   and `DMS_SECRET_*`. That is a separate, explicitly approved change.

## Rollback

Set `legacy_unsigned` back to `'allowed'` on the binding (or run the `.rollback.sql`, which does
it for every binding and revokes client access). Nothing is deleted: bindings, receipts and
the widened `integration_connections.app` check all stay. If the migration is not applied, the
legacy `legacy_feed_legacy_allowed` check fails open and legacy callers are unaffected.

## Who must change (not implemented, not verified here)

- AutoFilm: sign the `autofilm-feed` list and detail GETs. Not changed or tested.
- AutoCurb: sign `autocurb-sync` POSTs and send `Idempotency-Key`. Not changed or tested. The
  AutoCurb repo available for this work (`KenCarbiz/hartecash-2edb8fec`, cloned read-only) contains
  no caller of `autocurb-sync`: grep for `autocurb-sync`, `AUTOCURB_SYNC_SECRET` and
  `x-autocurb-signature` finds nothing except the unrelated RPC name `autocurb_sync_entitlements`
  (stripe-webhook, billing-replay, billing-add-app, supabase/config.toml), and there is no
  reference to `dms-webhook`, `autofilm-feed` or `AUTOLABELS_LOOKUP_SECRET`. The real producer of
  these calls is therefore unidentified.
- DMS vendors (vAuto, vinSolutions, CDK, Reynolds, generic): must sign with the connection key
  and send `Idempotency-Key`. Vendor-side capability to produce `X-Rooftop-*` headers is unknown;
  a vendor that cannot sign has to stay on legacy mode (or go through an intermediary).
