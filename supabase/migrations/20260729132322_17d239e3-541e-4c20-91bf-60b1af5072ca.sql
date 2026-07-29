ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

COMMENT ON COLUMN public.vehicle_listings.archived_at IS
  'When this listing left active inventory. Set by marketcheck_prune_inventory when the VIN drops out of the dealer feed; the row and its passport are kept.';
COMMENT ON COLUMN public.vehicle_listings.archive_reason IS
  'Why the listing was retired: left_feed (absent from a full dealer pull). Never asserts "sold" -- a VIN can leave a feed for reasons we cannot see.';

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_archived_at
  ON public.vehicle_listings (tenant_id, archived_at)
  WHERE archived_at IS NOT NULL;

ALTER TABLE public.vehicle_files
  ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE OR REPLACE FUNCTION public.marketcheck_prune_inventory(_tenant_id uuid, _live_vins text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_listings int := 0; v_files int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.vehicle_listings vl
       SET status         = 'archived',
           archived_at    = COALESCE(vl.archived_at, now()),
           archive_reason = COALESCE(vl.archive_reason, 'left_feed')
     WHERE vl.tenant_id = _tenant_id
       AND vl.feed_source = 'marketcheck'
       AND vl.status <> 'archived'
       AND upper(vl.vin) <> ALL (SELECT upper(x) FROM unnest(_live_vins) x)
    RETURNING 1
  ) SELECT count(*) INTO v_listings FROM upd;

  WITH upd2 AS (
    UPDATE public.vehicle_files vf
       SET archived_at    = COALESCE(vf.archived_at, now()),
           archive_reason = COALESCE(vf.archive_reason, 'left_feed')
     WHERE vf.tenant_id = _tenant_id
       AND vf.feed_source = 'marketcheck'
       AND vf.deal_status = 'stickered'
       AND vf.archived_at IS NULL
       AND upper(vf.vin) <> ALL (SELECT upper(x) FROM unnest(_live_vins) x)
    RETURNING 1
  ) SELECT count(*) INTO v_files FROM upd2;

  RETURN jsonb_build_object('listings_deleted', v_listings, 'files_deleted', v_files,
                            'listings_archived', v_listings, 'files_archived', v_files);
END; $$;

GRANT EXECUTE ON FUNCTION public.marketcheck_prune_inventory(uuid, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.marketcheck_revive_listing(_tenant_id uuid, _vin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.vehicle_listings
     SET status = 'published', archived_at = NULL, archive_reason = NULL
   WHERE tenant_id = _tenant_id
     AND upper(vin) = upper(_vin)
     AND status = 'archived'
     AND archive_reason = 'left_feed';

  UPDATE public.vehicle_files
     SET archived_at = NULL, archive_reason = NULL
   WHERE tenant_id = _tenant_id
     AND upper(vin) = upper(_vin)
     AND archive_reason = 'left_feed';
END; $$;

GRANT EXECUTE ON FUNCTION public.marketcheck_revive_listing(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_vehicle_listing_by_slug(_slug TEXT)
RETURNS SETOF public.vehicle_listings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.vehicle_listings
  WHERE (slug = _slug OR vin = upper(_slug))
    AND (status = 'published' OR (status = 'archived' AND archived_at IS NOT NULL))
  ORDER BY (slug = _slug) DESC, (status = 'published') DESC, published_at DESC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_listing_by_slug(text) TO anon, authenticated;