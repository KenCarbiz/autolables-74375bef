-- ROLLBACK for supabase/proposed/20261103000000_provider_tenant_budgets.sql.
-- Stops the delivery schedule, restores provider_call_admit to the hosted
-- body (the platform budget only) and removes the budget functions, so no
-- dealership budget is enforced and the Budgets & alerts tab shows "not
-- switched on". The four tables and their rows stay (budgets, prices, alert
-- settings, alert history): nothing reads them once the gate is restored, and
-- provider_call_events, the call ledger, is untouched. Dropping the tables
-- deletes the alert history and needs its own approval after an export.

DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'provider-budget-alerts';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.provider_call_admit(p_provider text, p_product text, p_caller text, p_essential boolean DEFAULT false, p_tenant_id uuid DEFAULT NULL::uuid, p_vin text DEFAULT NULL::text, p_estimated_cost_usd numeric DEFAULT NULL::numeric)
 RETURNS TABLE(admitted boolean, event_id bigint, month_calls integer, monthly_call_cap integer, reserve_for_essential integer, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_budget public.provider_call_budgets%ROWTYPE;
  v_count  integer := 0;
  v_month  timestamptz := date_trunc('month', now());
  v_id     bigint;
  v_reason text;
BEGIN
  SELECT * INTO v_budget FROM public.provider_call_budgets
   WHERE provider = p_provider FOR UPDATE;

  IF NOT FOUND OR v_budget.enabled IS NOT TRUE THEN
    INSERT INTO public.provider_call_events
      (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, note)
    VALUES
      (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'admitted', p_estimated_cost_usd, 'ungated: no budget row or gate disabled')
    RETURNING id INTO v_id;
    RETURN QUERY SELECT true, v_id, NULL::integer, NULL::integer, NULL::integer, 'ungated'::text;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_count FROM public.provider_call_events
   WHERE provider = p_provider AND at >= v_month AND outcome <> 'budget_denied';

  IF v_count >= v_budget.monthly_call_cap THEN
    v_reason := 'monthly_cap';
  ELSIF NOT p_essential AND v_count >= v_budget.monthly_call_cap - v_budget.reserve_for_essential THEN
    v_reason := 'reserve_for_essential';
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.provider_call_events
      (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, month_calls_before, note)
    VALUES
      (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'budget_denied', p_estimated_cost_usd, v_count, v_reason)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT false, v_id, v_count, v_budget.monthly_call_cap, v_budget.reserve_for_essential, v_reason;
    RETURN;
  END IF;

  INSERT INTO public.provider_call_events
    (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, month_calls_before)
  VALUES
    (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'admitted', p_estimated_cost_usd, v_count)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, v_id, v_count, v_budget.monthly_call_cap, v_budget.reserve_for_essential, 'admitted'::text;
END
$function$
;

DROP FUNCTION IF EXISTS public.unschedule_provider_budget_alerts();
DROP FUNCTION IF EXISTS public.schedule_provider_budget_alerts(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.platform_provider_budget_overview();
DROP FUNCTION IF EXISTS public.platform_set_alert_settings(boolean, boolean, text[], text[]);
DROP FUNCTION IF EXISTS public.platform_set_unit_price(text, text, numeric, text);
DROP FUNCTION IF EXISTS public.platform_delete_tenant_budget(uuid, text);
DROP FUNCTION IF EXISTS public.platform_set_tenant_budget(uuid, text, text, integer, numeric, integer[], boolean, text);
DROP FUNCTION IF EXISTS public.platform_require_admin();
DROP FUNCTION IF EXISTS public.provider_tenant_budget_thresholds(uuid, text, text);
DROP FUNCTION IF EXISTS public.provider_tenant_month_usage(uuid, text);

