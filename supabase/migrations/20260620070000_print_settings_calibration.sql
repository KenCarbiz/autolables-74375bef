-- Print Settings + Calibration: extend dealer_print_settings (20260620060000)
-- with safe-margin guides and crop/safe-area print toggles. Additive and
-- idempotent so it is safe to re-run. RLS + tenant ownership already defined
-- on the base table.

ALTER TABLE public.dealer_print_settings
  ADD COLUMN IF NOT EXISTS top_safe_margin_inches  numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS left_safe_margin_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS show_crop_marks         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_safe_area          boolean NOT NULL DEFAULT false;
