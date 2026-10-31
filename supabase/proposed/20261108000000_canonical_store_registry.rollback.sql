-- Rollback for 20261108000000_canonical_store_registry.sql: restores the 0009 estimator apply function and drops the registry reader.

DROP FUNCTION IF EXISTS public.tenant_store_registry(uuid);

CREATE OR REPLACE FUNCTION public.apply_payment_estimator_settings(
  _tenant_id uuid,
  _store_id text,
  _base_version integer,
  _config jsonb,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_admin boolean;
  v_errs text[];
  v_row public.passport_payment_estimator_settings%ROWTYPE;
  v_found boolean;
  v_current integer;
  v_next integer;
  v_store_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_admin := public.has_role(v_uid, 'admin'::public.app_role);
  IF NOT v_admin AND NOT public.tenant_role_in(_tenant_id, ARRAY['owner','admin','general_manager','gsm']) THEN
    RAISE EXCEPTION 'not_authorized_for_payment_settings' USING ERRCODE = '42501';
  END IF;
  IF _request_id IS NULL THEN
    RAISE EXCEPTION 'request id required' USING ERRCODE = '22023';
  END IF;

  -- The rooftop must be this tenant's: either the synthesized default store
  -- (store id = tenant id) or a store listed on its onboarding profile.
  SELECT _store_id = _tenant_id::text OR EXISTS (
           SELECT 1 FROM public.onboarding_profiles op,
                         jsonb_array_elements(CASE WHEN jsonb_typeof(op.stores) = 'array' THEN op.stores ELSE '[]'::jsonb END) s
           WHERE op.tenant_id = _tenant_id AND s ->> 'id' = _store_id)
    INTO v_store_ok;
  IF NOT coalesce(v_store_ok, false) THEN
    RAISE EXCEPTION 'store_not_in_tenant' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.passport_payment_estimator_settings
    WHERE tenant_id = _tenant_id AND store_id = _store_id
    FOR UPDATE;
  v_found := FOUND;

  -- A retried request that already committed returns the same answer.
  IF v_found AND v_row.last_request_id = _request_id THEN
    RETURN jsonb_build_object('version', v_row.version, 'updated_at', v_row.updated_at, 'replayed', true);
  END IF;

  v_current := CASE WHEN v_found THEN v_row.version ELSE 0 END;
  IF _base_version IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'stale_version' USING ERRCODE = '40001', DETAIL = v_current::text;
  END IF;

  v_errs := public.payment_estimator_config_errors(_config);
  IF array_length(v_errs, 1) > 0 THEN
    RAISE EXCEPTION 'invalid_config' USING ERRCODE = '22023', DETAIL = array_to_string(v_errs, '; ');
  END IF;

  IF v_found AND v_row.config = _config THEN
    RAISE EXCEPTION 'no_change' USING ERRCODE = '22023';
  END IF;

  v_next := v_current + 1;
  IF v_found THEN
    UPDATE public.passport_payment_estimator_settings
      SET enabled = (_config ->> 'enabled')::boolean, config = _config, version = v_next,
          last_request_id = _request_id, updated_by = v_uid, updated_at = now()
      WHERE tenant_id = _tenant_id AND store_id = _store_id AND version = v_current;
  ELSE
    -- Two first-ever applies racing: the loser hits the primary key and is
    -- told its draft is stale, never silently overwritten.
    BEGIN
      INSERT INTO public.passport_payment_estimator_settings
          (tenant_id, store_id, enabled, config, version, last_request_id, updated_by, updated_at)
        VALUES (_tenant_id, _store_id, (_config ->> 'enabled')::boolean, _config, v_next, _request_id, v_uid, now());
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'stale_version' USING ERRCODE = '40001', DETAIL = '1';
    END;
  END IF;

  INSERT INTO public.passport_payment_estimator_versions (tenant_id, store_id, version, config, prev_config, actor, request_id)
    VALUES (_tenant_id, _store_id, v_next, _config, CASE WHEN v_found THEN v_row.config END, v_uid, _request_id);

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
    VALUES ('payment_estimator_applied', 'payment_estimator', _tenant_id::text || ':' || _store_id, _store_id, v_uid,
            jsonb_build_object('tenant_id', _tenant_id, 'version', v_next, 'request_id', _request_id,
                               'prev', CASE WHEN v_found THEN v_row.config END, 'next', _config));

  RETURN jsonb_build_object('version', v_next, 'updated_at', now(), 'replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_payment_estimator_settings(uuid, text, integer, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_payment_estimator_settings(uuid, text, integer, jsonb, uuid) TO authenticated;
