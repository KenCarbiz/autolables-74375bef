DROP POLICY IF EXISTS "Public can submit leads" ON public.leads;
CREATE POLICY "Public can submit leads"
  ON public.leads FOR INSERT
  TO anon
  WITH CHECK (
    tenant_id IS NOT NULL
    AND source = ANY (ARRAY['website'::text, 'qr_scan'::text, 'signing_link'::text])
    AND status = 'new'::text
    AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id)
  );

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pinned uuid;
  raw text;
BEGIN
  BEGIN
    raw := current_setting('app.current_tenant_id', true);
  EXCEPTION WHEN OTHERS THEN
    raw := NULL;
  END;
  IF raw IS NOT NULL AND raw <> '' THEN
    BEGIN
      pinned := raw::uuid;
    EXCEPTION WHEN OTHERS THEN
      pinned := NULL;
    END;
    IF pinned IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE user_id = auth.uid() AND tenant_id = pinned AND accepted_at IS NOT NULL
    ) THEN
      RETURN pinned;
    END IF;
  END IF;

  RETURN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    ORDER BY accepted_at DESC, tenant_id ASC
    LIMIT 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_current_tenant_id(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _tenant_id IS NULL THEN
    PERFORM set_config('app.current_tenant_id', '', true);
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = auth.uid() AND tenant_id = _tenant_id AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not a member of tenant %', _tenant_id USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.current_tenant_id', _tenant_id::text, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_current_tenant_id(uuid) TO authenticated;