-- ─────────────────────────────────────────────────────────────────────
-- Stagger the nightly window: description-reconcile 04:10 -> 06:00 UTC.
--
-- enrich-sweep starts at 03:15 and self-chains up to 80 hops of ~100s, so
-- on a real inventory it can still be running at ~05:30. The description
-- reconcile started at 04:10 and chains exactly the same way (80 x 100s),
-- so the two overlapped for well over an hour every night: both fan
-- sibling invocations at the same per-function platform limit, and the
-- reconcile builds copy from enrichment the other sweep is still writing.
--
-- 06:00 clears the enrich window's worst case and still leaves the whole
-- ingest chain (marketcheck-sync 03:00, crawl 03:17, intake 03:20/03:30,
-- recall 03:45) finished long before descriptions are rebuilt.
--
-- Rescheduled through schedule_description_reconcile, not a fresh
-- cron.schedule: the helper unschedules the existing job first, so there
-- stays exactly one 'description-reconcile-nightly' entry. The default is
-- moved with it so a later bare call cannot silently restore 04:10.
-- ─────────────────────────────────────────────────────────────────────

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

-- Apply the new time where pg_cron and the vault secrets exist; inert (and
-- harmless) anywhere they do not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM public.schedule_description_reconcile();
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
