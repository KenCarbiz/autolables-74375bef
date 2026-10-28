-- RooftopOS staging: the minimal real objects the spine migration depends on.
-- Apply ONCE as a single migration on a brand-new, EMPTY Supabase/Lovable Cloud
-- project, before 20261030000000_rooftopos_spine.sql. Idempotent: safe to re-run.
-- Paste-safe: plain SQL, no psql meta-commands, no extensions beyond Supabase's
-- defaults, no cron, no net.http.
--
-- Every definition below is copied verbatim from the AutoLabels migration named
-- above it. The only additions are idempotency guards (IF NOT EXISTS, DROP POLICY
-- IF EXISTS, a duplicate_object guard on CREATE TYPE). The final policy text was
-- checked against pg_policies after a full replay of the 522-file history
-- (supabase/tests/rooftopos_harness.sh) and matches it exactly.
--
-- Deliberately NOT included (the spine never touches them):
--   * public.vehicle_listings: the spine references no vehicle_listings column
--     (grep of 20261030000000_rooftopos_spine.sql), so no listing table is created.
--   * Later tenants columns (carfax_dealer_id, autocheck_dealer_id, autocurb_profile,
--     autocurb_synced_at) and the audit_log hash chain (prev_hash, row_hash and its
--     trigger): unused by the spine.
--   * tenant_members triggers enforce_seat_limit / prevent_tenant_member_self_escalation:
--     they need app_entitlements and the seat model, which staging does not have.

-- ── app_role + user_roles + has_role ─────────────────────────────────
-- Source: supabase/migrations/20260410142244_46331a7f-fbcf-4c67-8fd5-d3d0d492eeb6.sql
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- ── update_updated_at_column ─────────────────────────────────────────
-- Source: supabase/migrations/20260410142244_46331a7f-fbcf-4c67-8fd5-d3d0d492eeb6.sql
-- (later files re-issue the identical body).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ── tenants + tenant_members ─────────────────────────────────────────
-- Source: supabase/migrations/20260417030000_shared_tenant_entitlements.sql
CREATE TABLE IF NOT EXISTS public.tenants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  domain              TEXT,                       -- e.g. freemanford.com
  primary_email       TEXT,
  billing_email       TEXT,
  source              TEXT NOT NULL DEFAULT 'autolabels'
                        CHECK (source IN ('autocurb', 'autolabels', 'manual')),
  autocurb_tenant_id  TEXT,                       -- ID in the Autocurb system, if sourced there
  stripe_customer_id  TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_domain ON public.tenants (domain);
CREATE INDEX IF NOT EXISTS idx_tenants_autocurb ON public.tenants (autocurb_tenant_id);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tenant_members (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email       TEXT,                       -- populated before accept
  role                TEXT NOT NULL DEFAULT 'staff'
                        CHECK (role IN ('owner', 'admin', 'manager', 'staff')),
  accepted_at         TIMESTAMPTZ,
  invited_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by          UUID REFERENCES auth.users(id),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, invited_email)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON public.tenant_members (user_id);

ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

-- Source: supabase/migrations/20260518000000_rls_wrap_uid_wave13a.sql
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_tenant
  ON public.tenant_members (user_id, tenant_id);

-- Final role list. Source: supabase/migrations/20260908240000_repair_migration_drift.sql
ALTER TABLE public.tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN (
    'owner','admin','general_manager','gsm','sales_manager','salesperson',
    'used_car_manager','inventory_manager','service_manager','service_advisor',
    'office','detail','third_party_vendor','finance','compliance','biller',
    'readonly','manager','staff','sales','viewer'));

-- Source: supabase/migrations/20260417030000_shared_tenant_entitlements.sql
DROP TRIGGER IF EXISTS update_tenants_updated_at ON public.tenants;
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── is_tenant_manager (breaks the recursive tenant_members policy) ──
-- Source: supabase/migrations/20260615185331_f67eaff7-66f8-46e8-a29b-c9871198a0f7.sql
CREATE OR REPLACE FUNCTION public.is_tenant_manager(_tenant_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id
      AND tm.user_id = _user_id
      AND tm.role = ANY (ARRAY['owner'::text, 'admin'::text])
      AND tm.accepted_at IS NOT NULL
  );
