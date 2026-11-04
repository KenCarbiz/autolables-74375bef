# AutoLabels: rtgip/2 Lovable implementation handoff (Phase 3)

Status: **not approved for implementation.** Everything below is proposed SQL plus parked,
server-only TypeScript on branch `claude/project-thread-ixjske` (draft PR #51, stacked on the
unmerged PR #46). Nothing here may be applied, deployed, published or switched on until Ken
approves each numbered gate in section 6. Transport stays off. `gateway.service/1` and
`gw.extension/1` stay HELD.

## 1. What this app contributes

AutoLabels is the identity and custody authority. It publishes `vehicle.identity_registered`,
`inventory.status_changed`, `listing.price_published`, `custody.episode_opened`,
`custody.episode_closed` and `sale.milestone_recorded`, and it admits inbound AutoCurb and
AutoFrame facts through `rtgip.inbox_admit`.

## 2. Exact source tables (read only, tenant-scoped by `tenant_id uuid`)

| Table | Columns the reader uses | From |
|---|---|---|
| `public.vehicle_instances` | `id` (episode id), `tenant_id`, `vin`, `status`, `custody_state`, `opened_reason`, `previous_instance_id`, `listing_id`, `created_at` | PR #46 |
| `public.vehicle_custody_milestones` | `id`, `tenant_id`, `instance_id`, `vin`, `milestone`, `to_state`, `occurred_at`, `source`, `confirmed_by`, `corrects_id` | PR #46 |
| `public.vehicle_reappearance_reviews` | `id`, `tenant_id`, `vin`, `prior_instance_id`, `status`, `decision`, `decided_by`, `decided_at`, `resulting_instance_id` | PR #46 |
| `public.vehicle_listings` | `id`, `tenant_id`, `vehicle_file_id` | existing |
| `public.vehicle_files` | `id`, `tenant_id`, `stock_number` | existing |

Identity mapping: rtgip `tenant_id` = `public.tenants.id`; `episode_id` = `vehicle_instances.id`;
`instance_id` = root of the `previous_instance_id` chain; `stock_number` from the listing's
vehicle file (nullable; facts that need it refuse with `stock_number_unknown`).

## 3. Required queries (server only, never from the browser)

```sql
-- as the rtgip_source_reader role, read-only transaction
SELECT rtgip_src.labels_episode_history($1::uuid /* tenant */, $2::uuid /* episode */);
SELECT rtgip_src.labels_episode_milestones($1::uuid, $2::uuid);
-- as the rtgip_inbox_receiver role, one transaction per delivery (see admission.ts)
SELECT * FROM rtgip.inbox_admit($1::text::jsonb /* rtgip-* headers */, $2::text /* raw body */, $3::text::jsonb /* consumer reject or null */);
```

The TypeScript side is already written: `src/lib/rooftopos-parked/rtgip2-autolabels/source-reader.ts`
(validates every reader field, then calls the producers) and
`src/lib/rooftopos-parked/rtgip2/admission.ts` (`admitDelivery`). Lovable should wire these into
an edge function only after gate 4, and must not reimplement verification.

## 4. Role permissions

| Role | May execute | Must not |
|---|---|---|
| `rtgip_source_reader` (NOLOGIN) | `rtgip_src.labels_episode_history`, `rtgip_src.labels_episode_milestones` | anything else |
| `rtgip_inbox_receiver` (NOLOGIN) | `rtgip.inbox_admit` only | `inbox_receive`, `claim_nonce`, direct table writes |
| `rtgip_dispatcher`, `rtgip_outbox_writer`, `rtgip_operator` | as in `rtgip_v2_delivery.proposed.sql` | inbound admission |
| `anon`, `authenticated`, `service_role` | nothing in `rtgip` or `rtgip_src` | everything (EXECUTE is revoked explicitly, also under Supabase default grants) |

A deployment grants these NOLOGIN roles to one dedicated server login (not `service_role`).

## 5. Proposed migrations, in order

1. `supabase/proposed/20261030000000_rooftopos_spine.sql` (unapplied spine)
2. `supabase/proposed/20261109000000_vehicle_history_foundation.sql` (PR #46)
3. `supabase/proposed/rtgip_v2_delivery.proposed.sql` (ledger, receipts, `inbox_admit`)
4. `supabase/proposed/rtgip_source_readers.proposed.sql` (readers)

Each applies twice cleanly. Verified on a throwaway cluster by
`supabase/tests/rtgip/pg_integration.sh` (full history replay) and
`supabase/tests/rtgip/pg_concurrency.sh` (112 checks). Neither touches Supabase.

## 6. Approval boundaries (each needs Ken's explicit go-ahead)

1. Merge PR #46, then apply migration 2.
2. Apply migrations 1, 3 and 4 to the hosted project (Lovable does not apply SQL on merge).
3. Create the server login and grant it the NOLOGIN roles.
4. Wire an inbound edge function to `admitDelivery` and an outbound dispatcher to the readers, behind the existing transport-off flag.
5. Load Vault secrets and connection rows provisioned by the Gateway owner.
6. Turn transport on for one synthetic tenant in staging.

## 7. Unresolved environment dependencies

- Hosted Gateway signing keys, key ids and the connection registry rows: owned by the Gateway
  owner. No real key exists in any repo; `gw-dev-1` and the other `*-dev-*` keys are public DEV
  literals and must never be provisioned.
- A Postgres connection string for the dedicated server login (edge functions normally use
  `service_role`, which is deliberately denied here).
- Vault entries `rtgip:<key_id>` for every key in `rtgip.signing_keys`.
- Gateway conformance: the owner re-signs `rtgip2-gateway-contract.v1.json` bodies with their own
  key against a staging target and confirms every recorded outcome.

## 8. Do not

- Do not call the readers or `inbox_admit` from the browser or with `service_role`.
- Do not change the customer Passport, pricing arithmetic or any working production flow.
- Do not add a translation for `gateway.service/1` or `gw.extension/1`.
