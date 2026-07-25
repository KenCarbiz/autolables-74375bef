-- Recurring intake safety net (INTAKE_SPEC S1/S4): two nightly jobs.
--
-- 1. intake-draft-sweep (03:20 UTC, pure SQL): re-runs the VIN-idempotent
--    draft RPCs for every used/CPO listing — the same query the one-time
--    20260723030000 / 20260723050000 DO blocks ran once — so a car that
--    slipped past the ingest hook (or predates an artifact) still gets its
--    Buyers Guide, K-208, Get-Ready, addendum, and window-sticker drafts.
--    Failures are recorded to vehicle_exceptions, never swallowed: ingest
--    cannot silently finish with a required artifact missing.
--
-- 2. ingest-orchestrate-sweep (03:30 UTC): actually creates the sweep cron
--    that 20260630010000 referenced but never scheduled. Mirrors
--    schedule_recall_sweep exactly, including the Vault-backed x-cron-secret
--    mechanism — no new credentials.
--
-- Neither job touches the existing marketcheck-sync (03:00) or recall-sweep
-- (03:45) schedules.

CREATE OR REPLACE FUNCTION public.sweep_missing_intake_drafts(_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_scanned integer := 0;
  v_failed integer := 0;
  v_err text;
BEGIN
  -- Cron/service automation only; an interactive session must not run a
  -- cross-tenant sweep.
  IF (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;

  FOR r IN
    SELECT tenant_id, vin FROM public.vehicle_listings
    WHERE lower(coalesce(condition, 'used')) IN ('used', 'cpo', 'certified')
      AND tenant_id IS NOT NULL
      AND coalesce(trim(vin), '') <> ''
    LIMIT _limit
  LOOP
    v_scanned := v_scanned + 1;
    BEGIN
      PERFORM public.create_draft_buyers_guide(r.tenant_id, r.vin);
      PERFORM public.create_draft_safety_inspection(r.tenant_id, r.vin);
      PERFORM public.create_draft_get_ready(r.tenant_id, r.vin);
      PERFORM public.create_draft_addendum(r.tenant_id, r.vin);
      PERFORM public.create_draft_window_sticker(r.tenant_id, r.vin);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_err := left(SQLERRM, 500);
      BEGIN
        INSERT INTO public.vehicle_exceptions AS ve
          (tenant_id, vin, exception_type, severity, title, explanation, source_values, recommended_action, status)
        VALUES
          (r.tenant_id, r.vin, 'artifact_autogen_failed', 'high',
           'Intake draft sweep failed for this vehicle',
           v_err,
           jsonb_build_object('artifacts', jsonb_build_object('draft_sweep', v_err), 'source', 'intake_draft_sweep'),
           'Retry the drafts from the vehicle intake summary; the nightly sweep will also retry.',
           'open')
        ON CONFLICT (tenant_id, vin, exception_type) WHERE status IN ('open', 'in_progress')
        DO UPDATE SET
          explanation = EXCLUDED.explanation,
          source_values = coalesce(ve.source_values, '{}'::jsonb) || EXCLUDED.source_values,
          severity = 'high';
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  RETURN jsonb_build_object('scanned', v_scanned, 'failed', v_failed);
END $$;

REVOKE ALL ON FUNCTION public.sweep_missing_intake_drafts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_missing_intake_drafts(integer) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'intake-draft-sweep';
  PERFORM cron.schedule('intake-draft-sweep', '20 3 * * *',
    'SELECT public.sweep_missing_intake_drafts();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'intake-draft-sweep not scheduled (%); schedule it once pg_cron is available', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.schedule_ingest_orchestrate_sweep(
  _cron_expr TEXT DEFAULT '30 3 * * *',
  _supabase_url TEXT DEFAULT NULL,
  _service_key TEXT DEFAULT NULL
)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url TEXT; key TEXT; secret TEXT; hdrs JSONB; job_id BIGINT;
BEGIN
  IF _supabase_url IS NULL THEN
    SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  ELSE url := _supabase_url; END IF;
  IF _service_key IS NULL THEN
    SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  ELSE key := _service_key; END IF;
  IF url IS NULL OR key IS NULL THEN
    RAISE EXCEPTION 'supabase_url and service_role_key required (via args or Vault entries)';
  END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'marketcheck_cron_secret' LIMIT 1;

  hdrs := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key);
  IF secret IS NOT NULL AND secret <> '' THEN
    hdrs := hdrs || jsonb_build_object('x-cron-secret', secret);
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ingest-orchestrate-sweep';
  SELECT cron.schedule('ingest-orchestrate-sweep', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"sweep": true}'::jsonb,
        timeout_milliseconds := 240000
      );
    $job$,
    url || '/functions/v1/ingest-orchestrate',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_ingest_orchestrate_sweep(TEXT, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  PERFORM public.schedule_ingest_orchestrate_sweep();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'ingest-orchestrate-sweep not scheduled yet (%); call schedule_ingest_orchestrate_sweep(cron, url, key) once Vault is set', SQLERRM;
END $$;