$$;

-- Source: supabase/migrations/20260615185427_db247b47-507b-4171-b1d0-e93f5c4473b5.sql
REVOKE ALL ON FUNCTION public.is_tenant_manager(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_manager(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_manager(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_manager(uuid, uuid) TO service_role;

-- ── tenants policies (final) ─────────────────────────────────────────
-- Source: supabase/migrations/20260418023207_4c49d1c5-18d9-4f24-94cb-ae137ac2fcd3.sql
DROP POLICY IF EXISTS "Members see their tenant" ON public.tenants;
CREATE POLICY "Members see their tenant"
  ON public.tenants FOR SELECT TO authenticated
  USING (id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
  ));

DROP POLICY IF EXISTS "Owners can update their tenant" ON public.tenants;
CREATE POLICY "Owners can update their tenant"
  ON public.tenants FOR UPDATE TO authenticated
  USING (id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin') AND accepted_at IS NOT NULL
  ));

-- Source: supabase/migrations/20260614033948_328b7eab-3cc1-418c-af12-117f57511939.sql
DROP POLICY IF EXISTS "Authenticated users can create tenants" ON public.tenants;
CREATE POLICY "Authenticated users can create tenants"
  ON public.tenants FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- Source: supabase/migrations/20260418050000_platform_admin_rls.sql
DROP POLICY IF EXISTS "Admins read all tenants" ON public.tenants;
CREATE POLICY "Admins read all tenants"
  ON public.tenants FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update all tenants" ON public.tenants;
CREATE POLICY "Admins update all tenants"
  ON public.tenants FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete tenants" ON public.tenants;
CREATE POLICY "Admins delete tenants"
  ON public.tenants FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ── tenant_members policies (final) ──────────────────────────────────
-- Source: supabase/migrations/20260418050000_platform_admin_rls.sql
DROP POLICY IF EXISTS "Admins read all members" ON public.tenant_members;
CREATE POLICY "Admins read all members"
  ON public.tenant_members FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update all members" ON public.tenant_members;
CREATE POLICY "Admins update all members"
  ON public.tenant_members FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete members" ON public.tenant_members;
CREATE POLICY "Admins delete members"
  ON public.tenant_members FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins insert members" ON public.tenant_members;
CREATE POLICY "Admins insert members"
  ON public.tenant_members FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Source: supabase/migrations/20260615185331_f67eaff7-66f8-46e8-a29b-c9871198a0f7.sql
DROP POLICY IF EXISTS "Members see their own memberships" ON public.tenant_members;
CREATE POLICY "Members see their own memberships"
  ON public.tenant_members FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_tenant_manager(tenant_id, (SELECT auth.uid()))
  );

-- Source: supabase/migrations/20260615150641_b33c2cdf-c4c9-4b98-bc60-530cc3340829.sql
DROP POLICY IF EXISTS "Owners can invite members" ON public.tenant_members;
CREATE POLICY "Owners can invite members"
  ON public.tenant_members FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role = ANY (ARRAY['owner','admin'])
        AND tm.accepted_at IS NOT NULL
    )
  );

-- Source: supabase/migrations/20260723214154_fb51617d-21f2-485a-9887-3652bc25eb4a.sql
DROP POLICY IF EXISTS "Users can accept their own membership" ON public.tenant_members;

