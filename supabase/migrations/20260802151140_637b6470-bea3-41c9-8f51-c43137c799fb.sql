ALTER TABLE public.marketcheck_sync_config
  ADD COLUMN IF NOT EXISTS mc_scope_param      text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mc_scope_value      text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rooftop_street      text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rooftop_zip         text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rooftop_name        text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rooftop_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS strict_rooftop      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_good_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_good_at        timestamptz;

COMMENT ON COLUMN public.marketcheck_sync_config.mc_scope_param IS
  'Pinned MarketCheck scope parameter (source | dealer_id | mc_website_id | mc_dealer_id ...). Empty until a run validates one.';
COMMENT ON COLUMN public.marketcheck_sync_config.rooftop_street IS
  'Normalized street of the rooftop, e.g. "150 weston st". Authoritative for ownership.';

UPDATE public.marketcheck_sync_config c
   SET rooftop_street = lower(regexp_replace(coalesce(p.settings->>'dealer_address', ''), '[^a-zA-Z0-9 ]', ' ', 'g')),
       rooftop_zip    = substring(regexp_replace(coalesce(p.settings->>'dealer_zip', ''), '\D', '', 'g') from 1 for 5)
  FROM public.dealer_profiles p
 WHERE p.tenant_id = c.tenant_id
   AND c.rooftop_street = ''
   AND coalesce(p.settings->>'dealer_address', '') <> '';

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