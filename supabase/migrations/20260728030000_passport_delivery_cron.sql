-- Passport document delivery — retry bookkeeping + the schedule that actually
-- drains the outbox.
--
-- send-passport-document-deliveries has always been cron-only (it rejects any
-- caller that is not holding the service-role key or the cron secret), but no
-- schedule was ever created. The shopper-facing "Email me this packet" form
-- queued a row, showed a success state, and nothing ever sent it. This migration
-- creates the missing schedule and the columns the worker needs to retry a
-- transient failure instead of burying the row in status='failed' forever.
--
-- Schedule: every 5 minutes outside 03:00-06:00 UTC. Packet requests are
-- speed-to-lead — the shopper is standing at the car — so the flush has to be
-- near-real-time rather than nightly, and the 03:00-06:00 blackout keeps it off
-- the nightly ingest/recall/get-ready window (03:15-05:30 UTC).

ALTER TABLE public.passport_document_delivery_outbox
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

-- The worker's hot query is "queued and due"; the pre-existing
-- (status, created_at) index cannot answer the next_attempt_at predicate.
CREATE INDEX IF NOT EXISTS passport_delivery_outbox_due_idx
  ON public.passport_document_delivery_outbox (next_attempt_at ASC)
  WHERE status = 'queued';

-- Rows that were marked terminally failed before retries existed get one more
-- pass — they failed against a worker that no cron ever invoked, so their
-- recorded error says nothing about whether Resend would accept them today.
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

  -- The worker accepts either the service key or a matching x-cron-secret, so
  -- the secret is optional; send it when present so a service-key rotation
  -- cannot silently 401 the schedule. 'marketcheck_cron_secret' is the name the
  -- already-deployed schedules use for the shared CRON_SECRET value.
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

-- Activate now (safe to re-run). Wrapped so a missing Vault entry on first
-- deploy does not fail the migration — an admin can call the function with
-- explicit args once Vault is populated.
DO $$
BEGIN
  PERFORM public.schedule_passport_delivery_flush();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'passport-delivery-flush not scheduled yet (%); call schedule_passport_delivery_flush(cron, url, key) once Vault is set', SQLERRM;
END $$;
