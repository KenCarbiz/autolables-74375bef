-- Daily cron: re-engage shoppers watching a vehicle's price when it drops.
-- Authenticated with the shared cron secret (same as marketcheck-sync).
SELECT cron.schedule(
  'price-drop-reengage',
  '45 14 * * *',
  $$
    SELECT net.http_post(
      url := 'https://onnbmmdbrsgytfozfozn.supabase.co/functions/v1/price-drop-reengage',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ubmJtbWRicnNneXRmb3pmb3puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE1NDUsImV4cCI6MjA5MTM5NzU0NX0.NPYibMwwXXsttNlOcmC42qMSes7gJYSdB-GgMIhvcuo',
        'x-cron-secret','<REDACTED_ROTATED_TO_LOVABLE_CRON_SECRET>'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
