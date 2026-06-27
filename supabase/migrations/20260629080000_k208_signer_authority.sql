-- ─────────────────────────────────────────────────────────────────────────
-- K-208 signer authority: let the dealer require an AUTHORIZED role to sign.
--
-- Defense-in-depth on the finalize gate. The permanent windshield QR lets any
-- anon tech/vendor RECORD a K-208, but a dealer can now require that the
-- inspection which actually SATISFIES the finalize gate was signed by a current,
-- accepted tenant member holding an authorized role.
--
--   settings.k208_authority_roles  (jsonb array of role strings)
--     • absent / empty  → no restriction; any signed K-208 satisfies the gate
--       (backward-compatible with the original behavior).
--     • e.g. ["owner","admin","manager","service"] → the signed K-208 must have
--       created_by = a tenant_member with one of those roles (accepted).
--
-- Anon QR sign-offs have created_by = NULL, so they never satisfy an authority
-- restriction. To make a logged-in authorized person's QR sign-off count too,
-- submit_safety_inspection now stamps created_by = auth.uid() when present.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_ready_blocks_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_require boolean;
  v_condition text;
  v_vin text := upper(coalesce(_vin, ''));
  v_roles text[];
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;
  SELECT (settings ->> 'require_safety_inspection')::boolean,
         ARRAY(SELECT jsonb_array_elements_text(coalesce(settings -> 'k208_authority_roles', '[]'::jsonb)))
    INTO v_require, v_roles
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;
  IF v_require IS NOT TRUE THEN RETURN false; END IF;
  SELECT lower(coalesce(condition, 'used')) INTO v_condition
    FROM public.vehicle_listings WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;                 -- unknown vehicle → don't block
  IF v_condition NOT IN ('used','cpo','certified') THEN RETURN false; END IF;  -- new cars exempt

  -- No authority restriction configured → any signed K-208 satisfies the gate.
  IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
    RETURN NOT EXISTS (
      SELECT 1 FROM public.safety_inspections
      WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
    );
  END IF;

  -- Authority restriction → the signed K-208 must have been signed by a current,
  -- accepted tenant member whose role is in the dealer's authorized set.
  RETURN NOT EXISTS (
    SELECT 1 FROM public.safety_inspections si
    JOIN public.tenant_members tm
      ON tm.user_id = si.created_by AND tm.tenant_id = si.tenant_id
    WHERE si.tenant_id = _tenant_id AND si.vin = v_vin AND si.status = 'signed'
      AND tm.accepted_at IS NOT NULL
      AND tm.role = ANY(v_roles)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ready_blocks_finalize(uuid, text) TO anon, authenticated;

-- Re-define submit_safety_inspection to stamp created_by when the caller is a
-- logged-in user (so an authorized member's QR sign-off counts toward the gate).
-- Anon callers leave created_by NULL exactly as before. Hub 'vehicle' token is
-- accepted and never consumed; legacy single-use 'service' token is consumed.
CREATE OR REPLACE FUNCTION public.submit_safety_inspection(
  _token text, _checklist jsonb, _result text, _failure_notes text, _notes text, _documents jsonb,
  _inspector_name text, _signature_data text, _content_hash text, _esign_consent jsonb, _ip text, _user_agent text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_id uuid; v_uid uuid := (SELECT auth.uid());
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
     esign_consent, customer_ip, user_agent, submitted_via, status, signed_at, created_by)
  VALUES (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, 'CT-K208',
     coalesce(_checklist, '[]'::jsonb), _result, _failure_notes, _notes,
     coalesce(_documents, '[]'::jsonb), _inspector_name, 'service', _signature_data, 'type',
     _content_hash, _esign_consent, _ip, _user_agent, 'qr', 'signed', now(), v_uid)
  RETURNING id INTO v_id;
  IF r.department = 'service' THEN
    UPDATE public.dept_signoff_tokens SET status = 'used', used_at = now(), updated_at = now() WHERE id = r.id;
  END IF;
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('safety_inspection_signed', 'vehicle', r.vin, r.tenant_id,
            jsonb_build_object('inspection_id', v_id, 'department', r.department, 'result', _result, 'created_by', v_uid));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.submit_safety_inspection(text, jsonb, text, text, text, jsonb, text, text, text, jsonb, text, text) TO anon, authenticated;
