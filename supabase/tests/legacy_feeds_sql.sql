-- Legacy feed hardening: bindings, receipts, replay protection, legacy switch and the
-- archived hold. Scratch database only; one transaction, rolled back. Synthetic data only.
-- Requires the spine, 20261109000000_vehicle_history_foundation.sql and
-- 20261109010000_legacy_feed_hardening.sql.

BEGIN;

CREATE TEMP TABLE _ids AS SELECT
  gen_random_uuid() AS mgr_a, gen_random_uuid() AS staff_a, gen_random_uuid() AS mgr_b,
  gen_random_uuid() AS tenant_a, gen_random_uuid() AS tenant_b,
  gen_random_uuid() AS conn_ac_a, gen_random_uuid() AS conn_dms_a, gen_random_uuid() AS conn_ac_b,
  gen_random_uuid() AS conn_film_a, gen_random_uuid() AS listing_arch, gen_random_uuid() AS listing_live;
GRANT SELECT ON _ids TO authenticated, anon, service_role;

INSERT INTO auth.users (id, email) SELECT u, 'lf-' || u || '@example.test' FROM _ids, unnest(ARRAY[mgr_a, staff_a, mgr_b]) u;
INSERT INTO public.tenants (id, name, slug) SELECT tenant_a, 'Synthetic Dealer A', 'lf-a-' || tenant_a FROM _ids;
INSERT INTO public.tenants (id, name, slug) SELECT tenant_b, 'Synthetic Dealer B', 'lf-b-' || tenant_b FROM _ids;
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
  SELECT tenant_a, mgr_a, 'owner', now() FROM _ids UNION ALL
  SELECT tenant_a, staff_a, 'sales', now() FROM _ids UNION ALL
  SELECT tenant_b, mgr_b, 'owner', now() FROM _ids;

-- The widened app check accepts dms.
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status) SELECT conn_ac_a, tenant_a, 'autocurb', 'A curb', 'active' FROM _ids;
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status) SELECT conn_dms_a, tenant_a, 'dms', 'A dms', 'active' FROM _ids;
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status) SELECT conn_ac_b, tenant_b, 'autocurb', 'B curb', 'active' FROM _ids;
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status, adapter, external_rooftop_ref)
  SELECT conn_film_a, tenant_a, 'autofilm', 'A film', 'active', 'autofilm.v1', 'af-lf-a' FROM _ids;

INSERT INTO public.vehicles (vin) VALUES ('1HGCM82633A004352'), ('1M8GDM9AXKP042788');
INSERT INTO public.vehicle_listings (id, tenant_id, store_id, vin, slug, status, archived_at, archive_reason, price)
  SELECT listing_arch, tenant_a, tenant_a::text, '1HGCM82633A004352', 'lf-arch-' || listing_arch, 'archived', now() - interval '30 days', 'sold', 19999 FROM _ids;
INSERT INTO public.vehicle_listings (id, tenant_id, store_id, vin, slug, status, price)
  SELECT listing_live, tenant_a, tenant_a::text, '1M8GDM9AXKP042788', 'lf-live-' || listing_live, 'published', 15000 FROM _ids;

SET LOCAL ROLE service_role;

DO $$
DECLARE i _ids%ROWTYPE; n int;
BEGIN
  SELECT * INTO i FROM _ids;
  INSERT INTO public.legacy_feed_bindings (tenant_id, feed, connection_id) VALUES (i.tenant_a, 'autocurb_sync', i.conn_ac_a);
  INSERT INTO public.legacy_feed_bindings (tenant_id, feed, provider, connection_id) VALUES (i.tenant_a, 'dms_webhook', 'vauto', i.conn_dms_a);
  INSERT INTO public.legacy_feed_bindings (tenant_id, feed, provider, connection_id) VALUES (i.tenant_a, 'dms_webhook', 'cdk', i.conn_dms_a);
  INSERT INTO public.legacy_feed_bindings (tenant_id, feed, connection_id) VALUES (i.tenant_a, 'autofilm_feed', i.conn_film_a);
  INSERT INTO public.legacy_feed_bindings (tenant_id, feed, connection_id) VALUES (i.tenant_b, 'autocurb_sync', i.conn_ac_b);
  SELECT count(*) INTO n FROM public.legacy_feed_bindings WHERE legacy_unsigned = 'allowed';
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL: bindings default to allowed, got %', n; END IF;
  RAISE NOTICE 'PASS: bindings created, dms connection app accepted, legacy defaults to allowed';
END $$;

