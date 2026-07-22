-- ──────────────────────────────────────────────────────────────────────
-- Manager acceptance state for the addendum (FLOW hinge)
--
-- The ingest pipeline auto-builds a DRAFT addendum (create_draft_addendum) the
-- moment a vehicle lands. Until now nothing recorded the used-car manager's
-- deliberate "I accept this addendum" step — the point where the disclosure the
-- customer will sign is approved and the shop is told to start the Get-Ready.
--
-- These columns are the manager-acceptance marker. They are DISTINCT from the
-- customer-signing lifecycle (status draft->signed->completed and
-- lifecycle_status draft->...->fully_executed): acceptance is an INTERNAL
-- approval that happens before the addendum is ever sent to a customer. Modeled
-- on the existing delivered_at/delivered_by pair.
--
--   accepted_at            when the manager accepted the draft
--   accepted_by            which user accepted it
--   getready_dispatched_at when the Get-Ready was sent to the shop on acceptance
--
-- The two-bucket Ready Board keys its queues off these:
--   waiting_for_acceptance  = a draft addendum with accepted_at IS NULL
--   waiting_for_get_ready   = accepted_at IS NOT NULL, shop work not yet complete
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS accepted_at            timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS getready_dispatched_at timestamptz;

-- accept_addendum(_addendum_id): record the manager's acceptance of a draft.
-- SECURITY DEFINER so it can stamp accepted_by = auth.uid() regardless of the
-- row's created_by, but it manually enforces that the caller is an ACCEPTED
-- member of the addendum's tenant (or a platform admin) — matching the tenant
-- scoping on the table's RLS policies. Idempotent: re-accepting is a no-op that
-- returns the existing acceptance. Returns the vin/tenant/ymm so the client can
-- dispatch the Get-Ready in the same click.
CREATE OR REPLACE FUNCTION public.accept_addendum(_addendum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant uuid; _vin text; _ymm text; _uid uuid; _accepted timestamptz;
BEGIN
  _uid := (SELECT auth.uid());
  SELECT tenant_id, vehicle_vin, vehicle_ymm, accepted_at
    INTO _tenant, _vin, _ymm, _accepted
    FROM public.addendums WHERE id = _addendum_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'addendum not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _uid AND accepted_at IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized for this tenant';
  END IF;

  IF _accepted IS NULL THEN
    UPDATE public.addendums
       SET accepted_at = now(), accepted_by = _uid, updated_at = now()
     WHERE id = _addendum_id
     RETURNING accepted_at INTO _accepted;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'addendum_id', _addendum_id,
    'tenant_id', _tenant, 'vin', _vin, 'ymm', _ymm,
    'accepted_at', _accepted
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.accept_addendum(uuid) TO authenticated;

-- mark_addendum_getready_dispatched(_addendum_id): stamp that the Get-Ready was
-- sent to the shop on acceptance, so the Ready Board can move the vehicle from
-- the "waiting for Get-Ready" queue. Same tenant-membership guard.
CREATE OR REPLACE FUNCTION public.mark_addendum_getready_dispatched(_addendum_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid; _uid uuid;
BEGIN
  _uid := (SELECT auth.uid());
  SELECT tenant_id INTO _tenant FROM public.addendums WHERE id = _addendum_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'addendum not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _uid AND accepted_at IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized for this tenant';
  END IF;
  UPDATE public.addendums
     SET getready_dispatched_at = COALESCE(getready_dispatched_at, now()), updated_at = now()
   WHERE id = _addendum_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.mark_addendum_getready_dispatched(uuid) TO authenticated;
