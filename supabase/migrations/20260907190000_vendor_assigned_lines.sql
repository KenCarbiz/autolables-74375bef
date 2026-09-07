-- Vendor task read, scoped server-side.
--
-- VendorHome previously read up to 500 get_ready_records for the whole tenant
-- and matched the vendor's email in the browser. Only their own lines rendered,
-- but their client still received every VIN, stock number, delivery target and
-- work item in the shop, including other vendors' assignments. A third party
-- must not be sent the lot to be shown one line of it.
--
-- This returns only the lines addressed to the calling vendor. SECURITY DEFINER
-- so the filter cannot be bypassed by querying the table directly, with the
-- membership check done here rather than inherited.

CREATE OR REPLACE FUNCTION public.vendor_assigned_lines(p_tenant_id uuid)
RETURNS TABLE (
  record_id uuid,
  vin text,
  ymm text,
  stock_number text,
  delivery_target timestamptz,
  item jsonb,
  accessory jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  -- The caller's own verified address, from the JWT. Never a parameter: a
  -- vendor asking for another vendor's email would otherwise read their work.
  SELECT lower(trim(coalesce(auth.jwt() ->> 'email', ''))) INTO v_email;
  IF v_email = '' THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = (SELECT auth.uid())
      AND m.accepted_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT g.id,
         g.vin,
         g.ymm,
         g.stock_number,
         g.delivery_target,
         x.item,
         (
           SELECT a
           FROM jsonb_array_elements(coalesce(g.accessories_to_install, '[]'::jsonb)) a
           WHERE x.item ->> 'label' = 'Install: ' || (a ->> 'productName')
           LIMIT 1
         )
  FROM public.get_ready_records g
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(g.items, '[]'::jsonb)) AS x(item)
  WHERE g.tenant_id = p_tenant_id
    AND lower(trim(coalesce(x.item ->> 'vendorEmail', ''))) = v_email;
END $$;

REVOKE ALL ON FUNCTION public.vendor_assigned_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_assigned_lines(uuid) TO authenticated;

COMMENT ON FUNCTION public.vendor_assigned_lines(uuid) IS
  'Get Ready lines addressed to the calling vendor. Email comes from the JWT, never a parameter, so one vendor cannot read another''s work.';
