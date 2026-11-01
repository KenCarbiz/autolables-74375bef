# AutoLabels → Gateway v1 inbound evidence — Phase 2 parked adapter

**Development branch stacked on unmerged PR #46. No active integration. No production database writes, migrations, transport, endpoints, credentials, pricing changes or data reads.**

## Implementation

- `src/lib/rooftopos-parked/gateway-inbound-evidence-v1.ts` receives a trusted, pre-verified **canonical numeric-v1** Gateway event and resolves an isolated, deterministic **application plan**, without performing I/O.
- `src/lib/rooftopos-parked/gateway-inbound-evidence-v1.test.ts` contains 16 synthetic behavior tests. These are **preflight rules**, not an authenticated server, a durable consumer, or cross-project end-to-end validation.
- This branch is based on the AutoLabels PR #46 vehicle history foundation, which is not in production main. It reuses the same VIN/episode/service-visit principles rather than creating a second vehicle table.

### Supported source-authoritative effects

| Gateway producer | Allowed source event | AutoLabels effect (proposed only) | Forbidden mutation |
|---|---|---|---|
| AutoFilm | `service.mpi_verified`, `service.repair_verified` | New verified evidence linked to an actual RO/service visit, even after sale | Reopening a sold listing, publishing raw customer/private MPI |
| AutoCurb | `appraisal.completed` | Provenance-only appraisal evidence after separate finalization audit | Overwriting published price, internal acquisition cost, value/market algorithm |
| AutoCurb | `acquisition.closed` | Custody/acquisition evidence after verified purchase audit | Automatically creating an active listing or changing sale history |
| AutoFrame | `media.approved` | Metadata-only gallery reference; no public URL, no binary | Reopening a sold listing, replacing originals or exposing private media |

The above does not mean the corresponding real app has implemented a signed publisher. AutoFilm PR #693 and AutoCurb PR #87 were parked and merged with CI; AutoFrame DEV has a tested synthetic source shape; all still require authenticated physical staging.

## Trust and custody boundaries

The pure adapter **cannot cryptographically authenticate** `ServerVerifiedDelivery`. A future trusted server must verify raw bytes HMAC + key rotation + nonce/timestamp replay, resolve signer key→authorized application/tenant/rooftop, calculate the Gateway canonical JSONB payload hash, and enforce least privilege before passing that object. Browser-provided booleans must never be accepted.

The future transactional recipient must lock a source watermark by **tenant + signed producer + aggregate instance**, enforce a unique inbox receipt by `event_id` and destination, compare the signed hash on repeated delivery, and commit the projected evidence and inbox row **in the same database transaction**. A stale revision must never replace newer data. The in-memory `LockedSourceReceipt` supplied to this pure planner is not itself race protection.

Projection remains AutoLabels-owned RLS under the existing PR #46 service/custody evidence schema and grants. A VIN alone is not an identity; require tenant + rooftop + instance + episode. A sold/delivered vehicle may later receive service evidence without becoming inventory. Any mismatch is rejected or held; there is no auto-create from VIN.

Never put customer names, phones, emails, SSNs, finance fields, image/video bytes, signed URLs or temporary access tokens into shared metadata. Preserve purpose-bound AutoFilm/AutoCurb CRM consent and DNC on its separate channel.

## Remaining staging work

1. CI: run target Vitest, TypeScript, lint and build; fail on imported parked module from production. No test success is claimed until GitHub checks show it.
2. Use the latest Gateway v1 canonical fixture corpus, including the exact AutoFrame manager approval fields and source revision, to test a real signed **staging** ingress and inbox.
3. Connect this plan to PR #46's actual vehicle/service projection functions only in a separate staging backend after RLS and custody smoke tests. Proposed SQL remains outside the autoapply migration folder; NO production cutover.
4. Test all directed routes with explicit source authority; the Gateway currently has eight defined routes, not an assumed all-to-all twelve.
5. Test independent app failure, retry, duplicate hash conflicts, replay, stale revisions, cross-tenant roles, sold→delivered→MPI, access-grant revocation, and a failed database transaction.
6. Run measured 1/4/8 worker load and disaster recovery. Targets such as 99.95% / 99.99% availability are objectives, **not guaranteed results**.
7. Only after production-specific security review, live-like tenant/rooftop provisioning and rollback drills should this adapter be imported in a server handler.

**Rollback:** close this stacked PR. Nothing runs without explicit server-side integration and release authorization.
