-- Rollback for the PROPOSED 20261106000000_provider_budget_fail_closed.sql.
--
-- Rolling back RE-OPENS provider calls that the fail-closed gate would refuse,
-- so it is itself a policy change and needs the owner's approval. It restores
-- the 20261103000000 gate (dealership budgets, unit prices, the essential
-- bypass) by re-running that migration's provider_call_admit, and the hosted
-- provider_call_record. provider_lane_budgets, the reconciled_at column and
-- every ledger row stay.
--
-- Run: this file, then 20261103000000_provider_tenant_budgets.sql again (it is
-- re-runnable; scripts/budget-verify/failclosed/run.sh checks that the two
-- leave provider_call_admit and provider_call_record exactly as they were
-- before 20261106, with every ledger row and the lane table kept).

-- Byte for byte the hosted definition (pg_get_functiondef md5
-- 1a86d3414cb6612a6c791404d1215a4d, read from production on 2026-10-29).
CREATE OR REPLACE FUNCTION public.provider_call_record(p_event_id bigint, p_http_status integer, p_outcome text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  UPDATE public.provider_call_events
     SET http_status = p_http_status,
         outcome     = p_outcome,
         note        = COALESCE(p_note, note)
   WHERE id = p_event_id AND outcome = 'admitted';
$function$;
DROP FUNCTION IF EXISTS public.provider_call_unreconciled(interval);
DROP FUNCTION IF EXISTS public.platform_set_provider_lane_budget(text, text, boolean, integer, numeric, text, text, text);
