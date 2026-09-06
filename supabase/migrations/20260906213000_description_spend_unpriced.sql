-- Make the monthly budget bind when the model has no price on file.
--
-- description_generation_spend already counted pending_cost_executions and
-- nothing ever read it. That mattered more than it looks: the configured model
-- (gpt-5.6-luna) has no entry in the pricing table, so every execution records
-- cost_amount NULL, SUM(cost_amount) is 0, and the $90 monthly budget reported
-- 0% consumed no matter how many vehicles were generated. The one control that
-- exists to stop runaway spend was silently disabled by a missing price.
--
-- The fix does not invent a price. It returns the monthly production call
-- count so the caller can fall back to the only bound that holds without one:
-- budget divided by the per-generation cost cap the dealer already configured.

CREATE OR REPLACE FUNCTION public.description_generation_spend(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ok  boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = p_tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL
    ) INTO v_ok;
    IF NOT v_ok THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;
  SELECT jsonb_build_object(
    'ok', true,
    'month_production_spend', COALESCE(SUM(cost_amount) FILTER (
        WHERE NOT is_preview AND created_at >= date_trunc('month', now())), 0),
    'month_preview_spend', COALESCE(SUM(cost_amount) FILTER (
        WHERE is_preview AND created_at >= date_trunc('month', now())), 0),
    'today_generation_count', COALESCE(COUNT(*) FILTER (
        WHERE NOT is_preview AND created_at >= date_trunc('day', now())), 0),
    -- Production calls this month, priced or not. The denominator for the
    -- unpriced ceiling.
    'month_generation_count', COALESCE(COUNT(*) FILTER (
        WHERE NOT is_preview AND created_at >= date_trunc('month', now())), 0),
    'pending_cost_executions', COALESCE(COUNT(*) FILTER (
        WHERE cost_state IN ('pending','unavailable')
          AND created_at >= date_trunc('month', now())), 0)
  ) INTO v_result
  FROM public.description_model_executions
  WHERE tenant_id = p_tenant_id;
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.description_generation_spend(uuid)
  TO authenticated, service_role;
