-- ── Fix SQLSTATE 42702 in market_reserve_provider_call ─────────────────────
--
-- The function could never grant a reservation. Every call that reached its
-- enabled-budget path raised:
--
--   42702: column reference "estimated_cost_usd" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- `RETURNS TABLE(... estimated_cost_usd numeric ...)` makes that name an OUT
-- variable, and `provider_request_reservations` also has a column of that
-- name. The month-spend query referenced it bare, PL/pgSQL's default
-- variable_conflict is `error`, and it raised.
--
-- Why it survived review and four gates: the `disabled` short-circuit returns
-- before the spend query, so every probe run with the budget switched off
-- returned a clean `disabled` and proved nothing about the path that matters.
-- The one live call that did enable the budget got the exception, and the
-- caller discarded the error, recording only `reservation = "unavailable"`.
--
-- The author had already hit this once: `RETURNING
-- provider_request_reservations.attempt_id` is qualified precisely because
-- `attempt_id` is also an OUT parameter. The spend query was missed.
--
-- This migration replaces ONLY the function body's column references. The
-- signature, return columns, language, search_path, exception handling and
-- decision semantics are byte-for-byte the same. No table, policy, RLS,
-- trigger, grant or row is touched.
--
-- Ambiguity is fixed by qualification, deliberately NOT by a
-- `#variable_conflict` directive: suppressing the error would hide the next
-- collision instead of preventing it.
--
-- CREATE OR REPLACE preserves the existing EXECUTE ACL
-- ({postgres=X/postgres,service_role=X/postgres}), so no grant is reissued
-- here and no privilege is widened.

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
  -- Expire anything abandoned before measuring, so a crashed caller cannot
  -- hold a fingerprint or a slice of the budget forever.
  UPDATE public.provider_request_reservations
     SET status = 'expired', completed_at = now(), failure_reason = 'reservation_expired'
   WHERE status = 'reserved' AND expires_at < now();

  -- Serialise every decision for this tenant, so two callers cannot both read
  -- the same remaining budget and both spend it.
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

  -- THE FIX. `prr.estimated_cost_usd` is the column; unqualified it collides
  -- with the OUT parameter of the same name and raises 42702.
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
    -- Another caller won the race for this fingerprint between our check and
    -- our insert. Hand back theirs; nobody pays twice.
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
