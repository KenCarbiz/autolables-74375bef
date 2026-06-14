-- ──────────────────────────────────────────────────────────────
-- Wave 19 — drain useEmailDistribution.getRecipients/saveRecipients
-- from localStorage to Supabase. Recipients were trapped on one
-- browser, so the finance manager / GSM / office manager
-- distribution list never followed the dealer across devices,
-- and the get-ready completion email had no shared list to
-- consult. This wave gives every tenant a real recipient table
-- scoped per store.
--
-- Roles match the existing client EmailRecipientRole union:
--   finance_manager · general_sales_manager · general_manager
--   office_manager  · customer
--
-- (customer is a placeholder slot — populated per-deal, not from
-- this table; included in the CHECK constraint so the same
-- shape is reusable elsewhere.)
-- ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.email_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL
                CHECK (role IN (
                  'finance_manager',
                  'general_sales_manager',
                  'general_manager',
                  'office_manager',
                  'customer'
                )),
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL,
  -- Which workflows to subscribe this recipient to. JSONB so we
  -- can add new email types (Wave 19 onward) without an ALTER.
  subscriptions JSONB NOT NULL DEFAULT '{"get_ready_complete": true, "signed_addendum": true}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_recipients_tenant_store
  ON public.email_recipients (tenant_id, store_id);

-- Soft uniqueness so a dealer can't accidentally duplicate the
-- same address under the same role within one store. Email is
-- compared case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_recipients_role_email
  ON public.email_recipients (tenant_id, store_id, role, LOWER(email));

ALTER TABLE public.email_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read email_recipients" ON public.email_recipients;
CREATE POLICY "Tenant members read email_recipients"
  ON public.email_recipients FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tenant members write email_recipients" ON public.email_recipients;
CREATE POLICY "Tenant members write email_recipients"
  ON public.email_recipients FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP TRIGGER IF EXISTS set_tenant_id_email_recipients ON public.email_recipients;
CREATE TRIGGER set_tenant_id_email_recipients
  BEFORE INSERT ON public.email_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

DROP TRIGGER IF EXISTS update_email_recipients_updated_at ON public.email_recipients;
CREATE TRIGGER update_email_recipients_updated_at
  BEFORE UPDATE ON public.email_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────────────────────────
-- Add the new table to the supabase_realtime publication so the
-- client useRealtimeInvalidate hook can subscribe and refresh
-- cross-device. Matches the Wave 14.6 pattern.
-- ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'email_recipients'
  ) THEN
    EXECUTE 'ALTER TABLE public.email_recipients REPLICA IDENTITY FULL';
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'email_recipients'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.email_recipients';
    END IF;
  END IF;
END $$;