CREATE POLICY "Users can accept their own membership"
  ON public.tenant_members
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = (SELECT tm.role FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
    AND tenant_id = (SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
    AND user_id = (SELECT tm.user_id FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
  );

-- ── audit_log ────────────────────────────────────────────────────────
-- Source: supabase/migrations/20260417000000_platform_expansion.sql
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  store_id      TEXT,
  user_id       UUID REFERENCES auth.users(id),
  user_email    TEXT,
  ip_address    TEXT,
  user_agent    TEXT,
  content_hash  TEXT,                    -- SHA-256 of canonical payload at action time
  details       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_store ON public.audit_log (store_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log (created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Source: supabase/migrations/20260614032226_9c89f601-7461-4430-85e5-8d105046cc76.sql
DROP POLICY IF EXISTS "Audit log readable by admins, owner, or tenant members" ON public.audit_log;
CREATE POLICY "Audit log readable by admins, owner, or tenant members"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR user_id = (SELECT auth.uid())
    OR (
      store_id IS NOT NULL
      AND store_id IN (
        SELECT tm.tenant_id::text
          FROM public.tenant_members tm
         WHERE tm.user_id = (SELECT auth.uid())
           AND tm.accepted_at IS NOT NULL
      )
    )
  );

-- Source: supabase/migrations/20260619203001_f9e761c0-893d-433d-bfb6-513c8295675b.sql
DROP POLICY IF EXISTS "Auth users can insert audit events" ON public.audit_log;
CREATE POLICY "Auth users can insert audit events"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = (SELECT auth.uid()))
    AND (
      store_id IS NULL
      OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR store_id IN (
        SELECT tm.tenant_id::text
          FROM public.tenant_members tm
         WHERE tm.user_id = (SELECT auth.uid())
           AND tm.accepted_at IS NOT NULL
      )
    )
  );

-- Source: supabase/migrations/20260515191442_0d8a344e-d1a9-402c-b56b-acf1e5e36d81.sql
DROP POLICY IF EXISTS "Anon can insert shopper audit events" ON public.audit_log;
CREATE POLICY "Anon can insert shopper audit events"
  ON public.audit_log FOR INSERT TO anon
  WITH CHECK (
    user_id IS NULL
    AND action IN (
      'addendum_viewed',
      'addendum_consent_given',
      'addendum_signed',
      'listing_viewed',
      'vehicle_inquiry'
    )
  );

-- ── final grants ─────────────────────────────────────────────────────
-- Source: supabase/migrations/20260615185427_db247b47-507b-4171-b1d0-e93f5c4473b5.sql
REVOKE ALL ON public.audit_log FROM anon;
REVOKE ALL ON public.tenant_members FROM anon;

GRANT INSERT ON public.audit_log TO anon;

-- Source: supabase/migrations/20260615185331_f67eaff7-66f8-46e8-a29b-c9871198a0f7.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO authenticated;
GRANT INSERT ON public.audit_log TO anon;
GRANT ALL ON public.audit_log TO service_role;
GRANT SELECT ON public.tenant_members TO authenticated;
GRANT ALL ON public.tenant_members TO service_role;

-- ── wrap auth.uid() as (SELECT auth.uid()) in every policy above ────
-- Source: supabase/migrations/20260908230000_wrap_auth_uid_in_rls_policies.sql
-- (the transformation block, verbatim; it is idempotent and leaves already
-- wrapped policies untouched).
DO $$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_done int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname='public'
      AND (qual ~ 'auth\.(uid|jwt)\(\)' OR with_check ~ 'auth\.(uid|jwt)\(\)')
      AND NOT (coalesce(qual,'')||coalesce(with_check,'') ~ '\(\s*SELECT\s+auth\.(uid|jwt)\(\)')
  LOOP
    v_qual := regexp_replace(
                regexp_replace(r.qual, '\(\s*SELECT\s+auth\.(uid|jwt)\(\)\s*\)', 'auth.\1()', 'g'),
                'auth\.(uid|jwt)\(\)', '(SELECT auth.\1())', 'g');
    v_check := regexp_replace(
                regexp_replace(r.with_check, '\(\s*SELECT\s+auth\.(uid|jwt)\(\)\s*\)', 'auth.\1()', 'g'),
                'auth\.(uid|jwt)\(\)', '(SELECT auth.\1())', 'g');

    IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)',
                     r.policyname, r.tablename, v_qual, v_check);
    ELSIF r.qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',
                     r.policyname, r.tablename, v_qual);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)',
                     r.policyname, r.tablename, v_check);
    END IF;
    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE 'wrapped auth helper in % policies', v_done;
END $$;
