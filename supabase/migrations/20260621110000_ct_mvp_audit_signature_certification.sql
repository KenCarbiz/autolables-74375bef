-- Connecticut MVP evidence persistence.
-- Stores lifecycle events, signature evidence, and certification run history so
-- the smoke-test/certification layer can graduate from in-memory validation to
-- durable compliance proof.

CREATE TABLE IF NOT EXISTS public.document_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vehicle_id uuid,
  vin text,
  stock text,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_name text,
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signature_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vehicle_id uuid,
  vin text,
  stock text,
  role text NOT NULL,
  signer_name text,
  signer_email text,
  signed_at timestamptz,
  ip_address text,
  user_agent text,
  device_label text,
  signature_image_url text,
  consent_text text,
  document_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ct_mvp_certification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vehicle_id uuid,
  vin text,
  stock text,
  vehicle_title text,
  ready boolean NOT NULL DEFAULT false,
  required_document_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  rule_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_audit jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'ct-mvp-certification',
  certified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_lifecycle_events_tenant_vehicle ON public.document_lifecycle_events (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_document_lifecycle_events_vin ON public.document_lifecycle_events (vin);
CREATE INDEX IF NOT EXISTS idx_document_lifecycle_events_event_type ON public.document_lifecycle_events (event_type);
CREATE INDEX IF NOT EXISTS idx_signature_evidence_tenant_vehicle ON public.signature_evidence (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_signature_evidence_vin ON public.signature_evidence (vin);
CREATE INDEX IF NOT EXISTS idx_signature_evidence_role ON public.signature_evidence (role);
CREATE INDEX IF NOT EXISTS idx_ct_mvp_certification_runs_tenant_vehicle ON public.ct_mvp_certification_runs (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ct_mvp_certification_runs_vin ON public.ct_mvp_certification_runs (vin);
CREATE INDEX IF NOT EXISTS idx_ct_mvp_certification_runs_ready ON public.ct_mvp_certification_runs (ready);

ALTER TABLE public.document_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ct_mvp_certification_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  IF to_regclass('public.tenant_members') IS NOT NULL THEN
    FOREACH table_name IN ARRAY ARRAY[
      'document_lifecycle_events',
      'signature_evidence',
      'ct_mvp_certification_runs'
    ] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "%1$s tenant members read" ON public.%1$I', table_name);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s tenant members write" ON public.%1$I', table_name);
      EXECUTE format(
        'CREATE POLICY "%1$s tenant members read" ON public.%1$I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = auth.uid()))',
        table_name
      );
      EXECUTE format(
        'CREATE POLICY "%1$s tenant members write" ON public.%1$I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = auth.uid()))',
        table_name
      );
    END LOOP;
  END IF;
END $$;
