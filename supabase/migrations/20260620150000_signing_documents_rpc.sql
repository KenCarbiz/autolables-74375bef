-- Public, token-keyed read of the generated documents a customer should see in
-- their signing packet. Resolves the signing token -> addendum -> vehicle and
-- returns ONLY customer-visible documents (approved / printed / published).
-- Mirrors get_install_proofs_public / get_published_documents_public: anon can't
-- read generated_documents directly (tenant RLS), so this SECURITY DEFINER
-- function exposes exactly the right rows for that one signing token.

CREATE OR REPLACE FUNCTION public.get_signing_documents(_token uuid)
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
  SELECT gd.id, gd.document_type, gd.template_id, gd.template_version, gd.version,
         gd.label_mode, gd.pdf_url, gd.png_url, gd.online_url,
         gd.created_at, gd.approved_at, gd.published_at
  FROM public.addendums a
  -- Normalize VIN (case/whitespace) so the right vehicle is never missed; the
  -- tenant_id equality keeps this strictly within the addendum's own tenant.
  JOIN public.vehicle_listings v
    ON upper(btrim(v.vin)) = upper(btrim(a.vehicle_vin))
   AND v.tenant_id = a.tenant_id
  JOIN public.generated_documents gd ON gd.vehicle_id = v.id
  WHERE a.signing_token = _token
    AND gd.document_status IN ('approved','printed','published')
  ORDER BY gd.document_type, gd.version DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_signing_documents(uuid) TO anon, authenticated;
