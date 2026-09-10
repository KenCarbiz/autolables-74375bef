# Gate 14A-2 — Migration Application Report

Market Intelligence V2 audit schema. Schema and security only: no valuation
data, no provider calls, no feature flags, no customer-facing change.

- **Migration**: `supabase/migrations/20260910090000_market_intelligence_v2_audit.sql`
- **sha256**: `894e9c034ab012afe81093724b476a744740bf652bb5dd37c98822090480a3b5`
- **Source commit**: `739473da` (branch `claude/continue-previous-emv49c`)
- **Size**: 798 lines, 38,785 bytes
- **Supabase project**: `onnbmmdbrsgytfozfozn` / Lovable `1a2a5abf-4218-480d-aac9-d7bd0d3cfb73`
- **Channel**: Lovable MCP `query_database`

## 1. Execution role preflight

Captured 2026-09-10 10:43:38Z, before any statement was applied.

| Fact | Value |
|---|---|
| `current_user` / `session_user` | `postgres` / `postgres` |
| Version | PostgreSQL 17.6 on aarch64-unknown-linux-gnu (gcc 15.2.0, 64-bit) |
| Database | `postgres` |
| `CREATE` on database | true |
| `CREATE` / `USAGE` on schema `public` | true / true |
| `rolsuper` | false |
| `rolbypassrls` | true |
| `rolcreaterole` | true |
| Member of `postgres` / `authenticated` / `service_role` / `anon` | true / true / true / true |
| `public.app_role` enum present | yes |
| `public.has_role` + `public.is_tenant_manager` present | both |

`postgres` owns every object in `public` and holds `CREATE` on both the
database and the schema, which covers CREATE TABLE, ALTER TABLE, CREATE
FUNCTION, CREATE TRIGGER, CREATE POLICY, GRANT and REVOKE for objects it
creates and owns. `rolsuper` is false, which is normal for Supabase's
`postgres` role and is not required for any statement in this file.

**Result: PASS.**

## 2. Atomicity

Confirmed empirically rather than assumed.

Probe — a transaction-local GUC written by statement one, read back by
statement two in the same `query_database` call:

```sql
SELECT set_config('app.gate14a2_probe', txid_current()::text, true);
SELECT current_setting('app.gate14a2_probe', true), txid_current()::text;
```

Result: `stmt_two_reads_back = 447325`, `stmt_two_xid = 447325`,
`same_transaction = true`. A `SET LOCAL`-scoped value survived from the first
statement to the second and both carried the same transaction id, so **every
statement in one `query_database` call runs inside a single implicit
transaction**.

Error surfacing — a second probe (`SELECT 1; SELECT 1/0;`) returned
`ERROR: 22012: division by zero` to the caller, so a failure inside the batch
is reported rather than swallowed. With the batch proven to be one
transaction, PostgreSQL's implicit-transaction semantics make any such failure
abort the whole batch.

The migration file contains **no** `BEGIN`, `COMMIT`, `ROLLBACK` or
`START TRANSACTION`, so nothing inside it can break the single transaction
open. The file was submitted as one call and was therefore all-or-nothing.

**Result: ATOMIC. Not split.**

## 3. Dynamic baselines

Captured 2026-09-10 10:44:44Z, in the same session, immediately before apply.
No hard-coded counts were used for acceptance.

| Baseline | Pre (10:44:44Z) | Post (10:49:56Z) | Delta |
|---|---|---|---|
| `vehicle_listings` | 287 | 287 | 0 |
| `tenants` | 2 | 2 | 0 |
| `dealer_profiles` | 2 | 2 | 0 |
| `tenant_members` | 4 | 4 | 0 |
| `user_roles` | 2 | 2 | 0 |
| `audit_log` | 11,726 | 11,726 | 0 |
| `public` base tables | 143 | 148 | +5 |

Collision check before apply: target tables 0, target functions 0, target
triggers 0, target policy names 0. The single `market%` policy match was
`marketcheck_config_read` on `marketcheck_sync_config` — a pre-existing,
unrelated object, not a collision.

Migration ledger before apply: latest `20260909124610`; `20260910090000`
absent.

## 4. Apply

- **Started**: 2026-09-10 10:46:xx Z
- **Committed**: 2026-09-10 10:46:59.290268 Z
- **Transaction id**: 447341
- **Outcome**: success, no errors, no warnings returned

Exact reviewed content of the Gate 14A-2 candidate. No opportunistic SQL, no
backfill, no provider call, no market table populated, no UI enabled.

## 5. Allowlist verification (live catalog, not migration text)

