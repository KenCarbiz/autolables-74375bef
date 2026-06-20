-- Per-dealer template customization extras. Extends dealer_template_customizations
-- (20260620060000) with default seed content and a preferred label mode. Additive
-- and idempotent. Owner column + RLS already defined on the base table.

ALTER TABLE public.dealer_template_customizations
  ADD COLUMN IF NOT EXISTS default_benefits          jsonb   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS default_addendum_wording  text,
  ADD COLUMN IF NOT EXISTS preferred_label_mode      text    CHECK (preferred_label_mode IN ('white','black'));
