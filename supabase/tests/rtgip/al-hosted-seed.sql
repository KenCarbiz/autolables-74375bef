-- Minimal "hosted AutoLabels today" prerequisites for the hosted package test. Only the shapes the
-- RooftopOS components read; the real hosted tables are wider. No RooftopOS object is created here.
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  user_id uuid NOT NULL, role text NOT NULL DEFAULT 'member', accepted_at timestamptz);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.onboarding_profiles (tenant_id uuid PRIMARY KEY, stores jsonb);
CREATE TABLE public.dealer_stores (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, display_name text, city text, state text,
  status text NOT NULL DEFAULT 'active', is_primary_inventory_store boolean NOT NULL DEFAULT false);
CREATE TABLE public.vehicle_files (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, stock_number text, year text, make text, model text, trim text,
  vin text, created_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_listings (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, vin text, slug text, status text, condition text, price numeric,
  advertised_price_before_doc numeric, doc_fee numeric, website_sale_price numeric, published_at timestamptz,
  updated_at timestamptz DEFAULT now(), vehicle_file_id uuid, owning_store_id uuid);
CREATE TABLE public.dealer_profiles (tenant_id uuid PRIMARY KEY, settings jsonb);
CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text, entity_type text,
  entity_id text, store_id text, user_id uuid, details jsonb);
CREATE TABLE public.passport_payment_estimator_settings (
  tenant_id uuid NOT NULL, store_id text NOT NULL, enabled boolean, config jsonb, version integer,
  last_request_id uuid, updated_by uuid, updated_at timestamptz, PRIMARY KEY (tenant_id, store_id));
CREATE TABLE public.passport_payment_estimator_versions (
  tenant_id uuid, store_id text, version integer, config jsonb, prev_config jsonb, actor uuid, request_id uuid);

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = _role) $$;
CREATE FUNCTION public.tenant_role_in(p_tenant_id uuid, p_roles text[]) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = p_tenant_id AND m.user_id = (SELECT auth.uid()) AND m.role = ANY (p_roles)) $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO PUBLIC;
