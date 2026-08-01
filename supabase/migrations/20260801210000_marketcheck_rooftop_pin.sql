-- Pin the nightly inventory pull to one verified rooftop.
--
-- Consistency, not just correctness: the pull previously re-derived which feed
-- to use on every run, so the answer could change from one night to the next.
-- This stores the winning feed identifier and the rooftop's verified street
-- address, so every subsequent run uses the SAME scope and re-proves it against
-- the SAME address before writing anything.
--
-- Idempotent: safe to run more than once.

ALTER TABLE public.marketcheck_sync_config
  -- The pinned feed identifier. Once set, the pull uses only this and never
  -- re-probes; a feed that stops validating fails the run instead of silently
  -- falling back to a guess.
  ADD COLUMN IF NOT EXISTS mc_scope_param      text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mc_scope_value      text NOT NULL DEFAULT '',
  -- The rooftop this tenant IS. Street + ZIP is the only field unique to a
  -- physical dealership; siblings in a group share state, city, and often the
  -- parent domain.
  ADD COLUMN IF NOT EXISTS rooftop_street      text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rooftop_zip         text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rooftop_name        text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rooftop_verified_at timestamptz,
  -- When true (the default) a listing must positively match the rooftop address
  -- to be ingested. Left switchable so a tenant that has not configured an
  -- address yet is not locked out of syncing.
  ADD COLUMN IF NOT EXISTS strict_rooftop      boolean NOT NULL DEFAULT true,
  -- Inventory size of the last run that validated cleanly. The circuit breaker
  -- compares against this so a feed that suddenly returns a fraction of the lot
  -- cannot trigger a mass prune.
  ADD COLUMN IF NOT EXISTS last_good_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_good_at        timestamptz;

COMMENT ON COLUMN public.marketcheck_sync_config.mc_scope_param IS
  'Pinned MarketCheck scope parameter (source | dealer_id | mc_website_id | mc_dealer_id ...). Empty until a run validates one.';
COMMENT ON COLUMN public.marketcheck_sync_config.rooftop_street IS
  'Normalized street of the rooftop, e.g. "150 weston st". Authoritative for ownership.';

-- Seed the rooftop address from the dealership profile each tenant already
-- maintains, so the assertion is live without anyone re-entering data.
UPDATE public.marketcheck_sync_config c
   SET rooftop_street = lower(regexp_replace(coalesce(p.settings->>'dealer_address', ''), '[^a-zA-Z0-9 ]', ' ', 'g')),
       rooftop_zip    = substring(regexp_replace(coalesce(p.settings->>'dealer_zip', ''), '\D', '', 'g') from 1 for 5)
  FROM public.dealer_profiles p
 WHERE p.tenant_id = c.tenant_id
   AND c.rooftop_street = ''
   AND coalesce(p.settings->>'dealer_address', '') <> '';

-- Let the sync (service role) pin a validated scope without a broad grant.
CREATE OR REPLACE FUNCTION public.marketcheck_pin_scope(
  _tenant_id uuid, _param text, _value text, _name text, _count integer
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.marketcheck_sync_config
     SET mc_scope_param = _param,
         mc_scope_value = _value,
         rooftop_name = coalesce(nullif(_name, ''), rooftop_name),
         rooftop_verified_at = now(),
         last_good_count = greatest(_count, 0),
         last_good_at = now()
   WHERE tenant_id = _tenant_id;
$$;

REVOKE ALL ON FUNCTION public.marketcheck_pin_scope(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketcheck_pin_scope(uuid, text, text, text, integer) TO service_role;

-- Clearing the pin is how an operator forces a fresh resolve (e.g. the dealer
-- changed website or MarketCheck re-crawled the rooftop under a new id).
CREATE OR REPLACE FUNCTION public.marketcheck_clear_scope(_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = _tenant_id
       AND m.user_id = (SELECT auth.uid())
       AND m.accepted_at IS NOT NULL
       AND m.role IN ('owner','admin')
  ) AND NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'not authorized for this dealership';
  END IF;
  UPDATE public.marketcheck_sync_config
     SET mc_scope_param = '', mc_scope_value = '', rooftop_verified_at = NULL
   WHERE tenant_id = _tenant_id;
END $$;

REVOKE ALL ON FUNCTION public.marketcheck_clear_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketcheck_clear_scope(uuid) TO authenticated, service_role;
