-- Paste this whole file into Lovable (see the prompt in the thread).
-- Source: main 7b464b5e, supabase/proposed/20261112000000_group_inventory_view.sql

-- PROPOSED, NOT APPLIED. Needs Ken's approval before it runs anywhere.
--
-- Multi-dealership inventory view (read-only).
--
-- The dealer Inventory screens let a user pick any combination of the tenant's
-- dealerships and see their vehicles together. The feed vehicles of every store
-- live in store_inventory, which any accepted tenant member can SELECT through
-- the drizzle 0006 policy. This migration does not touch that policy. It adds a
-- server-side gate for the group-wide view, so the screens read other stores
-- through two SECURITY DEFINER functions that check the caller first:
--
--   allowed when the caller is a platform admin (has_role 'admin'), an accepted
--   tenant owner (tenant_members.role = 'owner'), or an accepted member holding
--   a row in inventory_group_view_grants for this tenant.
--
-- 1. inventory_group_view_grants(tenant_id, user_id, granted_by, granted_at):
--    who besides owners and platform admins may use the group view. RLS on;
--    platform admins manage it; a user may read their own grant.
-- 2. inventory_group_view_access(tenant): {allowed, reason, stores[]} with
--    authoritative per-store counts (feed present by condition, absent from the
--    last feed, listings that resolve to the store). A caller who is not
--    allowed gets allowed=false and no stores, never another tenant's data.
-- 3. inventory_group_view_rows(tenant, store_ids, offset, limit): one page of
--    the requested stores' feed rows plus the total. Raises 42501 unless the
--    caller is allowed or if any store id is not in the tenant. Each row says
--    whether its VIN has an open cross-store conflict for that store.
--
-- Read-only: nothing here transfers, adopts, publishes or modifies a vehicle,
-- calls a provider, or writes any row other than the grants an admin manages.
--
-- Preconditions: drizzle 0006 applied and 20261110000000_store_scope_primary_precedence
-- applied (the access function reads listing counts from inventory_scope_report).
-- Rollback: 20261112000000_group_inventory_view.rollback.sql.

CREATE TABLE IF NOT EXISTS public.inventory_group_view_grants (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE public.inventory_group_view_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins manage group view grants" ON public.inventory_group_view_grants;
CREATE POLICY "Platform admins manage group view grants" ON public.inventory_group_view_grants FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Users read own group view grant" ON public.inventory_group_view_grants;
CREATE POLICY "Users read own group view grant" ON public.inventory_group_view_grants FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.inventory_group_view_grants FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_group_view_grants TO authenticated;

CREATE OR REPLACE FUNCTION public.inventory_group_view_access(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_reason text;
  v_report jsonb;
  v_stores jsonb;
BEGIN
  IF v_uid IS NULL OR p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('tenant_id', p_tenant_id, 'allowed', false, 'reason', 'not_signed_in', 'stores', '[]'::jsonb);
  END IF;

  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    v_reason := 'platform_admin';
  ELSIF EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = p_tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
                   AND lower(trim(coalesce(tm.role, ''))) = 'owner') THEN
    v_reason := 'tenant_owner';
  ELSIF EXISTS (SELECT 1 FROM public.inventory_group_view_grants g
                  JOIN public.tenant_members tm ON tm.tenant_id = g.tenant_id AND tm.user_id = g.user_id
                  WHERE g.tenant_id = p_tenant_id AND g.user_id = v_uid AND tm.accepted_at IS NOT NULL) THEN
    v_reason := 'granted';
  ELSE
    RETURN jsonb_build_object('tenant_id', p_tenant_id, 'allowed', false, 'reason', 'not_permitted', 'stores', '[]'::jsonb);
  END IF;

  v_report := public.inventory_scope_report(p_tenant_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'store_id', s.id,
      'name', s.display_name,
      'primary', s.is_primary_inventory_store,
      'feed_present', f.present,
      'new', f.n_new,
      'used', f.n_used,
      'cpo', f.n_cpo,
      'absent', f.absent,
      'listings_total', COALESCE((SELECT (x->'listings'->>'total')::int
                                    FROM jsonb_array_elements(v_report->'stores') x
                                   WHERE (x->>'store_id')::uuid = s.id), 0)
     ) ORDER BY s.is_primary_inventory_store DESC, s.display_name), '[]'::jsonb)
    INTO v_stores
    FROM public.dealer_stores s
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE si.presence = 'present')::int AS present,
             count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'new')::int AS n_new,
             count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'used')::int AS n_used,
             count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'cpo')::int AS n_cpo,
             count(*) FILTER (WHERE si.presence IN ('missing', 'retirement_review'))::int AS absent
        FROM public.store_inventory si WHERE si.store_id = s.id
     ) f
   WHERE s.tenant_id = p_tenant_id;

  RETURN jsonb_build_object('tenant_id', p_tenant_id, 'allowed', true, 'reason', v_reason, 'stores', v_stores);
