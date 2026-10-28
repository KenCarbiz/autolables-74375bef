-- The objects the two Administration V2 migrations read or replace, as the
-- hosted project held them before 2026-10-28 11:13 UTC. Column lists, types,
-- defaults, keys, helper functions and policies were read from the hosted
-- catalogue (read-only) and the pre-migration policies come from the rollback
-- section of ADMIN_V2_SERVER_AUTHORITY.md. Unrelated triggers on
-- vehicle_listings and the audit hash chain are not reproduced; the tests do
-- not depend on them.

CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  domain text,
  primary_email text,
  billing_email text,
  source text NOT NULL DEFAULT 'autolabels'::text,
  autocurb_tenant_id text,
  stripe_customer_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  carfax_dealer_id text,
  autocheck_dealer_id text,
  autocurb_profile jsonb,
  autocurb_synced_at timestamp with time zone
);

CREATE TABLE public.tenant_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid,
  invited_email text,
  role text NOT NULL DEFAULT 'staff'::text,
  accepted_at timestamp with time zone,
  invited_at timestamp with time zone NOT NULL DEFAULT now(),
  invited_by uuid,
  UNIQUE (tenant_id, invited_email),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE public.dealer_profiles (
  tenant_id uuid NOT NULL PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  subtitle text,
  warranty text,
  badge_type text NOT NULL DEFAULT 'installed'::text,
  price numeric(10,2) NOT NULL DEFAULT 0,
  price_label text DEFAULT 'Included in Selling Price'::text,
  disclosure text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  benefit_justification text NOT NULL DEFAULT ''::text,
  price_in_advertised boolean NOT NULL DEFAULT true,
  disclosure_optional text,
  benefit_justification_optional text,
  available_preinstalled boolean NOT NULL DEFAULT true,
  upgrade jsonb,
  contract_url text,
  contract_doc_type text,
  price_tiers jsonb,
  tenant_id uuid
);

CREATE TABLE public.product_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  year_min text NOT NULL DEFAULT ''::text,
  year_max text NOT NULL DEFAULT ''::text,
  makes text[] NOT NULL DEFAULT '{}'::text[],
  models text[] NOT NULL DEFAULT '{}'::text[],
  trims text[] NOT NULL DEFAULT '{}'::text[],
  body_styles text[] NOT NULL DEFAULT '{}'::text[],
  condition text NOT NULL DEFAULT 'all'::text,
  mileage_max integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  store_id text,
  user_id uuid,
  user_email text,
  ip_address text,
  user_agent text,
  content_hash text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  prev_hash text,
  row_hash text
);

CREATE TABLE public.vehicle_listings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id text NOT NULL,
  vin text NOT NULL,
  slug text NOT NULL UNIQUE,
  ymm text,
  "trim" text,
  mileage integer,
  condition text,
  price numeric(10,2),
  sticker_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  dealer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_props jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  videos jsonb NOT NULL DEFAULT '[]'::jsonb,
  prep_status jsonb,
  status text NOT NULL DEFAULT 'draft'::text,
  published_at timestamp with time zone,
  view_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  tenant_id uuid,
  recall_check jsonb,
  recall_override_by uuid,
  recall_override_notes text,
  recall_override_at timestamp with time zone,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  certification jsonb,
  factory_sticker_url text,
  scrape_source_url text,
  scrape_last_synced_at timestamp with time zone,
  payment_estimate jsonb,
  default_locale text NOT NULL DEFAULT 'en'::text,
  install_token uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_file_id uuid,
  service_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  warranty_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_accessories jsonb NOT NULL DEFAULT '[]'::jsonb,
  feed_source text,
  source_url text,
  hero_image_url text,
  photo_count integer,
  mc_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  recall_status text,
  recall_checked_at timestamp with time zone,
  open_recall_count integer,
  closed_recall_count integer,
  recall_payload jsonb,
  market_value numeric(10,2),
  market_position text,
  market_checked_at timestamp with time zone,
  market_payload jsonb,
  packet_modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  oem_sticker_url text,
  oem_sticker_checked_at timestamp with time zone,
  mc_raw jsonb,
  market_meta jsonb,
  comparables jsonb,
  blackbook jsonb,
  enriched_at timestamp with time zone,
  history_payload jsonb,
  in_service_date date,
  advertised_price_before_doc numeric,
  doc_fee numeric,
  website_sale_price numeric,
  dealer_discount numeric,
  retail_cash numeric,
  price_source_url text,
  price_last_verified_at timestamp with time zone,
  price_parse_status text,
  price_parse_notes text,
  orchestrated_at timestamp with time zone,
  history_report_url text,
  assigned_agent_id text,
  epa_economy jsonb,
  epa_checked_at timestamp with time zone,
  suppressed_programs jsonb NOT NULL DEFAULT '[]'::jsonb,
  website_price_term text,
  passport_version text NOT NULL DEFAULT 'inherit'::text,
  deal_processed_at timestamp with time zone,
  archived_at timestamp with time zone,
  archive_reason text,
  group_similar jsonb NOT NULL DEFAULT '[]'::jsonb,
  title_verification jsonb
);

CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid,
  store_id uuid,
  name text NOT NULL DEFAULT ''::text,
  phone text NOT NULL DEFAULT ''::text,
  email text NOT NULL DEFAULT ''::text,
  vehicle_interest text NOT NULL DEFAULT ''::text,
  vehicle_vin text NOT NULL DEFAULT ''::text,
  source text NOT NULL DEFAULT 'manual'::text,
  signing_url text NOT NULL DEFAULT ''::text,
  status text NOT NULL DEFAULT 'new'::text,
  notes text NOT NULL DEFAULT ''::text,
  captured_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  sub_source text,
  routing jsonb,
  routed_agent_id text,
  first_response_at timestamp with time zone,
  escalated_at timestamp with time zone,
  escalation_level integer NOT NULL DEFAULT 0
);

CREATE TABLE public.inventory_sync_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'marketcheck'::text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  status text NOT NULL,
  num_found integer NOT NULL DEFAULT 0,
  seen integer NOT NULL DEFAULT 0,
  new_vehicles integer NOT NULL DEFAULT 0,
  updated_vehicles integer NOT NULL DEFAULT 0,
  prices_recorded integer NOT NULL DEFAULT 0,
  removed integer NOT NULL DEFAULT 0,
  http_status integer,
  matched_dealer text,
  error_summary text,
  raw jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.description_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  description_case_id uuid,
  job_type text NOT NULL DEFAULT 'full_generation'::text,
  status text NOT NULL DEFAULT 'queued'::text,
  idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  scheduled_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  failed_at timestamp with time zone,
  last_error_code text,
  last_error_message text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.advertised_price_crawl_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  vin text NOT NULL,
  source_label text NOT NULL DEFAULT 'website'::text,
  source_url text,
  outcome text NOT NULL,
  http_status integer,
  render_status integer,
  detail text,
  attempts integer NOT NULL DEFAULT 1,
  first_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  last_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone
);

CREATE TABLE public.marketcheck_sync_config (
  tenant_id uuid NOT NULL PRIMARY KEY,
  allowed boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT ''::text,
  max_vehicles integer NOT NULL DEFAULT 1000,
  frequency text NOT NULL DEFAULT 'nightly'::text,
  day_of_week integer NOT NULL DEFAULT 0,
  run_hour integer NOT NULL DEFAULT 3,
  last_run_at timestamp with time zone,
  last_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  dealer_id text NOT NULL DEFAULT ''::text,
  mc_scope_param text NOT NULL DEFAULT ''::text,
  mc_scope_value text NOT NULL DEFAULT ''::text,
  rooftop_street text NOT NULL DEFAULT ''::text,
  rooftop_zip text NOT NULL DEFAULT ''::text,
  rooftop_name text NOT NULL DEFAULT ''::text,
  rooftop_verified_at timestamp with time zone,
  strict_rooftop boolean NOT NULL DEFAULT true,
  last_good_count integer NOT NULL DEFAULT 0,
  last_good_at timestamp with time zone
);

-- Helper functions, verbatim from the hosted catalogue.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pinned uuid;
  raw text;
BEGIN
  BEGIN
    raw := current_setting('app.current_tenant_id', true);
  EXCEPTION WHEN OTHERS THEN
    raw := NULL;
  END;
  IF raw IS NOT NULL AND raw <> '' THEN
    BEGIN
      pinned := raw::uuid;
    EXCEPTION WHEN OTHERS THEN
      pinned := NULL;
    END;
    IF pinned IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE user_id = auth.uid() AND tenant_id = pinned AND accepted_at IS NOT NULL
    ) THEN
      RETURN pinned;
    END IF;
  END IF;

  RETURN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    ORDER BY accepted_at DESC, tenant_id ASC
    LIMIT 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_manager(_tenant_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id
      AND tm.user_id = _user_id
      AND tm.role = ANY (ARRAY['owner'::text, 'admin'::text])
      AND tm.accepted_at IS NOT NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER update_dealer_profiles_updated_at BEFORE UPDATE ON public.dealer_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vehicle_listings_updated_at BEFORE UPDATE ON public.vehicle_listings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The pre-migration settings writer (20260726180000_harden_merge_dealer_settings.sql),
-- so migration 2 replaces a real function as it did in the hosted project.
CREATE OR REPLACE FUNCTION public.merge_dealer_settings(_tenant_id UUID, _patch JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
BEGIN
  SELECT lower(trim(tm.role)) INTO v_role
    FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
    LIMIT 1;
  IF v_role IS NULL AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  INSERT INTO public.dealer_profiles (tenant_id, settings, updated_by)
  VALUES (_tenant_id, COALESCE(_patch, '{}'::jsonb), v_uid)
  ON CONFLICT (tenant_id) DO UPDATE
    SET settings   = COALESCE(dealer_profiles.settings, '{}'::jsonb) || COALESCE(_patch, '{}'::jsonb),
        updated_by = v_uid;
  RETURN true;
END;
$$;

-- Row security and the pre-migration policy set.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.description_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advertised_price_crawl_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketcheck_sync_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see their tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id IN (SELECT tenant_members.tenant_id FROM tenant_members WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))));
CREATE POLICY "Members see their own memberships" ON public.tenant_members FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid() AS uid)) OR is_tenant_manager(tenant_id, (SELECT auth.uid() AS uid)));
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT
  USING ((SELECT auth.uid() AS uid) = user_id);

