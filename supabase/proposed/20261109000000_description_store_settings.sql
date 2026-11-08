-- PROPOSED, NOT APPLIED. Needs Ken's approval before it runs anywhere.
--
-- Per-rooftop description settings for multi-store dealer groups (the six
-- Harte rooftops). Additive only.
--
--   description_store_settings          one row per dealer_stores row that
--                                        overrides the dealership defaults,
--                                        with a version counter
--   description_store_settings_versions  every applied version with actor,
--                                        reason and the previous overrides
--   apply_description_store_settings()   the only write path: settings
--                                        roles only, the store must belong
--                                        to the tenant, only listed keys,
--                                        compare-and-swap on the version,
--                                        idempotent per request id
--
-- Isolation: a row is keyed by (tenant_id, store_id) and the RPC writes
-- exactly that row, so changing one store can never change another. A store
-- with no row keeps using description_settings (the dealership row) exactly
-- as today, so applying this migration changes no description.
--
-- Not covered here, by design:
--   * Fee basis (advertised_includes_doc_fee, doc fee amount) stays on
--     dealer_profiles for the whole dealership, because the Passport, the fee
--     review and the price reconciliation all read it there. Making it
--     per-store is a pricing change across those surfaces and needs its own
--     decision; the description gate reads the same source they do.
--   * The approved-claims voice profile stays dealership-wide; a store may
--     override brand_voice, cta_template and prohibited_phrases.
--
-- Preconditions: dealer_stores (drizzle 0006) and description_settings exist.
-- Rollback: 20261109000000_description_store_settings.rollback.sql.

CREATE TABLE IF NOT EXISTS public.description_store_settings (
  tenant_id        uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id         uuid        NOT NULL REFERENCES public.dealer_stores(id) ON DELETE CASCADE,
  overrides        jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides) = 'object'),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  last_request_id  uuid,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.description_store_settings_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  store_id        uuid        NOT NULL,
  version         integer     NOT NULL,
  overrides       jsonb       NOT NULL,
  prev_overrides  jsonb,
  reason          text,
  actor           uuid,
  request_id      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, version)
);

ALTER TABLE public.description_store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.description_store_settings_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "description store settings members read" ON public.description_store_settings;
CREATE POLICY "description store settings members read"
  ON public.description_store_settings FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "description store settings history members read" ON public.description_store_settings_versions;
CREATE POLICY "description store settings history members read"
  ON public.description_store_settings_versions FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

REVOKE ALL ON public.description_store_settings FROM anon;
REVOKE ALL ON public.description_store_settings_versions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.description_store_settings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.description_store_settings_versions FROM authenticated;
GRANT SELECT ON public.description_store_settings TO authenticated;
GRANT SELECT ON public.description_store_settings_versions TO authenticated;
GRANT SELECT ON public.description_store_settings TO service_role;

-- Keys a store may override; mirrors STORE_OVERRIDABLE_KEYS in
-- supabase/functions/_shared/description-store-settings.ts.
CREATE OR REPLACE FUNCTION public.description_store_settings_errors(_overrides jsonb)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_allowed text[] := ARRAY['required_legal_text','cta_template','brand_voice','prohibited_phrases',
                            'review_mode','review_mode_by_class','enabled_channels','primary_city','state'];
  v_errs text[] := '{}';
  v_key text;
BEGIN
  IF _overrides IS NULL OR jsonb_typeof(_overrides) <> 'object' THEN RETURN ARRAY['overrides must be an object']; END IF;
  FOR v_key IN SELECT jsonb_object_keys(_overrides) LOOP
    IF NOT v_key = ANY (v_allowed) THEN v_errs := v_errs || format('%s cannot be set per store', v_key); END IF;
  END LOOP;
  IF _overrides ? 'prohibited_phrases' AND jsonb_typeof(_overrides->'prohibited_phrases') <> 'array' THEN v_errs := v_errs || 'prohibited_phrases must be a list'::text; END IF;
  IF _overrides ? 'enabled_channels' AND jsonb_typeof(_overrides->'enabled_channels') <> 'array' THEN v_errs := v_errs || 'enabled_channels must be a list'::text; END IF;
  IF _overrides ? 'review_mode' AND NOT (_overrides->>'review_mode') = ANY (ARRAY['EXCEPTION_REVIEW','REQUIRE_APPROVAL_ALL','DRAFT_ONLY','AUTO_PUBLISH']) THEN
    v_errs := v_errs || 'review_mode is not a known mode'::text;
  END IF;
  IF _overrides ? 'state' AND (_overrides->>'state') !~ '^[A-Z]{2}$' THEN v_errs := v_errs || 'state must be a two-letter code'::text; END IF;
  IF _overrides ? 'required_legal_text' AND length(coalesce(_overrides->>'required_legal_text','')) > 1200 THEN v_errs := v_errs || 'required_legal_text is too long'::text; END IF;
  RETURN v_errs;