DO $$
DECLARE i _ids%ROWTYPE;
BEGIN
  SELECT * INTO i FROM _ids;
  BEGIN
    INSERT INTO public.legacy_feed_bindings (tenant_id, feed, connection_id) VALUES (i.tenant_a, 'autocurb_sync', i.conn_ac_a);
    RAISE EXCEPTION 'FAIL: unique scope allowed a second autocurb binding';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    UPDATE public.legacy_feed_bindings SET connection_id = i.conn_ac_b WHERE tenant_id = i.tenant_a AND feed = 'autocurb_sync';
    RAISE EXCEPTION 'FAIL: binding accepted another tenant''s connection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'binding_connection_tenant_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.legacy_feed_bindings SET connection_id = i.conn_dms_a WHERE tenant_id = i.tenant_a AND feed = 'autocurb_sync';
    RAISE EXCEPTION 'FAIL: binding accepted a connection of the wrong app';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'binding_connection_app_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.legacy_feed_bindings (tenant_id, feed) VALUES (i.tenant_b, 'dms_webhook');
    RAISE EXCEPTION 'FAIL: dms binding without provider accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM public.integration_connections WHERE id = i.conn_ac_a;
    RAISE EXCEPTION 'FAIL: bound connection was deletable';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  RAISE NOTICE 'PASS: one binding per scope, same-tenant and same-app connection, provider rules, bound connection protected';
END $$;

DO $$
DECLARE i _ids%ROWTYPE; r jsonb;
BEGIN
  SELECT * INTO i FROM _ids;
  r := public.legacy_feed_claim_request(i.conn_ac_a, 'autocurb_sync', 'k1', 'hash-1');
  IF r->>'outcome' <> 'new' THEN RAISE EXCEPTION 'FAIL: first claim %', r; END IF;
  r := public.legacy_feed_claim_request(i.conn_ac_a, 'autocurb_sync', 'k1', 'hash-1');
  IF r->>'outcome' <> 'in_progress' THEN RAISE EXCEPTION 'FAIL: second claim before completion %', r; END IF;
  r := public.legacy_feed_claim_request(i.conn_ac_a, 'autocurb_sync', 'k1', 'hash-2');
  IF r->>'outcome' <> 'conflict' THEN RAISE EXCEPTION 'FAIL: different body %', r; END IF;
  PERFORM public.legacy_feed_complete_request(i.conn_ac_a, 'k1', '{"status":200,"body":{"upserted":2}}');
  r := public.legacy_feed_claim_request(i.conn_ac_a, 'autocurb_sync', 'k1', 'hash-1');
  IF r->>'outcome' <> 'replay' OR (r->'response'->'body'->>'upserted') <> '2' THEN RAISE EXCEPTION 'FAIL: replay %', r; END IF;
  r := public.legacy_feed_claim_request(i.conn_ac_a, 'autocurb_sync', 'k1', 'hash-2');
  IF r->>'outcome' <> 'conflict' THEN RAISE EXCEPTION 'FAIL: conflict after completion %', r; END IF;
  r := public.legacy_feed_claim_request(i.conn_ac_b, 'autocurb_sync', 'k1', 'hash-1');
  IF r->>'outcome' <> 'new' THEN RAISE EXCEPTION 'FAIL: same key on another connection must be independent %', r; END IF;
  IF (SELECT tenant_id FROM public.legacy_feed_receipts WHERE connection_id = i.conn_ac_b) <> i.tenant_b THEN
    RAISE EXCEPTION 'FAIL: receipt tenant is not the connection tenant';
  END IF;
  RAISE NOTICE 'PASS: claim returns new, in_progress, conflict, replay and keys are per connection';
END $$;

DO $$
DECLARE i _ids%ROWTYPE; r jsonb;
BEGIN
  SELECT * INTO i FROM _ids;
  PERFORM public.legacy_feed_claim_request(i.conn_ac_a, 'autocurb_sync', 'stale', 'h');
  UPDATE public.legacy_feed_receipts SET created_at = now() - interval '11 minutes' WHERE idempotency_key = 'stale';
  r := public.legacy_feed_claim_request(i.conn_ac_a, 'autocurb_sync', 'stale', 'h');
  IF r->>'outcome' <> 'new' THEN RAISE EXCEPTION 'FAIL: stale processing row not reclaimed %', r; END IF;
  RAISE NOTICE 'PASS: a stale processing claim can be retaken';
END $$;

DO $$
DECLARE i _ids%ROWTYPE;
BEGIN
  SELECT * INTO i FROM _ids;
  IF NOT public.legacy_feed_legacy_allowed(i.tenant_a, 'autocurb_sync', NULL) THEN RAISE EXCEPTION 'FAIL: default not allowed'; END IF;
  IF NOT public.legacy_feed_legacy_allowed(gen_random_uuid(), 'autocurb_sync', NULL) THEN RAISE EXCEPTION 'FAIL: unbound tenant not allowed'; END IF;
  UPDATE public.legacy_feed_bindings SET legacy_unsigned = 'rejected' WHERE tenant_id = i.tenant_a AND feed = 'dms_webhook' AND provider = 'vauto';
  IF public.legacy_feed_legacy_allowed(i.tenant_a, 'dms_webhook', 'vauto') THEN RAISE EXCEPTION 'FAIL: rejected binding still allowed'; END IF;
  IF NOT public.legacy_feed_legacy_allowed(i.tenant_a, 'dms_webhook', 'cdk') THEN RAISE EXCEPTION 'FAIL: other provider affected'; END IF;
  IF NOT public.legacy_feed_legacy_allowed(i.tenant_b, 'dms_webhook', 'vauto') THEN RAISE EXCEPTION 'FAIL: other tenant affected'; END IF;
  UPDATE public.legacy_feed_bindings SET legacy_unsigned = 'allowed' WHERE tenant_id = i.tenant_a AND feed = 'dms_webhook' AND provider = 'vauto';
  IF NOT public.legacy_feed_legacy_allowed(i.tenant_a, 'dms_webhook', 'vauto') THEN RAISE EXCEPTION 'FAIL: rollback to allowed did not reopen'; END IF;
  RAISE NOTICE 'PASS: legacy switch is false only for a rejected binding and reverses';
