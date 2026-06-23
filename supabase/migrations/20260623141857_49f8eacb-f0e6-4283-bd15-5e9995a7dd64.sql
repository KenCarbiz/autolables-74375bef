ALTER TABLE public.tenant_incentive_settings
  ADD COLUMN IF NOT EXISTS show_on_sticker BOOLEAN NOT NULL DEFAULT FALSE;