-- Minimal stand-in for the hosted objects the proposed description store
-- settings and vAuto export gate migrations touch, so both can be applied and
-- exercised on a bare local Postgres. Test-only; columns are the subset used.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.tenant_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, user_id uuid, role text, accepted_at timestamptz DEFAULT now());
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
  store_id text, user_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.dealer_profiles (tenant_id uuid PRIMARY KEY, settings jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.dealer_stores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id), display_name text NOT NULL, state text);
CREATE TABLE public.vehicle_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vin text, price numeric, doc_fee numeric,
  advertised_price_before_doc numeric, website_sale_price numeric, owning_store_id uuid REFERENCES public.dealer_stores(id), description text);
CREATE TABLE public.description_settings (tenant_id uuid PRIMARY KEY, required_legal_text text);
CREATE TABLE public.description_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id), vehicle_id uuid NOT NULL REFERENCES public.vehicle_listings(id),
  vin text NOT NULL DEFAULT 'SYNTHETIC', current_master_version_id uuid, potentially_stale boolean NOT NULL DEFAULT false);
CREATE TABLE public.description_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id), version_number integer NOT NULL DEFAULT 1, content text NOT NULL);
CREATE TABLE public.description_channel_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id), master_version_id uuid NOT NULL REFERENCES public.description_versions(id),
  channel text NOT NULL, content text NOT NULL, potentially_stale boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_version_id, channel));
CREATE TABLE public.description_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, description_case_id uuid NOT NULL, version_id uuid, channel_version_id uuid,
  validator_code text NOT NULL, status text NOT NULL DEFAULT 'open', message text NOT NULL DEFAULT '', blocking boolean NOT NULL DEFAULT false);
CREATE TABLE public.description_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL, description_case_id uuid NOT NULL,
  exception_type text NOT NULL, status text NOT NULL DEFAULT 'open', blocking boolean NOT NULL DEFAULT false, title text NOT NULL DEFAULT '', channel text);
CREATE TABLE public.description_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL, description_case_id uuid NOT NULL,
  version_id uuid, channel_version_id uuid, destination text NOT NULL, delivery_mode text NOT NULL DEFAULT 'export_only',
  connector_status text NOT NULL DEFAULT 'not_configured', status text NOT NULL DEFAULT 'pending', idempotency_key text NOT NULL UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0, response_metadata jsonb NOT NULL DEFAULT '{}', published_at timestamptz);

-- Copied from 20260725050000_description_function_grants.sql.
CREATE OR REPLACE FUNCTION public.has_description_authority(p_tenant_id uuid, p_level text DEFAULT 'approve')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
     WHERE tm.tenant_id = p_tenant_id AND tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL
       AND lower(trim(tm.role)) = ANY (
         CASE p_level
           WHEN 'approve' THEN ARRAY['owner','general_manager','gsm','admin','manager','sales_manager','used_car_manager','inventory_manager','service_manager']
           WHEN 'resolve' THEN ARRAY['owner','general_manager','gsm','admin','manager','office','finance','compliance']
           WHEN 'configure' THEN ARRAY['owner','general_manager','gsm','admin','manager']
           ELSE ARRAY['owner','general_manager','gsm','admin','manager','sales_manager','used_car_manager','inventory_manager']
         END)
  ) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role) $$;
GRANT SELECT ON public.tenant_members TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
