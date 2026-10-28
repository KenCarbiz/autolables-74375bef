# Administration V2: server authority and policy apply

Prepared 2026-10-28. **Not applied.** Two migrations, applied only on the
owner's explicit authorization, through the usual Lovable migration path,
in this order:

1. `supabase/migrations/20261029000000_admin_v2_policy_apply.sql`
2. `supabase/migrations/20261029001000_admin_v2_settings_authority.sql`

Migration 2 depends on migration 1 (`tenant_role_in`). Neither touches an
existing migration. Both are re-runnable (`IF NOT EXISTS`, `OR REPLACE`,
`DROP ... IF EXISTS` before each `CREATE POLICY` and `CREATE TRIGGER`).

Text-level tests live in `src/lib/admin/sql/` and run with
`bunx vitest run src/lib/admin/sql`. They hold the SQL to the rules below;
they cannot execute it. The dry-run section is how the SQL is exercised
before it is applied.

## 1. Why

Two write-safety findings from the October 20 review drive this work.

**P0-A, fee application was a side effect.** The Admin page recalculated
the doc fee from an effect on settings state. Ordinary hydration (cache,
then server) satisfied that effect, so opening the page could call
`recalc_tenant_doc_fee`, which rewrites `doc_fee` and `website_sale_price`
on every priced listing of the tenant, archived stock included, resets
`price_parse_status` to `ok` and stamps `price_last_verified_at = now()`
as if every price had just been observed. The effect was removed in the
keystone commit. The server still had no safe writer: migration 1 adds one.

**P0-B, authorization lived in the client.** `dealerRoleCapabilities` and
`adminTabAccess` decide what each role sees. The server let any accepted
member of a tenant update `dealer_profiles` directly (whole-settings
upsert), write `products` and `product_rules`, and change any column of a
`vehicle_listings` row, price and recall override included, through the
member-wide UPDATE policy. A role-aware navigation is not authorization.
Migration 2 makes the server the authority for the writes the
Administration surfaces touch.

## 2. What changes, object by object

### Migration 1: `20261029000000_admin_v2_policy_apply.sql`

| Object | Change | Notes |
| --- | --- | --- |
| `public.tenant_role_in(uuid, text[])` | new, SQL, STABLE, SECURITY DEFINER | accepted member of the tenant whose `lower(trim(role))` is in the list; `(SELECT auth.uid())` |
| `public.admin_tenant_member_ok(uuid)` | new, SQL, STABLE, SECURITY DEFINER | platform admin (`has_role(..., 'admin')`) or accepted member |
| `dealer_profiles.policy_version` | new column `bigint NOT NULL DEFAULT 1` | constant default: metadata-only on PG 11+ |
| `dealer_profiles_bump_policy_version` | new BEFORE UPDATE trigger | increments only when `settings IS DISTINCT FROM` the old value |
| `vehicle_listings.price_recalculated_at` | new nullable `timestamptz` | the recalculation stamp; `price_last_verified_at` stays the verification stamp |
| `public.admin_policy_applications` | new table, RLS on | PK `idempotency_key`; tenant members SELECT; no client INSERT/UPDATE/DELETE; written only by the apply RPC |
| `admin_policy_version(uuid)` | new RPC | member or platform admin; `coalesce(policy_version, 1)` |
| `admin_doc_fee_change_preview(uuid, boolean, numeric, boolean)` | new RPC, STABLE | pricing roles or platform admin; counts, five samples by VIN suffix, warnings; never writes |
| `admin_doc_fee_change_apply(uuid, boolean, numeric, bigint, text, boolean)` | new RPC | pricing roles or platform admin; ledger check, row lock, version check, settings patch, changed-rows listing update, audit row, ledger row |
| `admin_feed_last_success(uuid)` | new RPC, STABLE | `max(started_at)` over `inventory_sync_runs` with `status IN ('success','partial')`; no window |
| `admin_job_status(uuid)` | new RPC, STABLE, `search_path public, cron` | named platform jobs from `cron.job` plus run times from `cron.job_run_details`; tenant rows from the feed, crawl and description ledgers; never selects `command` or `return_message` |

Every function: `REVOKE ALL ... FROM PUBLIC, anon` then
`GRANT EXECUTE ... TO authenticated, service_role`.

Apply semantics, in order:

