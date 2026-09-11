CREATE OR REPLACE FUNCTION public.market_reserve_provider_call(
  p_tenant_id   uuid,
  p_provider    text,
  p_fingerprint text,
  p_ttl_seconds integer DEFAULT 120
)
RETURNS TABLE(
  outcome            text,
  attempt_id         uuid,
  estimated_cost_usd numeric,
  month_spent_usd    numeric,
  month_budget_usd   numeric
)
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_budget  public.market_provider_budgets%ROWTYPE;
  v_spent   numeric := 0;
  v_month   timestamptz := date_trunc('month', now());
  v_existing public.provider_request_reservations%ROWTYPE;
  v_id      uuid;
BEGIN
  UPDATE public.provider_request_reservations
     SET status = 'expired', completed_at = now(), failure_reason = 'reservation_expired'
   WHERE status = 'reserved' AND expires_at < now();

  SELECT * INTO v_budget FROM public.market_provider_budgets
   WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND OR v_budget.enabled IS NOT TRUE THEN
    RETURN QUERY SELECT 'disabled'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM public.provider_request_reservations AS prr
   WHERE prr.provider = p_provider AND prr.request_fingerprint = p_fingerprint
     AND prr.status = 'reserved'
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'existing'::text, v_existing.attempt_id, v_existing.estimated_cost_usd,
                        0::numeric, v_budget.monthly_budget_usd;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(COALESCE(prr.actual_cost_usd, prr.estimated_cost_usd)), 0) INTO v_spent
    FROM public.provider_request_reservations AS prr
   WHERE prr.tenant_id = p_tenant_id AND prr.reserved_at >= v_month
     AND prr.status IN ('reserved', 'succeeded');

  IF v_spent + v_budget.per_call_cost_usd > v_budget.monthly_budget_usd THEN
    RETURN QUERY SELECT 'budget_exceeded'::text, NULL::uuid, v_budget.per_call_cost_usd,
                        v_spent, v_budget.monthly_budget_usd;
    RETURN;
  END IF;

  INSERT INTO public.provider_request_reservations
    (tenant_id, provider, request_fingerprint, status, expires_at, estimated_cost_usd)
  VALUES
    (p_tenant_id, p_provider, p_fingerprint, 'reserved',
     now() + make_interval(secs => GREATEST(p_ttl_seconds, 10)), v_budget.per_call_cost_usd)
  RETURNING provider_request_reservations.attempt_id INTO v_id;

  RETURN QUERY SELECT 'reserved'::text, v_id, v_budget.per_call_cost_usd,
                      v_spent, v_budget.monthly_budget_usd;
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.provider_request_reservations AS prr
     WHERE prr.provider = p_provider AND prr.request_fingerprint = p_fingerprint
       AND prr.status = 'reserved'
     LIMIT 1;
    RETURN QUERY SELECT 'existing'::text, v_existing.attempt_id, v_existing.estimated_cost_usd,
                        0::numeric, 0::numeric;
END
$function$;

COMMENT ON FUNCTION public.market_reserve_provider_call(uuid, text, text, integer) IS
  'Atomically reserves one paid provider call against a tenant budget. Returns '
  'disabled | existing | budget_exceeded | reserved. Column references to '
  'provider_request_reservations are table-qualified because outcome, '
  'attempt_id and estimated_cost_usd are also OUT parameters; an unqualified '
  'reference raises 42702 and silently prevents every reservation.';