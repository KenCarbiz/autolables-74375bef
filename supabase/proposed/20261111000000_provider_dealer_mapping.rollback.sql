-- Rollback for 20261111000000_provider_dealer_mapping.sql.
-- Removes the mapping function, the provider-dealer guard and the event table,
-- and restores the drizzle 0018 inventory_scope_report. dealer_stores.provider_ids
-- values are left as they are: to undo a specific mapping first, unmap it on the
-- Inventory by store screen (recorded), or clear provider_ids for that store.
-- Export store_provider_mapping_events first if its history must be kept.

DROP FUNCTION IF EXISTS public.inv_admin_map_provider_dealer(uuid, text, text, timestamptz, jsonb, text);
DROP TRIGGER IF EXISTS dealer_stores_provider_dealer_guard ON public.dealer_stores;
DROP FUNCTION IF EXISTS public.dealer_stores_provider_dealer_guard();
DROP TABLE IF EXISTS public.store_provider_mapping_events;
DROP FUNCTION IF EXISTS public.store_provider_mapping_events_append_only();

CREATE OR REPLACE FUNCTION public.inventory_scope_report(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
          OR EXISTS (SELECT 1 FROM public.tenant_members tm
                      WHERE tm.tenant_id = p_tenant_id AND tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;
  WITH stores AS (
    SELECT s.id, s.display_name, s.is_primary_inventory_store AS is_primary FROM dealer_stores s WHERE s.tenant_id = p_tenant_id
  ), primary_store AS (
    SELECT id FROM stores WHERE is_primary
  ), dealer_map AS (
    SELECT d.dealer_id, min(s.id::text)::uuid AS store_id, count(DISTINCT s.id) AS n
      FROM dealer_stores s
      CROSS JOIN LATERAL (
        SELECT jsonb_array_elements_text(CASE jsonb_typeof(s.provider_ids->'marketcheck_dealer_id') WHEN 'array' THEN s.provider_ids->'marketcheck_dealer_id' ELSE '[]'::jsonb END) AS dealer_id
        UNION ALL
        SELECT s.provider_ids->>'marketcheck_dealer_id' WHERE jsonb_typeof(s.provider_ids->'marketcheck_dealer_id') IN ('string','number')
      ) d
     WHERE s.tenant_id = p_tenant_id AND NULLIF(trim(d.dealer_id), '') IS NOT NULL
     GROUP BY d.dealer_id
  ), listings AS (
    SELECT vl.id, vl.condition, vl.owning_store_id, NULLIF(trim(vl.mc_raw->'dealer'->>'id'), '') AS mc_dealer
      FROM vehicle_listings vl WHERE vl.tenant_id = p_tenant_id AND vl.status <> 'archived'
  ), resolved AS (
    SELECT l.condition,
           CASE
             WHEN l.owning_store_id IS NOT NULL THEN CASE WHEN EXISTS (SELECT 1 FROM stores WHERE id = l.owning_store_id) THEN l.owning_store_id END
             WHEN l.mc_dealer IS NOT NULL THEN (SELECT dm.store_id FROM dealer_map dm WHERE dm.dealer_id = l.mc_dealer AND dm.n = 1)
             ELSE (SELECT id FROM primary_store)
           END AS store_id,
           l.mc_dealer
      FROM listings l
  )
  SELECT jsonb_build_object(
    'tenant_id', p_tenant_id,
    'generated_at', now(),
    'primary_store_id', (SELECT id FROM primary_store),
    'stores', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'store_id', s.id, 'name', s.display_name, 'primary', s.is_primary,
        'feed', (SELECT jsonb_build_object('present', count(*) FILTER (WHERE si.presence = 'present'),
                   'new', count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'new'),
                   'used', count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'used'),
                   'cpo', count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'cpo'),
                   'absent_not_removed', count(*) FILTER (WHERE si.presence IN ('missing','retirement_review')),
                   'last_feed_update', max(si.last_seen_at))
                 FROM store_inventory si WHERE si.store_id = s.id),
        'listings', (SELECT jsonb_build_object('total', count(*), 'new', count(*) FILTER (WHERE r.condition = 'new'),
                    'used', count(*) FILTER (WHERE r.condition = 'used'), 'cpo', count(*) FILTER (WHERE r.condition = 'cpo'))
                 FROM resolved r WHERE r.store_id = s.id)
      ) ORDER BY s.is_primary DESC, s.display_name) FROM stores s), '[]'::jsonb),
    'rooftop_review', (SELECT jsonb_build_object('total', count(*),
        'by_dealer', COALESCE(jsonb_object_agg(x.k, x.n) FILTER (WHERE x.k IS NOT NULL), '{}'::jsonb))
      FROM (SELECT COALESCE(r.mc_dealer, 'unknown_store') AS k, count(*) AS n FROM resolved r WHERE r.store_id IS NULL GROUP BY 1) x)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.inventory_scope_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_scope_report(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.dealer_store_mc_dealer_ids(jsonb);