1. Role check (owner, admin, general_manager, gsm, or platform admin);
   key length at least 8; amount at least 0; expected version present.
2. Ledger lookup by key. A hit returns the stored result with
   `status: 'duplicate'` and `original_status`, and changes nothing.
3. `INSERT ... ON CONFLICT DO NOTHING` so a tenant with no settings row
   gets one, then `SELECT ... FOR UPDATE` on `dealer_profiles`.
4. Ledger lookup again under the lock, so a same-key call that finished
   while this one waited is a `duplicate`, not a `conflict`.
5. `policy_version` compared to `p_expected_version`. A mismatch returns
   `{status: 'conflict', affected: 0, version}` without writing.
6. `settings || {doc_fee_enabled, doc_fee_amount}`; the trigger bumps the
   version; the new version is returned.
7. `UPDATE vehicle_listings SET doc_fee, website_sale_price,
   price_recalculated_at = now()` where the tenant matches, a price basis
   exists, the row is active (or `p_include_archived`), and the value would
   change. `price_last_verified_at`, `price_parse_status` and
   `price_parse_notes` are not in the statement.
8. One `audit_log` row, action `doc_fee_policy_applied`, with prev, next,
   fee applied, affected count, flags, both versions and the key.
9. One ledger row. A `unique_violation` on it (a concurrent same-key
   winner) rolls this call back and returns the winner's result as a
   `duplicate`.

`partial` is never produced: the listing update is one statement.
`failed` is produced only when a concurrent winner's ledger row cannot be
read back, which should not happen.

### Migration 2: `20261029001000_admin_v2_settings_authority.sql`

| Object | Change | Notes |
| --- | --- | --- |
| `merge_dealer_settings(uuid, jsonb)` | replaced | same signature, SECURITY DEFINER, same patch-only merge; key classes below; audit per class |
| policy `dealer_profiles_update` | dropped | members write through the RPC only |
| policy `dealer_profiles_insert` | dropped | same |
| policy `Platform admins write all dealer profiles` | kept | the `PlatformTenants` upsert keeps working |
| policies `dealer_profiles_select`, `Platform admins read all dealer profiles` | kept | reads unchanged |
| `dealer_profiles` privileges | `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM anon, authenticated`; `REVOKE INSERT, UPDATE, DELETE FROM anon` | UPDATE/INSERT/DELETE stay granted to `authenticated` because the platform-admin policy needs them; without a matching policy a member's direct write is refused by RLS |
| policy `products tenant members write` (ALL) | dropped | replaced by three per-command policies |
| policies `products addon roles insert/update/delete` | new, `TO authenticated` | `tenant_id IS NOT NULL AND tenant_role_in(tenant_id, addon roles)`; platform templates (`tenant_id IS NULL`) stay admin-only |
| policy `Tenant members write product_rules` (ALL) | dropped | replaced likewise |
| policies `product_rules addon roles insert/update/delete` | new, `TO authenticated` | `tenant_role_in(tenant_id, addon roles)` |
| read policies on `products`, `product_rules` | untouched | |
| `vehicle_listings_guard_priced_columns()` | new trigger function, SECURITY INVOKER | returns early unless `current_user = 'authenticated'`; platform admin passes; tenantless draft passes for its creator; price columns need a `can_edit_inventory` role; recall override columns need a `can_manage_compliance` role; refuses with `42501` |
| `trg_vehicle_listings_priced_columns_guard` | new `BEFORE UPDATE OF` the nine guarded columns | fires only when a guarded column is in the SET list |
| privileges on `products`, `product_rules`, `vehicle_listings` | `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM anon, authenticated` | row security never governed these |

Settings key classes in `merge_dealer_settings` (a patch may touch several
classes; the caller must satisfy each one it touches; a platform admin
satisfies all):

