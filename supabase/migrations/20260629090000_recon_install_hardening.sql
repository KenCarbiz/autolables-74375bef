-- ─────────────────────────────────────────────────────────────────────────
-- Defensibility + idempotency hardening for the recon/ingest flow.
--
-- 1. Third-party installs must carry photo proof. The Get-Ready UI already
--    blocks a pre-install without a photo, but the record must be defensible
--    even if a future caller skips the UI: enforce it at the write boundary.
-- 2. Fire-once seed: a partial unique index makes a second ingest-origin
--    estimate for the same (tenant, vin) impossible, so a relist/re-sync race
--    can never double-seed even if the EXISTS pre-check loses the race.
-- ─────────────────────────────────────────────────────────────────────────

-- One ingest-seeded estimate per vehicle, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_estimates_ingest_per_vin
  ON public.recon_estimates (tenant_id, vin) WHERE origin = 'ingest';

-- Re-create submit_detail_signoff with a server-side photo-proof requirement
-- for third-party installs. Body is otherwise identical to 20260629020000.
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
  -- Third-party installs are not defensible without a photo of the work.
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