| Object class | Expected | Catalog | Result |
|---|---|---|---|
| Tables | 5 | 5 | PASS |
| RLS enabled | 5 | 5 | PASS |
| Functions | 5 | 5 | PASS |
| Triggers (non-internal) | 2 | 2 | PASS |
| Policies | 6 | 6 | PASS |
| Declared `CREATE INDEX` | 13 | 19 total | PASS (reconciled) |
| Named table constraints | 35 | 45 total | PASS (reconciled) |
| `COMMENT ON` | 4 | 2 table + 2 function | PASS |
| Table owner | `postgres` | `postgres` (1 distinct) | PASS |

Index reconciliation: 19 = 13 declared indexes + 5 primary keys + 1 index
backing `vmv_id_tenant_unique`.

Constraint reconciliation: 45 = 35 named constraints (33 CHECK + 1 UNIQUE +
1 composite FK) + 5 primary keys + 5 inline `REFERENCES public.tenants(id)`
foreign keys. Catalog reports 33 CHECK and 6 FK, which matches exactly.

## 6. RLS canaries

Run with `SET LOCAL ROLE authenticated` **and** `SET LOCAL request.jwt.claims`,
in the same transaction, so `auth.uid()` actually resolves. Confirmed: the
`resolved_uid` returned by each canary equals the intended subject.

Because all five tables are empty, row counts cannot demonstrate isolation —
zero rows returns zero for everyone. Each canary therefore evaluates the
**policy predicates themselves** as the real role with the real uid, and the
live reads are reported separately as reachability checks.

### A. Harte owner reads Harte valuation tables

Subject `f6953bc5-8621-4d85-a12b-bb6e7389f21a` (owner, accepted, Harte only):

| Predicate | Result |
|---|---|
| `harte_valuation_policy_passes` | **true** |
| `other_tenant_valuation_policy_passes` (93ae75c1) | **false** |
| Live reads on all 5 tables | permitted, 0 rows |

**PASS.**

### B. Manager read of budget / reservation tables

Subject `553e5ba5-0f6a-47a2-97f8-ae0a893567ba` — a **non-platform-admin**
manager of tenant `93ae75c1`. This isolates the manager arm from the admin arm,
which the two Harte owners cannot do because both are also platform admins.

| Predicate | Result |
|---|---|
| `is_platform_admin` | **false** |
| `own_manager_arm_passes` (93ae75c1) | **true** |
| `own_valuation_policy_passes` (93ae75c1) | **true** |

The manager arm grants access on its own, with the admin arm off. **PASS.**

Also confirmed for `f6953bc5`: `harte_manager_arm_passes = true`.

### C. Outsider cannot read another tenant's rows

Same subject `553e5ba5`, evaluated against Harte tenant `3f0f97f5`:

| Predicate | Result |
|---|---|
| `harte_valuation_policy_passes` | **false** |
| `harte_manager_arm_passes` | **false** |

Both arms deny. **PASS.**

### D. Platform admin

Subject `f6953bc5`: `admin_arm_passes = true` via
`public.has_role((SELECT auth.uid()), 'admin'::app_role)`. **PASS.**

### E. Anonymous

`SET LOCAL ROLE anon; SELECT count(*) FROM public.vehicle_market_valuations;`

```
ERROR: 42501: permission denied for table vehicle_market_valuations
```

Denied at the privilege layer, before RLS. **PASS.**

### Explicit evidence gap

**The non-manager-in-same-tenant case is NOT BEHAVIORALLY TESTABLE WITH
CURRENT PRODUCTION IDENTITIES.**

All four `tenant_members` rows are accepted owners, so
`is_tenant_manager` returns true for every one of them. There is no ordinary
tenant member (salesperson) in the database today, so the proposition "a
non-manager tenant member can read valuations but not budgets" has no real
subject to test against.

The manager restriction is currently supported by:

- policy text, read back from `pg_policies` (§8);
- the verified helper signature `is_tenant_manager(_tenant_id, _user_id)`;
- unit and migration-guard tests in the repository.

It is **not** supported by a real-user canary. This gap closes only when a
non-manager member exists.

## 7. Append-only canary

Four prohibited mutations attempted as `service_role`, each with a predicate
that cannot match a row (`WHERE false`) or against an empty table, so nothing
could be written even had they been permitted.

| Attempt | SQLSTATE | Mechanism |
|---|---|---|
| `UPDATE public.vehicle_market_valuations` | **42501** | privilege denial |
| `DELETE FROM public.vehicle_market_valuations` | **42501** | privilege denial |
| `UPDATE public.vehicle_market_comparables` | **42501** | privilege denial |
| `TRUNCATE public.vehicle_market_valuations` | **42501** | privilege denial |

Error text (representative):

```
ERROR: 42501: permission denied for table vehicle_market_valuations
HINT:  Grant the required privileges to the current role with:
       GRANT UPDATE ON public.vehicle_market_valuations TO service_role;
```