END $$;

CREATE OR REPLACE FUNCTION public.apply_description_store_settings(
  _tenant_id uuid, _store_id uuid, _base_version integer, _overrides jsonb, _reason text, _request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.description_store_settings%ROWTYPE;
  v_found boolean;
  v_current integer;
  v_next integer;
  v_errs text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_description_authority(_tenant_id, 'configure') THEN
    RAISE EXCEPTION 'not_authorized_for_description_settings' USING ERRCODE = '42501';
  END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'request id required' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dealer_stores s WHERE s.id = _store_id AND s.tenant_id = _tenant_id) THEN
    RAISE EXCEPTION 'store_not_in_tenant' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.description_store_settings
   WHERE tenant_id = _tenant_id AND store_id = _store_id FOR UPDATE;
  v_found := FOUND;
  IF v_found AND v_row.last_request_id = _request_id THEN
    RETURN jsonb_build_object('version', v_row.version, 'replayed', true);
  END IF;
  v_current := CASE WHEN v_found THEN v_row.version ELSE 0 END;
  IF _base_version IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'stale_version' USING ERRCODE = '40001', DETAIL = v_current::text;
  END IF;
  v_errs := public.description_store_settings_errors(_overrides);
  IF array_length(v_errs, 1) > 0 THEN
    RAISE EXCEPTION 'invalid_overrides' USING ERRCODE = '22023', DETAIL = array_to_string(v_errs, '; ');
  END IF;
  IF v_found AND v_row.overrides = _overrides THEN RAISE EXCEPTION 'no_change' USING ERRCODE = '22023'; END IF;

  v_next := v_current + 1;
  IF v_found THEN
    UPDATE public.description_store_settings
       SET overrides = _overrides, version = v_next, last_request_id = _request_id, updated_by = v_uid, updated_at = now()
     WHERE tenant_id = _tenant_id AND store_id = _store_id AND version = v_current;
  ELSE
    BEGIN
      INSERT INTO public.description_store_settings (tenant_id, store_id, overrides, version, last_request_id, updated_by)
      VALUES (_tenant_id, _store_id, _overrides, v_next, _request_id, v_uid);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'stale_version' USING ERRCODE = '40001', DETAIL = '1';
    END;
  END IF;

  INSERT INTO public.description_store_settings_versions (tenant_id, store_id, version, overrides, prev_overrides, reason, actor, request_id)
  VALUES (_tenant_id, _store_id, v_next, _overrides, CASE WHEN v_found THEN v_row.overrides END, _reason, v_uid, _request_id);
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_store_settings_applied', 'dealer_store', _store_id::text, _tenant_id::text, v_uid,
          jsonb_build_object('version', v_next, 'request_id', _request_id, 'keys', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(_overrides) k)));
  RETURN jsonb_build_object('version', v_next, 'replayed', false);
END $$;

REVOKE ALL ON FUNCTION public.apply_description_store_settings(uuid, uuid, integer, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_description_store_settings(uuid, uuid, integer, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.description_store_settings_errors(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_description_store_settings(uuid, uuid, integer, jsonb, text, uuid) IS
  'The only write path for one rooftop''s description overrides. Configure authority only; the store must belong to the tenant; only listed keys; the base version must match (40001 on a stale draft); a repeated request id replays; the row, its version history and audit_log are written in one transaction. Never touches another store.';
