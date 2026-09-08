-- Owner direction: the master goal becomes 3,979 characters, and the market
-- area becomes a 45-mile radius around the rooftop.
--
-- LENGTH. Only the ceiling moves. The floor stays 3,221 -- it matches vAuto's
-- own recommendedMin, and channel variants are produced by trimming a master
-- so the master can never be shorter than the destination it feeds. 3,979 is
-- still the figure the writer works toward rather than a limit to stay under,
-- and the route to it is coverage of verified material, never padding.
--
-- Two properties of the band survive this change and must survive the next:
--
--   1. The required legal disclosure is RESERVED out of the writable band.
--      buildMasterPromptV3 asks the writer for the band LESS the appended
--      disclosure (297 characters plus a blank line on this lot), so the
--      finished text lands inside 3,979 instead of 297 past it. Trimming the
--      disclosure off the end instead is what cost three production
--      investigations.
--   2. description-orchestrate re-prompts once when a draft overshoots, and
--      derives that ceiling from this same band. Raising max_length here
--      raises the correction ceiling with it; nothing in that file is pinned
--      to 3,879.
--
-- vAuto's own policy stays 3221-3879. That ceiling is vAuto's, not ours, and a
-- master at 3,979 is trimmed into it by the channel pass exactly as every
-- other destination is.
--
-- GEO. What is actually on file for a dealership's location is a rooftop
-- STREET ADDRESS and ZIP (dealer_profiles.settings->>'dealer_zip', mirrored on
-- marketcheck_sync_config.rooftop_zip) and a primary city and state on
-- description_settings. There are no coordinates for a dealership anywhere in
-- this schema, so a radius cannot be computed from stored data alone, and a
-- town list cannot be turned into distances after the fact.
--
-- The honest chain is: rooftop ZIP -> a ZIP coordinate dataset -> haversine ->
-- a ranked list of localities with a MEASURED distance to each. That chain
-- already exists offline in scripts/build-selling-areas.mjs, which is where
-- the current 20 towns came from at a 40-mile radius. What was missing is
-- anywhere to record that the list IS a derivation: `selling_areas` is a bare
-- array of names, so a hand-typed list and a measured one were indistinguish-
-- able, and nothing downstream could tell whether a distance was known.
--
-- So this migration stores the derivation, not a guess:
--
--   geo_radius_miles     the radius the dealership's market area is defined at
--   geo_origin_zip       the rooftop ZIP the radius is measured from
--   selling_areas_meta   the derivation envelope: method, origin ZIP, radius,
--                        dataset, timestamp, and the measured miles per area
--
-- No town is invented here and no distance is asserted. Existing lists are
-- labelled 'hand_entered', which is what they are; they keep gating which
-- places may be named and simply cannot claim to be a measured radius until
-- an operator re-runs the derivation and writes the envelope.

-- ── 1. The band ──────────────────────────────────────────────────────

UPDATE public.description_settings
   SET max_length = 3979,
       updated_at = now()
 WHERE min_length = 3221
   AND max_length = 3879;

-- ── 2. Where the market area comes from ──────────────────────────────

ALTER TABLE public.description_settings
  ADD COLUMN IF NOT EXISTS geo_radius_miles   integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS geo_origin_zip     text,
  ADD COLUMN IF NOT EXISTS selling_areas_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'description_settings_geo_radius_miles_check'
  ) THEN
    ALTER TABLE public.description_settings
      ADD CONSTRAINT description_settings_geo_radius_miles_check
      CHECK (geo_radius_miles BETWEEN 1 AND 150);
  END IF;
END $$;

COMMENT ON COLUMN public.description_settings.geo_radius_miles IS
  'Radius in miles the dealership market area is defined at. Changing this number alone changes nothing: the area list is regenerated offline from geo_origin_zip and written back with selling_areas_meta.';
COMMENT ON COLUMN public.description_settings.geo_origin_zip IS
  'Rooftop ZIP the radius is measured from. Seeded from dealer_profiles.settings->>''dealer_zip''.';
COMMENT ON COLUMN public.description_settings.selling_areas_meta IS
  'Derivation envelope for selling_areas: {method, origin_zip, radius_miles, dataset, derived_at, areas:[{area, miles}]}. method=radius_derived means every distance in it was measured; method=hand_entered means the names were typed and no distance is known. Empty {} is read as hand_entered.';

-- ── 3. Seed the origin from the rooftop the dealership already maintains ──

UPDATE public.description_settings ds
   SET geo_origin_zip = substring(
         regexp_replace(coalesce(p.settings->>'dealer_zip', ''), '\D', '', 'g') from 1 for 5),
       updated_at = now()
  FROM public.dealer_profiles p
 WHERE p.tenant_id = ds.tenant_id
   AND ds.geo_origin_zip IS NULL
   AND length(regexp_replace(coalesce(p.settings->>'dealer_zip', ''), '\D', '', 'g')) >= 5;

UPDATE public.description_settings ds
   SET geo_origin_zip = c.rooftop_zip,
       updated_at = now()
  FROM public.marketcheck_sync_config c
 WHERE c.tenant_id = ds.tenant_id
   AND ds.geo_origin_zip IS NULL
   AND length(coalesce(c.rooftop_zip, '')) = 5;

-- ── 4. Say what the existing lists actually are ──────────────────────

UPDATE public.description_settings
   SET selling_areas_meta = jsonb_build_object(
         'method', 'hand_entered',
         'origin_zip', coalesce(geo_origin_zip, ''),
         'radius_miles', null,
         'dataset', null,
         'derived_at', null,
         'note', 'Names entered by hand. No distance is known for any of them; '
              || 'they gate which places may be named and nothing more. Re-run '
              || 'scripts/build-selling-areas.mjs against the rooftop ZIP to '
              || 'replace this with a measured derivation.',
         'areas', '[]'::jsonb),
       updated_at = now()
 WHERE selling_areas_meta = '{}'::jsonb
   AND jsonb_typeof(selling_areas) = 'array'
   AND jsonb_array_length(selling_areas) > 0;

-- ── 5. Reconsider the cases the change affects ───────────────────────

DO $$
DECLARE
  r          record;
  v_requeued integer := 0;
  v_total    integer := 0;
  v_tenants  integer := 0;
BEGIN
  FOR r IN
    SELECT tenant_id FROM public.description_settings WHERE max_length = 3979
  LOOP
    v_requeued := public.enqueue_description_config_change(r.tenant_id);
    v_total    := v_total + coalesce(v_requeued, 0);
    v_tenants  := v_tenants + 1;
  END LOOP;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES (
    'description_settings_band_and_geo',
    'description_settings',
    'platform',
    'platform',
    NULL,
    jsonb_build_object(
      'migration', '20260908150000_master_ceiling_3979_geo_radius_45',
      'max_length', jsonb_build_object('from', 3879, 'to', 3979),
      'min_length', 3221,
      'geo', jsonb_build_object(
        'radius_miles_default', 45,
        'origin', 'rooftop ZIP from dealer_profiles.settings->>dealer_zip, '
               || 'falling back to marketcheck_sync_config.rooftop_zip',
        'coordinates_available', false,
        'existing_lists_labelled', 'hand_entered'),
      'tenants_requeued', v_tenants,
      'cases_requeued', v_total));

  RAISE NOTICE 'Master ceiling 3979 and 45-mile geo scaffolding applied; % tenant(s), % case(s) requeued', v_tenants, v_total;
END $$;
