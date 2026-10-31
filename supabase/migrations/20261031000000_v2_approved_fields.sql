-- ── V2 approved fields (owner sign-off 2026-10-31) ──────────────────────────
--
--   compliance_issue_owners            current owner per (tenant, issue key);
--                                      no row or a null owner is Unassigned
--   compliance_issue_owner_history     append-only record of every assignment
--   assign_compliance_issue_owner      the one writer: roles holding
--                                      can_manage_compliance, assignee must be
--                                      an accepted member holding
--                                      can_view_compliance
--   prep_sign_offs.due_at              optional due date; only roles holding
--                                      can_manage_work_queue may set or change
--                                      it. The settings default is the
--                                      dealer_profiles.settings key
--                                      prep_default_due_days, applied on read.
--   addendums.deal_number              the DMS deal number, entered or synced;
--                                      not unique, not even within a tenant
--   safety_inspection_item_failures.repair_approval
--                                      internal service-manager authorization,
--                                      not customer consent; independent of
--                                      repair_state and the inspection result
--   safety_inspection_repair_approval_history
--                                      append-only who/when of every change
--   set_repair_approval                convenience writer; runs as the caller
--                                      so the column guard decides
--   platform_vehicle_counts            active vehicles per dealership, platform
--                                      admins only, counts and nothing else
--
-- Role arrays mirror dealerRoleCapabilityMap in
-- src/lib/permissions/dealerRoleCapabilities.ts; a static test holds them
-- together. Helpers reused: public.tenant_role_in, public.has_role.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Compliance issue owner ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.compliance_issue_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  issue_key text NOT NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_issue_owners_tenant_issue_key UNIQUE (tenant_id, issue_key),
  CONSTRAINT compliance_issue_owners_issue_key_format CHECK (
    issue_key ~ '^(vehicle_listings|ct_mvp_certification_runs|vehicle_exceptions|stale_document_flags|advertised_prices|vehicle_documents|recall_service_tasks):[A-Za-z0-9_.:-]{1,200}$'
  )
);

CREATE TABLE IF NOT EXISTS public.compliance_issue_owner_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  issue_key text NOT NULL,
  previous_owner_user_id uuid,
  owner_user_id uuid,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_issue_owner_history_issue_idx
  ON public.compliance_issue_owner_history (tenant_id, issue_key, changed_at DESC);
CREATE INDEX IF NOT EXISTS compliance_issue_owners_owner_idx
  ON public.compliance_issue_owners (tenant_id, owner_user_id)
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE public.compliance_issue_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_issue_owner_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compliance issue owners tenant read" ON public.compliance_issue_owners;
CREATE POLICY "compliance issue owners tenant read"
  ON public.compliance_issue_owners FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "compliance issue owner history tenant read" ON public.compliance_issue_owner_history;
CREATE POLICY "compliance issue owner history tenant read"
  ON public.compliance_issue_owner_history FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.compliance_issue_owners FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.compliance_issue_owner_history FROM anon, authenticated;
REVOKE ALL ON public.compliance_issue_owners FROM anon;
REVOKE ALL ON public.compliance_issue_owner_history FROM anon;
GRANT SELECT ON public.compliance_issue_owners TO authenticated;
GRANT SELECT ON public.compliance_issue_owner_history TO authenticated;

