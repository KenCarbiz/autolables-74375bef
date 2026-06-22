-- Dealer settings persistence for the Connecticut MVP automation layer.
-- These tables let each rooftop control template selection, rule behavior,
-- branding, trust sources, passport behavior, CPO programs, and price-label
-- terminology without changing code.

CREATE TABLE IF NOT EXISTS public.dealer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dealer_name text,
  legal_name text,
  state text DEFAULT 'CT',
  default_condition text DEFAULT 'used',
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS public.dealer_template_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  default_window_template text DEFAULT 'window-saturday-hero',
  default_addendum_template text DEFAULT 'addendum-saturday-premium',
  new_window_template text DEFAULT 'new-car-sticker',
  used_window_template text DEFAULT 'window-saturday-hero',
  dealer_cpo_template text DEFAULT 'window-saturday-hero',
  oem_cpo_template text DEFAULT 'window-saturday-hero',
  luxury_template text DEFAULT 'window-saturday-hero',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS public.dealer_rule_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'CT',
  require_ftc_buyers_guide boolean NOT NULL DEFAULT true,
  require_k208 boolean NOT NULL DEFAULT true,
  auto_select_templates boolean NOT NULL DEFAULT true,
  auto_generate_passport boolean NOT NULL DEFAULT true,
  auto_generate_addendum boolean NOT NULL DEFAULT true,
  auto_archive_signed_packet boolean NOT NULL DEFAULT true,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, state)
);

CREATE TABLE IF NOT EXISTS public.dealer_branding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dealer_name text,
  address text,
  phone text,
  website text,
  logo_url text,
  primary_color text DEFAULT '#2563EB',
  secondary_color text DEFAULT '#071f3f',
  accent_color text DEFAULT '#22c55e',
  tagline text,
  disclaimer text,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS public.dealer_review_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'google',
  label text NOT NULL DEFAULT 'Google Reviews',
  rating numeric(3,2),
  review_count integer,
  profile_url text,
  manually_entered boolean NOT NULL DEFAULT false,
  allow_automated_fetch boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dealer_passport_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  passport_enabled boolean NOT NULL DEFAULT true,
  show_market_data boolean NOT NULL DEFAULT true,
  show_reconditioning boolean NOT NULL DEFAULT true,
  show_service_records boolean NOT NULL DEFAULT true,
  show_history_signals boolean NOT NULL DEFAULT true,
  qr_destination_mode text NOT NULL DEFAULT 'public_listing',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS public.dealer_cpo_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  program_type text NOT NULL DEFAULT 'dealer',
  label text NOT NULL,
  headline text NOT NULL,
  months integer,
  miles integer,
  requires_financing boolean NOT NULL DEFAULT false,
  price_add_on numeric(12,2),
  disclosure text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dealer_price_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  label text NOT NULL,
  context text NOT NULL DEFAULT 'used',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_settings_tenant_id ON public.dealer_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_template_preferences_tenant_id ON public.dealer_template_preferences (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_rule_preferences_tenant_state ON public.dealer_rule_preferences (tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_dealer_branding_tenant_id ON public.dealer_branding (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_review_sources_tenant_id ON public.dealer_review_sources (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_passport_settings_tenant_id ON public.dealer_passport_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_cpo_programs_tenant_id ON public.dealer_cpo_programs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_price_labels_tenant_id ON public.dealer_price_labels (tenant_id);

ALTER TABLE public.dealer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_template_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_rule_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_review_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_passport_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_cpo_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_price_labels ENABLE ROW LEVEL SECURITY;

-- Tenant-member policies. These are intentionally written with dynamic SQL so
-- the migration stays safe if a staging DB is missing tenant_members while the
-- rest of the MVP schema is being applied.
DO $$
DECLARE
  table_name text;
BEGIN
  IF to_regclass('public.tenant_members') IS NOT NULL THEN
    FOREACH table_name IN ARRAY ARRAY[
      'dealer_settings',
      'dealer_template_preferences',
      'dealer_rule_preferences',
      'dealer_branding',
      'dealer_review_sources',
      'dealer_passport_settings',
      'dealer_cpo_programs',
      'dealer_price_labels'
    ] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "%1$s tenant members read" ON public.%1$I', table_name);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s tenant members write" ON public.%1$I', table_name);
      EXECUTE format(
        'CREATE POLICY "%1$s tenant members read" ON public.%1$I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = auth.uid()))',
        table_name
      );
      EXECUTE format(
        'CREATE POLICY "%1$s tenant members write" ON public.%1$I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = auth.uid()))',
        table_name
      );
    END LOOP;
  END IF;
END $$;

-- Seed common price-label terminology for any tenant that already has settings.
INSERT INTO public.dealer_price_labels (tenant_id, label, context, is_default, sort_order)
SELECT tenant_id, label, 'used', label = 'Best Price', sort_order
FROM public.dealer_settings
CROSS JOIN (VALUES
  ('Selling Price', 10),
  ('Market Price', 20),
  ('Best Price', 30),
  ('One Price', 40),
  ('Value Price', 50),
  ('Dealer Custom Text', 60)
) AS labels(label, sort_order)
ON CONFLICT DO NOTHING;
