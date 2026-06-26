-- ─────────────────────────────────────────────────────────────────────────
-- Service department safety-inspection (CT K-208) sign-off + dealer documents
--
-- Adds the backbone for the service/detail "Ready Board" sign-off flow:
--   • safety_inspections   — the persisted K-208 record (checklist + signature)
--   • dept_signoff_tokens  — single-use, expiring QR tokens per vehicle+dept
--   • vehicle_documents    — dealer-facing docs (title/MCO front+back), never
--                            shown on the public Passport
--   • 'service' / 'detail' tenant roles so staff can be given desktop logins
--
-- The K-208 can be signed TWO ways, both writing safety_inspections:
--   1. No-login QR  → anon calls submit_safety_inspection(token, ...) — the same
--      SECURITY DEFINER token pattern proven by record_customer_signing.
--   2. Desktop login (role 'service') → normal in-app insert under RLS.
-- This migration is purely additive — it does not touch the publish gate yet.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Widen tenant roles so service/detail staff can be invited with a login.
ALTER TABLE public.tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN ('owner','admin','manager','staff','sales','finance','viewer','service','detail'));

-- ── safety_inspections ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  vin text NOT NULL,
  stock_number text,
  ymm text,
  form_type text NOT NULL DEFAULT 'CT-K208',
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,          -- [{key,label,result:'pass'|'fail'|'na'}]
  result text CHECK (result IN ('pass','fail','conditional')),
  failure_notes text,
  notes text,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,          -- [{url,caption,category}] inspection sheets/photos
  inspector_name text,                                    -- typed name (who did it)
  inspector_role text DEFAULT 'service',
  signature_data text,                                    -- base64 PNG or typed name
  signature_type text DEFAULT 'type' CHECK (signature_type IN ('draw','type')),
  content_hash text,
  esign_consent jsonb,
  customer_ip text,
  user_agent text,
  submitted_via text NOT NULL DEFAULT 'qr' CHECK (submitted_via IN ('qr','app')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','voided')),
  signed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_inspections_tenant_vin_idx ON public.safety_inspections (tenant_id, vin);
CREATE INDEX IF NOT EXISTS safety_inspections_listing_idx ON public.safety_inspections (vehicle_listing_id);

ALTER TABLE public.safety_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read safety inspections" ON public.safety_inspections;
DROP POLICY IF EXISTS "Members write safety inspections" ON public.safety_inspections;
DROP POLICY IF EXISTS "Members update safety inspections" ON public.safety_inspections;
CREATE POLICY "Members read safety inspections"
  ON public.safety_inspections FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));

-- Desktop sign-off path: logged-in tenant members (service role included) write directly.
CREATE POLICY "Members write safety inspections"
  ON public.safety_inspections FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));

CREATE POLICY "Members update safety inspections"
  ON public.safety_inspections FOR UPDATE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));

-- ── dept_signoff_tokens (single-use QR) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dept_signoff_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin text NOT NULL,
  ymm text,
  stock_number text,
  department text NOT NULL CHECK (department IN ('service','detail')),
  purpose text NOT NULL DEFAULT 'safety_inspection',
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','used','expired','revoked')),
  used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '21 days'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dept_signoff_tokens_lookup_idx ON public.dept_signoff_tokens (tenant_id, vin, department, status);

ALTER TABLE public.dept_signoff_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage dept tokens" ON public.dept_signoff_tokens;
CREATE POLICY "Members manage dept tokens"
  ON public.dept_signoff_tokens FOR ALL TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));

-- ── vehicle_documents (dealer-facing: title / MCO front+back) ───────────────
CREATE TABLE IF NOT EXISTS public.vehicle_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin text NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('title_front','title_back','mco_front','mco_back','other')),
  url text NOT NULL,
  filename text,
  caption text,
  customer_facing boolean NOT NULL DEFAULT false,   -- title/MCO are dealer-only
  uploaded_by uuid,
  uploaded_via text NOT NULL DEFAULT 'app' CHECK (uploaded_via IN ('app','qr')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_documents_tenant_vin_idx ON public.vehicle_documents (tenant_id, vin);

ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage vehicle documents" ON public.vehicle_documents;
CREATE POLICY "Members manage vehicle documents"
  ON public.vehicle_documents FOR ALL TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));

