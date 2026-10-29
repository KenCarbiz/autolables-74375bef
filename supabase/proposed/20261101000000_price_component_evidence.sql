-- PROPOSED, NOT APPLIED. Append-only evidence for every price component read
-- from a dealer page by the proposed price-stack reader
-- (supabase/proposed/crawl-fee-treatment/priceEvidence.ts).
--
-- A row is never updated or deleted: a later reading is a new row. The
-- record hash is the row's identity, so the same reading is stored once.
-- Tenant members read their own rows; only the service role writes.

CREATE TABLE IF NOT EXISTS public.price_component_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  vin               text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  captured_at       timestamptz NOT NULL,
  source_url        text NOT NULL,
  extractor_version text NOT NULL,
  page_sha256       text NOT NULL CHECK (page_sha256 ~ '^[0-9a-f]{64}$'),
  widget_sha256     text CHECK (widget_sha256 ~ '^[0-9a-f]{64}$'),
  screenshot_sha256 text CHECK (screenshot_sha256 ~ '^[0-9a-f]{64}$'),
  stack_status      text NOT NULL,
  component_role    text NOT NULL CHECK (component_role IN (
                      'msrp', 'discount', 'dealer_price', 'incentive', 'fee', 'final_price', 'unknown',
                      'disclaimer_widget', 'disclaimer_page', 'stack_summary')),
  label             text,
  amount            numeric(12, 2),
  printed_sign      smallint CHECK (printed_sign IN (-1, 0, 1)),
  line_index        integer,
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  record_sha256     text NOT NULL UNIQUE CHECK (record_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_component_evidence_vin_idx
  ON public.price_component_evidence (tenant_id, vin, captured_at DESC);

CREATE OR REPLACE FUNCTION public.price_component_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'price_component_evidence is append-only (% refused)', TG_OP USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS price_component_evidence_no_update ON public.price_component_evidence;
CREATE TRIGGER price_component_evidence_no_update
  BEFORE UPDATE OR DELETE ON public.price_component_evidence
  FOR EACH ROW EXECUTE FUNCTION public.price_component_evidence_immutable();

DROP TRIGGER IF EXISTS price_component_evidence_no_truncate ON public.price_component_evidence;
CREATE TRIGGER price_component_evidence_no_truncate
  BEFORE TRUNCATE ON public.price_component_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.price_component_evidence_immutable();

ALTER TABLE public.price_component_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.price_component_evidence FROM anon, authenticated;
GRANT SELECT ON public.price_component_evidence TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.price_component_evidence FROM service_role;
GRANT SELECT, INSERT ON public.price_component_evidence TO service_role;

DROP POLICY IF EXISTS "Tenant members read price evidence" ON public.price_component_evidence;
CREATE POLICY "Tenant members read price evidence"
  ON public.price_component_evidence FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
