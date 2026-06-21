-- Idempotent: column add + index + RPC refresh for template_version tracking.

ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS template_version integer;

CREATE INDEX IF NOT EXISTS idx_generated_documents_template_version
  ON public.generated_documents(template_id, template_version);

DROP FUNCTION IF EXISTS public.get_signing_documents(text);
DROP FUNCTION IF EXISTS public.get_signing_documents(uuid);

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
    gd.id,
    gd.document_type,
    gd.template_id,
    gd.template_version,
    gd.version,
    gd.label_mode,
    gd.pdf_url,
    gd.png_url,
    gd.online_url,
    gd.created_at,
    gd.approved_at,
    gd.published_at
  FROM public.addendums a
  JOIN public.vehicle_listings v
    ON upper(btrim(v.vin)) = upper(btrim(a.vehicle_vin))
   AND v.tenant_id = a.tenant_id
  JOIN public.generated_documents gd ON gd.vehicle_id = v.id
  WHERE a.signing_token::text = _token
    AND gd.document_status IN ('approved','printed','published')
  ORDER BY gd.document_type, gd.version DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_signing_documents(text) TO anon, authenticated;