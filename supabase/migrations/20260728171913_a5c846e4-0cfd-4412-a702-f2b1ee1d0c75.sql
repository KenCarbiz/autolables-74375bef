SELECT net.http_post(
  url := 'https://onnbmmdbrsgytfozfozn.supabase.co/functions/v1/factory-sticker-orchestrate',
  headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ubmJtbWRicnNneXRmb3pmb3puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE1NDUsImV4cCI6MjA5MTM5NzU0NX0.NPYibMwwXXsttNlOcmC42qMSes7gJYSdB-GgMIhvcuo","x-cron-secret":"<REDACTED_ROTATED_TO_LOVABLE_CRON_SECRET>"}'::jsonb,
  body := '{"action": "sweep", "limit": 200}'::jsonb,
  timeout_milliseconds := 60000
);