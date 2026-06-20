-- Sticker Studio template archive + versioning. The render LAYOUTS live in code
-- (render engine per sticker type), but the CATALOG is data: each template is a
-- row carrying a config override (id/name/style/accent), so new template
-- variants ship without a code deploy. Immutable template_versions snapshot the
-- config so a previously generated document can pin the exact version it used
-- and never change. Tenant-scoped dealer preferences pick a default per type.

-- Categories ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sticker_template_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL CHECK (key IN ('window','addendum','passport')),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.sticker_template_categories (key, name) VALUES
  ('window','Window Sticker'), ('addendum','Addendum'), ('passport','Vehicle Passport')
ON CONFLICT (key) DO NOTHING;

-- Templates (catalog) -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sticker_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    text UNIQUE NOT NULL,                 -- matches the code config.id
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('window','addendum','passport')),
  size            text NOT NULL CHECK (size IN ('8.5x11','4.5x11','responsive')),
  style_tags      text[] NOT NULL DEFAULT '{}',
  -- The config OVERRIDE merged onto the code base config for this type.
  config          jsonb NOT NULL DEFAULT '{}',
  preview_url     text,
  is_active       boolean NOT NULL DEFAULT true,
  is_featured     boolean NOT NULL DEFAULT false,
  current_version integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sticker_templates_active ON public.sticker_templates (type, size) WHERE is_active AND deleted_at IS NULL;

-- Immutable versions --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sticker_template_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES public.sticker_templates(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  config       jsonb NOT NULL DEFAULT '{}',
  changelog    text,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

-- Dealer default per type ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dealer_sticker_template_prefs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  type         text NOT NULL CHECK (type IN ('window','addendum','passport')),
  template_id  uuid NOT NULL REFERENCES public.sticker_templates(id) ON DELETE CASCADE,
  is_favorite  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type)
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_sticker_templates_updated ON public.sticker_templates;
CREATE TRIGGER trg_sticker_templates_updated BEFORE UPDATE ON public.sticker_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_dealer_prefs_updated ON public.dealer_sticker_template_prefs;
CREATE TRIGGER trg_dealer_prefs_updated BEFORE UPDATE ON public.dealer_sticker_template_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS -----------------------------------------------------------------------
ALTER TABLE public.sticker_template_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticker_templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticker_template_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_sticker_template_prefs ENABLE ROW LEVEL SECURITY;

-- Any signed-in dealer may read the catalog.
CREATE POLICY "read categories"  ON public.sticker_template_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "read templates"   ON public.sticker_templates           FOR SELECT TO authenticated USING (is_active AND deleted_at IS NULL);
CREATE POLICY "read versions"    ON public.sticker_template_versions    FOR SELECT TO authenticated USING (true);

-- Only platform admins manage the catalog.
CREATE POLICY "admin manage templates" ON public.sticker_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));
CREATE POLICY "admin manage versions" ON public.sticker_template_versions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));

-- Dealers manage their own per-tenant preferences.
CREATE POLICY "dealer prefs" ON public.dealer_sticker_template_prefs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

-- Seed the initial template pack (mirrors the code registry). config holds the
-- override merged onto the code base config for the type at render time.
INSERT INTO public.sticker_templates (template_key, name, type, size, style_tags, config) VALUES
  ('window-modern',      'Modern Window Sheet',     'window',   '8.5x11', ARRAY['Modern','SaaS'],        '{"id":"window-modern","name":"Modern Window Sheet","styleTags":["Modern","SaaS"],"defaultAccent":"#2563EB"}'),
  ('window-classic',     'Classic Monroney',        'window',   '8.5x11', ARRAY['Classic','Compliance'], '{"id":"window-classic","name":"Classic Monroney","styleTags":["Classic","Compliance"],"defaultAccent":"#0B2041","supportsAccent":false}'),
  ('window-luxury',      'Luxury Showcase',         'window',   '8.5x11', ARRAY['Luxury'],               '{"id":"window-luxury","name":"Luxury Showcase","styleTags":["Luxury"],"defaultAccent":"#7c5c1e"}'),
  ('addendum-modern',    'Modern Addendum Strip',   'addendum', '4.5x11', ARRAY['Modern','SaaS'],        '{"id":"addendum-modern","name":"Modern Addendum Strip","styleTags":["Modern","SaaS"],"defaultAccent":"#2563EB"}'),
  ('addendum-luxury',    'Luxury Addendum',         'addendum', '4.5x11', ARRAY['Luxury'],               '{"id":"addendum-luxury","name":"Luxury Addendum","styleTags":["Luxury"],"defaultAccent":"#7c5c1e"}'),
  ('addendum-compliance','Compliance Addendum',     'addendum', '4.5x11', ARRAY['Compliance','Classic'], '{"id":"addendum-compliance","name":"Compliance Addendum","styleTags":["Compliance","Classic"],"defaultAccent":"#0B2041","supportsAccent":false}')
ON CONFLICT (template_key) DO NOTHING;

-- Freeze each seeded template as version 1.
INSERT INTO public.sticker_template_versions (template_id, version, config, changelog)
SELECT id, 1, config, 'Initial version' FROM public.sticker_templates
ON CONFLICT (template_id, version) DO NOTHING;
