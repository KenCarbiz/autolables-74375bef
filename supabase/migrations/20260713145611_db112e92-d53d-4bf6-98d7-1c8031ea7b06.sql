
CREATE TABLE IF NOT EXISTS public.source_authority_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  field_key TEXT NOT NULL,
  primary_source TEXT NOT NULL,
  secondary_source TEXT,
  conflict_behavior TEXT NOT NULL DEFAULT 'warn'
    CHECK (conflict_behavior IN ('warn','block_generation','ignore')),
  override_expires_days INTEGER,
  auto_replace_override BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_source_authority_rules_tenant
  ON public.source_authority_rules (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_authority_rules TO authenticated;
GRANT ALL ON public.source_authority_rules TO service_role;

ALTER TABLE public.source_authority_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read source authority"
  ON public.source_authority_rules FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE POLICY "Tenant members insert source authority"
  ON public.source_authority_rules FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE POLICY "Tenant members update source authority"
  ON public.source_authority_rules FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
    OR public.has_role((SELECT auth.uid()), 'admin')
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE POLICY "Tenant members delete source authority"
  ON public.source_authority_rules FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE OR REPLACE FUNCTION public.source_authority_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_source_authority_touch ON public.source_authority_rules;
CREATE TRIGGER trg_source_authority_touch
  BEFORE UPDATE ON public.source_authority_rules
  FOR EACH ROW EXECUTE FUNCTION public.source_authority_touch();