| Class | Keys | Roles | Audit action |
| --- | --- | --- | --- |
| service | `k208_authority_roles`, `k208_authorized_users`, `require_safety_inspection`, `require_k208_licensee_certification`, `service_failure_photo_required`, `service_reinspection_managers_only`, `service_pass_all_enabled`, `service_overdue_hours` | owner, general_manager, gsm, admin, manager, service_manager (unchanged) | `service_policy_changed` (unchanged) |
| pricing | `doc_fee_enabled`, `doc_fee_amount`, `doc_fee_state`, `price_display_mode`, `price_label`, `comp_settings`, `todays_price_mode`, `todays_price_custom`, `financing_disclosure_apr`, `title_policy_no_branded` | owner, admin, general_manager, gsm | `pricing_policy_changed` |
| routing | `passport_contact_routing`, `passport_agents`, `vehicle_agent_assignments`, `passport_rotation_state` | owner, admin, general_manager, gsm, manager, sales_manager, used_car_manager, finance | `routing_policy_changed` |
| publishing | `ingest_auto_publish`, `document_rules`, `require_install_verification`, `ingest_recon_dispatch`, `ingest_detail_dispatch`, `factory_sticker`, `packet_module_defaults`, `passport_version`, `history_report_links_enabled` | owner, admin, general_manager, gsm, manager | `publishing_policy_changed` |
| addon | `dealer_programs`, `oem_factory_warranties`, `cpo_programs`, `product_default_mode`, `allow_type_override_at_signing` | owner, admin, general_manager, gsm, manager, sales_manager, used_car_manager, finance, office, compliance | `addon_policy_changed` |
| member | `label_defaults`, `used_sticker_options`, `inventory_show_quick_actions` | any accepted member | none |
| everything else (identity, brand, features, notifications, print) | all other keys | owner, admin, general_manager, gsm, manager | none |

The role lists are the server-side image of `dealerRoleCapabilityMap`:
pricing = the fee apply list from the brief; routing = `can_manage_settings`
or `can_manage_deals` (the `passport-routing` tab rule); addon =
`can_manage_addons`; settings = `can_manage_settings`; price columns on
listings = `can_edit_inventory`; recall override = `can_manage_compliance`.

## 3. Dry-run (read-only, run before applying)

Run each as a platform operator against the project database. Nothing here
writes. Record the outputs with the apply ticket; the policy, function and
privilege snapshots are what the rollback restores.

**3.1 Members who lose direct `dealer_profiles` writes but keep RPC writes
to the three member keys.** Expect sales, service and clerical roles; any
manager-class role here would be a surprise.

```sql
SELECT tm.tenant_id, lower(trim(coalesce(tm.role, ''))) AS role, count(*) AS members
FROM public.tenant_members tm
WHERE tm.accepted_at IS NOT NULL
  AND lower(trim(coalesce(tm.role, ''))) NOT IN ('owner','admin','general_manager','gsm','manager')
GROUP BY 1, 2
ORDER BY 1, 2;
```

**3.2 Members who lose `products` and `product_rules` writes.** The Admin
products and rules tabs are gated on `can_manage_settings` or
`can_manage_addons`; anyone listed here could not reach the editor today.

```sql
SELECT tm.tenant_id, lower(trim(coalesce(tm.role, ''))) AS role, count(*) AS members
FROM public.tenant_members tm
WHERE tm.accepted_at IS NOT NULL
  AND lower(trim(coalesce(tm.role, ''))) NOT IN
      ('owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance')
GROUP BY 1, 2
ORDER BY 1, 2;
```

**3.3 Legacy role values.** The client aliases `staff`, `sales` and
`viewer`; the server does not. Expect zero rows; otherwise reassign before
applying.

```sql
SELECT lower(trim(coalesce(role, ''))) AS role, count(*)
FROM public.tenant_members
WHERE accepted_at IS NOT NULL
  AND lower(trim(coalesce(role, ''))) NOT IN (
    'owner','general_manager','gsm','admin','manager','sales_manager','salesperson',
    'used_car_manager','inventory_manager','service_manager','service_advisor','detail',
    'third_party_vendor','office','finance','compliance','biller','readonly')
GROUP BY 1;
```

**3.4 Listing impact at the current fee.** This is what the preview RPC
will report for a no-change review; it must be computed before the apply
RPC exists so the first real review can be checked against it.

