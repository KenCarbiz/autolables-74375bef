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

-- Vendor write, scoped the same way.
--
-- The read path above was not enough on its own: the page still wrote by
-- pulling the whole items array into the vendor's browser, mutating it in JS
-- and writing it back. That leaked every other vendor's assignment and every
-- internal line on the car, lost any concurrent edit made between the read and
-- the write, and let a third party stamp the dealership's own completion.
--
-- RLS does not contain this. get_ready_records grants FOR ALL to any
-- tenant_members row, and a vendor IS a tenant member, so a client-supplied
-- record id could reach any record in the tenant. The check therefore lives
-- here, keyed to the caller's own line.
CREATE OR REPLACE FUNCTION public.vendor_update_assigned_line(
  p_record_id uuid,
  p_item_id text,
  p_patch jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_items jsonb;
  v_new jsonb;
BEGIN
  SELECT lower(trim(coalesce(auth.jwt() ->> 'email', ''))) INTO v_email;
  IF v_email = '' THEN RAISE EXCEPTION 'no caller identity'; END IF;

  -- FOR UPDATE: the read-modify-write of a JSONB array is only safe under a
  -- row lock. Without it two vendors finishing at once silently drop one edit.
  SELECT items INTO v_items FROM public.get_ready_records
   WHERE id = p_record_id FOR UPDATE;
  IF v_items IS NULL THEN RAISE EXCEPTION 'assignment not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) x
     WHERE x ->> 'id' = p_item_id
       AND lower(trim(coalesce(x ->> 'vendorEmail', ''))) = v_email
  ) THEN
    RAISE EXCEPTION 'not your assignment';
  END IF;

  -- The patch touches the caller's element only; every other line is copied
  -- through untouched, so a vendor cannot edit work that is not theirs.
  SELECT jsonb_agg(
           CASE WHEN x ->> 'id' = p_item_id THEN x || p_patch ELSE x END
         )
    INTO v_new
    FROM jsonb_array_elements(v_items) x;

  -- status rolls up because "every line is complete" is an observable fact.
  -- get_ready_complete_date deliberately does NOT: that is the dealership
  -- declaring the vehicle done, and a third party does not get to declare it.
  UPDATE public.get_ready_records
     SET items = v_new,
         status = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_new) y
              WHERE y ->> 'status' IS DISTINCT FROM 'complete')
           THEN 'ready' ELSE 'in_progress' END
   WHERE id = p_record_id;
END $$;

REVOKE ALL ON FUNCTION public.vendor_update_assigned_line(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_update_assigned_line(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.vendor_update_assigned_line(uuid, text, jsonb) IS
  'Applies a patch to the calling vendor''s own Get Ready line. Identity comes from the JWT and ownership is checked per line, so a vendor cannot read or write another vendor''s work, or the dealership''s completion date.';