**The append-only trigger did NOT fire.** PostgreSQL checks table privileges
before row triggers, and `UPDATE`, `DELETE` and `TRUNCATE` are revoked from
`service_role` on both evidence tables, so the statement is rejected before any
row is considered. `trg_vmv_append_only` and `trg_vmc_append_only` exist and
are attached (verified in `pg_trigger`), but they were not exercised.

No temporary GRANT was issued to reach the trigger. That is outside this gate.

## 8. Function security

All five functions carry `search_path=pg_catalog, public` in the live
`pg_proc.proconfig`:

```
functions_with_pinned_search_path = 5 / 5
```

Policy definitions read back from `pg_policies`:

| Policy | `qual` |
|---|---|
| `market_provider_budgets manager read` | `is_tenant_manager(tenant_id, (SELECT auth.uid())) OR has_role((SELECT auth.uid()), 'admin'::app_role)` |
| `provider_request_reservations manager read` | `is_tenant_manager(tenant_id, (SELECT auth.uid())) OR has_role((SELECT auth.uid()), 'admin'::app_role)` |
| `market_value_model_metrics platform admin read` | `has_role((SELECT auth.uid()), 'admin'::app_role)` |
| `market_value_model_metrics tenant read` | `tenant_id IS NOT NULL AND tenant_id IN (SELECT ... FROM tenant_members WHERE user_id = (SELECT auth.uid()))` |
| `vehicle_market_valuations tenant read` | `tenant_id IN (SELECT ... FROM tenant_members WHERE user_id = (SELECT auth.uid()))` |
| `vehicle_market_comparables tenant read` | `tenant_id IN (SELECT ... FROM tenant_members WHERE user_id = (SELECT auth.uid()))` |

Confirmed: **`tenant_id` is the first argument** to `is_tenant_manager` in both
manager policies; the admin check goes through `public.has_role`; every
`auth.uid()` is wrapped as `(SELECT auth.uid())`; all six are `FOR SELECT` to
`{authenticated}` only. No INSERT, UPDATE or DELETE policy exists on any of the
five tables.

## 9. Identity contract

`vehicle_market_comparables` carries **both** columns, distinct and nullable:

| Column | Type |
|---|---|
| `dealer_group_id` | `text` — provider-issued stable identifiers only |
| `dealer_group_name` | `text` — trading / group name |

No group name was written into any identifier field. No tenant has a
`dealer_identity` setting configured (`dealer_identity` is null for both
tenants), so "Harte Auto Group" exists in production only as
`vehicle_listings.dealership_group_name` data — never as a group ID.

The code-side contract (group-name matches return `name_only` confidence, and
`tenantIdentityStability` counts `groupNames` as a name, so a group name alone
cannot produce high confidence or a red verdict) is enforced by
`src/lib/market/dealerIdentity.ts` and its 16 tests at commit `739473da`.

## 10. Mandatory add-on contract

All four columns exist on `vehicle_market_valuations`, **all nullable, none
with a default**, so an unanswered question is stored as NULL and can never
default to zero:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `mandatory_dealer_add_ons` | `numeric(12,2)` | YES | none |
| `mandatory_add_ons_included_in_displayed_price` | `boolean` | YES | none |
| `mandatory_add_on_source` | `text` | YES | none |
| `total_with_mandatory_add_ons` | `numeric(12,2)` | YES | none |

`price_basis_status` is `NOT NULL`, as required.

Production settings confirm nothing was assumed: `mandatory_add_ons_usd` is
**null** for both tenants and `mandatory_add_ons_verified` is unset, so both
tenants resolve to `source = unknown` and an ambiguous basis. **No tenant-wide
zero was written.** No draft addendum was promoted to verified pricing. No
desk-charged add-on was folded into an advertised price.

## 11. Zero-row final state

| Table | Rows |
|---|---|
| `vehicle_market_valuations` | **0** |
| `vehicle_market_comparables` | **0** |
| `market_value_model_metrics` | **0** |
| `market_provider_budgets` | **0** |
| `provider_request_reservations` | **0** |

The migration creates no system or config rows and none appeared. All
pre-existing table counts are unchanged (§3), including `audit_log` at 11,726 —
so nothing in this gate wrote an audit entry either.

## 12. Provider calls

**None.** No MarketCheck call, no other paid provider call, no Edge Function
invoked. Every statement in this gate was SQL against the database.

## 13. Customer-facing change

**None.** No feature flag was set: `market_value_v2_admin` is absent from both
tenants' `dealer_profiles.settings`, and neither profile carries any `market*`
key at all. No UI, Passport module, Vehicle File module, red warning or
AutoFilm output was enabled. No application code was deployed or published as
part of this gate.

## 14. Unexpected findings

