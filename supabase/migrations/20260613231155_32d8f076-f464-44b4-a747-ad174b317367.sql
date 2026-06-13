-- Wave 19 — email_recipients
-- Tenant-scoped distribution list for signed-addendum packet delivery.
-- Replaces the localStorage shim in useEmailDistribution so recipients
-- sync across devices and survive browser resets.

CREATE TABLE IF NOT EXISTS public.email_recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  store_id    TEXT,
  role        TEXT NOT NULL CHECK (role IN ('finance_manager','general_sales_manager','general_manager','office_manager','customer')),
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL CHECK (email LIKE '%@%'),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, role, email)
);

CREATE INDEX IF NOT EXISTS email_recipients_tenant_store_idx
  ON public.email_recipients (tenant_id, store_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_recipients TO authenticated;
GRANT ALL ON public.email_recipients TO service_role;

ALTER TABLE public.email_recipients ENABLE ROW LEVEL SECURITY;

-- Auto-stamp tenant_id from the caller's tenant on insert.
CREATE OR REPLACE FUNCTION public.set_tenant_id_email_recipients()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_tenant_id_email_recipients ON public.email_recipients;
CREATE TRIGGER trg_set_tenant_id_email_recipients
  BEFORE INSERT OR UPDATE ON public.email_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_email_recipients();

-- RLS: tenant members can manage their own recipients. Wrap auth.uid()
-- per the project's canonical pattern so the planner caches it.
DROP POLICY IF EXISTS "tenant members read email_recipients" ON public.email_recipients;
CREATE POLICY "tenant members read email_recipients"
  ON public.email_recipients FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "tenant members insert email_recipients" ON public.email_recipients;
CREATE POLICY "tenant members insert email_recipients"
  ON public.email_recipients FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "tenant members update email_recipients" ON public.email_recipients;
CREATE POLICY "tenant members update email_recipients"
  ON public.email_recipients FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "tenant members delete email_recipients" ON public.email_recipients;
CREATE POLICY "tenant members delete email_recipients"
  ON public.email_recipients FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

-- Cross-device sync via Wave 14.6 realtime bridge.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'email_recipients'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.email_recipients';
  END IF;
END$$;