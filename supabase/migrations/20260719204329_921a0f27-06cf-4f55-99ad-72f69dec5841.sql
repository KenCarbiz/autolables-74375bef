-- Passport version override: introduce 'inherit' so vehicles can be
-- explicitly pinned to Current or V3, while the tenant default lives
-- separately in dealer_profiles.settings.passport_version.

ALTER TABLE public.vehicle_listings
  DROP CONSTRAINT IF EXISTS vehicle_listings_passport_version_check;

ALTER TABLE public.vehicle_listings
  ADD CONSTRAINT vehicle_listings_passport_version_check
  CHECK (passport_version IN ('inherit','current','v3','experiment'));

ALTER TABLE public.vehicle_listings
  ALTER COLUMN passport_version SET DEFAULT 'inherit';

-- Build #1 shipped moments ago; every existing row was auto-defaulted to
-- 'current' and no dealer has intentionally pinned that value. Fold them
-- into the new neutral 'inherit' state so tenant-default V3 pilots aren't
-- silently overridden per-vehicle.
UPDATE public.vehicle_listings
   SET passport_version = 'inherit'
 WHERE passport_version = 'current';
