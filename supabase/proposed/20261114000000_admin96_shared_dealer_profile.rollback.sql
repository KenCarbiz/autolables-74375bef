-- Rollback for 20261114000000_admin96_shared_dealer_profile.sql.
-- Drops the new tables (and their rows) and the three onboarding_profiles
-- columns. Export the rows first if any dealer has saved data.
BEGIN;
DROP FUNCTION IF EXISTS public.save_shared_brand_profile(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.save_business_hours(uuid, uuid, text, text, jsonb, jsonb, jsonb, integer);
DROP FUNCTION IF EXISTS public.save_department_contacts(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.admin96_assert_store(uuid, uuid);
DROP TABLE IF EXISTS public.dealer_business_hours;
DROP TABLE IF EXISTS public.dealer_department_contacts;
ALTER TABLE public.onboarding_profiles
  DROP COLUMN IF EXISTS brand_palette,
  DROP COLUMN IF EXISTS logo_dark_url,
  DROP COLUMN IF EXISTS legal_name;
COMMIT;
