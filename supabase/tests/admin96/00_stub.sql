-- Minimal stand-in for the hosted objects the Admin 96 proposals touch. Test-only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.tenants (id uuid PRIMARY KEY, name text);
CREATE TABLE public.tenant_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, user_id uuid, role text, accepted_at timestamptz DEFAULT now());
CREATE FUNCTION public.tenant_role_in(p_tenant_id uuid, p_roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = p_tenant_id AND tm.user_id = (SELECT auth.uid())
    AND tm.accepted_at IS NOT NULL AND lower(trim(coalesce(tm.role, ''))) = ANY (p_roles)) $$;
CREATE TABLE public.dealer_stores (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id), display_name text);
CREATE TABLE public.onboarding_profiles (tenant_id uuid PRIMARY KEY, display_name text, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
  store_id text, user_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.dealer_print_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, location_id uuid,
  window_label_size text NOT NULL DEFAULT '8.5x11', x_offset_inches numeric NOT NULL DEFAULT 0,
  y_offset_inches numeric NOT NULL DEFAULT 0, scale_percentage numeric NOT NULL DEFAULT 100, printer_name text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id));
ALTER TABLE public.dealer_print_settings
  ADD COLUMN top_safe_margin_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN left_safe_margin_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN safe_margin_top_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN safe_margin_right_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN safe_margin_bottom_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN safe_margin_left_inches numeric NOT NULL DEFAULT 0.25;
GRANT SELECT ON public.tenant_members TO authenticated;

INSERT INTO public.tenants VALUES ('00000000-0000-0000-0000-0000000000a1','A'), ('00000000-0000-0000-0000-0000000000b1','B');
INSERT INTO public.dealer_stores VALUES ('00000000-0000-0000-0000-00000000a5a1','00000000-0000-0000-0000-0000000000a1','A store'),
  ('00000000-0000-0000-0000-00000000b5b1','00000000-0000-0000-0000-0000000000b1','B store');
INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000aa01','owner'),
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000aa02','salesperson'),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000bb01','owner');
INSERT INTO public.onboarding_profiles (tenant_id, display_name) VALUES ('00000000-0000-0000-0000-0000000000a1','Harte');
INSERT INTO public.dealer_print_settings (tenant_id, location_id, top_safe_margin_inches) VALUES ('00000000-0000-0000-0000-0000000000a1', NULL, 0.4);
