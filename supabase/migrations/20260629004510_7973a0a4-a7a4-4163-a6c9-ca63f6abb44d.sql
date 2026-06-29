-- ============================================================
-- 20260629060000_recon_estimates.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recon_estimates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  vehicle_listing_id uuid,
  store_id           uuid,
  vin                text NOT NULL,
  ymm                text,
  approval_token     text NOT NULL UNIQUE,
  status             text NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted','partially_approved','approved','declined','completed','voided')),
  submitted_by       text,
  submitted_role     text,
  subtotal           numeric NOT NULL DEFAULT 0,
  approved_total     numeric NOT NULL DEFAULT 0,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.recon_estimates TO authenticated;
GRANT ALL ON public.recon_estimates TO service_role;
CREATE INDEX IF NOT EXISTS idx_recon_estimates_tenant_vin ON public.recon_estimates (tenant_id, vin);
CREATE INDEX IF NOT EXISTS idx_recon_estimates_status ON public.recon_estimates (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.recon_estimate_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     uuid NOT NULL REFERENCES public.recon_estimates(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  category        text,
  description     text NOT NULL,
  severity        text DEFAULT 'recommended' CHECK (severity IN ('required','recommended','ok','na')),
  labor_cost      numeric NOT NULL DEFAULT 0,
  parts_cost      numeric NOT NULL DEFAULT 0,
  sublet_cost     numeric NOT NULL DEFAULT 0,
  line_total      numeric NOT NULL DEFAULT 0,
  vendor          text,
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_status text NOT NULL DEFAULT 'pending'
                    CHECK (approval_status IN ('pending','approved','declined','deferred','auto_approved')),
  approved_amount numeric,
  decline_reason  text,
  decided_by      text,
  decided_role    text,
  decision_channel text,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.recon_estimate_lines TO authenticated;
GRANT ALL ON public.recon_estimate_lines TO service_role;
CREATE INDEX IF NOT EXISTS idx_recon_lines_estimate ON public.recon_estimate_lines (estimate_id);

ALTER TABLE public.recon_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_estimate_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recon estimates readable by tenant" ON public.recon_estimates;
CREATE POLICY "recon estimates readable by tenant" ON public.recon_estimates FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "recon lines readable by tenant" ON public.recon_estimate_lines;
CREATE POLICY "recon lines readable by tenant" ON public.recon_estimate_lines FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.recon_recompute_estimate(_estimate_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_total int; n_pending int; n_approved int; n_declined int; v_approved numeric;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE approval_status = 'pending'),
         count(*) FILTER (WHERE approval_status IN ('approved','auto_approved')),
         count(*) FILTER (WHERE approval_status = 'declined'),
         coalesce(sum(approved_amount) FILTER (WHERE approval_status IN ('approved','auto_approved')), 0)
    INTO n_total, n_pending, n_approved, n_declined, v_approved
    FROM public.recon_estimate_lines WHERE estimate_id = _estimate_id;
  UPDATE public.recon_estimates SET
    approved_total = v_approved,
    status = CASE
      WHEN n_pending > 0 THEN 'submitted'
      WHEN n_approved > 0 AND n_declined > 0 THEN 'partially_approved'
      WHEN n_approved > 0 THEN 'approved'
      WHEN n_declined = n_total AND n_total > 0 THEN 'declined'
      ELSE status END,
    updated_at = now()
  WHERE id = _estimate_id;
END; $$;

CREATE OR REPLACE FUNCTION public.submit_recon_estimate(
  _token text, _submitted_by text, _submitted_role text, _notes text,
  _lines jsonb, _auto_approve_under numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE; v_id uuid; v_token text; ln jsonb;
  v_labor numeric; v_parts numeric; v_sublet numeric; v_total numeric; v_auto boolean; n int := 0;
  v_threshold numeric;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_lines'); END IF;
  IF coalesce(btrim(_submitted_by), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;

  SELECT (settings->>'recon_auto_approve_amount')::numeric INTO v_threshold
    FROM public.dealer_profiles WHERE tenant_id = r.tenant_id;
  v_threshold := coalesce(v_threshold, _auto_approve_under, 0);

  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.recon_estimates (tenant_id, vehicle_listing_id, vin, ymm, approval_token, submitted_by, submitted_role, notes)
  VALUES (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, v_token, btrim(_submitted_by), nullif(btrim(coalesce(_submitted_role,'')),''), nullif(btrim(coalesce(_notes,'')),''))
  RETURNING id INTO v_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_labor  := GREATEST(coalesce((ln->>'labor_cost')::numeric, 0), 0);
    v_parts  := GREATEST(coalesce((ln->>'parts_cost')::numeric, 0), 0);
    v_sublet := GREATEST(coalesce((ln->>'sublet_cost')::numeric, 0), 0);
    v_total  := v_labor + v_parts + v_sublet;
    v_auto   := v_threshold > 0 AND v_total <= v_threshold;
    INSERT INTO public.recon_estimate_lines
      (estimate_id, tenant_id, category, description, severity, labor_cost, parts_cost, sublet_cost, line_total, vendor, photos,
       approval_status, approved_amount, decided_at, decision_channel)
    VALUES (v_id, r.tenant_id, nullif(btrim(coalesce(ln->>'category','')),''), coalesce(nullif(btrim(coalesce(ln->>'description','')),''), 'Recon item'),
       CASE WHEN ln->>'severity' IN ('required','recommended','ok','na') THEN ln->>'severity' ELSE 'recommended' END,
       v_labor, v_parts, v_sublet, v_total, nullif(btrim(coalesce(ln->>'vendor','')),''),
       coalesce(ln->'photos', '[]'::jsonb),
       CASE WHEN v_auto THEN 'auto_approved' ELSE 'pending' END,
       CASE WHEN v_auto THEN v_total ELSE NULL END,
       CASE WHEN v_auto THEN now() ELSE NULL END,
       CASE WHEN v_auto THEN 'auto' ELSE NULL END);
    n := n + 1;
  END LOOP;

  UPDATE public.recon_estimates SET subtotal = (SELECT coalesce(sum(line_total),0) FROM public.recon_estimate_lines WHERE estimate_id = v_id) WHERE id = v_id;
  PERFORM public.recon_recompute_estimate(v_id);

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_submitted', 'vehicle', r.vin, r.tenant_id, jsonb_build_object('estimate_id', v_id, 'lines', n, 'by', _submitted_by));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'estimate_id', v_id, 'approval_token', v_token,
    'needs_approval', EXISTS (SELECT 1 FROM public.recon_estimate_lines WHERE estimate_id = v_id AND approval_status = 'pending'));
END; $$;

CREATE OR REPLACE FUNCTION public.get_recon_estimate(_approval_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_price numeric; v_lines jsonb;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE approval_token = _approval_token LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT price INTO v_price FROM public.vehicle_listings WHERE id = e.vehicle_listing_id OR (vin = e.vin AND tenant_id = e.tenant_id) LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'category', category, 'description', description, 'severity', severity,
           'labor_cost', labor_cost, 'parts_cost', parts_cost, 'sublet_cost', sublet_cost, 'line_total', line_total,
           'vendor', vendor, 'photos', photos, 'approval_status', approval_status,
           'approved_amount', approved_amount, 'decline_reason', decline_reason) ORDER BY created_at), '[]'::jsonb)
    INTO v_lines FROM public.recon_estimate_lines WHERE estimate_id = e.id;
  RETURN jsonb_build_object('ok', true,
    'estimate', jsonb_build_object('id', e.id, 'vin', e.vin, 'ymm', e.ymm, 'status', e.status,
      'submitted_by', e.submitted_by, 'submitted_role', e.submitted_role, 'notes', e.notes,
      'subtotal', e.subtotal, 'approved_total', e.approved_total, 'created_at', e.created_at,
      'vehicle_price', v_price),
    'lines', v_lines);
END; $$;

CREATE OR REPLACE FUNCTION public.decide_recon_line(
  _approval_token text, _line_id uuid, _action text, _reason text DEFAULT NULL,
  _by text DEFAULT NULL, _channel text DEFAULT 'link'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_line public.recon_estimate_lines%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE approval_token = _approval_token LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO v_line FROM public.recon_estimate_lines WHERE id = _line_id AND estimate_id = e.id LIMIT 1;
  IF v_line.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'line_not_found'); END IF;
  v_status := CASE _action WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' WHEN 'defer' THEN 'deferred' ELSE NULL END;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_action'); END IF;
  IF v_status = 'declined' AND coalesce(btrim(_reason),'') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_required'); END IF;

  UPDATE public.recon_estimate_lines SET
    approval_status = v_status,
    approved_amount = CASE WHEN v_status = 'approved' THEN line_total ELSE NULL END,
    decline_reason  = CASE WHEN v_status = 'declined' THEN btrim(_reason) ELSE NULL END,
    decided_by = nullif(btrim(coalesce(_by,'')),''), decision_channel = _channel, decided_at = now()
  WHERE id = _line_id;
  PERFORM public.recon_recompute_estimate(e.id);

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_line_' || v_status, 'vehicle', e.vin, e.tenant_id,
            jsonb_build_object('estimate_id', e.id, 'line_id', _line_id, 'amount', v_line.line_total, 'reason', _reason, 'by', _by, 'channel', _channel));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.decide_recon_estimate(
  _approval_token text, _action text, _by text DEFAULT NULL, _channel text DEFAULT 'link'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE approval_token = _approval_token LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_status := CASE _action WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE NULL END;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_action'); END IF;
  UPDATE public.recon_estimate_lines SET
    approval_status = v_status,
    approved_amount = CASE WHEN v_status = 'approved' THEN line_total ELSE NULL END,
    decided_by = nullif(btrim(coalesce(_by,'')),''), decision_channel = _channel, decided_at = now()
  WHERE estimate_id = e.id AND approval_status = 'pending';
  PERFORM public.recon_recompute_estimate(e.id);
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_' || v_status, 'vehicle', e.vin, e.tenant_id, jsonb_build_object('estimate_id', e.id, 'by', _by, 'channel', _channel));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.submit_recon_estimate(text, text, text, text, jsonb, numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recon_estimate(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_recon_line(text, uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_recon_estimate(text, text, text, text) TO anon, authenticated;

-- ============================================================
-- 20260629070000_recon_member_and_messages.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recon_estimate_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.recon_estimates(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  author_id   uuid,
  author_name text,
  author_role text,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.recon_estimate_messages TO authenticated;
GRANT ALL ON public.recon_estimate_messages TO service_role;
CREATE INDEX IF NOT EXISTS idx_recon_messages_estimate ON public.recon_estimate_messages (estimate_id, created_at);

ALTER TABLE public.recon_estimate_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recon messages readable by tenant" ON public.recon_estimate_messages;
CREATE POLICY "recon messages readable by tenant" ON public.recon_estimate_messages FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.recon_caller_role(_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.tenant_members
   WHERE user_id = (SELECT auth.uid()) AND tenant_id = _tenant AND accepted_at IS NOT NULL
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.recon_submit_member(
  _vin text, _ymm text, _notes text, _by text, _lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_role text; v_listing uuid; v_id uuid; v_token text; ln jsonb;
  v_labor numeric; v_parts numeric; v_sublet numeric; v_total numeric; v_auto boolean;
  v_threshold numeric; v_vin text := upper(btrim(coalesce(_vin,'')));
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_tenant'); END IF;
  v_role := public.recon_caller_role(v_tenant);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_member'); END IF;
  IF v_vin = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'vin_required'); END IF;
  IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_lines'); END IF;

  SELECT id INTO v_listing FROM public.vehicle_listings WHERE tenant_id = v_tenant AND vin = v_vin LIMIT 1;
  SELECT (settings->>'recon_auto_approve_amount')::numeric INTO v_threshold FROM public.dealer_profiles WHERE tenant_id = v_tenant;
  v_threshold := coalesce(v_threshold, 0);

  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.recon_estimates (tenant_id, vehicle_listing_id, vin, ymm, approval_token, submitted_by, submitted_role, notes)
  VALUES (v_tenant, v_listing, v_vin, nullif(btrim(coalesce(_ymm,'')),''), v_token, nullif(btrim(coalesce(_by,'')),''), v_role, nullif(btrim(coalesce(_notes,'')),''))
  RETURNING id INTO v_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_labor  := GREATEST(coalesce((ln->>'labor_cost')::numeric, 0), 0);
    v_parts  := GREATEST(coalesce((ln->>'parts_cost')::numeric, 0), 0);
    v_sublet := GREATEST(coalesce((ln->>'sublet_cost')::numeric, 0), 0);
    v_total  := v_labor + v_parts + v_sublet;
    v_auto   := v_threshold > 0 AND v_total <= v_threshold;
    INSERT INTO public.recon_estimate_lines
      (estimate_id, tenant_id, category, description, severity, labor_cost, parts_cost, sublet_cost, line_total, vendor, photos,
       approval_status, approved_amount, decided_at, decision_channel)
    VALUES (v_id, v_tenant, nullif(btrim(coalesce(ln->>'category','')),''), coalesce(nullif(btrim(coalesce(ln->>'description','')),''), 'Recon item'),
       CASE WHEN ln->>'severity' IN ('required','recommended','ok','na') THEN ln->>'severity' ELSE 'recommended' END,
       v_labor, v_parts, v_sublet, v_total, nullif(btrim(coalesce(ln->>'vendor','')),''), coalesce(ln->'photos','[]'::jsonb),
       CASE WHEN v_auto THEN 'auto_approved' ELSE 'pending' END,
       CASE WHEN v_auto THEN v_total ELSE NULL END,
       CASE WHEN v_auto THEN now() ELSE NULL END,
       CASE WHEN v_auto THEN 'auto' ELSE NULL END);
  END LOOP;

  UPDATE public.recon_estimates SET subtotal = (SELECT coalesce(sum(line_total),0) FROM public.recon_estimate_lines WHERE estimate_id = v_id) WHERE id = v_id;
  PERFORM public.recon_recompute_estimate(v_id);
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_submitted', 'vehicle', v_vin, v_tenant, jsonb_build_object('estimate_id', v_id, 'by', _by, 'channel', 'app'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'estimate_id', v_id, 'approval_token', v_token,
    'needs_approval', EXISTS (SELECT 1 FROM public.recon_estimate_lines WHERE estimate_id = v_id AND approval_status = 'pending'));
END; $$;

CREATE OR REPLACE FUNCTION public.recon_decide_member(
  _estimate_id uuid, _line_id uuid, _action text, _reason text DEFAULT NULL, _by text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_role text; v_status text;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE id = _estimate_id LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_role := public.recon_caller_role(e.tenant_id);
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized'); END IF;
  v_status := CASE _action WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' WHEN 'defer' THEN 'deferred' ELSE NULL END;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_action'); END IF;
  IF v_status = 'declined' AND _line_id IS NOT NULL AND coalesce(btrim(_reason),'') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_required'); END IF;

  IF _line_id IS NULL THEN
    UPDATE public.recon_estimate_lines SET approval_status = v_status,
      approved_amount = CASE WHEN v_status='approved' THEN line_total ELSE NULL END,
      decline_reason = CASE WHEN v_status='declined' THEN nullif(btrim(coalesce(_reason,'')),'') ELSE NULL END,
      decided_by = nullif(btrim(coalesce(_by,'')),''), decided_role = v_role, decision_channel = 'app', decided_at = now()
    WHERE estimate_id = e.id AND approval_status = 'pending';
  ELSE
    UPDATE public.recon_estimate_lines SET approval_status = v_status,
      approved_amount = CASE WHEN v_status='approved' THEN line_total ELSE NULL END,
      decline_reason = CASE WHEN v_status='declined' THEN btrim(_reason) ELSE NULL END,
      decided_by = nullif(btrim(coalesce(_by,'')),''), decided_role = v_role, decision_channel = 'app', decided_at = now()
    WHERE id = _line_id AND estimate_id = e.id;
  END IF;
  PERFORM public.recon_recompute_estimate(e.id);
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_' || coalesce(CASE WHEN _line_id IS NULL THEN 'estimate' ELSE 'line' END,'line') || '_' || v_status,
            'vehicle', e.vin, e.tenant_id, jsonb_build_object('estimate_id', e.id, 'line_id', _line_id, 'by', _by, 'role', v_role, 'channel', 'app'));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.recon_post_message(_estimate_id uuid, _body text, _by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_role text;
BEGIN
  IF coalesce(btrim(_body),'') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'empty'); END IF;
  SELECT * INTO e FROM public.recon_estimates WHERE id = _estimate_id LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_role := public.recon_caller_role(e.tenant_id);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_member'); END IF;
  INSERT INTO public.recon_estimate_messages (estimate_id, tenant_id, author_id, author_name, author_role, body)
  VALUES (e.id, e.tenant_id, (SELECT auth.uid()), nullif(btrim(coalesce(_by,'')),''), v_role, btrim(_body));
  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.recon_caller_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_submit_member(text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_decide_member(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_post_message(uuid, text, text) TO authenticated;

-- ============================================================
-- 20260629081000_ingest_orchestration.sql
-- ============================================================
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS orchestrated_at timestamptz;

ALTER TABLE public.recon_estimates
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS sent_to_service_at timestamptz;

CREATE TABLE IF NOT EXISTS public.installer_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  company    text NOT NULL,
  product    text,
  email      text,
  phone      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installer_contacts TO authenticated;
GRANT ALL ON public.installer_contacts TO service_role;
CREATE INDEX IF NOT EXISTS idx_installer_contacts_tenant ON public.installer_contacts (tenant_id) WHERE active;

ALTER TABLE public.installer_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "installer contacts readable by tenant" ON public.installer_contacts;
CREATE POLICY "installer contacts readable by tenant" ON public.installer_contacts FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "installer contacts writable by tenant" ON public.installer_contacts;
CREATE POLICY "installer contacts writable by tenant" ON public.installer_contacts FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.claim_listing_orchestration(_listing_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_won boolean;
BEGIN
  IF _listing_id IS NULL THEN RETURN false; END IF;
  UPDATE public.vehicle_listings
     SET orchestrated_at = now()
   WHERE id = _listing_id AND orchestrated_at IS NULL
  RETURNING true INTO v_won;
  RETURN coalesce(v_won, false);
END; $$;

CREATE OR REPLACE FUNCTION public.seed_recon_estimate_for_ingest(
  _tenant_id uuid, _vin text, _ymm text, _vehicle_listing_id uuid, _mode text DEFAULT 'manual'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin text := upper(btrim(coalesce(_vin,''))); v_settings jsonb; v_services jsonb;
  v_threshold numeric; v_auto_mode boolean; v_id uuid; v_token text; svc jsonb;
  v_total numeric; v_auto boolean; v_sent timestamptz; n int := 0;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_args'); END IF;

  IF EXISTS (SELECT 1 FROM public.recon_estimates WHERE tenant_id = _tenant_id AND vin = v_vin AND origin = 'ingest') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_seeded');
  END IF;

  SELECT settings INTO v_settings FROM public.dealer_profiles WHERE tenant_id = _tenant_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_services := coalesce(v_settings->'recon_canned_services', '[]'::jsonb);
  v_threshold := coalesce((v_settings->>'recon_auto_approve_amount')::numeric, 0);
  v_auto_mode := coalesce(_mode, v_settings->>'ingest_recon_dispatch', 'manual') = 'auto';

  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_services) s WHERE s->>'severity' = 'required') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'no_required_services');
  END IF;

  v_sent := CASE WHEN v_auto_mode THEN now() ELSE NULL END;
  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.recon_estimates (tenant_id, vehicle_listing_id, vin, ymm, approval_token,
      submitted_by, submitted_role, notes, origin, sent_to_service_at)
  VALUES (_tenant_id, _vehicle_listing_id, v_vin, nullif(btrim(coalesce(_ymm,'')),''), v_token,
      'Auto-ingest', 'system', 'Seeded on intake from your standard recon menu.', 'ingest', v_sent)
  RETURNING id INTO v_id;

  FOR svc IN SELECT * FROM jsonb_array_elements(v_services) WHERE value->>'severity' = 'required' LOOP
    v_total := GREATEST(coalesce((svc->>'labor_cost')::numeric, 0), 0) + GREATEST(coalesce((svc->>'parts_cost')::numeric, 0), 0);
    v_auto := v_auto_mode AND v_threshold > 0 AND v_total <= v_threshold;
    INSERT INTO public.recon_estimate_lines
      (estimate_id, tenant_id, category, description, severity, labor_cost, parts_cost, line_total,
       approval_status, approved_amount, decided_at, decision_channel)
    VALUES (v_id, _tenant_id, nullif(btrim(coalesce(svc->>'category','')),''),
       coalesce(nullif(btrim(coalesce(svc->>'label','')),''), 'Recon item'), 'required',
       GREATEST(coalesce((svc->>'labor_cost')::numeric, 0), 0), GREATEST(coalesce((svc->>'parts_cost')::numeric, 0), 0), v_total,
       CASE WHEN v_auto THEN 'auto_approved' ELSE 'pending' END,
       CASE WHEN v_auto THEN v_total ELSE NULL END,
       CASE WHEN v_auto THEN now() ELSE NULL END,
       CASE WHEN v_auto THEN 'auto' ELSE NULL END);
    n := n + 1;
  END LOOP;

  UPDATE public.recon_estimates SET subtotal = (SELECT coalesce(sum(line_total),0) FROM public.recon_estimate_lines WHERE estimate_id = v_id) WHERE id = v_id;
  PERFORM public.recon_recompute_estimate(v_id);

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_seeded', 'vehicle', v_vin, _tenant_id,
            jsonb_build_object('estimate_id', v_id, 'lines', n, 'mode', CASE WHEN v_auto_mode THEN 'auto' ELSE 'manual' END));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'estimate_id', v_id, 'approval_token', v_token,
    'mode', CASE WHEN v_auto_mode THEN 'auto' ELSE 'manual' END,
    'needs_approval', EXISTS (SELECT 1 FROM public.recon_estimate_lines WHERE estimate_id = v_id AND approval_status = 'pending'));
