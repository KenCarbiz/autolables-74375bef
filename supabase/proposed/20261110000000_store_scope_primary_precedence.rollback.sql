-- Rollback for 20261110000000_store_scope_primary_precedence.sql.
-- Restores the drizzle 0006 store_enrichment_admit body (no primary-precedence
-- check), drops the report function and the two added columns. No row data
-- other than those two columns is touched. If the reserve UPDATE was run, put
-- it back separately: UPDATE provider_accounts SET protected_reserve = 1000
-- WHERE account_ref = 'marketcheck_primary';

DROP FUNCTION IF EXISTS public.inventory_scope_report(uuid);

CREATE OR REPLACE FUNCTION public.store_enrichment_admit(p_tenant_id uuid, p_vin text, p_product text, p_caller text, p_reason text DEFAULT 'provider_call', p_estimated_cost_usd numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv record;
  p public.store_enrichment_policies%ROWTYPE;
  v_day integer; v_month integer; v_usd numeric; v_reason text;
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

  INSERT INTO store_provider_usage (store_id, group_id, product, reason, caller, vin, outcome, deny_reason, estimated_cost_usd, cost_basis)
  VALUES (inv.store_id, inv.group_id, p_product, left(p_reason, 60), left(p_caller, 80), upper(trim(p_vin)),
          CASE WHEN v_reason IS NULL THEN 'admitted' ELSE 'denied' END, v_reason, p_estimated_cost_usd,
          CASE WHEN p_estimated_cost_usd IS NULL THEN 'unpriced' ELSE 'estimate' END);
  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('admitted', true, 'scope', 'store', 'store_id', inv.store_id);
  END IF;
  RETURN jsonb_build_object('admitted', false, 'scope', 'store', 'store_id', inv.store_id, 'reason', v_reason);
END $$;

ALTER TABLE public.provider_accounts DROP COLUMN IF EXISTS primary_store_holdback;
ALTER TABLE public.store_enrichment_policies DROP COLUMN IF EXISTS condition_priority;