END $$;

CREATE OR REPLACE FUNCTION public.inventory_group_view_rows(p_tenant_id uuid, p_store_ids uuid[], p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[];
  v_limit integer := LEAST(COALESCE(p_limit, 500), 1000);
  v_total integer;
  v_rows jsonb;
BEGIN
  IF NOT COALESCE((public.inventory_group_view_access(p_tenant_id)->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'group inventory view not permitted for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;
  IF p_store_ids IS NULL OR cardinality(p_store_ids) = 0 OR COALESCE(p_offset, 0) < 0 OR v_limit < 1 THEN
    RAISE EXCEPTION 'invalid store list or page' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_store_ids) x;
  IF (SELECT count(*) FROM public.dealer_stores s WHERE s.tenant_id = p_tenant_id AND s.id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'store is not part of tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_total
    FROM public.store_inventory si JOIN public.dealer_stores s ON s.id = si.store_id
   WHERE s.tenant_id = p_tenant_id AND si.store_id = ANY (v_ids) AND si.presence IN ('present', 'missing', 'retirement_review');

  SELECT COALESCE(jsonb_agg(r.j ORDER BY r.store_id, r.id), '[]'::jsonb) INTO v_rows FROM (
    SELECT si.store_id, si.id, jsonb_build_object(
        'id', si.id, 'store_id', si.store_id, 'tenant_id', s.tenant_id, 'vin', si.vin, 'stock_number', si.stock_number,
        'condition', si.condition, 'certified', si.certified, 'year', si.year, 'make', si.make, 'model', si.model, 'trim', si.trim,
        'mileage', si.mileage, 'msrp', si.msrp, 'feed_price', si.feed_price, 'feed_price_status', si.feed_price_status,
        'exterior_color', si.exterior_color,
        'photos', CASE WHEN jsonb_typeof(si.photos) = 'array'
                       THEN (SELECT COALESCE(jsonb_agg(e.v ORDER BY e.n), '[]'::jsonb) FROM jsonb_array_elements(si.photos) WITH ORDINALITY e(v, n) WHERE e.n <= 8)
                       ELSE '[]'::jsonb END,
        'photo_count', si.photo_count, 'presence', si.presence, 'last_seen_at', si.last_seen_at, 'listing_id', si.listing_id,
        'has_open_conflict', EXISTS (SELECT 1 FROM public.inventory_vin_conflicts c
                                       WHERE c.group_id = si.group_id AND c.vin = si.vin AND c.status = 'open'
                                        AND (c.claiming_store_id = si.store_id OR c.existing_store_id = si.store_id))
      ) AS j
      FROM public.store_inventory si JOIN public.dealer_stores s ON s.id = si.store_id
     WHERE s.tenant_id = p_tenant_id AND si.store_id = ANY (v_ids) AND si.presence IN ('present', 'missing', 'retirement_review')
     ORDER BY si.store_id, si.id
     OFFSET COALESCE(p_offset, 0) LIMIT v_limit
  ) r;

  RETURN jsonb_build_object('tenant_id', p_tenant_id, 'total', v_total, 'offset', COALESCE(p_offset, 0), 'rows', v_rows);
END $$;

REVOKE ALL ON FUNCTION public.inventory_group_view_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_group_view_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.inventory_group_view_rows(uuid, uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_group_view_rows(uuid, uuid[], integer, integer) TO authenticated;