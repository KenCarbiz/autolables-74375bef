
DROP TABLE IF EXISTS public.autolabels_usage_events CASCADE;
CREATE TABLE IF NOT EXISTS public.autolabels_usage_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  metric_key  text NOT NULL,
  quantity    integer NOT NULL DEFAULT 1,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_events_tenant_metric
  ON public.autolabels_usage_events (tenant_id, metric_key, created_at DESC);
GRANT SELECT, INSERT ON public.autolabels_usage_events TO authenticated;
GRANT ALL ON public.autolabels_usage_events TO service_role;
ALTER TABLE public.autolabels_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read usage" ON public.autolabels_usage_events
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant insert usage" ON public.autolabels_usage_events
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

DROP TABLE IF EXISTS public.stale_document_flags CASCADE;
CREATE TABLE IF NOT EXISTS public.stale_document_flags (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id            uuid NOT NULL,
  generated_document_id uuid REFERENCES public.generated_documents(id) ON DELETE SET NULL,
  severity              text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','compliance_block')),
  reason                text NOT NULL,
  changed_field         text,
  old_value             jsonb,
  new_value             jsonb,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','ignored','superseded')),
  reviewed_by           uuid REFERENCES auth.users(id),
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stale_flags_tenant_status  ON public.stale_document_flags (tenant_id, status, created_at DESC);
CREATE INDEX idx_stale_flags_vehicle_status ON public.stale_document_flags (vehicle_id, status);
CREATE INDEX idx_stale_flags_generated_doc  ON public.stale_document_flags (generated_document_id);
CREATE INDEX idx_stale_flags_severity       ON public.stale_document_flags (severity);
GRANT SELECT, INSERT, UPDATE ON public.stale_document_flags TO authenticated;
GRANT ALL ON public.stale_document_flags TO service_role;
DROP TRIGGER IF EXISTS trg_stale_flags_updated ON public.stale_document_flags;
CREATE TRIGGER trg_stale_flags_updated
  BEFORE UPDATE ON public.stale_document_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.stale_document_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant select stale_document_flags" ON public.stale_document_flags
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant insert stale_document_flags" ON public.stale_document_flags
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant update stale_document_flags" ON public.stale_document_flags
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

DROP FUNCTION IF EXISTS public.get_signing_documents(uuid);
DROP FUNCTION IF EXISTS public.get_signing_documents(text);
CREATE OR REPLACE FUNCTION public.get_signing_documents(_token text)
RETURNS TABLE (
  id uuid,
  document_type text,
  template_id text,
  template_version integer,
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
  SELECT
    gd.id, gd.document_type, gd.template_id,
    NULL::integer AS template_version,
    gd.version, gd.label_mode, gd.pdf_url, gd.png_url, gd.online_url,
    gd.created_at, gd.approved_at, gd.published_at
  FROM public.addendums a
  JOIN public.vehicle_listings v
    ON v.tenant_id = a.tenant_id
   AND upper(btrim(v.vin)) = upper(btrim(a.vehicle_vin))
  JOIN public.generated_documents gd
    ON gd.tenant_id = a.tenant_id
   AND gd.vehicle_id = v.id
  WHERE a.signing_token = (_token)::uuid
    AND gd.document_status IN ('approved','printed','published')
  ORDER BY gd.document_type, gd.version DESC, gd.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_signing_documents(text) TO anon, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'log_qr_scan'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.log_qr_scan(
  _token    text,
  _device   text DEFAULT NULL,
  _browser  text DEFAULT NULL,
  _referrer text DEFAULT NULL,
  _ua       text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_qr public.qr_codes%ROWTYPE;
BEGIN
  PERFORM _device; PERFORM _browser;
  SELECT * INTO v_qr FROM public.qr_codes
   WHERE code = _token AND is_active = true LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.qr_scan_events (qr_code_id, code, tenant_id, vehicle_id, user_agent, referrer)
  VALUES (v_qr.id, v_qr.code, v_qr.tenant_id, v_qr.vehicle_id, _ua, _referrer);
  RETURN v_qr.target_url;
END $$;
GRANT EXECUTE ON FUNCTION public.log_qr_scan(text, text, text, text, text) TO anon, authenticated;
