\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text, p_name text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'FAILED: % (no error)', p_name;
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'FAILED:%' THEN RAISE; END IF;
  IF position(p_needle in SQLERRM) = 0 THEN RAISE EXCEPTION 'FAILED: % (got %)', p_name, SQLERRM; END IF;
  RETURN 'ok  ' || p_name;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_name text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAILED: %', p_name; END IF; RETURN 'ok  ' || p_name; END $$;

SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000aa01', false);
SELECT pg_temp.check(public.save_department_contacts('00000000-0000-0000-0000-0000000000a1', NULL,
  '[{"department":"main","label":"Main","phone_e164":"+12035550100","is_primary":true},
    {"department":"service","label":"Service","phone_e164":"+12035550101","extension":"22"}]') = 2, 'owner saves tenant contacts');
SELECT pg_temp.check(public.save_department_contacts('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1',
  '[{"department":"sales","label":"Sales","phone_e164":"+12035550200","is_primary":true}]') = 1, 'owner saves rooftop contacts separately');
SELECT pg_temp.check((SELECT count(*) FROM dealer_department_contacts) = 3, 'tenant and rooftop rows coexist');
SELECT pg_temp.check(public.save_department_contacts('00000000-0000-0000-0000-0000000000a1', NULL,
  '[{"department":"main","label":"Main","phone_e164":"+12035550199","is_primary":true}]') = 1, 'resave replaces tenant set');
SELECT pg_temp.check((SELECT count(*) FROM dealer_department_contacts WHERE store_id IS NULL) = 1, 'resave left one tenant row');
SELECT pg_temp.expect_error($q$SELECT public.save_department_contacts('00000000-0000-0000-0000-0000000000a1', NULL,
  '[{"department":"main","label":"Main","phone_e164":"203-555-0100"}]')$q$, 'phone_e164', 'non-E.164 phone rejected');
SELECT pg_temp.expect_error($q$SELECT public.save_department_contacts('00000000-0000-0000-0000-0000000000a1', NULL,
  '[{"department":"main","label":"A","phone_e164":"+12035550100","is_primary":true},{"department":"sales","label":"B","phone_e164":"+12035550101","is_primary":true}]')$q$,
  'one_primary', 'two primaries in one scope rejected');
SELECT pg_temp.expect_error($q$SELECT public.save_department_contacts('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000b5b1', '[]')$q$,
  'store_not_in_tenant', 'other tenant rooftop rejected');
SELECT pg_temp.check((SELECT count(*) FROM audit_log WHERE action = 'department_contacts_saved') = 3, 'contact saves audited');

SELECT pg_temp.check(public.save_business_hours('00000000-0000-0000-0000-0000000000a1', NULL, 'sales', 'America/New_York',
  '{"mon":[{"open":"09:00","close":"20:00"}]}', '[{"date":"2026-12-25","closed":true}]', NULL, 0) = 1, 'first hours save is version 1');
SELECT pg_temp.check(public.save_business_hours('00000000-0000-0000-0000-0000000000a1', NULL, 'sales', 'America/New_York',
  '{"mon":[{"open":"09:00","close":"21:00"}]}', '[]', NULL, 1) = 2, 'second save with version 1 is version 2');
SELECT pg_temp.expect_error($q$SELECT public.save_business_hours('00000000-0000-0000-0000-0000000000a1', NULL, 'sales', 'America/New_York', '{}', '[]', NULL, 1)$q$,
  'version_conflict', 'stale version rejected');
SELECT pg_temp.expect_error($q$SELECT public.save_business_hours('00000000-0000-0000-0000-0000000000a1', NULL, 'service', 'Mars/Olympus', '{}', '[]', NULL, 0)$q$,
  'invalid_timezone', 'unknown timezone rejected');

SELECT pg_temp.expect_error($q$SELECT public.save_shared_brand_profile('00000000-0000-0000-0000-0000000000a1', 'Harte Auto Group LLC', NULL, '[{"name":"Primary","hex":"blue"}]')$q$,
  'invalid_palette', 'bad HEX rejected');
SELECT public.save_shared_brand_profile('00000000-0000-0000-0000-0000000000a1', 'Harte Auto Group LLC', 'https://x/logo-dark.svg',
  '[{"name":"Primary","hex":"#2457D6"},{"name":"Ink","hex":"#1B2B3B"}]');
SELECT pg_temp.check((SELECT legal_name = 'Harte Auto Group LLC' AND display_name = 'Harte' FROM onboarding_profiles), 'legal name saved, display name untouched');

SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000aa02', false);
SELECT pg_temp.expect_error($q$SELECT public.save_department_contacts('00000000-0000-0000-0000-0000000000a1', NULL, '[]')$q$, 'not_authorized', 'salesperson cannot save contacts');
SELECT pg_temp.expect_error($q$SELECT public.save_shared_brand_profile('00000000-0000-0000-0000-0000000000a1', 'X', NULL, NULL)$q$, 'not_authorized', 'salesperson cannot save brand');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000bb01', false);
SELECT pg_temp.expect_error($q$SELECT public.save_business_hours('00000000-0000-0000-0000-0000000000a1', NULL, 'sales', 'America/New_York', '{}', '[]', NULL, 2)$q$,
  'not_authorized', 'other tenant owner cannot save hours');

SET ROLE authenticated;
SELECT pg_temp.check((SELECT count(*) FROM dealer_department_contacts) = 0, 'RLS hides other tenant contacts');
RESET ROLE;
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000aa02', false);
SET ROLE authenticated;
SELECT pg_temp.check((SELECT count(*) FROM dealer_department_contacts) = 2, 'RLS shows own tenant contacts to any member');
RESET ROLE;

-- Calibration
SELECT pg_temp.check((SELECT safe_margin_top_inches = 0.4 FROM dealer_print_settings), 'legacy top margin copied to canonical');
SELECT pg_temp.expect_error($q$INSERT INTO dealer_print_settings (tenant_id, location_id) VALUES ('00000000-0000-0000-0000-0000000000a1', NULL)$q$,
  'dealer_print_settings_scope_unique', 'second all-rooftops row rejected');
SELECT pg_temp.expect_error($q$SELECT public.record_print_calibration('00000000-0000-0000-0000-0000000000a1', NULL, 'calibration_verified', '{"x":0}')$q$,
  'test_sheet_not_printed', 'cannot verify before test sheet');
SELECT pg_temp.check(public.record_print_calibration('00000000-0000-0000-0000-0000000000a1', NULL, 'test_sheet_printed', NULL) IS NOT NULL, 'staff member records test sheet');
SELECT pg_temp.check(public.record_print_calibration('00000000-0000-0000-0000-0000000000a1', NULL, 'calibration_verified', '{"x_mm":0.5,"y_mm":-0.5}') IS NOT NULL, 'verify after test sheet');
SELECT pg_temp.check((SELECT calibration_verified_at IS NOT NULL FROM dealer_print_settings), 'verification persisted');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000bb01', false);
SELECT pg_temp.expect_error($q$SELECT public.record_print_calibration('00000000-0000-0000-0000-0000000000a1', NULL, 'test_sheet_printed', NULL)$q$, 'not_authorized', 'other tenant cannot record calibration');
