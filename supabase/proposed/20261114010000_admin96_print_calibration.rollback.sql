-- Rollback for 20261114010000_admin96_print_calibration.sql. Restores the
-- original UNIQUE constraint (fails if NULL-location duplicates were added
-- since, which the new index prevents) and drops the added columns except the
-- four-sided safe-margin family, which predates this proposal.
BEGIN;
DROP FUNCTION IF EXISTS public.record_print_calibration(uuid, uuid, text, jsonb);
DROP INDEX IF EXISTS public.dealer_print_settings_scope_unique;
ALTER TABLE public.dealer_print_settings
  ADD CONSTRAINT dealer_print_settings_tenant_id_location_id_key UNIQUE (tenant_id, location_id);
ALTER TABLE public.dealer_print_settings
  DROP COLUMN IF EXISTS calibration_measurements,
  DROP COLUMN IF EXISTS calibration_verified_by,
  DROP COLUMN IF EXISTS calibration_verified_at,
  DROP COLUMN IF EXISTS test_sheet_printed_by,
  DROP COLUMN IF EXISTS test_sheet_printed_at,
  DROP COLUMN IF EXISTS profile_name;
COMMENT ON COLUMN public.dealer_print_settings.top_safe_margin_inches IS NULL;
COMMENT ON COLUMN public.dealer_print_settings.left_safe_margin_inches IS NULL;
COMMIT;