Four findings, all discovered by verifying live catalog state rather than
migration text. **None was remediated** — remediation is outside this gate.

### F1 — `authenticated` retains TRUNCATE on three tables (MEDIUM)

`market_value_model_metrics`, `market_provider_budgets` and
`provider_request_reservations` all show ACL `authenticated=rDxtm`, i.e.
SELECT + **TRUNCATE** + REFERENCES + TRIGGER + MAINTAIN.

The migration revokes `INSERT, UPDATE, DELETE` from `anon, authenticated` on
these three tables, but not `TRUNCATE`. Supabase's default privileges grant ALL
on new `public` tables to `authenticated`, so TRUNCATE survives. **RLS does not
restrict TRUNCATE** — it governs SELECT/INSERT/UPDATE/DELETE only — so the
policies in §8 do not compensate.

The two evidence tables are NOT affected: they revoke TRUNCATE explicitly and
show `authenticated=arxtm` with no `D`.

I did **not** execute a TRUNCATE to demonstrate this. The privilege is proven
by `has_table_privilege(... 'TRUNCATE') = true` and by the raw ACL; executing
it would have taken an ACCESS EXCLUSIVE lock and rewritten the relation on a
production table for no additional evidence.

Proposed remedy (not applied): add
`REVOKE TRUNCATE ON <the three tables> FROM anon, authenticated;`

### F2 — `authenticated` retains INSERT on both evidence tables (LOW)

ACL `authenticated=arxtm` includes `a` (INSERT) on
`vehicle_market_valuations` and `vehicle_market_comparables`. An actual insert
is blocked because RLS is enabled and no INSERT policy exists for
`authenticated`, so this is not an open hole — but the intended posture was
"the writer is service_role", and here that is enforced by RLS alone rather
than by RLS and privilege together.

Proposed remedy (not applied): `REVOKE INSERT ... FROM authenticated;`

### F3 — `sandbox_exec` role holds INSERT + SELECT on all five tables (INFO)

Every one of the five new tables shows `sandbox_exec=ar/postgres`. This role
was not created or referenced by this migration; it arrives through
`ALTER DEFAULT PRIVILEGES` on the project and presumably applies to other
`public` tables too. Flagged for the owner's awareness, not attributed to this
change.

### F4 — Migration is not recorded in the Supabase ledger (MEDIUM, process)

After apply, `supabase_migrations.schema_migrations` still shows latest
`20260909124610`, and `20260910090000` is absent. Applying through
`query_database` executes the SQL but does not write the ledger row.

Consequence: when commit `739473da` reaches `main`, Lovable's git-driven
deploy will attempt to apply this file again. The file was verified fully
idempotent before apply — every `CREATE TABLE`/`CREATE INDEX` uses
`IF NOT EXISTS`, every function uses `CREATE OR REPLACE`, every trigger and
policy is preceded by `DROP ... IF EXISTS` — so a second apply is expected to
be a no-op rather than a failure. It has not been tested.

### F5 — `reject_valuation_mutation` EXECUTE is not revoked (INFO)

ACL `{=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X}`. This
is the PostgreSQL default for a new function and is normal for a trigger
function, which must be executable for the trigger to fire. Called directly
outside a trigger context it raises an error rather than doing anything. No
action proposed.

## 15. Rollback status

**No rollback was performed or required.** The migration applied cleanly in a
single transaction with no error. Nothing was reverted, and no compensating
statement was issued.

Had it failed, the proven single-transaction semantics (§2) would have rolled
the whole file back with no partial state.

## 16. GO / NO-GO

**Gate 14A-2 itself: GO.** The migration applied atomically, every allowlisted
object exists in the catalog with the expected shape, all five functions pin
their search path, all six policies read back with the correct helper calls and
argument order, the append-only evidence tables reject every mutation from
every runtime role, `anon` is denied outright, tenant isolation holds on every
predicate tested, and all five tables are at zero rows with no existing data
touched.

**Proceeding to the next gate: NO-GO pending two items.**

1. **F1** must be closed before any data reaches
   `market_provider_budgets` or `provider_request_reservations`. Today the
   exposure is theoretical because all three tables are empty, but a budget
   table that any signed-in user can TRUNCATE is not a budget control. This is
   a three-line REVOKE and a matching migration-guard test.
2. **F4** must be decided: either record the ledger row so the git deploy skips
   the file, or accept the re-apply and verify idempotency on a non-production
   target first.

**F2** should be folded into the same follow-up patch. **F3** and **F5** need
no action.

I have not applied any remediation and will not without explicit approval. No
further action has been taken past Gate 14A-2.

---

Generated 2026-09-10. Verification queries were run against the live database
through Lovable MCP `query_database`; every count and ACL in this report is
catalog state, not migration text.