```sql
WITH fee AS (
  SELECT dp.tenant_id,
         CASE WHEN (dp.settings->>'doc_fee_enabled')::boolean
              THEN round(coalesce((dp.settings->>'doc_fee_amount')::numeric, 0), 2)
              ELSE 0 END AS v_fee
  FROM public.dealer_profiles dp
)
SELECT vl.tenant_id,
       count(*) FILTER (WHERE vl.archived_at IS NULL)     AS active_with_basis,
       count(*) FILTER (WHERE vl.archived_at IS NOT NULL) AS archived_with_basis,
       count(*) FILTER (WHERE vl.archived_at IS NULL
                          AND (vl.doc_fee IS DISTINCT FROM f.v_fee
                               OR vl.website_sale_price IS DISTINCT FROM vl.advertised_price_before_doc + f.v_fee)) AS active_would_change,
       count(*) FILTER (WHERE vl.archived_at IS NOT NULL
                          AND (vl.doc_fee IS DISTINCT FROM f.v_fee
                               OR vl.website_sale_price IS DISTINCT FROM vl.advertised_price_before_doc + f.v_fee)) AS archived_would_change,
       count(*) FILTER (WHERE vl.archived_at IS NULL AND vl.price_parse_status = 'warning') AS active_parse_warnings
FROM public.vehicle_listings vl
JOIN fee f ON f.tenant_id = vl.tenant_id
WHERE vl.advertised_price_before_doc IS NOT NULL
GROUP BY 1
ORDER BY 1;
```

**3.5 Snapshots for rollback.**

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('dealer_profiles','products','product_rules','vehicle_listings')
ORDER BY tablename, policyname;

SELECT pg_get_functiondef('public.merge_dealer_settings(uuid, jsonb)'::regprocedure);

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('dealer_profiles','products','product_rules','vehicle_listings')
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY 1, 2, 3;

SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.vehicle_listings'::regclass AND NOT tgisinternal
ORDER BY tgname;

SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('tenant_role_in','admin_tenant_member_ok','admin_policy_version',
                  'admin_doc_fee_change_preview','admin_doc_fee_change_apply',
                  'admin_feed_last_success','admin_job_status',
                  'dealer_profiles_bump_policy_version','vehicle_listings_guard_priced_columns');
```

The last query must return zero rows before migration 1 (none of these
names exist today) and nine rows after migration 2.

**3.6 Client and job writers (code check, done 2026-10-28).**

- Direct `dealer_profiles` writes from the client: the
  `DealerSettingsContext.updateSettings` fallback upsert, which runs only
  when the `merge_dealer_settings` RPC is reported missing (S2 removes it),
  and the `PlatformTenants` upsert, which is a platform-admin surface and
  stays covered by the platform-admin policy. Nothing else.
- Edge functions read `dealer_profiles` with the service-role client;
  `lead-alert` also updates `passport_rotation_state` with it. RLS does not
  apply to the service role, so none of them change behaviour.
- `products` and `product_rules` client writers: `useProductRules` and the
  Admin products tab, both behind tabs gated on `can_manage_settings` or
  `can_manage_addons`. The server list now matches the client gate.
- `vehicle_listings` price columns are written by the inventory surfaces
  (roles holding `can_edit_inventory`), by `recalc_tenant_doc_fee` and the
  new apply RPC (SECURITY DEFINER, so `current_user` is the owner and the
  guard passes), and by the sync, crawl and enrichment edge functions
  (service role, guard passes). Recall override columns are written by the
  compliance surfaces.

## 4. Apply order and verification

Apply migration 1, verify, then migration 2, verify. Both are short
transactions: the new columns are metadata-only, and the triggers take a
brief `SHARE ROW EXCLUSIVE` lock on their tables. Avoid the feed window
(07:00 UTC) and the crawl window (07:20 UTC) so the lock never queues
behind a long sync write.

**After migration 1.**

```sql
SELECT proname, prosecdef, provolatile
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND (proname LIKE 'admin\_%' OR proname = 'tenant_role_in');
-- expect prosecdef = true on every row

SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'dealer_profiles' AND column_name = 'policy_version')
    OR (table_name = 'vehicle_listings' AND column_name = 'price_recalculated_at'));

SELECT count(*) AS recalculated_rows FROM public.vehicle_listings WHERE price_recalculated_at IS NOT NULL;
-- expect 0: nothing has been applied yet

