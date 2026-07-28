DO $$
DECLARE v_url text; v_key text; v_secret text; v_cmd text; v_hdrs jsonb;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'marketcheck-sync' LIMIT 1;
  v_url := (regexp_match(v_cmd, 'https://[a-z0-9]+\.supabase\.co'))[1];
  v_key := (regexp_match(v_cmd, 'Bearer ([A-Za-z0-9._\-]+)'))[1];
  v_secret := (regexp_match(v_cmd, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1];
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'could not extract url/key from template job';
  END IF;

  v_hdrs := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key);
  IF v_secret IS NOT NULL AND v_secret <> '' THEN
    v_hdrs := v_hdrs || jsonb_build_object('x-cron-secret', v_secret);
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'passport-delivery-flush';
  PERFORM cron.schedule('passport-delivery-flush', '*/5 0-2,6-23 * * *', format(
    $job$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{"limit": 50}'::jsonb, timeout_milliseconds := 120000);$job$,
    v_url || '/functions/v1/send-passport-document-deliveries', v_hdrs::text));

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'factory-sticker-sweep';
  PERFORM cron.schedule('factory-sticker-sweep', '40,45,50,55 8 * * *', format(
    $job$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{"action": "orchestrate_sweep", "limit": 500}'::jsonb, timeout_milliseconds := 60000);$job$,
    v_url || '/functions/v1/factory-sticker-orchestrate', v_hdrs::text));

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'description-reconcile-nightly';
  PERFORM cron.schedule('description-reconcile-nightly', '0 6 * * *', format(
    $job$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{"action":"reconcile","limit":50}'::jsonb, timeout_milliseconds := 120000);$job$,
    v_url || '/functions/v1/description-orchestrate', v_hdrs::text));
END $$;