-- ─────────────────────────────────────────────────────────────────────────
-- Get-Ready multi-signoff: many installers, one vehicle, one QR.
--
-- A vehicle is worked by several independent parties — the detail department
-- (detail + ceramic), an outside vendor (door edge guards), parts/service (a
-- wind deflector). Each needs its own signed record, and none should lock the
-- others out. The detail_signoffs table already allows many rows per VIN; this
-- migration removes the "first signer wins" model by:
--   • adding performer_role so each sign-off is attributed to an entity
--   • returning the full roster of sign-offs from get_vehicle_ready (the hub
--     lists who has signed and stays open for more)
--   • accepting _performer_role on submit_detail_signoff
-- No real logins: identity is a self-declared role + signature + photo + IP.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.detail_signoffs ADD COLUMN IF NOT EXISTS performer_role text;
ALTER TABLE public.detail_signoffs DROP CONSTRAINT IF EXISTS detail_signoffs_performer_role_check;
ALTER TABLE public.detail_signoffs ADD CONSTRAINT detail_signoffs_performer_role_check
  CHECK (performer_role IS NULL OR performer_role IN ('detail','service','parts','recon','outside'));

-- Backfill: existing rows were third-party or detail.
UPDATE public.detail_signoffs
   SET performer_role = CASE WHEN is_third_party THEN 'outside' ELSE 'detail' END
 WHERE performer_role IS NULL;

-- ── resolve hub token → vehicle + station status + FULL sign-off roster ──────
CREATE OR REPLACE FUNCTION public.get_vehicle_ready(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE;
  v_service_done boolean;
  v_detail_done boolean;
  v_products jsonb;
  v_signoffs jsonb;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  v_service_done := EXISTS (SELECT 1 FROM public.safety_inspections WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'signed');
  v_detail_done := EXISTS (SELECT 1 FROM public.detail_signoffs WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'signed');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'pre_install', true) ORDER BY sort_order), '[]'::jsonb)
    INTO v_products FROM public.products WHERE is_active = true AND available_preinstalled = true;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'role', coalesce(performer_role, CASE WHEN is_third_party THEN 'outside' ELSE 'detail' END),
           'performer_name', performer_name,
           'company', provider_company,
           'is_third_party', is_third_party,
           'detail_types', detail_types,
           'installs', installs,
           'photos', jsonb_array_length(coalesce(photos, '[]'::jsonb)),
           'signed_at', signed_at
         ) ORDER BY signed_at), '[]'::jsonb)
    INTO v_signoffs FROM public.detail_signoffs
   WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'signed';
  RETURN jsonb_build_object(
    'ok', true, 'tenant_id', r.tenant_id, 'vehicle_listing_id', r.vehicle_listing_id,
    'vin', r.vin, 'ymm', r.ymm,
    'service_done', v_service_done, 'detail_done', v_detail_done,
    'signoffs', v_signoffs,
    'preinstall_products', v_products
  );
END; $$;

-- ── submit a detail sign-off with the performer's role (anon, no consume) ────
DROP FUNCTION IF EXISTS public.submit_detail_signoff(text, jsonb, jsonb, boolean, text, text, text, text, jsonb, text, text, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.submit_detail_signoff(
  _token text, _detail_types jsonb, _installs jsonb, _is_third_party boolean,
  _provider_company text, _provider_contact text, _performer_name text,
  _signature_data text, _photos jsonb, _notes text, _content_hash text,
  _esign_consent jsonb, _ip text, _user_agent text, _performer_role text DEFAULT 'detail'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_id uuid; v_role text;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF coalesce(trim(_performer_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
  v_role := CASE WHEN _performer_role IN ('detail','service','parts','recon','outside')
                 THEN _performer_role
                 ELSE CASE WHEN _is_third_party THEN 'outside' ELSE 'detail' END END;
  INSERT INTO public.detail_signoffs
    (tenant_id, vehicle_listing_id, vin, ymm, detail_types, installs, is_third_party, provider_company,
     provider_contact, performer_name, performer_role, signature_data, signature_type, photos, notes, content_hash,
     esign_consent, customer_ip, user_agent, submitted_via, status, signed_at)
  VALUES (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, coalesce(_detail_types,'[]'::jsonb),
     coalesce(_installs,'[]'::jsonb), coalesce(_is_third_party,false), _provider_company, _provider_contact,
     _performer_name, v_role, _signature_data, 'type', coalesce(_photos,'[]'::jsonb), _notes, _content_hash,
     _esign_consent, _ip, _user_agent, 'qr', 'signed', now())
  RETURNING id INTO v_id;
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('detail_signed', 'vehicle', r.vin, r.tenant_id, jsonb_build_object('detail_id', v_id, 'role', v_role, 'third_party', _is_third_party));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_ready(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_detail_signoff(text, jsonb, jsonb, boolean, text, text, text, text, jsonb, text, text, jsonb, text, text, text) TO anon, authenticated;
