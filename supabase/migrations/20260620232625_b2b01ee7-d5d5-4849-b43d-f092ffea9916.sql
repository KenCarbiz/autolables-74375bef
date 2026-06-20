
ALTER TABLE public.dealer_print_settings
  ADD COLUMN IF NOT EXISTS safe_margin_top_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS safe_margin_right_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS safe_margin_bottom_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS safe_margin_left_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS show_crop_marks boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_safe_area boolean NOT NULL DEFAULT false;

ALTER TABLE public.dealer_template_customizations
  ADD COLUMN IF NOT EXISTS default_benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS addendum_wording text,
  ADD COLUMN IF NOT EXISTS preferred_label_mode text;

ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.generated_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS print_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_printed_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.generated_documents DROP CONSTRAINT IF EXISTS generated_documents_status_check;
  ALTER TABLE public.generated_documents
    ADD CONSTRAINT generated_documents_status_check
    CHECK (document_status IN ('draft','in_review','approved','rejected','published','superseded','archived'));
EXCEPTION WHEN others THEN NULL; END $$;

INSERT INTO public.sticker_templates (template_key, name, type, size, style_tags, config, is_active, is_featured) VALUES
  ('window-bold',         'Bold Monroney',           'window',   '8.5x11',     ARRAY['bold','high-contrast'], '{}'::jsonb, true, false),
  ('window-minimal',      'Minimal Window',          'window',   '8.5x11',     ARRAY['minimal','clean'],      '{}'::jsonb, true, false),
  ('window-premium',      'Premium Window',          'window',   '8.5x11',     ARRAY['premium','luxury'],     '{}'::jsonb, true, false),
  ('addendum-bold',       'Bold Addendum',           'addendum', '4.5x11',     ARRAY['bold'],                 '{}'::jsonb, true, false),
  ('addendum-classic',    'Classic Addendum',        'addendum', '4.5x11',     ARRAY['classic'],              '{}'::jsonb, true, false),
  ('addendum-minimal',    'Minimal Addendum',        'addendum', '4.5x11',     ARRAY['minimal'],              '{}'::jsonb, true, false),
  ('passport-classic',    'Classic Vehicle Passport','passport', 'responsive', ARRAY['classic'],              '{}'::jsonb, true, true),
  ('passport-modern',     'Modern Vehicle Passport', 'passport', 'responsive', ARRAY['modern'],               '{}'::jsonb, true, true),
  ('passport-luxury',     'Luxury Vehicle Passport', 'passport', 'responsive', ARRAY['luxury'],               '{}'::jsonb, true, false),
  ('passport-bold',       'Bold Vehicle Passport',   'passport', 'responsive', ARRAY['bold'],                 '{}'::jsonb, true, false),
  ('passport-minimal',    'Minimal Vehicle Passport','passport', 'responsive', ARRAY['minimal'],              '{}'::jsonb, true, false),
  ('passport-compliance', 'Compliance Passport',     'passport', 'responsive', ARRAY['compliance'],           '{}'::jsonb, true, false)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO public.sticker_template_categories (key, name) VALUES
  ('addendum','Addendum'),('passport','Vehicle Passport'),('window','Window Sticker')
ON CONFLICT (key) DO NOTHING;

DROP FUNCTION IF EXISTS public.get_published_documents_public(text);
CREATE FUNCTION public.get_published_documents_public(p_slug text)
RETURNS TABLE (
  id uuid, document_type text, template_id text,
  pdf_url text, png_url text, online_url text,
  version integer, published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gd.id, gd.document_type, gd.template_id, gd.pdf_url, gd.png_url, gd.online_url, gd.version, gd.published_at
  FROM public.generated_documents gd
  JOIN public.vehicle_listings vl ON vl.id = gd.vehicle_id
  WHERE vl.slug = p_slug AND gd.document_status = 'published'
  ORDER BY gd.published_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_published_documents_public(text) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.generated_documents(id) ON DELETE SET NULL,
  code text NOT NULL UNIQUE,
  target_url text NOT NULL,
  surface text,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_codes TO authenticated;
GRANT ALL ON public.qr_codes TO service_role;
GRANT SELECT ON public.qr_codes TO anon;
ALTER TABLE public.qr_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant qr_codes" ON public.qr_codes;
CREATE POLICY "tenant qr_codes" ON public.qr_codes FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "anon read active qr_codes" ON public.qr_codes;
CREATE POLICY "anon read active qr_codes" ON public.qr_codes FOR SELECT TO anon USING (is_active = true);

DROP TRIGGER IF EXISTS qr_codes_set_updated_at ON public.qr_codes;
CREATE TRIGGER qr_codes_set_updated_at BEFORE UPDATE ON public.qr_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.qr_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id uuid REFERENCES public.qr_codes(id) ON DELETE CASCADE,
  code text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  user_agent text, referrer text, ip_hash text,
  country text, region text, city text,
  scanned_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.qr_scan_events TO authenticated;
GRANT ALL ON public.qr_scan_events TO service_role;
ALTER TABLE public.qr_scan_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read qr_scan_events" ON public.qr_scan_events;
CREATE POLICY "tenant read qr_scan_events" ON public.qr_scan_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE INDEX IF NOT EXISTS qr_scan_events_code_idx ON public.qr_scan_events(code);
CREATE INDEX IF NOT EXISTS qr_scan_events_tenant_scanned_idx ON public.qr_scan_events(tenant_id, scanned_at DESC);

CREATE OR REPLACE FUNCTION public.log_qr_scan(
  p_code text, p_user_agent text DEFAULT NULL, p_referrer text DEFAULT NULL,
  p_ip_hash text DEFAULT NULL, p_country text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_qr public.qr_codes%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_qr FROM public.qr_codes WHERE code = p_code AND is_active = true LIMIT 1;
  INSERT INTO public.qr_scan_events (qr_code_id, code, tenant_id, vehicle_id, user_agent, referrer, ip_hash, country)
  VALUES (v_qr.id, p_code, v_qr.tenant_id, v_qr.vehicle_id, p_user_agent, p_referrer, p_ip_hash, p_country)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_qr_scan(text,text,text,text,text) TO anon, authenticated;
