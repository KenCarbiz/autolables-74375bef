ALTER TABLE public.passport_document_delivery_outbox
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS passport_delivery_outbox_due_idx
  ON public.passport_document_delivery_outbox (next_attempt_at ASC)
  WHERE status = 'queued';

UPDATE public.passport_document_delivery_outbox
   SET status = 'queued', attempts = 0, next_attempt_at = now(), error = NULL
 WHERE status = 'failed'
   AND channel = 'email'
   AND created_at > now() - interval '7 days';

CREATE OR REPLACE FUNCTION public.schedule_passport_delivery_flush(
  _cron_expr TEXT DEFAULT '*/5 0-2,6-23 * * *',
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

  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  IF secret IS NULL OR secret = '' THEN
    SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'marketcheck_cron_secret' LIMIT 1;
  END IF;

  hdrs := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key);
  IF secret IS NOT NULL AND secret <> '' THEN
    hdrs := hdrs || jsonb_build_object('x-cron-secret', secret);
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'passport-delivery-flush';
  SELECT cron.schedule('passport-delivery-flush', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"limit": 50}'::jsonb,
        timeout_milliseconds := 120000
      );
    $job$,
    url || '/functions/v1/send-passport-document-deliveries',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_passport_delivery_flush(TEXT, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  PERFORM public.schedule_passport_delivery_flush();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'passport-delivery-flush not scheduled yet (%)', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.schedule_description_reconcile(p_schedule text DEFAULT '0 6 * * *')
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_url text; v_key text; v_cmd text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN 'skipped: vault secrets supabase_url / service_role_key not configured';
  END IF;

  v_cmd := format(
    $c$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
      body := jsonb_build_object('action','reconcile','limit',50),
      timeout_milliseconds := 120000);$c$,
    v_url || '/functions/v1/description-orchestrate', v_key);

  PERFORM cron.unschedule('description-reconcile-nightly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'description-reconcile-nightly');
  PERFORM cron.schedule('description-reconcile-nightly', p_schedule, v_cmd);
  RETURN 'scheduled ' || p_schedule;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM public.schedule_description_reconcile();
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.schedule_factory_sticker_sweep(
  _cron_expr TEXT DEFAULT '40,45,50,55 8 * * *',
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

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'factory-sticker-sweep';
  SELECT cron.schedule('factory-sticker-sweep', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"action": "orchestrate_sweep", "limit": 500}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$,
    url || '/functions/v1/factory-sticker-orchestrate',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_factory_sticker_sweep(TEXT, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  PERFORM public.schedule_factory_sticker_sweep();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'factory-sticker-sweep not scheduled yet (%)', SQLERRM;
END $$;