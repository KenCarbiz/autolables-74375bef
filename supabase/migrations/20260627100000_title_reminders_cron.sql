-- Daily cron: re-email the office an upload link for any in-stock vehicle that
-- still has no Title / MCO on file, paced by each dealer's reminder cadence.
-- Authenticated with the shared cron secret (same as marketcheck-sync).
SELECT cron.schedule(
  'title-reminders-sweep',
  '15 13 * * *',
  $$
    SELECT net.http_post(
      url := 'https://onnbmmdbrsgytfozfozn.supabase.co/functions/v1/title-reminders-sweep',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ubmJtbWRicnNneXRmb3pmb3puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE1NDUsImV4cCI6MjA5MTM5NzU0NX0.NPYibMwwXXsttNlOcmC42qMSes7gJYSdB-GgMIhvcuo',
        'x-cron-secret','6d793fac24427b9bc1882dd7fcb2d8ac331912a8205aa9e7'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
