-- PROPOSED, NOT APPLIED. Awaiting the owner's review of the pricing role
-- matrix (ADMIN_V2_SERVER_AUTHORITY.md, section 10). Verified only in the
-- isolated replica: scripts/db-verify/run.sh --proposed.
--
-- Vehicle price columns become editable by the pricing roles (owner, admin,
-- general_manager, gsm) and by used-car or inventory managers holding an
-- active, time-limited delegation granted by the owner or the general
-- manager. Dealer-wide pricing policy (the doc fee, pricing settings keys, the
-- fee Review & Apply) stays with the pricing roles and is not delegable.
-- Service jobs, cron and definer-run RPCs are unaffected, as before.

-- ── Delegations ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pricing_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  delegate_user_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('used', 'new', 'all')),
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  granted_by uuid NOT NULL,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  revoke_reason text,
  CONSTRAINT pricing_delegations_window CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '90 days')
);

CREATE UNIQUE INDEX IF NOT EXISTS pricing_delegations_one_open
  ON public.pricing_delegations (tenant_id, delegate_user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.pricing_delegations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_delegations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pricing_delegations TO authenticated;

DROP POLICY IF EXISTS "pricing_delegations pricing roles and delegate read" ON public.pricing_delegations;
CREATE POLICY "pricing_delegations pricing roles and delegate read"
  ON public.pricing_delegations FOR SELECT
  TO authenticated
  USING (
    delegate_user_id = (SELECT auth.uid())
    OR public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm'])
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

COMMENT ON TABLE public.pricing_delegations IS
  'Time-limited authority for a used-car or inventory manager to change vehicle prices, granted by the owner or general manager. Written only by admin_grant_pricing_delegation and admin_revoke_pricing_delegation; every grant and revoke is audited.';

-- ── Authority check ─────────────────────────────────────────────────────

-- p_condition is the listing condition: 'new' needs a new or all scope; used,
-- certified and anything else need used or all; an unknown condition needs all.
CREATE OR REPLACE FUNCTION public.has_pricing_authority(p_tenant_id uuid, p_condition text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.tenant_role_in(p_tenant_id, ARRAY['owner','admin','general_manager','gsm'])
      OR EXISTS (
        SELECT 1
        FROM public.pricing_delegations d
        JOIN public.tenant_members tm
          ON tm.tenant_id = d.tenant_id
         AND tm.user_id = d.delegate_user_id
         AND tm.accepted_at IS NOT NULL
         AND lower(trim(coalesce(tm.role, ''))) IN ('used_car_manager', 'inventory_manager')
        WHERE d.tenant_id = p_tenant_id
          AND d.delegate_user_id = (SELECT auth.uid())
          AND d.revoked_at IS NULL
          AND now() < d.expires_at
          AND (d.scope = 'all'
               OR (d.scope = 'new' AND lower(trim(coalesce(p_condition, ''))) = 'new')
               OR (d.scope = 'used' AND lower(trim(coalesce(p_condition, ''))) IN ('used', 'cpo', 'certified')))
      );
$function$;

REVOKE ALL ON FUNCTION public.has_pricing_authority(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_pricing_authority(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_pricing_authority(uuid, text) IS
  'True when the caller may change vehicle prices for a listing of this condition: a pricing role, a platform admin, or an accepted used-car or inventory manager with an open, unexpired delegation whose scope covers the condition. A role change voids the delegation.';

-- ── Grant ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_grant_pricing_delegation(
  p_tenant_id uuid,
  p_delegate_user_id uuid,
  p_scope text,
  p_expires_at timestamp with time zone,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_replaced uuid;
  v_id uuid;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.tenant_role_in(p_tenant_id, ARRAY['owner','general_manager'])
  ) THEN
    RAISE EXCEPTION 'only the owner or general manager can delegate pricing authority' USING ERRCODE = '42501';
  END IF;
  IF p_delegate_user_id IS NULL OR p_delegate_user_id = v_uid THEN
    RAISE EXCEPTION 'choose another team member to delegate to' USING ERRCODE = '22023';
  END IF;
  SELECT lower(trim(coalesce(role, ''))) INTO v_role
  FROM public.tenant_members
  WHERE tenant_id = p_tenant_id AND user_id = p_delegate_user_id AND accepted_at IS NOT NULL;
  IF v_role IS NULL OR v_role NOT IN ('used_car_manager', 'inventory_manager') THEN
    RAISE EXCEPTION 'pricing authority can be delegated only to an accepted used-car or inventory manager' USING ERRCODE = '22023';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('used', 'new', 'all') THEN
    RAISE EXCEPTION 'scope must be used, new or all' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'a delegation must end within 90 days' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;

  -- One open delegation per person: a new grant replaces the previous one.
  UPDATE public.pricing_delegations
  SET revoked_at = now(), revoked_by = v_uid, revoke_reason = 'replaced by a new delegation'
  WHERE tenant_id = p_tenant_id AND delegate_user_id = p_delegate_user_id AND revoked_at IS NULL
  RETURNING id INTO v_replaced;

  INSERT INTO public.pricing_delegations (tenant_id, delegate_user_id, scope, reason, granted_by, expires_at)
  VALUES (p_tenant_id, p_delegate_user_id, p_scope, trim(p_reason), v_uid, p_expires_at)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('pricing_delegation_granted', 'pricing_delegation', v_id::text, p_tenant_id::text, v_uid,
          jsonb_build_object('delegate_user_id', p_delegate_user_id, 'delegate_role', v_role, 'scope', p_scope,
                             'expires_at', p_expires_at, 'reason', trim(p_reason), 'replaced', v_replaced));

  RETURN jsonb_build_object('status', 'granted', 'id', v_id, 'replaced', v_replaced, 'expires_at', p_expires_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_grant_pricing_delegation(uuid, uuid, text, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_pricing_delegation(uuid, uuid, text, timestamp with time zone, text) TO authenticated;

-- ── Revoke ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_revoke_pricing_delegation(p_delegation_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.pricing_delegations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.pricing_delegations WHERE id = p_delegation_id FOR UPDATE;
  IF NOT FOUND OR NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.tenant_role_in(v_row.tenant_id, ARRAY['owner','general_manager'])
  ) THEN
    RAISE EXCEPTION 'only the owner or general manager can revoke pricing authority' USING ERRCODE = '42501';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_revoked', 'id', v_row.id, 'revoked_at', v_row.revoked_at);
  END IF;

  UPDATE public.pricing_delegations
  SET revoked_at = now(), revoked_by = v_uid, revoke_reason = nullif(trim(coalesce(p_reason, '')), '')
  WHERE id = p_delegation_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('pricing_delegation_revoked', 'pricing_delegation', v_row.id::text, v_row.tenant_id::text, v_uid,
          jsonb_build_object('delegate_user_id', v_row.delegate_user_id, 'scope', v_row.scope, 'reason', nullif(trim(coalesce(p_reason, '')), '')));

  RETURN jsonb_build_object('status', 'revoked', 'id', v_row.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_revoke_pricing_delegation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_pricing_delegation(uuid, text) TO authenticated;

-- ── Column guard ────────────────────────────────────────────────────────

-- Same shape as the applied guard; the price branch now asks
-- has_pricing_authority for both the old and the new condition, so a scoped
-- delegate cannot reprice a vehicle by changing its condition in the same write.
CREATE OR REPLACE FUNCTION public.vehicle_listings_guard_priced_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_tenant uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
  v_price_changed boolean;
  v_recall_changed boolean;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_price_changed :=
       NEW.price IS DISTINCT FROM OLD.price
    OR NEW.doc_fee IS DISTINCT FROM OLD.doc_fee
    OR NEW.website_sale_price IS DISTINCT FROM OLD.website_sale_price
    OR NEW.advertised_price_before_doc IS DISTINCT FROM OLD.advertised_price_before_doc
    OR NEW.dealer_discount IS DISTINCT FROM OLD.dealer_discount
    OR NEW.retail_cash IS DISTINCT FROM OLD.retail_cash;
  v_recall_changed :=
       NEW.recall_override_by IS DISTINCT FROM OLD.recall_override_by
    OR NEW.recall_override_notes IS DISTINCT FROM OLD.recall_override_notes
    OR NEW.recall_override_at IS DISTINCT FROM OLD.recall_override_at;

  IF NOT v_price_changed AND NOT v_recall_changed THEN
    RETURN NEW;
  END IF;

  v_uid := (SELECT auth.uid());
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF v_tenant IS NULL THEN
    IF OLD.created_by = v_uid THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'not authorized to change this listing' USING ERRCODE = '42501';
  END IF;

  IF v_price_changed AND NOT (
    public.has_pricing_authority(v_tenant, OLD.condition)
    AND public.has_pricing_authority(v_tenant, NEW.condition)
  ) THEN
    RAISE EXCEPTION 'not authorized to change vehicle pricing' USING ERRCODE = '42501';
  END IF;
  IF v_recall_changed AND NOT public.tenant_role_in(v_tenant, ARRAY['owner','admin','general_manager','gsm','manager','compliance','office','finance']) THEN
    RAISE EXCEPTION 'not authorized to override a recall' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.vehicle_listings_guard_priced_columns() IS
  'Column-level authority on vehicle_listings for API callers: price columns need has_pricing_authority for the listing condition (pricing roles, or a delegated used-car or inventory manager), recall override columns a role that holds can_manage_compliance. Service jobs, cron and owner-run RPCs are not API callers and pass through.';

-- ── Fee recalculation: accepted members only ────────────────────────────

-- The hosted recalc_tenant_doc_fee checks the role but not that the
-- membership was accepted, so an open invitation for a pricing role can run
-- it. Only the role check changes; the body is the hosted one.
CREATE OR REPLACE FUNCTION public.recalc_tenant_doc_fee(p_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fee   numeric;
  v_count integer;
BEGIN
  IF NOT (
    public.tenant_role_in(p_tenant_id, ARRAY['owner','admin','general_manager','gsm'])
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id;
  END IF;

  SELECT CASE
           WHEN (settings->>'doc_fee_enabled')::boolean
           THEN COALESCE((settings->>'doc_fee_amount')::numeric, 0)
           ELSE 0
         END
    INTO v_fee
  FROM public.dealer_profiles
  WHERE tenant_id = p_tenant_id;
  v_fee := COALESCE(v_fee, 0);

  UPDATE public.vehicle_listings
  SET doc_fee                = v_fee,
      website_sale_price     = advertised_price_before_doc + v_fee,
      price_parse_status     = 'ok',
      price_parse_notes      = 'Doc fee updated in admin; sale price = advertised + doc fee.',
      price_last_verified_at = now()
  WHERE tenant_id = p_tenant_id
    AND advertised_price_before_doc IS NOT NULL
    AND (doc_fee IS DISTINCT FROM v_fee
         OR website_sale_price IS DISTINCT FROM advertised_price_before_doc + v_fee);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
