-- ─────────────────────────────────────────────────────────────────────────
-- Get-Ready hub: one permanent QR per vehicle → station sign-offs
--
-- One token per vehicle (department='vehicle', purpose='get_ready', long-lived,
-- never consumed). Anyone scans the same QR, picks their station, signs. Each
-- station is "done" when a signed record exists for the VIN — the token itself
-- stays live so the one windshield sticker serves the whole get-ready cycle.
--
--   • detail_signoffs            — detail checklist + protection installs
--                                  (pre-install items carry a photo) + optional
--                                  third-party provider (company/contact)
--   • issue_vehicle_ready_token  — mint/reuse the per-vehicle hub token (member)
--   • get_vehicle_ready          — anon: resolve token → vehicle + station status
--                                  + the dealer's pre-install products
--   • submit_detail_signoff      — anon: write a detail sign-off (no consume)
--   • submit_safety_inspection   — amended: accept the 'vehicle' hub token and
--                                  only consume legacy single-use 'service' tokens
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.detail_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  vin text NOT NULL,
  ymm text,
  detail_types jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{key,label}]
  installs jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{product_id,label,pre_install,photo_url}]
  is_third_party boolean NOT NULL DEFAULT false,
  provider_company text,
  provider_contact text,
  performer_name text,
  signature_data text,
  signature_type text DEFAULT 'type' CHECK (signature_type IN ('draw','type')),
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  content_hash text,
  esign_consent jsonb,
  customer_ip text,
  user_agent text,
  submitted_via text NOT NULL DEFAULT 'qr' CHECK (submitted_via IN ('qr','app')),
  status text NOT NULL DEFAULT 'signed' CHECK (status IN ('pending','signed','voided')),
  signed_at timestamptz DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS detail_signoffs_tenant_vin_idx ON public.detail_signoffs (tenant_id, vin);
ALTER TABLE public.detail_signoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read detail signoffs" ON public.detail_signoffs;
DROP POLICY IF EXISTS "Members write detail signoffs" ON public.detail_signoffs;
CREATE POLICY "Members read detail signoffs" ON public.detail_signoffs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
CREATE POLICY "Members write detail signoffs" ON public.detail_signoffs FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- Allow the hub token department.
ALTER TABLE public.dept_signoff_tokens DROP CONSTRAINT IF EXISTS dept_signoff_tokens_department_check;
ALTER TABLE public.dept_signoff_tokens ADD CONSTRAINT dept_signoff_tokens_department_check
  CHECK (department IN ('service','detail','vehicle'));

-- ── issue/reuse the per-vehicle hub token ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_vehicle_ready_token(p_tenant_id uuid, p_vin text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_vin text := upper(trim(p_vin));
  v_token text;
  v_listing public.vehicle_listings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT public.has_role(v_uid, 'admin') AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members WHERE user_id = v_uid AND tenant_id = p_tenant_id AND accepted_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'not a member of this tenant'; END IF;
  SELECT token INTO v_token FROM public.dept_signoff_tokens
   WHERE tenant_id = p_tenant_id AND vin = v_vin AND department = 'vehicle' AND status = 'pending' AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;
  SELECT * INTO v_listing FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.dept_signoff_tokens (tenant_id, vehicle_listing_id, vin, ymm, department, purpose, token, expires_at, created_by)
  VALUES (p_tenant_id, v_listing.id, v_vin, v_listing.ymm, 'vehicle', 'get_ready', v_token, now() + interval '1 year', v_uid);
  RETURN v_token;
END; $$;

-- ── resolve the hub token → vehicle + station status + pre-install products ──
CREATE OR REPLACE FUNCTION public.get_vehicle_ready(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE;
  v_service_done boolean;
  v_detail_done boolean;
  v_products jsonb;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  v_service_done := EXISTS (SELECT 1 FROM public.safety_inspections WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'signed');
  v_detail_done := EXISTS (SELECT 1 FROM public.detail_signoffs WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'signed');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'pre_install', true) ORDER BY sort_order), '[]'::jsonb)
    INTO v_products FROM public.products WHERE is_active = true AND available_preinstalled = true;
  RETURN jsonb_build_object(
    'ok', true, 'tenant_id', r.tenant_id, 'vehicle_listing_id', r.vehicle_listing_id,
    'vin', r.vin, 'ymm', r.ymm,
    'service_done', v_service_done, 'detail_done', v_detail_done,
    'preinstall_products', v_products
  );
END; $$;

-- ── submit a detail sign-off (anon, hub token, no consume) ──────────────────
CREATE OR REPLACE FUNCTION public.submit_detail_signoff(
  _token text, _detail_types jsonb, _installs jsonb, _is_third_party boolean,
  _provider_company text, _provider_contact text, _performer_name text,
  _signature_data text, _photos jsonb, _notes text, _content_hash text,
  _esign_consent jsonb, _ip text, _user_agent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF coalesce(trim(_performer_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
  INSERT INTO public.detail_signoffs
    (tenant_id, vehicle_listing_id, vin, ymm, detail_types, installs, is_third_party, provider_company,
     provider_contact, performer_name, signature_data, signature_type, photos, notes, content_hash,
     esign_consent, customer_ip, user_agent, submitted_via, status, signed_at)
  VALUES (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, coalesce(_detail_types,'[]'::jsonb),
     coalesce(_installs,'[]'::jsonb), coalesce(_is_third_party,false), _provider_company, _provider_contact,
     _performer_name, _signature_data, 'type', coalesce(_photos,'[]'::jsonb), _notes, _content_hash,
     _esign_consent, _ip, _user_agent, 'qr', 'signed', now())
  RETURNING id INTO v_id;
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('detail_signed', 'vehicle', r.vin, r.tenant_id, jsonb_build_object('detail_id', v_id, 'third_party', _is_third_party));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;

-- ── amend safety-inspection submit to accept the hub token (no consume) ──────
CREATE OR REPLACE FUNCTION public.submit_safety_inspection(
  _token text, _checklist jsonb, _result text, _failure_notes text, _notes text, _documents jsonb,
  _inspector_name text, _signature_data text, _content_hash text, _esign_consent jsonb, _ip text, _user_agent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'used_or_revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF r.department NOT IN ('service','vehicle') THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_department'); END IF;
  IF coalesce(trim(_inspector_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'inspector_name_required'); END IF;
  INSERT INTO public.safety_inspections
    (tenant_id, vehicle_listing_id, vin, ymm, form_type, checklist, result, failure_notes, notes,
     documents, inspector_name, inspector_role, signature_data, signature_type, content_hash,
     esign_consent, customer_ip, user_agent, submitted_via, status, signed_at)
  VALUES (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, 'CT-K208',
     coalesce(_checklist, '[]'::jsonb), _result, _failure_notes, _notes,
     coalesce(_documents, '[]'::jsonb), _inspector_name, 'service', _signature_data, 'type',
     _content_hash, _esign_consent, _ip, _user_agent, 'qr', 'signed', now())
  RETURNING id INTO v_id;
  -- Only the legacy single-use 'service' token is consumed; the hub token lives on.
  IF r.department = 'service' THEN
    UPDATE public.dept_signoff_tokens SET status = 'used', used_at = now(), updated_at = now() WHERE id = r.id;
  END IF;
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('safety_inspection_signed', 'vehicle', r.vin, r.tenant_id,
            jsonb_build_object('inspection_id', v_id, 'department', r.department, 'result', _result));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.issue_vehicle_ready_token(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_ready(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_detail_signoff(text, jsonb, jsonb, boolean, text, text, text, text, jsonb, text, text, jsonb, text, text) TO anon, authenticated;