SELECT relrowsecurity FROM pg_class WHERE oid = 'public.admin_policy_applications'::regclass;
-- expect true
```

Then, signed in as a member who holds a pricing role, from the app's
Supabase client:

- `admin_policy_version(<tenant_id>)` returns `1` for a tenant that has not
  changed settings since the migration.
- `admin_doc_fee_change_preview(<tenant_id>, <current enabled>, <current
  amount>)` returns counts equal to 3.4 for that tenant and `eligible`
  equal to `active_would_change`; the recalculated-rows count above is
  still 0 afterwards.
- `admin_job_status(<tenant_id>)` returns one platform row per listed job
  that exists in `cron.job` (22 on 2026-10-28) and 3 tenant rows; no row
  contains a URL or a key.

Signed in as a salesperson, each of the fee RPCs fails with `42501`;
`admin_policy_version` and `admin_job_status` succeed (member reads).

**After migration 2.**

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('dealer_profiles','products','product_rules')
ORDER BY 1, 2;
-- expect: no dealer_profiles_update, no dealer_profiles_insert,
-- the platform-admin and read policies present, six "addon roles" policies

SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.vehicle_listings'::regclass AND tgname = 'trg_vehicle_listings_priced_columns_guard';

SELECT position('pricing_policy_changed' IN pg_get_functiondef('public.merge_dealer_settings(uuid, jsonb)'::regprocedure)) > 0;
-- expect true
```

Then, from the app:

- A manager saving a brand key succeeds; the same manager saving
  `doc_fee_amount` fails with `42501` and detail `pricing`.
- An owner saving `doc_fee_amount` through `merge_dealer_settings` writes
  one `pricing_policy_changed` audit row and bumps `policy_version` by one.
- A salesperson saving `label_defaults` succeeds.
- A salesperson's direct `dealer_profiles` update is refused by RLS.
- An inventory manager changing a price in the inventory surface succeeds;
  a salesperson attempting the same update through the API is refused with
  `42501`.
- The next feed run and the next crawl run still write prices (service
  role; `inventory_sync_runs` and `advertised_price_crawl_attempts` show
  new rows after their windows).

## 5. Rollback

Roll back in reverse order: migration 2 first, then migration 1. Migration
2's policies and trigger depend on `tenant_role_in`, so dropping the helper
first fails with a dependency error (which is the right outcome).

### 5.1 Rollback of migration 2

Restores the policy set, privileges and `merge_dealer_settings` body that
were live on 2026-10-28 (the body is the one from
`20260726180000_harden_merge_dealer_settings.sql`, verbatim).

```sql
BEGIN;

DROP TRIGGER IF EXISTS trg_vehicle_listings_priced_columns_guard ON public.vehicle_listings;
DROP FUNCTION IF EXISTS public.vehicle_listings_guard_priced_columns();

DROP POLICY IF EXISTS "products addon roles insert" ON public.products;
DROP POLICY IF EXISTS "products addon roles update" ON public.products;
DROP POLICY IF EXISTS "products addon roles delete" ON public.products;
DROP POLICY IF EXISTS "product_rules addon roles insert" ON public.product_rules;
DROP POLICY IF EXISTS "product_rules addon roles update" ON public.product_rules;
DROP POLICY IF EXISTS "product_rules addon roles delete" ON public.product_rules;

CREATE POLICY "products tenant members write"
  ON public.products FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                       WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))))
  WITH CHECK (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                            WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))));

CREATE POLICY "Tenant members write product_rules"
  ON public.product_rules FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                       WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))))
  WITH CHECK (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                            WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))));

CREATE POLICY dealer_profiles_update
  ON public.dealer_profiles FOR UPDATE
  TO authenticated
  USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role)
         OR (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                           WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL)))))
  WITH CHECK (has_role((SELECT auth.uid() AS uid), 'admin'::app_role)
         OR (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                           WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL)))));

CREATE POLICY dealer_profiles_insert
  ON public.dealer_profiles FOR INSERT
  TO authenticated
  WITH CHECK (has_role((SELECT auth.uid() AS uid), 'admin'::app_role)
         OR (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                           WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL)))));

-- Privileges. The 2026-10-28 snapshot showed anon and authenticated holding
-- every privilege on these tables. Restoring them is optional: anon has no
-- policy on any of them, and TRUNCATE, REFERENCES and TRIGGER are never
-- used by the API roles. Run these two statements only if the exact prior
-- privilege set is wanted.
-- GRANT TRUNCATE, REFERENCES, TRIGGER ON public.dealer_profiles, public.products, public.product_rules, public.vehicle_listings TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.dealer_profiles TO anon;

CREATE OR REPLACE FUNCTION public.merge_dealer_settings(_tenant_id UUID, _patch JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_protected text[] := ARRAY[
    'k208_authority_roles','k208_authorized_users',
    'require_safety_inspection','require_k208_licensee_certification',
    'service_failure_photo_required','service_reinspection_managers_only',
    'service_pass_all_enabled','service_overdue_hours'];
  v_touched text[];
BEGIN
  SELECT lower(trim(tm.role)) INTO v_role
    FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
    LIMIT 1;
  IF v_role IS NULL AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT array_agg(k) INTO v_touched
    FROM jsonb_object_keys(COALESCE(_patch, '{}'::jsonb)) AS t(k)
    WHERE k = ANY(v_protected);
  IF v_touched IS NOT NULL THEN
    IF NOT (public.has_role(v_uid, 'admin'::public.app_role)
            OR v_role IN ('owner','general_manager','gsm','admin','manager','service_manager')) THEN
      RAISE EXCEPTION 'not_authorized_for_policy_keys';
    END IF;
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
    VALUES ('service_policy_changed', 'tenant', _tenant_id::text, _tenant_id::text, v_uid,
            jsonb_build_object('keys', to_jsonb(v_touched),
              'prev', (SELECT jsonb_object_agg(k, dp.settings -> k)
                       FROM unnest(v_touched) AS k, public.dealer_profiles dp
                       WHERE dp.tenant_id = _tenant_id),
              'next', (SELECT jsonb_object_agg(k, _patch -> k) FROM unnest(v_touched) AS k)));
  END IF;
  INSERT INTO public.dealer_profiles (tenant_id, settings, updated_by)
  VALUES (_tenant_id, COALESCE(_patch, '{}'::jsonb), v_uid)
  ON CONFLICT (tenant_id) DO UPDATE
    SET settings   = COALESCE(dealer_profiles.settings, '{}'::jsonb) || COALESCE(_patch, '{}'::jsonb),
        updated_by = v_uid;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_dealer_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_dealer_settings(uuid, jsonb) TO authenticated;

COMMIT;
```

