-- LOCAL VALIDATION ONLY. Never apply to a Supabase/Lovable project: there, these
-- objects are provided by the platform. Stands in for the minimum a brand-new
-- Supabase project has before 01_dependencies.sql runs: the API roles with
-- Supabase's default privileges, auth.users/auth.identities with the columns the
-- seed writes, auth.uid()/auth.jwt(), Vault (secrets, decrypted_secrets,
-- create_secret) and pgcrypto in the extensions schema.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT anon, authenticated, service_role TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id            uuid,
  id                     uuid PRIMARY KEY,
  aud                    varchar(255),
  role                   varchar(255),
  email                  varchar(255),
  encrypted_password     varchar(255),
  email_confirmed_at     timestamptz,
  raw_app_meta_data      jsonb,
  raw_user_meta_data     jsonb,
  created_at             timestamptz,
  updated_at             timestamptz,
  confirmation_token     varchar(255),
  recovery_token         varchar(255),
  email_change_token_new varchar(255),
  email_change           varchar(255)
);
CREATE TABLE IF NOT EXISTS auth.identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id     text NOT NULL,
  provider        text NOT NULL,
  identity_data   jsonb NOT NULL,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  email           text GENERATED ALWAYS AS (lower(identity_data ->> 'email')) STORED,
  UNIQUE (provider_id, provider)
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role() TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, created_at FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '')
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO vault.secrets (secret, name, description) VALUES (new_secret, new_name, new_description) RETURNING id
$$;
