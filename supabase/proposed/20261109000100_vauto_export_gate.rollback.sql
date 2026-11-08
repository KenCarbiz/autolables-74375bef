-- Rollback for 20261109000100_vauto_export_gate.sql. Restores the previous
-- record_description_output_use (20260727225826) and drops the gate.
DROP TRIGGER IF EXISTS trg_description_delivery_vauto_guard ON public.description_deliveries;
DROP TRIGGER IF EXISTS trg_description_export_approval_guard ON public.description_export_approvals;
DROP FUNCTION IF EXISTS public.description_delivery_vauto_guard();
DROP FUNCTION IF EXISTS public.export_vauto_description(uuid);
DROP FUNCTION IF EXISTS public.vauto_valid_approval(uuid);
DROP FUNCTION IF EXISTS public.approve_vauto_export(uuid, text);
DROP FUNCTION IF EXISTS public.description_export_approval_guard();
DROP FUNCTION IF EXISTS public.record_vauto_export_check(uuid, boolean, jsonb, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.approve_description_disclosure(uuid);
DROP FUNCTION IF EXISTS public.record_description_disclosure_legal_review(uuid, text, timestamptz, text, boolean);
DROP FUNCTION IF EXISTS public.propose_description_disclosure(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.vauto_export_sql_blockers(uuid);
DROP FUNCTION IF EXISTS public.vauto_export_state_fingerprint(uuid);
DROP TABLE IF EXISTS public.description_export_approvals;
DROP TABLE IF EXISTS public.description_export_checks;
DROP FUNCTION IF EXISTS public.description_disclosure_for(uuid, uuid, text);
DROP TABLE IF EXISTS public.description_store_disclosures;
DROP FUNCTION IF EXISTS public.description_render_disclosure(text, numeric);
DROP FUNCTION IF EXISTS public.description_money(numeric);
DROP FUNCTION IF EXISTS public.description_fee_basis(jsonb);
DROP FUNCTION IF EXISTS public.description_configured_boolean(jsonb);
DROP FUNCTION IF EXISTS public.vauto_gate_version();

CREATE OR REPLACE FUNCTION public.record_description_output_use(
  p_version_id  uuid,
  p_channel     text,
  p_action      text,
  p_destination text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_ver   public.description_versions%ROWTYPE;
  v_ok    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_action NOT IN ('saved_to_vehicle','exported','copied') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_action');
  END IF;
  SELECT * INTO v_ver FROM public.description_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'version_not_found');
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_ver.tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL
  ) INTO v_ok;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  INSERT INTO public.description_deliveries (
    tenant_id, vehicle_id, description_case_id, version_id, destination,
    delivery_mode, connector_status, status, idempotency_key, response_metadata
  ) VALUES (
    v_ver.tenant_id, v_ver.vehicle_id, v_ver.description_case_id, p_version_id,
    COALESCE(p_destination, p_channel, 'manual_export'),
    'export_only', 'export_only', 'recorded',
    p_version_id::text || ':' || p_action || ':' || COALESCE(p_channel,'master') || ':' || v_uid::text,
    jsonb_build_object('action', p_action, 'channel', p_channel,
                       'note', 'Operator took a copy of a stored version. No delivery was performed.')
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('description_' || p_action, 'description_version', p_version_id, v_ver.tenant_id,
          jsonb_build_object('channel', p_channel, 'version_number', v_ver.version_number,
                             'destination', p_destination));
  RETURN jsonb_build_object('ok', true, 'version_id', p_version_id,
                            'version_number', v_ver.version_number, 'action', p_action);
END;
$$;
REVOKE ALL ON FUNCTION public.record_description_output_use(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_description_output_use(uuid, text, text, text) TO authenticated;