### 5.2 Rollback of migration 1

```sql
BEGIN;

-- Export first if the ledger holds rows: SELECT * FROM public.admin_policy_applications;
DROP FUNCTION IF EXISTS public.admin_job_status(uuid);
DROP FUNCTION IF EXISTS public.admin_feed_last_success(uuid);
DROP FUNCTION IF EXISTS public.admin_doc_fee_change_apply(uuid, boolean, numeric, bigint, text, boolean);
DROP FUNCTION IF EXISTS public.admin_doc_fee_change_preview(uuid, boolean, numeric, boolean);
DROP FUNCTION IF EXISTS public.admin_policy_version(uuid);
DROP TABLE IF EXISTS public.admin_policy_applications;
DROP TRIGGER IF EXISTS dealer_profiles_bump_policy_version ON public.dealer_profiles;
DROP FUNCTION IF EXISTS public.dealer_profiles_bump_policy_version();
DROP FUNCTION IF EXISTS public.admin_tenant_member_ok(uuid);
DROP FUNCTION IF EXISTS public.tenant_role_in(uuid, text[]);

-- The two columns are kept. Both are harmless without the RPCs (one has a
-- constant default, the other is nullable) and keeping them preserves the
-- recalculation history. Drop them only if the owner asks:
-- ALTER TABLE public.vehicle_listings DROP COLUMN IF EXISTS price_recalculated_at;
-- ALTER TABLE public.dealer_profiles DROP COLUMN IF EXISTS policy_version;

COMMIT;
```

Audit rows written by the new RPCs stay in `audit_log`; the chain trigger
forbids deleting them.

## 6. RLS review

| Table | Command | Before | After | Shape check |
| --- | --- | --- | --- | --- |
| `dealer_profiles` | SELECT | accepted members; platform admins | unchanged | existing |
| `dealer_profiles` | INSERT, UPDATE | any accepted member, directly | platform admins directly; members only through `merge_dealer_settings` | member policies dropped; admin policy existing |
| `dealer_profiles` | DELETE | platform admins | unchanged | existing |
| `products` | SELECT | templates and own tenant | unchanged | existing |
| `products` | INSERT, UPDATE, DELETE | any accepted member (ALL); platform admins | addon roles on own tenant rows; platform admins | `TO authenticated`; `tenant_role_in` wraps `(SELECT auth.uid())` |
| `product_rules` | SELECT | own tenant | unchanged | existing |
| `product_rules` | INSERT, UPDATE, DELETE | any accepted member (ALL) | addon roles on own tenant | `TO authenticated`; `tenant_role_in` |
| `vehicle_listings` | UPDATE | tenant members (row policy) | unchanged row policy plus the column guard | trigger, not a policy; `current_user` check; `tenant_role_in` |
| `admin_policy_applications` | SELECT | n/a | accepted members of the tenant | `TO authenticated`; `(SELECT auth.uid())` |
| `admin_policy_applications` | INSERT, UPDATE, DELETE | n/a | nobody from the client; the apply RPC writes as owner | privileges revoked |

