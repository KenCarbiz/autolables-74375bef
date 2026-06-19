ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS feed_source text;
ALTER TABLE public.vehicle_files    ADD COLUMN IF NOT EXISTS feed_source text;

CREATE OR REPLACE FUNCTION public.admin_clear_synced_inventory(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_listings int := 0; v_files int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  WITH del AS (
    DELETE FROM public.vehicle_listings vl
     WHERE vl.tenant_id = _tenant_id
       AND NOT EXISTS (
         SELECT 1 FROM public.addendums a
          WHERE a.tenant_id = _tenant_id AND upper(a.vehicle_vin) = upper(vl.vin)
       )
    RETURNING 1
  ) SELECT count(*) INTO v_listings FROM del;

  WITH del2 AS (
    DELETE FROM public.vehicle_files vf
     WHERE vf.tenant_id = _tenant_id
       AND vf.deal_status = 'stickered'
       AND NOT EXISTS (
         SELECT 1 FROM public.addendums a
          WHERE a.tenant_id = _tenant_id AND upper(a.vehicle_vin) = upper(vf.vin)
       )
    RETURNING 1
  ) SELECT count(*) INTO v_files FROM del2;

  RETURN jsonb_build_object('listings_deleted', v_listings, 'files_deleted', v_files);
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_clear_synced_inventory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketcheck_prune_inventory(_tenant_id uuid, _live_vins text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_listings int := 0; v_files int := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.vehicle_listings vl
     WHERE vl.tenant_id = _tenant_id
       AND vl.feed_source = 'marketcheck'
       AND upper(vl.vin) <> ALL (SELECT upper(x) FROM unnest(_live_vins) x)
       AND NOT EXISTS (
         SELECT 1 FROM public.addendums a
          WHERE a.tenant_id = _tenant_id AND upper(a.vehicle_vin) = upper(vl.vin)
       )
    RETURNING 1
  ) SELECT count(*) INTO v_listings FROM del;

  WITH del2 AS (
    DELETE FROM public.vehicle_files vf
     WHERE vf.tenant_id = _tenant_id
       AND vf.feed_source = 'marketcheck'
       AND vf.deal_status = 'stickered'
       AND upper(vf.vin) <> ALL (SELECT upper(x) FROM unnest(_live_vins) x)
       AND NOT EXISTS (
         SELECT 1 FROM public.addendums a
          WHERE a.tenant_id = _tenant_id AND upper(a.vehicle_vin) = upper(vf.vin)
       )
    RETURNING 1
  ) SELECT count(*) INTO v_files FROM del2;

  RETURN jsonb_build_object('listings_deleted', v_listings, 'files_deleted', v_files);
END; $$;

GRANT EXECUTE ON FUNCTION public.marketcheck_prune_inventory(uuid, text[]) TO authenticated, service_role;