END; $$;

CREATE OR REPLACE FUNCTION public.recon_send_to_service(_estimate_id uuid, _by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE id = _estimate_id LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_role := public.recon_caller_role(e.tenant_id);
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized'); END IF;
  IF e.sent_to_service_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_sent', true); END IF;
  UPDATE public.recon_estimates SET sent_to_service_at = now(), updated_at = now() WHERE id = e.id;
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_sent', 'vehicle', e.vin, e.tenant_id, jsonb_build_object('estimate_id', e.id, 'by', _by, 'role', v_role));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'approval_token', e.approval_token);
END; $$;

GRANT EXECUTE ON FUNCTION public.claim_listing_orchestration(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_recon_estimate_for_ingest(uuid, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recon_send_to_service(uuid, text) TO authenticated;

-- ============================================================
-- 20260629090000_recon_install_hardening.sql
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_estimates_ingest_per_vin
  ON public.recon_estimates (tenant_id, vin) WHERE origin = 'ingest';

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
  IF coalesce(_is_third_party, false) AND (_photos IS NULL OR jsonb_array_length(_photos) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'photo_required');
  END IF;
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

GRANT EXECUTE ON FUNCTION public.submit_detail_signoff(text, jsonb, jsonb, boolean, text, text, text, text, jsonb, text, text, jsonb, text, text, text) TO anon, authenticated;

-- ============================================================
-- 20260629100000_ingest_publish_and_install_gate.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_prep_gate()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_do_not_drive BOOLEAN;
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;
    v_do_not_drive := COALESCE((NEW.recall_check ->> 'do_not_drive')::BOOLEAN, false);
    IF v_do_not_drive AND NEW.recall_override_by IS NULL THEN
      RAISE EXCEPTION 'recall_gate_blocked: vehicle % has an active do-not-drive recall; admin override required',
        NEW.vin USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.installs_block_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_vin text := upper(coalesce(_vin, '')); v_snap jsonb;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;
  SELECT (settings ->> 'require_install_verification')::boolean INTO v_require
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;
  IF v_require IS NOT TRUE THEN RETURN false; END IF;

  SELECT products_snapshot INTO v_snap
    FROM public.addendums
    WHERE tenant_id = _tenant_id AND vehicle_vin = v_vin
    ORDER BY created_at DESC
    LIMIT 1;
  IF v_snap IS NULL OR jsonb_typeof(v_snap) <> 'array' THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_snap) prod
    WHERE coalesce(prod->>'badge_type', 'installed') = 'installed'
      AND coalesce(btrim(prod->>'name'), '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.install_proofs ip
        WHERE ip.tenant_id = _tenant_id AND upper(ip.vehicle_vin) = v_vin
          AND ip.is_verified = true
          AND lower(btrim(ip.product_name)) = lower(btrim(prod->>'name'))
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ready_blocks_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_condition text; v_vin text := upper(coalesce(_vin, ''));
        v_roles text[]; v_k208 boolean := false;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;

  SELECT (settings ->> 'require_safety_inspection')::boolean,
         ARRAY(SELECT jsonb_array_elements_text(coalesce(settings -> 'k208_authority_roles', '[]'::jsonb)))
    INTO v_require, v_roles
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;
  IF v_require IS TRUE THEN
    SELECT lower(coalesce(condition, 'used')) INTO v_condition
      FROM public.vehicle_listings WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;
    IF FOUND AND v_condition IN ('used','cpo','certified') THEN
      IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
        v_k208 := NOT EXISTS (
          SELECT 1 FROM public.safety_inspections
          WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
        );
      ELSE
        v_k208 := NOT EXISTS (
          SELECT 1 FROM public.safety_inspections si
          JOIN public.tenant_members tm
            ON tm.user_id = si.created_by AND tm.tenant_id = si.tenant_id
          WHERE si.tenant_id = _tenant_id AND si.vin = v_vin AND si.status = 'signed'
            AND tm.accepted_at IS NOT NULL AND tm.role = ANY(v_roles)
        );
      END IF;
    END IF;
  END IF;
  IF v_k208 THEN RETURN true; END IF;

  RETURN public.installs_block_finalize(_tenant_id, v_vin);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ready_blocks_finalize(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installs_block_finalize(uuid, text) TO anon, authenticated;

-- ============================================================
-- 20260629110000_k208_official_fields.sql
-- ============================================================
ALTER TABLE public.safety_inspections
  ADD COLUMN IF NOT EXISTS result_initial      text CHECK (result_initial IN ('A','B','C')),
  ADD COLUMN IF NOT EXISTS buyer_name          text,
  ADD COLUMN IF NOT EXISTS buyer_signature_data text,
  ADD COLUMN IF NOT EXISTS buyer_signed_at      timestamptz;

CREATE OR REPLACE FUNCTION public.k208_record_buyer_signature(
  _signing_token text, _buyer_name text, _buyer_signature_data text, _result_initial text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_vin text; v_id uuid; v_already timestamptz;
BEGIN
  SELECT tenant_id, upper(vehicle_vin) INTO v_tenant, v_vin
    FROM public.addendums WHERE signing_token::text = _signing_token LIMIT 1;
  IF v_tenant IS NULL THEN
    SELECT tenant_id, upper(vehicle_payload->>'vin') INTO v_tenant, v_vin
      FROM public.deal_signing_tokens WHERE token = _signing_token LIMIT 1;
  END IF;
  IF v_tenant IS NULL OR coalesce(v_vin, '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_deal'); END IF;

  SELECT id, buyer_signed_at INTO v_id, v_already FROM public.safety_inspections
    WHERE tenant_id = v_tenant AND vin = v_vin AND status = 'signed'
    ORDER BY signed_at DESC NULLS LAST, created_at DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_inspection'); END IF;
  IF v_already IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_signed', true, 'id', v_id); END IF;

  UPDATE public.safety_inspections SET
    buyer_name = nullif(btrim(coalesce(_buyer_name, '')), ''),
    buyer_signature_data = _buyer_signature_data,
    buyer_signed_at = now(),
    result_initial = CASE WHEN _result_initial IN ('A','B','C') THEN _result_initial ELSE result_initial END,
    updated_at = now()
  WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.k208_record_buyer_signature(text, text, text, text) TO anon, authenticated;

-- ============================================================
-- 20260629120000_recon_completion.sql
-- ============================================================
ALTER TABLE public.recon_estimate_lines
  ADD COLUMN IF NOT EXISTS completed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by    text,
  ADD COLUMN IF NOT EXISTS completion_notes text;

CREATE OR REPLACE FUNCTION public.get_recon_for_token(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_lines jsonb;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'category', l.category, 'description', l.description, 'severity', l.severity,
           'completed_at', l.completed_at, 'completed_by', l.completed_by) ORDER BY l.created_at), '[]'::jsonb)
    INTO v_lines
    FROM public.recon_estimate_lines l
    JOIN public.recon_estimates e ON e.id = l.estimate_id
   WHERE e.tenant_id = r.tenant_id AND e.vin = r.vin
     AND l.approval_status IN ('approved', 'auto_approved');

  RETURN jsonb_build_object('ok', true, 'vin', r.vin, 'ymm', r.ymm, 'lines', v_lines);
END; $$;

CREATE OR REPLACE FUNCTION public.recon_confirm_lines_done(
  _token text, _line_ids jsonb, _by text, _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_n int;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF coalesce(btrim(_by), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
  IF _line_ids IS NULL OR jsonb_array_length(_line_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_lines'); END IF;

  UPDATE public.recon_estimate_lines l SET
    completed_at = now(), completed_by = btrim(_by), completion_notes = nullif(btrim(coalesce(_notes, '')), '')
  FROM public.recon_estimates e
  WHERE l.estimate_id = e.id
    AND e.tenant_id = r.tenant_id AND e.vin = r.vin
    AND l.approval_status IN ('approved', 'auto_approved')
    AND l.id IN (SELECT (jsonb_array_elements_text(_line_ids))::uuid);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_work_completed', 'vehicle', r.vin, r.tenant_id, jsonb_build_object('lines', v_n, 'by', _by));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'completed', v_n);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_recon_for_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recon_confirm_lines_done(text, jsonb, text, text) TO anon, authenticated;