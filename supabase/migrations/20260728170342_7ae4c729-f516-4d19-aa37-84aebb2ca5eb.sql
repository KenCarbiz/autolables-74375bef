DO $$
DECLARE cmd text; url text; key text;
BEGIN
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'factory-sticker-sweep';
  url := (regexp_match(cmd, 'url := ''(https://[^/]+)/functions'))[1];
  key := (regexp_match(cmd, 'Bearer ([A-Za-z0-9._-]+)'))[1];
  PERFORM public.schedule_compliance_forms_sweep('10,15,20,25 9 * * *', url, key);
END $$;

DO $$
DECLARE cmd text;
BEGIN
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'compliance-forms-sweep';
  EXECUTE cmd;
END $$;

DO $$
DECLARE cmd text;
BEGIN
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'factory-sticker-sweep';
  EXECUTE cmd;
END $$;