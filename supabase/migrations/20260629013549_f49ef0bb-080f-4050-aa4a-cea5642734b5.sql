-- ─────────────────────────────────────────────────────────────────────────
-- PDI (pre-delivery inspection) station on the Get-Ready QR.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pdi_signoffs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  vehicle_listing_id uuid,
  vin                text NOT NULL,
  ymm                text,
  checklist          jsonb NOT NULL DEFAULT '[]'::jsonb,
  result             text CHECK (result IN ('pass','fail')),
  notes              text,
  performer_name     text,
  performer_role     text,
  signature_data     text,
  content_hash       text,
  esign_consent      jsonb,
  customer_ip        text,
  user_agent         text,
  status             text NOT NULL DEFAULT 'signed',
  signed_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pdi_signoffs_tenant_vin ON public.pdi_signoffs (tenant_id, vin);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdi_signoffs TO authenticated;
GRANT ALL ON public.pdi_signoffs TO service_role;

ALTER TABLE public.pdi_signoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pdi readable by tenant" ON public.pdi_signoffs;
CREATE POLICY "pdi readable by tenant" ON public.pdi_signoffs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.get_pdi_for_token(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; p public.pdi_signoffs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  SELECT * INTO p FROM public.pdi_signoffs WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'signed'
    ORDER BY signed_at DESC LIMIT 1;
  RETURN jsonb_build_object('ok', true, 'done', p.id IS NOT NULL,
    'performer_name', p.performer_name, 'signed_at', p.signed_at);
END; $$;

CREATE OR REPLACE FUNCTION public.submit_pdi_signoff(
  _token text, _checklist jsonb, _result text, _notes text, _performer_name text,
  _performer_role text, _signature_data text, _content_hash text, _esign_consent jsonb,
  _ip text, _user_agent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_id uuid; v_role text;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF coalesce(btrim(_performer_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
  v_role := CASE WHEN _performer_role IN ('technician','service_writer') THEN _performer_role ELSE 'technician' END;

  INSERT INTO public.pdi_signoffs
    (tenant_id, vehicle_listing_id, vin, ymm, checklist, result, notes, performer_name, performer_role,
     signature_data, content_hash, esign_consent, customer_ip, user_agent, status, signed_at)
  VALUES (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, coalesce(_checklist, '[]'::jsonb),
     CASE WHEN _result = 'fail' THEN 'fail' ELSE 'pass' END, nullif(btrim(coalesce(_notes,'')),''),
     btrim(_performer_name), v_role, _signature_data, _content_hash, _esign_consent, _ip, _user_agent, 'signed', now())
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('pdi_signed', 'vehicle', r.vin, r.tenant_id, jsonb_build_object('pdi_id', v_id, 'role', v_role, 'result', _result));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;

REVOKE EXECUTE ON FUNCTION public.get_pdi_for_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_pdi_signoff(text, jsonb, text, text, text, text, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pdi_for_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_pdi_signoff(text, jsonb, text, text, text, text, text, text, jsonb, text, text) TO anon, authenticated;