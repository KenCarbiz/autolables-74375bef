-- Correct Harte's stored description settings so the row says what the
-- platform actually does.
--
-- The row was last written 2026-08-01 with a 172-character length window and
-- a blanket warranty veto. Application policy has since stopped honouring
-- both: preferredLengthBand refuses a window too tight to write inside, and
-- the warranty gate reads the vehicle's verified coverage instead of a flag.
-- That leaves the code permanently compensating for stored values nobody
-- intends, which is a worse state than either the old behaviour or the new
-- one -- the settings screen shows a dealer numbers the writer ignores.
--
-- Stored values before this migration, for the record:
--
--   min_length                3750
--   max_length                3922
--   warranty_language_allowed false
--
-- Stored values after:
--
--   min_length                1800   A soft floor, not a gate. Generation is
--                                    NOT refused below it: a sparse vehicle
--                                    honestly described in 1,500 characters
--                                    still publishes, it simply scores lower
--                                    on the length dimension. Length is the
--                                    last of six generation priorities,
--                                    beneath factual accuracy,
--                                    differentiation, readability, voice and
--                                    SEO.
--
--   max_length                3800   A soft ceiling of the same nature. The
--                                    hard safety limit stays in application
--                                    policy (LENGTH_POLICY.absoluteMax) and
--                                    is deliberately not a per-tenant column:
--                                    a dealership cannot raise the ceiling by
--                                    typing a bigger number.
--
--   warranty_language_allowed true   Permission to STATE remaining factory
--                                    coverage that the vehicle record already
--                                    proves. It is not permission to make
--                                    warranty claims. buildFactSnapshot still
--                                    emits nothing unless months, miles or a
--                                    program are present on the record, and
--                                    never invents terms it was not given.
--                                    A dealership that wants silence sets
--                                    warranty_language_suppressed_explicitly.
--
-- Scope. One tenant, three columns. Every other column on this row and every
-- other tenant's row is left exactly as it is. The UPDATE is guarded on the
-- row still holding all three stale values, so if anyone edits these settings
-- before this migration reaches an environment, their choice wins and this
-- becomes a no-op. Re-running it is a no-op for the same reason.
--
-- configuration_version is deliberately not written here. It is a fingerprint
-- computed in the orchestrator from the resolved settings, and loadSettings
-- already rewrites it when the stored fingerprint no longer matches.

DO $$
DECLARE
  v_tenant   uuid := '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142';
  v_before   jsonb;
  v_changed  integer := 0;
  v_requeued integer := 0;
BEGIN
  SELECT jsonb_build_object(
           'min_length', ds.min_length,
           'max_length', ds.max_length,
           'warranty_language_allowed', ds.warranty_language_allowed)
    INTO v_before
    FROM public.description_settings ds
   WHERE ds.tenant_id = v_tenant;

  IF v_before IS NULL THEN
    -- A local or branch database that has never seen this dealership.
    RETURN;
  END IF;

  UPDATE public.description_settings
     SET min_length                = 1800,
         max_length                = 3800,
         warranty_language_allowed = true
   WHERE tenant_id                 = v_tenant
     AND min_length                = 3750
     AND max_length                = 3922
     AND warranty_language_allowed = false;

  GET DIAGNOSTICS v_changed = ROW_COUNT;

  IF v_changed = 0 THEN
    RAISE NOTICE 'description_settings for % already differ from the stale row; left untouched (%)', v_tenant, v_before;
    RETURN;
  END IF;

  -- Settings that change generated output changed, so the cases have to be
  -- reconsidered -- the same thing save_description_settings does when a
  -- dealer edits these fields by hand.
  v_requeued := public.enqueue_description_config_change(v_tenant);

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES (
    'description_settings_corrected',
    'description_settings',
    v_tenant::text,
    v_tenant::text,
    NULL,
    jsonb_build_object(
      'migration', '20260905233000_harte_description_settings_correction',
      'reason', 'Stored values were being overridden at runtime by platform '
             || 'length and warranty policy. Corrected the row so the stored '
             || 'configuration matches the behaviour the dealership gets.',
      'before', v_before,
      'after', jsonb_build_object(
        'min_length', 1800, 'max_length', 3800, 'warranty_language_allowed', true),
      'columns_changed', jsonb_build_array('min_length', 'max_length', 'warranty_language_allowed'),
      'tenants_changed', 1,
      'cases_requeued', v_requeued,
      'notes', jsonb_build_object(
        'min_length', 'Soft target. Generation is not refused below it.',
        'max_length', 'Soft target. The absolute ceiling stays in application policy.',
        'warranty_language_allowed',
          'Permits stating verified remaining coverage only. Facts still gate the claim.')));

  RAISE NOTICE 'Corrected description_settings for %; % case(s) requeued', v_tenant, v_requeued;
END $$;
