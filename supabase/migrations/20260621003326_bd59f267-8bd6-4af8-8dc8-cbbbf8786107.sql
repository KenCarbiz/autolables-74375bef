
CREATE TABLE IF NOT EXISTS public.autolabels_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  feature_key text NOT NULL,
  metric_key text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_metric
  ON public.autolabels_usage_events (tenant_id, metric_key, created_at DESC);
GRANT SELECT, INSERT ON public.autolabels_usage_events TO authenticated;
GRANT ALL ON public.autolabels_usage_events TO service_role;
ALTER TABLE public.autolabels_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant read usage" ON public.autolabels_usage_events;
DROP POLICY IF EXISTS "tenant insert usage" ON public.autolabels_usage_events;
CREATE POLICY "tenant read usage" ON public.autolabels_usage_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant insert usage" ON public.autolabels_usage_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE TABLE IF NOT EXISTS public.stale_document_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  generated_document_id uuid REFERENCES public.generated_documents(id) ON DELETE CASCADE,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','compliance_block')),
  reason text NOT NULL,
  changed_field text,
  old_value jsonb,
  new_value jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','ignored','superseded')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stale_flags_tenant_open
  ON public.stale_document_flags (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stale_flags_vehicle ON public.stale_document_flags (vehicle_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stale_flag_open
  ON public.stale_document_flags (generated_document_id, changed_field) WHERE status = 'open';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stale_document_flags TO authenticated;
GRANT ALL ON public.stale_document_flags TO service_role;
DROP TRIGGER IF EXISTS trg_stale_flags_updated ON public.stale_document_flags;
CREATE TRIGGER trg_stale_flags_updated BEFORE UPDATE ON public.stale_document_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.stale_document_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant stale_document_flags" ON public.stale_document_flags;
CREATE POLICY "tenant stale_document_flags" ON public.stale_document_flags FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.get_signing_documents(_token uuid)
RETURNS TABLE (
  id uuid,
  document_type text,
  template_id text,
  version integer,
  label_mode text,
  pdf_url text,
  png_url text,
  online_url text,
  created_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gd.id, gd.document_type, gd.template_id, gd.version,
         gd.label_mode, gd.pdf_url, gd.png_url, gd.online_url,
         gd.created_at, gd.approved_at, gd.published_at
  FROM public.addendums a
  JOIN public.vehicle_listings v
    ON upper(btrim(v.vin)) = upper(btrim(a.vehicle_vin))
   AND v.tenant_id = a.tenant_id
  JOIN public.generated_documents gd ON gd.vehicle_id = v.id
  WHERE a.signing_token = _token
    AND gd.document_status IN ('approved','printed','published')
  ORDER BY gd.document_type, gd.version DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_signing_documents(uuid) TO anon, authenticated;
