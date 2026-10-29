-- Three function definitions as the hosted project defines them, read from its
-- catalogue (pg_get_functiondef) on 2026-10-29. The repository's migration
-- chain produces different bodies for these three, so the replica takes the
-- hosted ones. Code only; no hosted data.

CREATE OR REPLACE FUNCTION public.enforce_prep_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_do_not_drive BOOLEAN;
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;
    v_do_not_drive := COALESCE((NEW.recall_check ->> 'do_not_drive')::BOOLEAN, false);
    IF v_do_not_drive AND NEW.recall_override_by IS NULL THEN
      RAISE EXCEPTION 'recall_gate_blocked: vehicle % has an active do-not-drive recall; admin override required',
        NEW.vin USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fire_recall_service_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_sig text;
BEGIN
  IF COALESCE(NEW.open_recall_count, 0) <= 0 THEN RETURN NEW; END IF;
  v_sig := public.recall_payload_signature(NEW.recall_payload);
  IF EXISTS (SELECT 1 FROM public.recall_service_tasks t WHERE t.vehicle_listing_id = NEW.id AND t.status = 'open_review') THEN
    UPDATE public.recall_service_tasks
       SET open_recall_count = NEW.open_recall_count, recall_payload = NEW.recall_payload,
           recall_signature = v_sig, ymm = COALESCE(NEW.ymm, ymm), updated_at = now()
     WHERE vehicle_listing_id = NEW.id AND status = 'open_review';
    RETURN NEW;
  END IF;
  IF v_sig IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.recall_service_tasks t
       WHERE t.vehicle_listing_id = NEW.id AND t.status = 'resolved'
         AND t.recall_signature IS NOT DISTINCT FROM v_sig) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.recall_service_tasks
    (tenant_id, vehicle_listing_id, vin, ymm, open_recall_count, recall_payload, recall_signature, status)
  VALUES (NEW.tenant_id, NEW.id, NEW.vin, NEW.ymm, NEW.open_recall_count, NEW.recall_payload, v_sig, 'open_review')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $function$
;

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
