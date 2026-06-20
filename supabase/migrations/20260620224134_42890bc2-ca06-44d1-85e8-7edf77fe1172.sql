ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS packet_modules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS oem_sticker_url text,
  ADD COLUMN IF NOT EXISTS oem_sticker_checked_at timestamptz;

CREATE OR REPLACE FUNCTION public.schedule_marketcheck_sync(
  _cron_expr TEXT DEFAULT '0 3 * * *',
  _supabase_url TEXT DEFAULT NULL,
  _service_key TEXT DEFAULT NULL
)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url TEXT; key TEXT; secret TEXT; hdrs JSONB; job_id BIGINT;
BEGIN
  IF _supabase_url IS NULL THEN
    SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  ELSE url := _supabase_url; END IF;
  IF _service_key IS NULL THEN
    SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  ELSE key := _service_key; END IF;
  IF url IS NULL OR key IS NULL THEN
    RAISE EXCEPTION 'supabase_url and service_role_key required (via args or Vault entries)';
  END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'marketcheck_cron_secret' LIMIT 1;
  hdrs := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||key);
  IF secret IS NOT NULL AND secret <> '' THEN hdrs := hdrs || jsonb_build_object('x-cron-secret', secret); END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'marketcheck-sync';
  SELECT cron.schedule('marketcheck-sync', _cron_expr, format(
    $job$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb, timeout_milliseconds := 120000); $job$,
    url || '/functions/v1/marketcheck-sync', hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_marketcheck_sync(TEXT, TEXT, TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL, email text NOT NULL, phone text,
  dealership_name text NOT NULL, role text, oem_brands text, rooftops text,
  city text, state text, current_provider text, monthly_volume text,
  notes text, source text, user_agent text,
  status text NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON public.waitlist_signups (created_at DESC);
GRANT INSERT ON public.waitlist_signups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.waitlist_signups TO authenticated;
GRANT ALL ON public.waitlist_signups TO service_role;
ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can join the waitlist" ON public.waitlist_signups FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Admins read waitlist signups" ON public.waitlist_signups FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));
CREATE POLICY "Admins update waitlist signups" ON public.waitlist_signups FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));

CREATE TABLE IF NOT EXISTS public.sticker_template_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL CHECK (key IN ('window','addendum','passport')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.sticker_template_categories (key,name) VALUES ('window','Window Sticker'),('addendum','Addendum'),('passport','Vehicle Passport') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sticker_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text UNIQUE NOT NULL, name text NOT NULL,
  type text NOT NULL CHECK (type IN ('window','addendum','passport')),
  size text NOT NULL CHECK (size IN ('8.5x11','4.5x11','responsive')),
  style_tags text[] NOT NULL DEFAULT '{}',
  config jsonb NOT NULL DEFAULT '{}', preview_url text,
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  current_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sticker_templates_active ON public.sticker_templates (type,size) WHERE is_active AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sticker_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.sticker_templates(id) ON DELETE CASCADE,
  version integer NOT NULL, config jsonb NOT NULL DEFAULT '{}',
  changelog text, published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id,version)
);

CREATE TABLE IF NOT EXISTS public.dealer_sticker_template_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('window','addendum','passport')),
  template_id uuid NOT NULL REFERENCES public.sticker_templates(id) ON DELETE CASCADE,
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,type)
);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_sticker_templates_updated ON public.sticker_templates;
CREATE TRIGGER trg_sticker_templates_updated BEFORE UPDATE ON public.sticker_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_dealer_prefs_updated ON public.dealer_sticker_template_prefs;
CREATE TRIGGER trg_dealer_prefs_updated BEFORE UPDATE ON public.dealer_sticker_template_prefs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.sticker_template_categories TO authenticated;
GRANT ALL ON public.sticker_template_categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sticker_templates TO authenticated;
GRANT ALL ON public.sticker_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sticker_template_versions TO authenticated;
GRANT ALL ON public.sticker_template_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_sticker_template_prefs TO authenticated;
GRANT ALL ON public.dealer_sticker_template_prefs TO service_role;

ALTER TABLE public.sticker_template_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticker_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticker_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_sticker_template_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read categories" ON public.sticker_template_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "read templates" ON public.sticker_templates FOR SELECT TO authenticated USING (is_active AND deleted_at IS NULL);
CREATE POLICY "read versions" ON public.sticker_template_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage templates" ON public.sticker_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));
CREATE POLICY "admin manage versions" ON public.sticker_template_versions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));
CREATE POLICY "dealer prefs" ON public.dealer_sticker_template_prefs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

INSERT INTO public.sticker_templates (template_key,name,type,size,style_tags,config) VALUES
  ('window-modern','Modern Window Sheet','window','8.5x11',ARRAY['Modern','SaaS'],'{"id":"window-modern","name":"Modern Window Sheet","styleTags":["Modern","SaaS"],"defaultAccent":"#2563EB"}'),
  ('window-classic','Classic Monroney','window','8.5x11',ARRAY['Classic','Compliance'],'{"id":"window-classic","name":"Classic Monroney","styleTags":["Classic","Compliance"],"defaultAccent":"#0B2041","supportsAccent":false}'),
  ('window-luxury','Luxury Showcase','window','8.5x11',ARRAY['Luxury'],'{"id":"window-luxury","name":"Luxury Showcase","styleTags":["Luxury"],"defaultAccent":"#7c5c1e"}'),
  ('addendum-modern','Modern Addendum Strip','addendum','4.5x11',ARRAY['Modern','SaaS'],'{"id":"addendum-modern","name":"Modern Addendum Strip","styleTags":["Modern","SaaS"],"defaultAccent":"#2563EB"}'),
  ('addendum-luxury','Luxury Addendum','addendum','4.5x11',ARRAY['Luxury'],'{"id":"addendum-luxury","name":"Luxury Addendum","styleTags":["Luxury"],"defaultAccent":"#7c5c1e"}'),
  ('addendum-compliance','Compliance Addendum','addendum','4.5x11',ARRAY['Compliance','Classic'],'{"id":"addendum-compliance","name":"Compliance Addendum","styleTags":["Compliance","Classic"],"defaultAccent":"#0B2041","supportsAccent":false}')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO public.sticker_template_versions (template_id,version,config,changelog)
