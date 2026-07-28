DO $$
DECLARE v_url text; v_key text; v_cmd text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'enrich-sweep-nightly' LIMIT 1;
  IF v_cmd IS NULL THEN
    RAISE NOTICE 'no template job found'; RETURN;
  END IF;
  v_url := (regexp_match(v_cmd, 'https://[a-z0-9]+\.supabase\.co'))[1];
  v_key := (regexp_match(v_cmd, 'Bearer ([A-Za-z0-9._\-]+)'))[1];
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'could not extract url/key'; RETURN;
  END IF;
  PERFORM public.schedule_passport_delivery_flush('*/5 0-2,6-23 * * *', v_url, v_key);
  PERFORM public.schedule_factory_sticker_sweep('40,45,50,55 8 * * *', v_url, v_key);

  PERFORM cron.unschedule('description-reconcile-nightly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'description-reconcile-nightly');
  PERFORM cron.schedule('description-reconcile-nightly', '0 6 * * *', format(
    $c$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
      body := jsonb_build_object('action','reconcile','limit',50),
      timeout_milliseconds := 120000);$c$,
    v_url || '/functions/v1/description-orchestrate', v_key));
END $$;