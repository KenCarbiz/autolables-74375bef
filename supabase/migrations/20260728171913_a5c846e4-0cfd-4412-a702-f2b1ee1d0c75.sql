SELECT net.http_post(
  url := 'https://onnbmmdbrsgytfozfozn.supabase.co/functions/v1/factory-sticker-orchestrate',
  headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ubmJtbWRicnNneXRmb3pmb3puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE1NDUsImV4cCI6MjA5MTM5NzU0NX0.NPYibMwwXXsttNlOcmC42qMSes7gJYSdB-GgMIhvcuo","x-cron-secret":"6b901513c217801460d5ea9e3a078b631bac6405f864ff0f"}'::jsonb,
  body := '{"action": "sweep", "limit": 200}'::jsonb,
  timeout_milliseconds := 60000
);