Performance note. `tenant_role_in` is a SECURITY DEFINER SQL function, so
the planner does not inline it; it runs once per candidate row of a write.
Product and rule writes are single rows from an editor, so the cost is one
index lookup on `tenant_members` per write. It is not used in any SELECT
policy.

The member-wide `vehicle_listings` UPDATE policy is deliberately kept:
status, photos, descriptions, assignments and prep fields remain
member-editable, and the guard is column-level by design.

## 7. Deployment call-out

- **Authorization.** Apply only when the owner says so, through Lovable,
  migration 1 then migration 2, each verified per section 4 before the
  next. Do not apply from a session; do not apply out of order.
- **Until applied, the UI falls back honestly.** S4's Apply may call
  `recalc_tenant_doc_fee` only after explicit review and must say that this
  path also rewrites archived vehicles and refreshes the verification
  stamp. S8 computes last feed success from its own ledger query. Every
  caller treats Postgres `42883` (undefined function) as "pending
  migration", never as a result.
- **Coordinate with S2.** After migration 2 the `DealerSettingsContext`
  fallback upsert would be refused by RLS for every non-admin member. It
  only runs when the RPC is missing, so it has no practical effect, but it
  should be gone before apply so a refused write can never be mistaken for
  a saved one.
- **Audit action names.** The four new actions (`pricing_policy_changed`,
  `routing_policy_changed`, `publishing_policy_changed`,
  `addon_policy_changed`) are not yet in the client's audit action union
  in `src/types/tenant.ts`. The stream that renders the activity view adds
  them; the rows are written regardless.
- **Watch after apply.** `42501` errors reported by the app for roles that
  previously wrote settings, products or prices; new rows in
  `admin_policy_applications`; `audit_log` rows with the five policy
  actions; the next feed and crawl runs completing normally.
- **Retire later, separately.** Once S4 is on the RPCs,
  `recalc_tenant_doc_fee` should be revoked from `authenticated`; it is left
  untouched here because it is the documented fallback.

## 8. Deliberately unchanged

- `vehicle_listings` row policies, INSERT paths, the tenant-stamping
  trigger, the prep gate, the recall unpublish guard and the lifecycle
  triggers.
- `audit_log` policies and the hash-chain trigger.
- `recalc_tenant_doc_fee` (fallback until S4 is on the RPCs).
- `marketcheck_sync_config` and `save_marketcheck_config`.
- Every service-role, cron and migration path: the guard trigger returns
  before any check unless `current_user` is `authenticated`.
- Platform-admin paths: `has_role(uid, 'admin')` passes every new check.

## 9. Open questions for the owner

1. **Price-column roles.** The brief says "pricing roles" for the listing
   column guard. The migration uses the roles that hold
   `can_edit_inventory` (adds manager, inventory_manager, used_car_manager
   to the four pricing roles) because the inventory surfaces let those
   roles edit a vehicle's price today; narrowing to the four would refuse
   those edits. Confirm, or narrow and accept that change.
2. **`dealer_programs`.** Sticker Studio writes this key for any role that
   can create documents, including salespeople. The migration classes it as
   an add-on claim (addon roles). Either accept that salespeople can no
   longer add a dealer program from Sticker Studio, or move the key to the
   member list.
3. **`empty_valid` feed runs.** `admin_feed_last_success` counts
   `success` and `partial` only, so a valid empty response is not evidence
   the feed delivered vehicles. Confirm.
4. **Anon privileges on `dealer_profiles`.** Revoked and, on rollback,
   recommended to stay revoked.
5. **Ledger retention on rollback.** The rollback drops
   `admin_policy_applications`; export first if the history matters.
