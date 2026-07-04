-- Server-side shallow merge for dealer settings. The client previously
-- upserted its ENTIRE settings snapshot on every debounced edit, so two
-- managers editing different admin panels concurrently would clobber each
-- other's keys (last write wins across the whole blob). Merging only the
-- patched keys server-side confines each save to the keys it changed.

CREATE OR REPLACE FUNCTION public.merge_dealer_settings(
  _tenant_id UUID,
  _patch     JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = _tenant_id AND user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.dealer_profiles (tenant_id, settings, updated_by)
  VALUES (_tenant_id, COALESCE(_patch, '{}'::jsonb), (SELECT auth.uid()))
  ON CONFLICT (tenant_id) DO UPDATE
    SET settings   = COALESCE(dealer_profiles.settings, '{}'::jsonb) || COALESCE(_patch, '{}'::jsonb),
        updated_by = (SELECT auth.uid());

  RETURN true;
END;
$$;