CREATE POLICY "Platform admins read all dealer profiles" ON public.dealer_profiles FOR SELECT TO authenticated
  USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Platform admins write all dealer profiles" ON public.dealer_profiles FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role))
  WITH CHECK (has_role((SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY dealer_profiles_select ON public.dealer_profiles FOR SELECT TO authenticated
  USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role) OR (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL)))));
CREATE POLICY dealer_profiles_update ON public.dealer_profiles FOR UPDATE TO authenticated
  USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role)
         OR (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                           WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL)))))
  WITH CHECK (has_role((SELECT auth.uid() AS uid), 'admin'::app_role)
         OR (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                           WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL)))));
CREATE POLICY dealer_profiles_insert ON public.dealer_profiles FOR INSERT TO authenticated
  WITH CHECK (has_role((SELECT auth.uid() AS uid), 'admin'::app_role)
         OR (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                           WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL)))));

CREATE POLICY "Admins can delete products" ON public.products FOR DELETE USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Admins can insert products" ON public.products FOR INSERT WITH CHECK (has_role((SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Admins can update products" ON public.products FOR UPDATE USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "products tenant members read" ON public.products FOR SELECT TO authenticated
  USING ((tenant_id IS NULL) OR (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL)))));
CREATE POLICY "products tenant members write" ON public.products FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                       WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))))
  WITH CHECK (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                            WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))));
CREATE POLICY "Tenant members read product_rules" ON public.product_rules FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))));
CREATE POLICY "Tenant members write product_rules" ON public.product_rules FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                       WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))))
  WITH CHECK (tenant_id IN (SELECT tenant_members.tenant_id FROM tenant_members
                            WHERE ((tenant_members.user_id = (SELECT auth.uid() AS uid)) AND (tenant_members.accepted_at IS NOT NULL))));

CREATE POLICY "Audit log readable by admins, owner, or tenant members" ON public.audit_log FOR SELECT TO authenticated
  USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role) OR (user_id = (SELECT auth.uid() AS uid)) OR ((store_id IS NOT NULL) AND (store_id IN (SELECT (tm.tenant_id)::text AS tenant_id FROM tenant_members tm WHERE ((tm.user_id = (SELECT auth.uid() AS uid)) AND (tm.accepted_at IS NOT NULL))))));
CREATE POLICY "Auth users can insert audit events" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (((user_id IS NULL) OR (user_id = (SELECT auth.uid() AS uid))) AND ((store_id IS NULL) OR has_role((SELECT auth.uid() AS uid), 'admin'::app_role) OR (store_id IN (SELECT (tm.tenant_id)::text AS tenant_id FROM tenant_members tm WHERE ((tm.user_id = (SELECT auth.uid() AS uid)) AND (tm.accepted_at IS NOT NULL))))));

CREATE POLICY "Anon can insert shopper audit events" ON public.audit_log FOR INSERT TO anon
  WITH CHECK ((user_id IS NULL) AND (action = ANY (ARRAY['addendum_viewed'::text, 'addendum_consent_given'::text, 'addendum_signed'::text, 'listing_viewed'::text, 'vehicle_inquiry'::text])));

CREATE POLICY "Admins can delete listings" ON public.vehicle_listings FOR DELETE TO authenticated USING (has_role((SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Tenant members insert listings" ON public.vehicle_listings FOR INSERT TO authenticated
  WITH CHECK ((created_by = (SELECT auth.uid() AS uid)) AND ((tenant_id IS NULL) OR (tenant_id = current_tenant_id())));
CREATE POLICY "Tenant members update listings" ON public.vehicle_listings FOR UPDATE TO authenticated
  USING ((tenant_id = current_tenant_id()) OR ((tenant_id IS NULL) AND (created_by = (SELECT auth.uid() AS uid))) OR has_role((SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Tenant members view listings" ON public.vehicle_listings FOR SELECT TO authenticated
  USING (((tenant_id IS NULL) AND (created_by = (SELECT auth.uid() AS uid))) OR (tenant_id = current_tenant_id()));

CREATE POLICY "Tenant members view leads" ON public.leads FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());

-- Table privileges as the hosted snapshot showed them before migration 2.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON public.dealer_profiles, public.vehicle_listings TO anon;
REVOKE SELECT ON public.vehicle_listings FROM anon;
GRANT SELECT ON public.products TO anon;