END $$;

-- Archived hold: one reappearance review, listing untouched, second call returns the same review.
DO $$
DECLARE i _ids%ROWTYPE; rv uuid; rv2 uuid; before_row jsonb; n int;
BEGIN
  SELECT * INTO i FROM _ids;
  SELECT to_jsonb(l) INTO before_row FROM public.vehicle_listings l WHERE id = i.listing_arch;
  rv := public.legacy_feed_hold_archived(i.tenant_a, '1hgcm82633a004352', i.listing_arch, 'autocurb_sync', 'conn-1');
  IF rv IS NULL THEN RAISE EXCEPTION 'FAIL: no review id'; END IF;
  rv2 := public.legacy_feed_hold_archived(i.tenant_a, '1HGCM82633A004352', i.listing_arch, 'autocurb_sync', 'conn-1');
  IF rv2 IS DISTINCT FROM rv THEN RAISE EXCEPTION 'FAIL: second hold returned % not %', rv2, rv; END IF;
  SELECT count(*) INTO n FROM public.vehicle_reappearance_reviews WHERE tenant_id = i.tenant_a AND vin = '1HGCM82633A004352' AND status = 'open';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: % open reviews', n; END IF;
  IF (SELECT to_jsonb(l) FROM public.vehicle_listings l WHERE id = i.listing_arch) IS DISTINCT FROM before_row THEN
    RAISE EXCEPTION 'FAIL: listing changed by the hold';
  END IF;
  BEGIN
    PERFORM public.legacy_feed_hold_archived(i.tenant_b, '1HGCM82633A004352', i.listing_arch, 'autocurb_sync', 'x');
    RAISE EXCEPTION 'FAIL: listing from another tenant accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'listing_not_in_tenant' THEN RAISE; END IF;
  END;
  IF public.legacy_feed_hold_archived(i.tenant_a, 'SHORTVIN123', NULL, 'dms_webhook', 'x') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: invalid VIN produced a review';
  END IF;
  RAISE NOTICE 'PASS: archived hold opens exactly one review, is repeatable, leaves the listing untouched';
END $$;

-- RLS and function privileges.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', mgr_a, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE i _ids%ROWTYPE; own int; other int;
BEGIN
  SELECT * INTO i FROM _ids;
  SELECT count(*) INTO own FROM public.legacy_feed_bindings WHERE tenant_id = i.tenant_a;
  SELECT count(*) INTO other FROM public.legacy_feed_bindings WHERE tenant_id = i.tenant_b;
  IF own <> 4 OR other <> 0 THEN RAISE EXCEPTION 'FAIL: dealer A sees % own and % of dealer B', own, other; END IF;
  BEGIN
    INSERT INTO public.legacy_feed_bindings (tenant_id, feed, connection_id) VALUES (i.tenant_b, 'autofilm_feed', NULL);
    RAISE EXCEPTION 'FAIL: client wrote a binding';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.legacy_feed_receipts;
    RAISE EXCEPTION 'FAIL: client read receipts';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.legacy_feed_claim_request(i.conn_ac_a, 'autocurb_sync', 'x', 'h');
    RAISE EXCEPTION 'FAIL: client called claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.legacy_feed_hold_archived(i.tenant_a, '1HGCM82633A004352', NULL, 'autocurb_sync', 'x');
    RAISE EXCEPTION 'FAIL: client called hold';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS: dealer owner sees only own bindings, cannot write, cannot read receipts or call the RPCs';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', staff_a, 'role', 'authenticated')::text FROM _ids), true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.legacy_feed_bindings) <> 0 THEN RAISE EXCEPTION 'FAIL: non-manager staff sees bindings'; END IF;
  RAISE NOTICE 'PASS: non-manager staff sees no bindings';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', mgr_b, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE i _ids%ROWTYPE;
BEGIN
  SELECT * INTO i FROM _ids;
  IF (SELECT count(*) FROM public.legacy_feed_bindings WHERE tenant_id = i.tenant_a) <> 0 THEN RAISE EXCEPTION 'FAIL: dealer B sees dealer A bindings'; END IF;
  IF (SELECT count(*) FROM public.legacy_feed_bindings) <> 1 THEN RAISE EXCEPTION 'FAIL: dealer B own bindings'; END IF;
  RAISE NOTICE 'PASS: dealer B cannot see dealer A bindings';
END $$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.legacy_feed_bindings;
    RAISE EXCEPTION 'FAIL: anon read bindings';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS: anonymous callers reach nothing';
END $$;

ROLLBACK;
