-- PROPOSED, NOT APPLIED. Needs Ken's approval before it runs anywhere.
--
-- Primary vs child-store inventory and MarketCheck credit precedence (P0, Nov 6 2026).
--
-- 1. store_enrichment_policies.condition_priority: per-store new-versus-used
--    order for paid enrichment. Default used_first.
-- 2. provider_accounts.primary_store_holdback: calls kept for the primary
--    store. A child store may reserve only what is left after the protected
--    reserve and this holdback. Default 0, so applying this changes nothing
--    until an owner sets a number.
-- 3. store_enrichment_admit gains that child-store check. When account usage
--    cannot be read (no account row), a child store is refused: it fails
--    closed. The primary store and legacy tenant inventory are unchanged.
-- 4. inventory_scope_report(tenant): per-store counts (new/used/CPO), the
--    listings that resolve to each store, and the listings held for rooftop
--    review. Member-scoped, read-only, no provider calls. Same rules as
--    src/lib/inventoryScope/storeScope.ts.
--
-- Not included (separate owner decision): the 250-call reserve. Production
-- has protected_reserve = 1000. Ken's Nov 6 spec says 250; the statement to
-- run after approval is at the end of this file, commented out.
--
-- Preconditions: drizzle 0006 and 0007 applied. Additive: two columns with
-- defaults, one replaced function (same signature and return shape), one new
-- function. Rollback: 20261110000000_store_scope_primary_precedence.rollback.sql.

ALTER TABLE public.store_enrichment_policies
  ADD COLUMN IF NOT EXISTS condition_priority text NOT NULL DEFAULT 'used_first'
    CHECK (condition_priority IN ('used_first','new_first','equal'));

ALTER TABLE public.provider_accounts
  ADD COLUMN IF NOT EXISTS primary_store_holdback integer NOT NULL DEFAULT 0
    CHECK (primary_store_holdback >= 0);

CREATE OR REPLACE FUNCTION public.store_enrichment_admit(p_tenant_id uuid, p_vin text, p_product text, p_caller text, p_reason text DEFAULT 'provider_call', p_estimated_cost_usd numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv record;
  p public.store_enrichment_policies%ROWTYPE;
  v_day integer; v_month integer; v_usd numeric; v_reason text;
  v_primary boolean; a public.provider_accounts%ROWTYPE; u record;
BEGIN
  IF p_tenant_id IS NULL OR p_vin IS NULL OR p_vin = '' THEN
    RETURN jsonb_build_object('admitted', true, 'scope', 'not_store_vehicle');
  END IF;
  SELECT si.store_id, si.group_id INTO inv FROM store_inventory si JOIN dealer_groups g ON g.id = si.group_id
   WHERE g.tenant_id = p_tenant_id AND si.vin = upper(trim(p_vin)) AND si.presence NOT IN ('retired','transferred') LIMIT 1;
  IF inv.store_id IS NULL THEN
    SELECT vl.owning_store_id AS store_id, s.group_id INTO inv FROM vehicle_listings vl JOIN dealer_stores s ON s.id = vl.owning_store_id
     WHERE vl.tenant_id = p_tenant_id AND upper(trim(vl.vin)) = upper(trim(p_vin)) LIMIT 1;
  END IF;
  IF inv.store_id IS NULL THEN
    RETURN jsonb_build_object('admitted', true, 'scope', 'legacy_tenant_inventory');
  END IF;

  SELECT * INTO p FROM store_enrichment_policies WHERE store_id = inv.store_id FOR UPDATE;
  IF NOT FOUND OR p.mode = 'feed_only' THEN v_reason := 'feed_only';
  ELSIF p.mode = 'paused' THEN v_reason := 'paused';
  ELSIF p.budget_blocked THEN v_reason := 'budget_blocked';
  ELSIF NOT (p_product = ANY (p.allowed_products)) THEN v_reason := 'product_not_approved';
  ELSE
    SELECT count(*) FILTER (WHERE at >= date_trunc('day', now())), count(*), COALESCE(sum(estimated_cost_usd), 0)
      INTO v_day, v_month, v_usd
      FROM store_provider_usage WHERE store_id = inv.store_id AND outcome = 'admitted' AND at >= date_trunc('month', now());
    IF v_day >= p.daily_request_limit THEN v_reason := 'daily_limit';
    ELSIF v_month >= floor(p.monthly_request_cap * p.hard_stop_pct / 100.0) THEN v_reason := 'monthly_cap';
    ELSIF p.monthly_usd_cap IS NOT NULL AND p_estimated_cost_usd IS NULL THEN v_reason := 'unpriced';
    ELSIF p.monthly_usd_cap IS NOT NULL AND v_usd + p_estimated_cost_usd > p.monthly_usd_cap * p.hard_stop_pct / 100.0 THEN v_reason := 'monthly_usd_cap';
    END IF;
  END IF;

  -- Primary precedence: a child store spends only what the primary store and
  -- the essential reserve do not need.
  IF v_reason IS NULL THEN
    SELECT s.is_primary_inventory_store INTO v_primary FROM dealer_stores s WHERE s.id = inv.store_id;
    IF NOT COALESCE(v_primary, false) THEN
      SELECT * INTO a FROM provider_accounts WHERE account_ref = 'marketcheck_primary';
      IF NOT FOUND THEN
        v_reason := 'account_missing';
      ELSE
        SELECT * INTO u FROM provider_local_usage('marketcheck_primary');
        IF a.monthly_call_quota - (u.consumed + u.reserved + u.uncertain) - a.protected_reserve - a.primary_store_holdback < 1 THEN
          v_reason := 'primary_precedence';
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO store_provider_usage (store_id, group_id, product, reason, caller, vin, outcome, deny_reason, estimated_cost_usd, cost_basis)
  VALUES (inv.store_id, inv.group_id, p_product, left(p_reason, 60), left(p_caller, 80), upper(trim(p_vin)),
          CASE WHEN v_reason IS NULL THEN 'admitted' ELSE 'denied' END, v_reason, p_estimated_cost_usd,
          CASE WHEN p_estimated_cost_usd IS NULL THEN 'unpriced' ELSE 'estimate' END);
  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('admitted', true, 'scope', 'store', 'store_id', inv.store_id);
  END IF;
  RETURN jsonb_build_object('admitted', false, 'scope', 'store', 'store_id', inv.store_id, 'reason', v_reason);
END $$;

-- Read-only scope report. The MarketCheck dealer id is matched only through an
-- explicit dealer_stores.provider_ids.marketcheck_dealer_id mapping (a string
-- or an array of strings); a dealer id mapped to two stores is ambiguous and
-- goes to review.
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

-- After separate owner approval only (Ken's Nov 6 spec: 250-call reserve, 4,750 nonessential):
-- UPDATE public.provider_accounts SET protected_reserve = 250, updated_at = now()
--  WHERE account_ref = 'marketcheck_primary' AND protected_reserve = 1000;
