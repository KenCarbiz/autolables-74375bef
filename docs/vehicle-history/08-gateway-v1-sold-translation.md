# Parked AutoLabels PR #46 → RooftopOS Gateway v1 sold-event translator

**Status: development-only. Source: AutoLabels feature branch `claude/vehicle-history-foundation` (PR #46), NOT merged main. Does not run in the app, edge functions, triggers, migrations, cron, or database.**

## What is implemented

- `src/lib/rooftopos-parked/labels-gateway-v1.ts` is a *pure*, inactive conversion from an explicitly verified `autolabels.vehicle.sold` source envelope (semver 1.1.0) into a numeric Gateway `schema_version=1` `listing.sold` event.
- Requires the original AutoLabels PR #46 `EnvelopeV1` to validate; source payload SHA-256 checksum; independent **server** binding to signed source, active connection, originating tenant and rooftop; authoritative verified sold-custody milestone, instance and episode; no customer PII or binary media. Does not accept `vehicle.delivered`, `vehicle.archived`, `vehicle.sale_voided`, `vehicle.updated`, or `vehicle.price_changed` as synonyms.
- `src/lib/rooftopos-parked/labels-gateway-v1.test.ts` contains synthetic unit and negative tests. Run `npx vitest run src/lib/rooftopos-parked/labels-gateway-v1.test.ts` in isolated checkout. Run all normal `npm test`, `npm run lint`, `npm run build` before any merge. **Do not claim tests passed until CI/local results are recorded.**
- The explicit `LABELS_GATEWAY_TRANSPORT_ENABLED=false` makes the module non-delivering. The file is intentionally not imported by any runtime. *This constant is not a production policy or cryptographic security control.* Real delivery will need independent service-side gates.

## Critical limitations: do not connect yet

This fixture is a **proposed source mapping**, not proof AutoLabels production emits a complete verified sold event; PR #46 has not been deployed. The transport binding object and milestone attestation **must** be derived server-side from authenticated key + custody state, and must never be supplied by a browser, a user or an event payload. Merely passing booleans to a pure translator is not authentication. A trusted connection layer must check signed raw bytes, key rotation, replay receipts, tenant membership and source authority before invoking it.

Because a VIN can exist at multiple rooftops or custody episodes, persist routing identity as tenant + rooftop + vehicle instance + episode, not VIN alone. A later AutoFilm MPI on a service visit is not evidence of sale reversal, not a new listing and must not reactivate sold inventory.

No transport, HTTP call, queue worker, outbox/inbox write, mutation, signing key, cron, migration or production connection is included in this PR. Original `supabase/proposed/` migrations remain unapplied and original AutoLabels feed functions are unchanged.

The Gateway numeric contract supports `listing.sold`; the older PR #46 model uses semver and additional lifecycle events. A general bridge remains **unsupported** until signed, versioned cross-app fixtures prove full compatibility and all required events are reviewed. See `06-gateway-contract-reconciliation.md` and `07-autocurb-source-gates.md`.

## Next release-stage checklist

1. Run unit tests, static containment and all branch CI; confirm no new live imports.
2. Test true cryptographic producer identity, raw-byte HMAC and replay protection with isolated synthetic staging and live-like signing behavior.
3. Implement an additive, explicitly approved database transaction that records a real sold custody milestone and the outbox event together. Validate correct monotonic per-source revision and idempotent source-event ID.
4. Implement a signed-only Gateway ingress consumer that maps source seller-side tenant/rooftop/episode through registered connections; negative wrong-tenant tests must be credential-level.
5. Test receiver effects on AutoFilm and AutoCurb using synthetic dealership databases, including sold → delivered → AutoFilm service visit → verified MPI without relisting.
6. Benchmark 4 and 8 worker queues with 50/500/1000 synthetic submissions and compare measured accepted events/s and delivered p95/p99, not fabricated throughput.
7. Review PR #46 and this PR independently; merge only parked code if safe, and keep production connectors hard OFF until staging release approval.

**Rollback:** Close the unmerged feature PR. Nothing is deployed and no migration applied.
