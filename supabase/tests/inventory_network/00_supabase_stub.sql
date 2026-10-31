-- Minimal stand-in for the hosted schema objects the migration touches, so it
-- can be applied and exercised on a bare local Postgres. Test-only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean DEFAULT true);
CREATE TABLE public.tenant_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, user_id uuid, role text, accepted_at timestamptz DEFAULT now());
CREATE FUNCTION public.tenant_role_in(p_tenant_id uuid, p_roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = p_tenant_id AND tm.user_id = (SELECT auth.uid())
    AND tm.accepted_at IS NOT NULL AND lower(trim(coalesce(tm.role, ''))) = ANY (p_roles)) $$;

CREATE TABLE public.vehicle_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id text NOT NULL, tenant_id uuid REFERENCES public.tenants(id), vin text, slug text UNIQUE,
  ymm text, trim text, mileage integer, condition text CHECK (condition IN ('new','used','cpo')), price numeric, sticker_snapshot jsonb,
  status text CHECK (status IN ('draft','published','archived')), feed_source text, photos jsonb, photo_count integer, hero_image_url text,
  features jsonb, doc_fee numeric, advertised_price_before_doc numeric, website_sale_price numeric, price_source_url text, price_parse_status text,
  price_parse_notes text, price_last_verified_at timestamptz, source_url text, assigned_agent_id text, archived_at timestamptz, mc_raw jsonb
);
CREATE UNIQUE INDEX uq_vehicle_listings_tenant_vin ON public.vehicle_listings (tenant_id, upper(TRIM(BOTH FROM vin))) WHERE tenant_id IS NOT NULL AND COALESCE(TRIM(BOTH FROM vin), '') <> '';

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, store_id uuid, name text, phone text, email text, vehicle_interest text,
  vehicle_vin text, source text CHECK (source IN ('qr_scan','signing_link','manual','website')), sub_source text, status text CHECK (status IN ('new','contacted','converted','lost')), notes text, routing jsonb, routed_agent_id text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.dealer_profiles (tenant_id uuid PRIMARY KEY, settings jsonb);