-- Invoker rights on purpose: it is reached only from the definer RPC below and
-- from service jobs, and must not let a dealer probe another store's members.
CREATE OR REPLACE FUNCTION public.compliance_owner_eligible(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = p_user_id
      AND tm.accepted_at IS NOT NULL
      AND lower(trim(coalesce(tm.role, ''))) = ANY (ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','inventory_manager','service_manager','office','finance','compliance'])
  );
$function$;

REVOKE ALL ON FUNCTION public.compliance_owner_eligible(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compliance_owner_eligible(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.compliance_issue_owners_check_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.owner_user_id IS NOT NULL
     AND NOT public.compliance_owner_eligible(NEW.tenant_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'owner must be an accepted member of this dealership who can view compliance'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_compliance_issue_owners_check_member ON public.compliance_issue_owners;
CREATE TRIGGER trg_compliance_issue_owners_check_member
  BEFORE INSERT OR UPDATE OF owner_user_id, tenant_id ON public.compliance_issue_owners
  FOR EACH ROW
  EXECUTE FUNCTION public.compliance_issue_owners_check_member();

CREATE OR REPLACE FUNCTION public.assign_compliance_issue_owner(
  p_tenant_id uuid,
  p_issue_key text,
  p_owner_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_previous uuid;
  v_found boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.tenant_role_in(p_tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','compliance','office','finance'])
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to assign compliance owners' USING ERRCODE = '42501';
  END IF;
  IF p_issue_key IS NULL OR p_issue_key !~ '^(vehicle_listings|ct_mvp_certification_runs|vehicle_exceptions|stale_document_flags|advertised_prices|vehicle_documents|recall_service_tasks):[A-Za-z0-9_.:-]{1,200}$' THEN
    RAISE EXCEPTION 'invalid issue key' USING ERRCODE = '22023';
  END IF;
  IF p_owner_user_id IS NOT NULL AND NOT public.compliance_owner_eligible(p_tenant_id, p_owner_user_id) THEN
    RAISE EXCEPTION 'owner must be an accepted member of this dealership who can view compliance'
      USING ERRCODE = '23514';
  END IF;

  SELECT o.owner_user_id, true INTO v_previous, v_found
    FROM public.compliance_issue_owners o
   WHERE o.tenant_id = p_tenant_id AND o.issue_key = p_issue_key
   FOR UPDATE;

  IF coalesce(v_found, false) AND v_previous IS NOT DISTINCT FROM p_owner_user_id THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'issue_key', p_issue_key, 'owner_user_id', p_owner_user_id);
  END IF;
  IF NOT coalesce(v_found, false) AND p_owner_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'issue_key', p_issue_key, 'owner_user_id', NULL);
  END IF;

  INSERT INTO public.compliance_issue_owners AS o (tenant_id, issue_key, owner_user_id, assigned_by, assigned_at)
  VALUES (p_tenant_id, p_issue_key, p_owner_user_id, v_uid, now())
  ON CONFLICT (tenant_id, issue_key) DO UPDATE
    SET owner_user_id = EXCLUDED.owner_user_id,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = EXCLUDED.assigned_at;

  INSERT INTO public.compliance_issue_owner_history (tenant_id, issue_key, previous_owner_user_id, owner_user_id, changed_by)
  VALUES (p_tenant_id, p_issue_key, v_previous, p_owner_user_id, v_uid);

  RETURN jsonb_build_object('ok', true, 'changed', true, 'issue_key', p_issue_key,
                            'previous_owner_user_id', v_previous, 'owner_user_id', p_owner_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_compliance_issue_owner(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_compliance_issue_owner(uuid, text, uuid) TO authenticated;

-- ── 2. Prep due date ────────────────────────────────────────────────────────

ALTER TABLE public.prep_sign_offs
  ADD COLUMN IF NOT EXISTS due_at timestamptz;

CREATE INDEX IF NOT EXISTS prep_sign_offs_tenant_due_idx
  ON public.prep_sign_offs (tenant_id, due_at)
  WHERE due_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prep_sign_offs_guard_due_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.due_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.due_at IS NOT DISTINCT FROM OLD.due_at THEN
    RETURN NEW;
  END IF;

  v_uid := (SELECT auth.uid());
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS NULL THEN
    IF NEW.created_by = v_uid THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'not authorized to set the prep due date' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_role_in(NEW.tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','inventory_manager','service_manager']) THEN
    RAISE EXCEPTION 'not authorized to set the prep due date' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prep_sign_offs_guard_due_at ON public.prep_sign_offs;
CREATE TRIGGER trg_prep_sign_offs_guard_due_at
  BEFORE INSERT OR UPDATE OF due_at ON public.prep_sign_offs
  FOR EACH ROW
  EXECUTE FUNCTION public.prep_sign_offs_guard_due_at();

-- ── 3. DMS deal number ──────────────────────────────────────────────────────

ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS deal_number text
    CONSTRAINT addendums_deal_number_shape
    CHECK (deal_number IS NULL OR (deal_number = btrim(deal_number) AND length(deal_number) BETWEEN 1 AND 64));

CREATE INDEX IF NOT EXISTS addendums_tenant_deal_number_idx
  ON public.addendums (tenant_id, deal_number)
  WHERE deal_number IS NOT NULL;

-- ── 4. Repair approval ──────────────────────────────────────────────────────

ALTER TABLE public.safety_inspection_item_failures
  ADD COLUMN IF NOT EXISTS repair_approval text NOT NULL DEFAULT 'pending'
    CONSTRAINT item_failure_repair_approval_values
    CHECK (repair_approval IN ('pending','approved','not_approved')),
  ADD COLUMN IF NOT EXISTS repair_approval_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repair_approval_at timestamptz;

COMMENT ON COLUMN public.safety_inspection_item_failures.repair_approval IS
  'Internal service-manager authorization, not customer consent. Independent of repair_state and of the inspection result.';

CREATE TABLE IF NOT EXISTS public.safety_inspection_repair_approval_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  failure_id uuid NOT NULL,
  inspection_id uuid,
  previous_approval text,
  approval text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repair_approval_history_failure_idx
  ON public.safety_inspection_repair_approval_history (tenant_id, failure_id, changed_at DESC);

ALTER TABLE public.safety_inspection_repair_approval_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair approval history tenant read" ON public.safety_inspection_repair_approval_history;
CREATE POLICY "repair approval history tenant read"
  ON public.safety_inspection_repair_approval_history FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.safety_inspection_repair_approval_history FROM anon, authenticated;
REVOKE ALL ON public.safety_inspection_repair_approval_history FROM anon;
GRANT SELECT ON public.safety_inspection_repair_approval_history TO authenticated;

-- Runs as the caller so an API request can be told from a service job, the
-- same split vehicle_listings_guard_priced_columns uses.
CREATE OR REPLACE FUNCTION public.item_failures_guard_repair_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.repair_approval <> 'pending';
  ELSE
    v_changed := NEW.repair_approval IS DISTINCT FROM OLD.repair_approval;
  END IF;

  IF current_user = 'authenticated' THEN
    IF NOT v_changed THEN
      IF TG_OP = 'INSERT' THEN
        NEW.repair_approval_by := NULL;
        NEW.repair_approval_at := NULL;
      ELSE
        NEW.repair_approval_by := OLD.repair_approval_by;
        NEW.repair_approval_at := OLD.repair_approval_at;
      END IF;
      RETURN NEW;
    END IF;
    IF NOT (
      public.has_role(v_uid, 'admin'::public.app_role)
      OR public.tenant_role_in(NEW.tenant_id, ARRAY['owner','general_manager','gsm','admin','manager','sales_manager','used_car_manager','service_manager'])
    ) THEN
      RAISE EXCEPTION 'not authorized to change repair approval' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_changed THEN
    NEW.repair_approval_by := coalesce(v_uid, NEW.repair_approval_by);
    NEW.repair_approval_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_item_failures_guard_repair_approval ON public.safety_inspection_item_failures;
CREATE TRIGGER trg_item_failures_guard_repair_approval
  BEFORE INSERT OR UPDATE OF repair_approval, repair_approval_by, repair_approval_at
  ON public.safety_inspection_item_failures
  FOR EACH ROW
  EXECUTE FUNCTION public.item_failures_guard_repair_approval();

CREATE OR REPLACE FUNCTION public.item_failures_log_repair_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.repair_approval = 'pending' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.repair_approval IS NOT DISTINCT FROM OLD.repair_approval THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.safety_inspection_repair_approval_history
    (tenant_id, failure_id, inspection_id, previous_approval, approval, changed_by, changed_at)
  VALUES
    (NEW.tenant_id, NEW.id, NEW.inspection_id,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.repair_approval END,
     NEW.repair_approval, NEW.repair_approval_by, coalesce(NEW.repair_approval_at, now()));
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.item_failures_log_repair_approval() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_item_failures_log_repair_approval ON public.safety_inspection_item_failures;
CREATE TRIGGER trg_item_failures_log_repair_approval
  AFTER INSERT OR UPDATE OF repair_approval ON public.safety_inspection_item_failures
  FOR EACH ROW
  EXECUTE FUNCTION public.item_failures_log_repair_approval();

CREATE OR REPLACE FUNCTION public.set_repair_approval(p_failure_id uuid, p_decision text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.safety_inspection_item_failures%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('pending','approved','not_approved') THEN
    RAISE EXCEPTION 'invalid repair approval' USING ERRCODE = '22023';
  END IF;
  UPDATE public.safety_inspection_item_failures
     SET repair_approval = p_decision
   WHERE id = p_failure_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'failure not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'repair_approval', v_row.repair_approval,
                            'repair_approval_by', v_row.repair_approval_by, 'repair_approval_at', v_row.repair_approval_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_repair_approval(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_repair_approval(uuid, text) TO authenticated;

-- ── 5. Platform vehicle counts ──────────────────────────────────────────────

-- Active inventory as operating_metrics defines it: status other than
-- archived, never published_at. Counts only; no row of any dealership leaves.
CREATE OR REPLACE FUNCTION public.platform_vehicle_counts()
RETURNS TABLE (tenant_id uuid, active_vehicles bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'platform admin required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.id AS tenant_id, count(v.id)::bigint AS active_vehicles
      FROM public.tenants t
      LEFT JOIN public.vehicle_listings v
        ON v.tenant_id = t.id
       AND coalesce(v.status,'') <> 'archived'
     GROUP BY t.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_vehicle_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_vehicle_counts() TO authenticated;