-- ── RPC: issue a dept sign-off token (member-gated) ────────────────────────
-- Reuses an existing pending, unexpired token for the same vehicle+department
-- so the printed QR is stable until it's used, then a fresh one is minted.
CREATE OR REPLACE FUNCTION public.issue_dept_signoff_token(
  p_tenant_id uuid,
  p_vin text,
  p_department text,
  p_purpose text DEFAULT 'safety_inspection'
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_vin text := upper(trim(p_vin));
  v_token text;
  v_listing public.vehicle_listings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF p_department NOT IN ('service','detail') THEN RAISE EXCEPTION 'invalid department'; END IF;
  -- Caller must be an accepted member of the tenant, or a platform admin.
  IF NOT public.has_role(v_uid, 'admin') AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = v_uid AND tenant_id = p_tenant_id AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not a member of this tenant';
  END IF;

  -- Reuse a live token if one already exists.
  SELECT token INTO v_token FROM public.dept_signoff_tokens
  WHERE tenant_id = p_tenant_id AND vin = v_vin AND department = p_department
    AND purpose = p_purpose AND status = 'pending' AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;

  SELECT * INTO v_listing FROM public.vehicle_listings
  WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.dept_signoff_tokens
    (tenant_id, vehicle_listing_id, vin, ymm, stock_number, department, purpose, token, created_by)
  VALUES
    (p_tenant_id, v_listing.id, v_vin, v_listing.ymm, NULL, p_department, p_purpose, v_token, v_uid);
  RETURN v_token;
END;
$$;

-- ── RPC: resolve a token for the public sign-off page (anon) ────────────────
CREATE OR REPLACE FUNCTION public.get_dept_signoff_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'used_or_revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  RETURN jsonb_build_object(
    'ok', true, 'tenant_id', r.tenant_id, 'vehicle_listing_id', r.vehicle_listing_id,
    'vin', r.vin, 'ymm', r.ymm, 'stock_number', r.stock_number,
    'department', r.department, 'purpose', r.purpose
  );
END;
$$;

-- ── RPC: submit + sign the K-208 from the no-login QR (anon) ────────────────
-- Mirrors record_customer_signing: validate token, resolve tenant, write the
-- inspection, consume the token, append an audit row. Single-use by design.
CREATE OR REPLACE FUNCTION public.submit_safety_inspection(
  _token text,
  _checklist jsonb,
  _result text,
  _failure_notes text,
  _notes text,
  _documents jsonb,
  _inspector_name text,
  _signature_data text,
  _content_hash text,
  _esign_consent jsonb,
  _ip text,
  _user_agent text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'used_or_revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF r.department <> 'service' THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_department'); END IF;
  IF coalesce(trim(_inspector_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'inspector_name_required'); END IF;

  INSERT INTO public.safety_inspections
    (tenant_id, vehicle_listing_id, vin, ymm, form_type, checklist, result, failure_notes, notes,
     documents, inspector_name, inspector_role, signature_data, signature_type, content_hash,
     esign_consent, customer_ip, user_agent, submitted_via, status, signed_at)
  VALUES
    (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, 'CT-K208',
     coalesce(_checklist, '[]'::jsonb), _result, _failure_notes, _notes,
     coalesce(_documents, '[]'::jsonb), _inspector_name, 'service', _signature_data, 'type',
     _content_hash, _esign_consent, _ip, _user_agent, 'qr', 'signed', now())
  RETURNING id INTO v_id;

  -- Consume the token so the QR is dead after one completed sign-off.
  UPDATE public.dept_signoff_tokens SET status = 'used', used_at = now(), updated_at = now() WHERE id = r.id;

  -- Best-effort audit; never let the hash-chain trigger roll back a valid sign-off.
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('safety_inspection_signed', 'vehicle', r.vin, r.tenant_id,
            jsonb_build_object('inspection_id', v_id, 'department', 'service', 'result', _result, 'via', 'qr'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_dept_signoff_token(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dept_signoff_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_safety_inspection(text, jsonb, text, text, text, jsonb, text, text, text, jsonb, text, text) TO anon, authenticated;
