-- Security audit D3.1 + D2.5: the safety_inspections write guard.
--
-- D3.1 (critical): the INSERT policy requires only tenant membership, so ANY
-- member could insert an already-signed row (or a row pre-stamped with
-- licensee certification), bypassing the conduct/signer authority the RPCs
-- enforce. A BEFORE trigger now gates every path — including future clients:
--   • a row may only BECOME signed (INSERT signed, or pending -> signed) when
--     the caller holds conduct authority (k208_conduct_allowed, the same role
--     matrix save_inspection_draft enforces), OR the write arrives through
--     submit_safety_inspection's validated QR token (transaction-local flag),
--     OR a service context (auth.uid() IS NULL — anon can never reach the
--     table directly; RLS has no anon policy);
--   • created_by is stamped with the authenticated signer so the finalize
--     gate's authority check can never be spoofed;
--   • licensee certification can never be born on INSERT.
--
-- D2.5 (high): signed rows are FROZEN. The only allowed changes on a signed
-- row are:
--   • status -> 'voided' with manager void authority AND a documented
--     void_reason (new voided metadata columns, stamped by the trigger);
--   • operational workflow fields (inspection_state, started_at, assigned_to,
--     superseded_by, doc_version, updated_at);
--   • licensee certification fields — only with k208_signer_allowed (the
--     certify RPC's own authority), so a non-signer can no longer rewrite the
--     signer name or signature by direct UPDATE;
--   • result_initial — first determination stays open to the UPDATE-policy
--     roles (K208Document's A/B/C initialing), changing an EXISTING initial
--     requires signer authority;
--   • buyer_* — write-once (k208_record_buyer_signature's idempotent stamp);
--     rewriting an existing buyer signature requires platform admin.
-- Every legal-substance field (checklist, result, signatures, hash, consent,
-- identity, signed_at, created_by, ...) raises signed_inspection_frozen.
-- Voided rows are immutable.

ALTER TABLE public.safety_inspections
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text;

-- Server-side conduct authority: the exact role matrix save_inspection_draft
-- (20260726108000) already enforces for working the checklist. Signing the
-- technician inspection is a conduct act; K-208 EXECUTION stays a separate
-- k208_signer_allowed grant.
CREATE OR REPLACE FUNCTION public.k208_conduct_allowed(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL AND (
    public.has_role(p_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_user_id
        AND tm.accepted_at IS NOT NULL
        AND lower(trim(tm.role)) IN (
          'owner','general_manager','gsm','admin','manager',
          'service_manager','service_advisor','detail','service')
    )
  );
$$;

REVOKE ALL ON FUNCTION public.k208_conduct_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.k208_conduct_allowed(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_safety_inspection_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_via_token boolean := coalesce(current_setting('app.k208_token_submit', true), '') = '1';
  v_admin boolean := v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::public.app_role);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'signed' AND v_uid IS NOT NULL AND NOT v_via_token THEN
      IF NOT public.k208_conduct_allowed(NEW.tenant_id, v_uid) THEN
        RAISE EXCEPTION 'not_authorized_to_sign_inspection';
      END IF;
      NEW.created_by := v_uid;
    END IF;
    IF (NEW.licensee_certified_at IS NOT NULL
        OR NEW.licensee_certified_by IS NOT NULL
        OR NEW.licensee_signature_data IS NOT NULL)
       AND v_uid IS NOT NULL AND NOT v_admin THEN
      RAISE EXCEPTION 'certification_only_via_certify_rpc';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'voided_inspection_immutable';
  END IF;

  IF OLD.status <> 'signed' AND NEW.status = 'signed'
     AND v_uid IS NOT NULL AND NOT v_via_token THEN
    IF NOT public.k208_conduct_allowed(NEW.tenant_id, v_uid) THEN
      RAISE EXCEPTION 'not_authorized_to_sign_inspection';
    END IF;
    NEW.created_by := v_uid;
  END IF;

  IF OLD.status = 'signed' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status <> 'voided' THEN
        RAISE EXCEPTION 'signed_inspection_frozen';
      END IF;
      IF NOT (v_uid IS NULL OR v_admin OR EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = OLD.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
          AND lower(trim(tm.role)) IN ('owner','general_manager','gsm','admin','manager','service_manager')
      )) THEN
        RAISE EXCEPTION 'not_authorized_to_void';
      END IF;
      IF coalesce(trim(NEW.void_reason), '') = '' THEN
        RAISE EXCEPTION 'void_reason_required';
      END IF;
      NEW.voided_at := coalesce(NEW.voided_at, now());
      NEW.voided_by := coalesce(NEW.voided_by, v_uid);
    END IF;

    IF NEW.tenant_id            IS DISTINCT FROM OLD.tenant_id
       OR NEW.vehicle_listing_id IS DISTINCT FROM OLD.vehicle_listing_id
       OR NEW.vin               IS DISTINCT FROM OLD.vin
       OR NEW.stock_number      IS DISTINCT FROM OLD.stock_number
       OR NEW.ymm               IS DISTINCT FROM OLD.ymm
       OR NEW.form_type         IS DISTINCT FROM OLD.form_type
       OR NEW.checklist         IS DISTINCT FROM OLD.checklist
       OR NEW.result            IS DISTINCT FROM OLD.result
       OR NEW.failure_notes     IS DISTINCT FROM OLD.failure_notes
       OR NEW.notes             IS DISTINCT FROM OLD.notes
       OR NEW.documents         IS DISTINCT FROM OLD.documents
       OR NEW.inspector_name    IS DISTINCT FROM OLD.inspector_name
       OR NEW.inspector_role    IS DISTINCT FROM OLD.inspector_role
       OR NEW.signature_data    IS DISTINCT FROM OLD.signature_data
       OR NEW.signature_type    IS DISTINCT FROM OLD.signature_type
       OR NEW.content_hash      IS DISTINCT FROM OLD.content_hash
       OR NEW.esign_consent     IS DISTINCT FROM OLD.esign_consent
       OR NEW.customer_ip       IS DISTINCT FROM OLD.customer_ip
       OR NEW.user_agent        IS DISTINCT FROM OLD.user_agent
       OR NEW.submitted_via     IS DISTINCT FROM OLD.submitted_via
       OR NEW.signed_at         IS DISTINCT FROM OLD.signed_at
       OR NEW.created_by        IS DISTINCT FROM OLD.created_by
       OR NEW.created_at        IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'signed_inspection_frozen';
    END IF;

    IF (NEW.licensee_certified_by   IS DISTINCT FROM OLD.licensee_certified_by
        OR NEW.licensee_certified_at IS DISTINCT FROM OLD.licensee_certified_at
        OR NEW.licensee_name         IS DISTINCT FROM OLD.licensee_name
        OR NEW.licensee_signature_data IS DISTINCT FROM OLD.licensee_signature_data)
       AND NOT (v_uid IS NULL OR v_admin OR public.k208_signer_allowed(OLD.tenant_id, v_uid)) THEN
      RAISE EXCEPTION 'not_authorized_to_certify';
    END IF;

    IF NEW.result_initial IS DISTINCT FROM OLD.result_initial
       AND OLD.result_initial IS NOT NULL
       AND NOT (v_uid IS NULL OR v_admin OR public.k208_signer_allowed(OLD.tenant_id, v_uid)) THEN
      RAISE EXCEPTION 'not_authorized_to_change_result_initial';
    END IF;

    IF (NEW.buyer_name IS DISTINCT FROM OLD.buyer_name
        OR NEW.buyer_signature_data IS DISTINCT FROM OLD.buyer_signature_data
        OR NEW.buyer_signed_at IS DISTINCT FROM OLD.buyer_signed_at)
       AND OLD.buyer_signed_at IS NOT NULL
       AND NOT v_admin THEN
      RAISE EXCEPTION 'buyer_signature_locked';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Named to sort AFTER trg_snapshot_safety_inspection and
-- trg_sync_inspection_state among the BEFORE triggers, so it judges the final
-- NEW row (inspection_state already synced from status).
DROP TRIGGER IF EXISTS trg_zz_safety_inspection_guard ON public.safety_inspections;
CREATE TRIGGER trg_zz_safety_inspection_guard
  BEFORE INSERT OR UPDATE ON public.safety_inspections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_safety_inspection_guard();

-- submit_safety_inspection: identical to 20260726100000 (hub token accepted
-- and never consumed, single-use 'service' token consumed, already-completed
-- guard, created_by stamped) PLUS the transaction-local flag that tells the
-- write guard this signed birth was authorized by the validated QR token.
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
  v_done uuid;
  v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'used_or_revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF r.department NOT IN ('service','vehicle') THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_department'); END IF;
  IF coalesce(trim(_inspector_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'inspector_name_required'); END IF;

  SELECT id INTO v_done FROM public.safety_inspections
    WHERE tenant_id = r.tenant_id AND vin = r.vin
      AND status = 'signed' AND result IS DISTINCT FROM 'fail'
    LIMIT 1;
  IF v_done IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_completed', 'id', v_done);
  END IF;

  -- The token IS the signing authorization for this write; the guard trigger
  -- reads this transaction-local flag instead of re-judging the caller's role.
  PERFORM set_config('app.k208_token_submit', '1', true);

  SELECT id INTO v_id FROM public.safety_inspections
    WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.safety_inspections SET
      vehicle_listing_id = coalesce(vehicle_listing_id, r.vehicle_listing_id),
      ymm = coalesce(ymm, r.ymm),
      checklist = coalesce(_checklist, '[]'::jsonb), result = _result,
      failure_notes = _failure_notes, notes = _notes, documents = coalesce(_documents, '[]'::jsonb),
      inspector_name = _inspector_name, inspector_role = 'service',
      signature_data = _signature_data, signature_type = 'type', content_hash = _content_hash,
      esign_consent = _esign_consent, customer_ip = _ip, user_agent = _user_agent,
      submitted_via = 'qr', status = 'signed', signed_at = now(), updated_at = now(),
      created_by = coalesce(v_uid, created_by)
    WHERE id = v_id;
  ELSE
    INSERT INTO public.safety_inspections
      (tenant_id, vehicle_listing_id, vin, ymm, form_type, checklist, result, failure_notes, notes,
       documents, inspector_name, inspector_role, signature_data, signature_type, content_hash,
       esign_consent, customer_ip, user_agent, submitted_via, status, signed_at, created_by)
    VALUES
      (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, 'CT-K208',
       coalesce(_checklist, '[]'::jsonb), _result, _failure_notes, _notes,
       coalesce(_documents, '[]'::jsonb), _inspector_name, 'service', _signature_data, 'type',
       _content_hash, _esign_consent, _ip, _user_agent, 'qr', 'signed', now(), v_uid)
    RETURNING id INTO v_id;
  END IF;

  IF r.department = 'service' THEN
    UPDATE public.dept_signoff_tokens SET status = 'used', used_at = now(), updated_at = now() WHERE id = r.id;
  END IF;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('safety_inspection_signed', 'vehicle', r.vin, r.tenant_id,
            jsonb_build_object('inspection_id', v_id, 'department', r.department, 'result', _result,
                               'via', 'qr', 'created_by', v_uid));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_safety_inspection(text, jsonb, text, text, text, jsonb, text, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_safety_inspection(text, jsonb, text, text, text, jsonb, text, text, text, jsonb, text, text) TO anon, authenticated;

-- transition_safety_inspection: identical to 20260726102000 except the void
-- branch now records the voided metadata (void_reason, voided_by, voided_at)
-- the write guard requires, so the RPC remains the working void path.
CREATE OR REPLACE FUNCTION public.transition_safety_inspection(
  p_inspection_id uuid,
  p_new_state text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.safety_inspections%ROWTYPE;
  v_allowed jsonb := '{
    "not_started": ["in_progress","voided"],
    "in_progress": ["voided"],
    "failed_items_open": ["repairs_in_progress","voided"],
    "repairs_in_progress": ["ready_for_reinspection","failed_items_open","voided"],
    "ready_for_reinspection": ["repairs_in_progress","voided"],
    "passed": ["voided"],
    "voided": []
  }'::jsonb;
  v_can_void boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO v_row FROM public.safety_inspections WHERE id = p_inspection_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'inspection_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
  ) AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  IF NOT (coalesce(v_allowed -> v_row.inspection_state, '[]'::jsonb) ? p_new_state) THEN
    RAISE EXCEPTION 'invalid_transition from % to %', v_row.inspection_state, p_new_state;
  END IF;

  IF p_new_state = 'voided' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
        AND lower(trim(tm.role)) IN ('owner','general_manager','gsm','admin','manager','service_manager')
    ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_can_void;
    IF NOT v_can_void THEN RAISE EXCEPTION 'not_authorized_to_void'; END IF;
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'void_reason_required'; END IF;
    UPDATE public.safety_inspections
       SET inspection_state = 'voided', status = 'voided',
           void_reason = trim(p_reason), voided_by = v_uid, voided_at = now(),
           updated_at = now()
     WHERE id = p_inspection_id;
  ELSE
    UPDATE public.safety_inspections
       SET inspection_state = p_new_state,
           started_at = CASE WHEN p_new_state = 'in_progress' THEN coalesce(started_at, now()) ELSE started_at END,
           updated_at = now()
     WHERE id = p_inspection_id;
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('safety_inspection_state_changed', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object(
            'inspection_id', p_inspection_id,
            'prev_state', v_row.inspection_state,
            'new_state', p_new_state,
            'reason', nullif(trim(coalesce(p_reason, '')), '')));

  RETURN jsonb_build_object('ok', true, 'id', p_inspection_id,
                            'prev_state', v_row.inspection_state, 'new_state', p_new_state);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_safety_inspection(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_safety_inspection(uuid, text, text) TO authenticated, service_role;