SELECT id,1,config,'Initial version' FROM public.sticker_templates
ON CONFLICT (template_id,version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, vehicle_id uuid, template_id text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('window','addendum','passport')),
  document_status text NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft','approved','printed','published','archived')),
  version integer NOT NULL DEFAULT 1,
  label_mode text NOT NULL DEFAULT 'white' CHECK (label_mode IN ('white','black')),
  pdf_url text, png_url text, online_url text,
  data_snapshot jsonb NOT NULL DEFAULT '{}',
  generated_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz, printed_at timestamptz, published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_generated_documents_vehicle ON public.generated_documents (vehicle_id, document_type, version DESC);
CREATE INDEX IF NOT EXISTS idx_generated_documents_tenant ON public.generated_documents (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.dealer_print_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, location_id uuid,
  window_label_size text NOT NULL DEFAULT '8.5x11',
  addendum_label_size text NOT NULL DEFAULT '4.5x11',
  label_mode text NOT NULL DEFAULT 'white' CHECK (label_mode IN ('white','black')),
  x_offset_inches numeric NOT NULL DEFAULT 0,
  y_offset_inches numeric NOT NULL DEFAULT 0,
  scale_percentage numeric NOT NULL DEFAULT 100,
  printer_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id)
);

CREATE TABLE IF NOT EXISTS public.dealer_template_customizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, template_id text NOT NULL,
  accent_color text, secondary_color text,
  logo_enabled boolean NOT NULL DEFAULT true,
  qr_enabled boolean NOT NULL DEFAULT true,
  disclaimer_override text, value_prop_override text,
  section_label_overrides jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_id)
);

CREATE TABLE IF NOT EXISTS public.vehicle_addendums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  base_msrp numeric NOT NULL DEFAULT 0,
  installed_total numeric NOT NULL DEFAULT 0,
  available_upgrades_total numeric NOT NULL DEFAULT 0,
  selected_upgrades_total numeric NOT NULL DEFAULT 0,
  total_msrp numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_addendums_vehicle ON public.vehicle_addendums (vehicle_id);

CREATE TABLE IF NOT EXISTS public.vehicle_addendum_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_addendum_id uuid NOT NULL REFERENCES public.vehicle_addendums(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('installed','benefit','available_upgrade')),
  name text NOT NULL, description text,
  price numeric NOT NULL DEFAULT 0,
  is_installed boolean NOT NULL DEFAULT false,
  is_selected boolean NOT NULL DEFAULT false,
  is_included boolean NOT NULL DEFAULT false,
  disclosure_text text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_addendum_items_parent ON public.vehicle_addendum_items (vehicle_addendum_id, display_order);

DROP TRIGGER IF EXISTS trg_generated_documents_updated ON public.generated_documents;
CREATE TRIGGER trg_generated_documents_updated BEFORE UPDATE ON public.generated_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_dealer_print_settings_updated ON public.dealer_print_settings;
CREATE TRIGGER trg_dealer_print_settings_updated BEFORE UPDATE ON public.dealer_print_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_dealer_template_customizations_updated ON public.dealer_template_customizations;
CREATE TRIGGER trg_dealer_template_customizations_updated BEFORE UPDATE ON public.dealer_template_customizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_vehicle_addendums_updated ON public.vehicle_addendums;
CREATE TRIGGER trg_vehicle_addendums_updated BEFORE UPDATE ON public.vehicle_addendums FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_vehicle_addendum_items_updated ON public.vehicle_addendum_items;
CREATE TRIGGER trg_vehicle_addendum_items_updated BEFORE UPDATE ON public.vehicle_addendum_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_documents TO authenticated;
GRANT ALL ON public.generated_documents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_print_settings TO authenticated;
GRANT ALL ON public.dealer_print_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_template_customizations TO authenticated;
GRANT ALL ON public.dealer_template_customizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_addendums TO authenticated;
GRANT ALL ON public.vehicle_addendums TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_addendum_items TO authenticated;
GRANT ALL ON public.vehicle_addendum_items TO service_role;

ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_print_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_template_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_addendums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_addendum_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant generated_documents" ON public.generated_documents FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant dealer_print_settings" ON public.dealer_print_settings FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant dealer_template_customizations" ON public.dealer_template_customizations FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant vehicle_addendums" ON public.vehicle_addendums FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant vehicle_addendum_items" ON public.vehicle_addendum_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vehicle_addendums a WHERE a.id = vehicle_addendum_id AND a.tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.vehicle_addendums a WHERE a.id = vehicle_addendum_id AND a.tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()))));