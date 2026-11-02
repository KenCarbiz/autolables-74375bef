-- Minimal pg_cron stand-in for scratch databases.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET schedule = COALESCE(alter_job.schedule, job.schedule), command = COALESCE(alter_job.command, job.command),
    active = COALESCE(alter_job.active, job.active) WHERE jobid = job_id;
$$;
INSERT INTO cron.job (jobname, schedule, command, active) VALUES
  ('marketcheck-sync', '7 * * * *', $c$SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/marketcheck-sync')$c$, false),
  ('enrich-sweep-nightly', '15 3 * * *', $c$SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/enrich-sweep')$c$, false),
  ('specs-backfill', '45 3 * * *', $c$SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/specs-backfill')$c$, true),
  ('title-reminders-sweep', '15 13 * * *', $c$SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/title-reminders-sweep')$c$, true);

-- Production fixtures with the real Harte store ids, so the seeded draft plan
-- resolves exactly as it will in production. Synthetic data only.
INSERT INTO tenants (id, name) VALUES ('3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', 'Harte Auto Group'), ('00000000-0000-0000-0000-0000000000e2', 'Other Group');
INSERT INTO dealer_groups (id, tenant_id, name) VALUES ('79feb0ce-0214-48b4-8709-f8d94bdecb5b', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', 'Harte Auto Group'),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-0000000000e2', 'Other Group');
INSERT INTO dealer_stores (id, group_id, tenant_id, display_name, state, status, subscription_status, inventory_feed_enabled, feed_import_paused, is_primary_inventory_store)
VALUES ('45cdc1e0-7e88-4b44-9d07-27369d74ab21', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', 'Harte INFINITI', 'CT', 'active', 'subscribed', true, false, true),
       ('35d5584b-93d4-4419-9a50-6daead08e7a9', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', 'Harte Nissan', 'CT', 'active', 'unsubscribed', true, true, false),
       ('e400e636-0909-4b36-822e-caa2b5ae7381', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', 'George Harte INFINITI', 'CT', 'active', 'unsubscribed', true, true, false),
       ('12e1d831-166d-48e9-87b5-536d7c0980dc', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', 'George Harte Nissan', 'CT', 'active', 'unsubscribed', true, true, false),
       ('17a9f6f2-29ff-4ff1-bf72-1519df10b7d5', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', 'Harte Volkswagen of Meriden', 'CT', 'active', 'unsubscribed', true, true, false),
       ('02b4f1ac-e15a-40a7-9c49-811fd043ef53', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', 'Harte Hyundai of Old Saybrook', 'CT', 'active', 'unsubscribed', true, true, false);
