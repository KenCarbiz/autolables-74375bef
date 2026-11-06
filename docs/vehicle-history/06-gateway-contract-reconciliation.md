# RooftopOS Gateway compatibility review — AutoLabels PR #46

**Review only. No runtime changes, migrations, deployments, secret access, or network connectors.**
Branch based on AutoLabels draft PR #46 head `2da120f3285803c324d9c6ad28a53430d41221cb` (itself based on #36). Both PRs remain unmerged. This document is a review artifact, not an approved protocol change.

## Three distinct contracts that must NOT be conflated

| Dimension | AutoLabels #46 | RooftopOS Integration Gateway DEV | Action |
|---|---|---|---|
| Envelope version | Semantic string `1.0.0` or `1.1.0` | Numeric `schema_version: 1` or `2` | Add explicit, tested translator; do not silently coerce |
| Producer | `producer: autolabels/autofilm/autocurb` | `source_app: autolabels/autofilm/autocurb/autoframe` | Normalize only after authenticated key-to-app binding |
| Tenant | `tenant_ref` (informational, not auth) | `tenant_id`, `rooftop_id` | Resolve through active signed connection's approved tenant/rooftop mapping; refuse mismatch |
| Vehicle | `vin`, optional `instance_ref:{app,id}` | `vehicle:{vin,instance_id,episode_id?}` | Must resolve registered instance and episode; never synthesize one from VIN alone |
| Service | `service_visit_ref:{app,id}` since 1.1.0 | No first-class service visit reference in v1 | Expand canonical contract or adapter evidence model BEFORE enabling sold-then-MPI |
| Ordering | `source_record_id`, `source_version` | `aggregate:{type,id,revision}` | Define immutable per-aggregate identity and compare revisions per producer+tenant+instance; cross-event revision semantics need review |
| Time | `occurred_at`, `observed_at`, `sent_at` | `occurred_at`, `emitted_at` | Time fields have distinct meaning; preserve original values |
| Integrity | `payload_checksum`, signed transport envelope | optional `payload_hash`, separate app claims | Verify raw-byte transport signature first, canonical payload checksum separately, and bind signer identity to source/tenant |
| Disclosure | `visibility` and `evidence_refs` | `classification: internal/pii/media_meta` | Visibility != privacy class; do not auto-publish customer-private evidence |
| Catalog | Namespaced events e.g. `autolabels.vehicle.sold` | `listing.sold`, `inventory.updated`, `price.changed` | Map event semantics intentionally, never by string replacement alone |
| AutoFrame | Not in #46's producer/event catalog | `media.approved` | Requires new consumer support and scoped, metadata-only source adapter |

Sources: #46 `supabase/functions/_shared/integrations/envelope.ts`, `docs/vehicle-history/02-contracts-and-controls.md`, and `adapters/autofilmV1.ts`; Gateway DEV `src/lib/gateway/contract.ts`, `docs/contracts/source-of-truth.md` (verified 2026-11-01). The Gateway is a separate synthetic project; it is NOT connected to AutoLabels.

## Candidate event mapping — NOT automatic

| AutoLabels #46 event | Gateway event | Gate |
|---|---|---|
| `autolabels.vehicle.listed` / `.updated` | `inventory.updated` | Apply only for active listing episode and authoritative inventory snapshot; no sold reactivation |
| `autolabels.vehicle.price_changed` | `price.changed` | Fee-inclusive published price comes from AutoLabels authority, not recalculated by receiver |
| `autolabels.vehicle.sold` | `listing.sold` | Require actual sold disposition, not mere archived/unavailable listing |
| `autolabels.vehicle.delivered`, `.sale_voided`, `.archived` | **NO equivalent** | Extend Gateway catalog or preserve these as distinct verified events |
| `autofilm.inspection.completed` | **NOT automatically** `service.mpi_verified` | The existing AutoFilm V1 translator may set `technician_verified: false`; completion is not verified evidence |
| `autofilm.repair.completed_verified` | **NO equivalent** | Add verified service-completion event with evidence refs/RO anchor |
| `autocurb.appraisal.recorded` | **NOT automatically** `appraisal.completed` | Recorded and final appraisal have different meanings; require actual signed-off status |
| `autocurb.acquisition.recorded` | **NOT automatically** `acquisition.closed` | Recording acquisition does not mean title/custody closed; test state model |
| AutoFrame approved image | `media.approved` | Metadata and provenance only, no binary, separate signed media URL access |

## Safety invariants for the bridge

1. PR #46's VIN identity/custody episodes/service visit model remains canonical for AutoLabels; do not create duplicate global vehicle or episode tables, and do not turn a sold listing into inventory after an MPI.
2. A buyer/seller/employee lookup may use the existing AutoFilm–AutoCurb CRM mechanism only under its own purpose, consent, DNC and tenant gates. No customer name/email/phone or financing data is embedded in vehicle-event payloads.
3. Gate inbound/outbound adapters per environment, tenant, rooftop, partner, direction and event type; default **OFF** in every layer. Never use the browser/service-role key as an app-to-app signature.
4. Validate key ID and timestamp and HMAC over raw bytes before JSON parsing. Resolve tenant from the authenticated connection and reject a body whose claimed tenant differs. Use expiring replay receipts and rotate keys with overlap.
5. Keep source event ID, original source version, instance/episode/visit provenance, correlation and causation references. Translate into a new canonical event ID using a durable mapping/receipt; retry must not generate a second business effect.
6. `source_version` values are not necessarily contiguous or comparable across event families; watermark scope must be explicit and tested rather than sorting solely by timestamps.
7. Preserve historical Passport status, permit a subsequent verified MPI on a service visit without opening inventory, and ensure no public customer access to private MPI evidence without grant.
8. No adapter work may touch AutoLabels PR #46 deployment-hold functions or MarketCheck budgets; no new transport endpoint until bearer-token, signed-wire and tenant-negative tests pass.

## Reviewer acceptance matrix before implementation

- [ ] Establish canonical envelope and event taxonomy with Gateway, AutoFilm and AutoCurb contract authors; publish a versioned fixture corpus.
- [ ] Verify positive and negative mappings on both 1.0.0 and 1.1.0, including missing service-visit reference, unknown event types and version mismatch.
- [ ] Test sold -> delivered -> MPI across source and target while keeping sale and listing immutable.
- [ ] Test unknown VIN, VIN shared across tenants, same VIN re-acquired in another episode, and wrong-tenant signed request.
- [ ] Test duplicate event ID, reused idempotency key with changed payload, stale source version, out-of-order events and replay after destination outage.
- [ ] Test recommended / approved / completed / verified service states separately.
- [ ] Test envelope size, SHA-256 payload integrity, PII denial, key rotation, clock skew and wrong-event-source authorization.
- [ ] Run dry-run reconciliation and a bounded parallel synthetic benchmark; measure p50/p95/p99, not estimated latency.
- [ ] Confirm every production connector stays OFF, no live migration/function/cron applied, and preserve existing AutoLabels feed/AutoCurb sync behavior.

## Release hold

Do not merge, apply or publish from this review. A separate sign-off is required for canonical compatibility changes, each staged migration, external endpoints, pilot tenant mappings, and production enablement. Closing this unmerged PR reverts this documentation change without touching production.