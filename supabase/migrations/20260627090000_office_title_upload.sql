-- ──────────────────────────────────────────────────────────────────────
-- Office title / MCO upload. A per-vehicle token (emailed to the office as a
-- QR + link) opens a no-login landing page that uploads the Title (used) or
-- Manufacturer's Certificate of Origin (new), front + back, into the PRIVATE
-- vehicle-docs bucket. Title/MCO are PII — stored private, internal-only,
-- never on the customer packet.
-- ──────────────────────────────────────────────────────────────────────

-- Mint (or reuse) a long-lived per-vehicle title-upload token. Authenticated
-- (the vehicle file / email sender calls it). Idempotent per vehicle.
CREATE OR REPLACE FUNCTION public.issue_title_upload_token(_tenant_id uuid, _vin text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin   text := upper(btrim(_vin));
  v_tok   text;
  v_list  uuid;
  v_ymm   text;
  v_stock text;
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant_id AND user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
  ) THEN
    RAISE EXCEPTION 'not authorized for tenant %', _tenant_id;
  END IF;

  SELECT token INTO v_tok FROM public.dept_signoff_tokens
   WHERE tenant_id = _tenant_id AND vin = v_vin AND purpose = 'title_upload' AND status = 'pending' AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_tok IS NOT NULL THEN RETURN v_tok; END IF;

  SELECT id, ymm INTO v_list, v_ymm FROM public.vehicle_listings WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;
  SELECT stock_number INTO v_stock FROM public.vehicle_files WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;
  v_tok := encode(gen_random_bytes(16), 'hex');

  INSERT INTO public.dept_signoff_tokens (tenant_id, vehicle_listing_id, vin, ymm, stock_number, department, purpose, token, expires_at)
  VALUES (_tenant_id, v_list, v_vin, v_ymm, v_stock, 'vehicle', 'title_upload', v_tok, now() + interval '365 days');
  RETURN v_tok;
END;
$$;

-- Attach an uploaded title/MCO file (already in private storage) to the vehicle.
-- Token-gated (anon, from the landing page). Stores the storage PATH; the dealer
-- side signs it on read. Idempotent-ish: replaces a prior file of the same type.
CREATE OR REPLACE FUNCTION public.attach_title_document(
  _token text, _doc_type text, _path text, _filename text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE;
BEGIN
  IF _doc_type NOT IN ('title_front','title_back','mco_front','mco_back') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_doc_type');
  END IF;
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;

  DELETE FROM public.vehicle_documents
   WHERE tenant_id = r.tenant_id AND vin = r.vin AND doc_type = _doc_type;
  INSERT INTO public.vehicle_documents (tenant_id, vehicle_listing_id, vin, doc_type, url, filename, customer_facing, uploaded_via)
  VALUES (r.tenant_id, r.vehicle_listing_id, r.vin, _doc_type, _path, _filename, false, 'qr');

  RETURN jsonb_build_object('ok', true, 'doc_type', _doc_type);
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_title_upload_token(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_title_document(text, text, text, text) TO anon, authenticated;
