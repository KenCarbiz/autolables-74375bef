-- Supabase platform pieces the full migration chain needs beyond
-- scripts/db-verify/00_platform.sql: auth.users, storage, net, realtime,
-- vault and pg_cron's scheduling calls, all as inert local stand-ins. Applied
-- before supabase/migrations. Nothing here reaches a hosted project.

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, phone text,
  raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, deleted_at timestamptz,
  is_anonymous boolean DEFAULT false);
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', current_user) $$;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint,
  allowed_mime_types text[], owner uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid,
  metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS
  $$ SELECT string_to_array(name, '/') $$;

CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 1000) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;

CREATE PUBLICATION supabase_realtime;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text, decrypted_secret text);
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text, name text);

CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
