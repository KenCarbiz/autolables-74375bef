-- Widen the drift guard past functions.
--
-- 20260908240000 added missing_expected_functions(), which caught 16 missing
-- functions and 7 live broken call sites. Its limitation showed up within the
-- hour: every drift found afterwards was something it cannot see.
--
--   advertised_prices.source_channel CHECK   never dropped, so a capture the
--                                            app offers ('manual') is rejected
--   qr_codes                                 live shape is code/target_url/
--                                            surface; the client was written
--                                            against token/destination_url/
--                                            sticker_type from an unapplied
--                                            migration, so nothing was ever
--                                            created and nothing ever scanned
--   install_proofs.source                    column absent
--
-- A constraint, a table shape and a column. The function guard would have
-- reported all clear on every one of them.
--
-- Do NOT use supabase_migrations.schema_migrations as the drift oracle. It
-- lists 225 applied against 481 versions in the repo, which reads as 256
-- unapplied migrations and is wrong: 20260417030000_shared_tenant_entitlements
-- is absent from it while every table it creates exists and is in daily use.
-- The ledger only records migrations applied through Supabase's own runner, so
-- a missing row proves nothing. Check the objects themselves, which is what
-- this does.
--
-- One entry per object, prefixed by kind:
--   fn:list_tenant_members
--   table:qr_codes
--   col:qr_codes.target_url
--   con:tenant_members.tenant_members_role_check
--   idx:vehicle_listings.idx_fk_vehicle_listings_created_by
--
-- Usage in a deploy check -- anything returned is drift:
--   SELECT * FROM public.missing_expected_objects(ARRAY[
--     'fn:autocurb_sync_entitlements',
--     'col:advertised_prices.captured_by',
--     'table:qr_codes'
--   ]);
CREATE OR REPLACE FUNCTION public.missing_expected_objects(_expected text[])
RETURNS TABLE (kind text, object_name text, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e text;
  v_kind text;
  v_ref  text;
  v_rel  text;
  v_part text;
BEGIN
  FOREACH e IN ARRAY coalesce(_expected, '{}') LOOP
    v_kind := lower(split_part(e, ':', 1));
    v_ref  := substring(e from position(':' in e) + 1);
    IF v_ref = '' THEN
      kind := 'malformed'; object_name := e;
      detail := 'expected "<kind>:<name>"';
      RETURN NEXT; CONTINUE;
    END IF;

    IF v_kind = 'fn' THEN
      IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = v_ref) THEN
        kind := 'fn'; object_name := v_ref; detail := 'no such function in public';
        RETURN NEXT;
      END IF;

    ELSIF v_kind = 'table' THEN
      IF to_regclass('public.' || quote_ident(v_ref)) IS NULL THEN
        kind := 'table'; object_name := v_ref; detail := 'no such relation in public';
        RETURN NEXT;
      END IF;

    ELSIF v_kind IN ('col', 'con', 'idx') THEN
      v_rel  := split_part(v_ref, '.', 1);
      v_part := substring(v_ref from position('.' in v_ref) + 1);

      IF to_regclass('public.' || quote_ident(v_rel)) IS NULL THEN
        kind := v_kind; object_name := v_ref;
        detail := format('relation public.%I does not exist', v_rel);
        RETURN NEXT; CONTINUE;
      END IF;

      IF v_kind = 'col' AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = v_rel AND column_name = v_part) THEN
        kind := 'col'; object_name := v_ref;
        detail := format('column %I absent from public.%I', v_part, v_rel);
        RETURN NEXT;

      ELSIF v_kind = 'con' AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = ('public.' || quote_ident(v_rel))::regclass AND conname = v_part) THEN
        kind := 'con'; object_name := v_ref;
        detail := format('constraint %I absent from public.%I', v_part, v_rel);
        RETURN NEXT;

      ELSIF v_kind = 'idx' AND NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = v_rel AND indexname = v_part) THEN
        kind := 'idx'; object_name := v_ref;
        detail := format('index %I absent from public.%I', v_part, v_rel);
        RETURN NEXT;
      END IF;

    ELSE
      kind := 'malformed'; object_name := e;
      detail := 'kind must be one of fn, table, col, con, idx';
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.missing_expected_objects(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missing_expected_objects(text[]) TO authenticated, service_role;

-- Self-verification: assert the guard finds real drift and does not
-- manufacture false positives. Every object below was confirmed present on
-- 2026-09-08, and the three deliberately-bogus entries must be reported.
DO $$
DECLARE
  v_false_positive text;
  v_caught int;
BEGIN
  SELECT string_agg(object_name, ', ') INTO v_false_positive
  FROM public.missing_expected_objects(ARRAY[
    'fn:missing_expected_objects',
    'fn:autocurb_sync_entitlements',
    'fn:list_tenant_members',
    'table:qr_codes',
    'table:advertised_prices',
    'col:qr_codes.target_url',
    'col:qr_codes.surface',
    'col:advertised_prices.captured_by',
    'col:install_proofs.source',
    'col:addendums.accepted_by',
    'con:tenant_members.tenant_members_role_check'
  ]) m;

  IF v_false_positive IS NOT NULL THEN
    RAISE EXCEPTION 'drift guard reports present objects as missing: %', v_false_positive;
  END IF;

  -- Negative control: three objects that genuinely do not exist -- including
  -- qr_codes.sticker_type, the dead column name the QR client was written
  -- against, and an index deliberately named on the wrong table. A guard that
  -- cannot fail is not a guard, and this project has already shipped one
  -- passing test that asserted a defense which did not hold.
  SELECT count(*) INTO v_caught
  FROM public.missing_expected_objects(ARRAY[
    'fn:this_function_does_not_exist',
    'col:qr_codes.sticker_type',
    'idx:advertised_prices.idx_audit_store_created'
  ]);

  IF v_caught <> 3 THEN
    RAISE EXCEPTION 'drift guard failed its negative control: caught % of 3', v_caught;
  END IF;
END $$;
