-- ──────────────────────────────────────────────────────────────────────
-- Enforce the acceptance capability server-side (security review finding)
--
-- accept_addendum / mark_addendum_getready_dispatched originally guarded only
-- on tenant MEMBERSHIP. Acceptance approves the legal disclosure the customer
-- will sign and dispatches shop work, so it is a manager-only control — the
-- client already gates the button on the can_approve_print capability. A member
-- without that capability (salesperson, detail, third-party vendor, etc.) could
-- still call the RPC directly and bypass the UI gate. These redefinitions add
-- the manager role allow-list to the server guard.
--
-- The allow-list mirrors the roles that hold can_approve_print in
-- src/lib/permissions/dealerRoleCapabilities.ts (owner, general_manager, gsm,
-- admin, manager, sales_manager, used_car_manager, inventory_manager). Keep the
-- two in sync if that map changes. Platform admins (user_roles.role='admin')
-- always pass.
-- ──────────────────────────────────────────────────────────────────────

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
       AND role IN ('owner','general_manager','gsm','admin','manager',
                    'sales_manager','used_car_manager','inventory_manager')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized: manager acceptance required';
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
       AND role IN ('owner','general_manager','gsm','admin','manager',
                    'sales_manager','used_car_manager','inventory_manager')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized: manager acceptance required';
  END IF;
  UPDATE public.addendums
     SET getready_dispatched_at = COALESCE(getready_dispatched_at, now()), updated_at = now()
   WHERE id = _addendum_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.accept_addendum(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_addendum_getready_dispatched(uuid) TO authenticated;
