-- Public, slug-keyed read of a vehicle's PUBLISHED generated documents for the
-- Vehicle Passport (/v/:slug). Mirrors get_install_proofs_public: anon can't
-- read generated_documents directly (tenant RLS), so this SECURITY DEFINER
-- function exposes ONLY published rows for the vehicle behind that slug. Draft /
-- pending / approved / printed / superseded / archived / rejected stay private.

CREATE OR REPLACE FUNCTION public.get_published_documents_public(_slug text)
RETURNS TABLE (
  id uuid,
  document_type text,
  version integer,
  label_mode text,
  pdf_url text,
  png_url text,
  online_url text,
  published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gd.id, gd.document_type, gd.version, gd.label_mode,
         gd.pdf_url, gd.png_url, gd.online_url, gd.published_at
  FROM public.generated_documents gd
  JOIN public.vehicle_listings v ON v.id = gd.vehicle_id
  WHERE v.slug = _slug
    AND gd.document_status = 'published'
  ORDER BY gd.document_type, gd.version DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_published_documents_public(text) TO anon, authenticated;
