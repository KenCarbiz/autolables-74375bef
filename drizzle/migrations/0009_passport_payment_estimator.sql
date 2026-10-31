-- ── Passport payment estimator: per-store retail finance assumptions ──────
--
-- Each rooftop (tenant_id + store_id) owns one estimator configuration:
-- on/off, a store-wide default down payment (fixed dollars or percent of the
-- canonical selling price), shopper adjustment switches and explicit
-- model-year ranges, each with its own enabled terms, APR per term and default
-- term. Retail finance only. No rates are seeded: a store without a row shows
-- no payment estimate until an authorized person configures and applies one.
--
--   passport_payment_estimator_settings   the published config, one row per
--                                          rooftop, with a version counter.
--   passport_payment_estimator_versions   every applied version with actor,
--                                          time, before and after. Append-only.
--   payment_estimator_config_errors()      the server copy of the validation in
--                                          src/lib/payment/estimator.ts.
--   apply_payment_estimator_settings()     the only write path: pricing roles
--                                          (the roles merge_dealer_settings
--                                          accepts for financing_disclosure_apr),
--                                          store-in-tenant check, validation,
--                                          compare-and-swap on the version,
--                                          idempotent replay and an audit row,
--                                          all in one transaction.
--
-- Members of the tenant may read their own rooftops' rows. The anonymous
-- Passport never reads the table: public-listing-view (service role) projects
-- only the customer-readable fields for the listing's own rooftop.
--
-- Prepared, not applied. Requires 20261029000000 (tenant_role_in). Rollback
-- at the end of this file.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.passport_payment_estimator_settings (
  tenant_id        uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id         text        NOT NULL,
  enabled          boolean     NOT NULL DEFAULT false,
  config           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  last_request_id  uuid,
  updated_by       uuid        REFERENCES auth.users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.passport_payment_estimator_versions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id     text        NOT NULL,
  version      integer     NOT NULL,
  config       jsonb       NOT NULL,
  prev_config  jsonb,
  actor        uuid        REFERENCES auth.users(id),
  request_id   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, version)
);

ALTER TABLE public.passport_payment_estimator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_payment_estimator_versions ENABLE ROW LEVEL SECURITY;

-- Reads: accepted members of the owning tenant. No INSERT/UPDATE/DELETE
-- policies: the apply RPC is the only client write path.
DROP POLICY IF EXISTS "payment estimator members read" ON public.passport_payment_estimator_settings;
CREATE POLICY "payment estimator members read"
  ON public.passport_payment_estimator_settings FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "payment estimator history members read" ON public.passport_payment_estimator_versions;
CREATE POLICY "payment estimator history members read"
  ON public.passport_payment_estimator_versions FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

REVOKE ALL ON public.passport_payment_estimator_settings FROM anon;
REVOKE ALL ON public.passport_payment_estimator_versions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.passport_payment_estimator_settings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.passport_payment_estimator_versions FROM authenticated;
GRANT SELECT ON public.passport_payment_estimator_settings TO authenticated;
GRANT SELECT ON public.passport_payment_estimator_versions TO authenticated;

-- ── Validation (server copy of validateEstimatorConfig) ─────────────────

CREATE OR REPLACE FUNCTION public.payment_estimator_num(v jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE WHEN v IS NOT NULL AND jsonb_typeof(v) = 'number' THEN v::text::numeric ELSE NULL END;
$function$;

CREATE OR REPLACE FUNCTION public.payment_estimator_config_errors(_config jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  errs text[] := ARRAY[]::text[];
  v_enabled boolean;
  v_mode text;
  v_pct numeric;
  v_amt numeric;
  r jsonb;
  t jsonb;
  v_start numeric;
  v_end numeric;
  v_default numeric;
  v_months numeric;
  v_apr numeric;
  v_seen numeric[];
  v_enabled_terms numeric[];
  v_any_rule boolean := false;
  v_ranges numeric[][] := ARRAY[]::numeric[][];
  i int;
BEGIN
  IF _config IS NULL OR jsonb_typeof(_config) <> 'object' THEN
    RETURN ARRAY['config must be an object'];
  END IF;
  IF jsonb_typeof(_config -> 'enabled') IS DISTINCT FROM 'boolean' THEN
    errs := array_append(errs, 'enabled must be true or false');
  END IF;
  v_enabled := coalesce((_config ->> 'enabled')::boolean, false);

  v_mode := _config #>> '{downPayment,mode}';
  v_pct := public.payment_estimator_num(_config #> '{downPayment,percent}');
  v_amt := public.payment_estimator_num(_config #> '{downPayment,amount}');
  IF v_mode = 'percent' THEN
    IF v_pct IS NULL THEN
      IF v_enabled THEN errs := array_append(errs, 'downPayment.percent is required'); END IF;
    ELSIF v_pct < 0 OR v_pct > 100 THEN
      errs := array_append(errs, 'downPayment.percent must be between 0 and 100');
    END IF;
  ELSIF v_mode = 'amount' THEN
    IF v_amt IS NULL THEN
      IF v_enabled THEN errs := array_append(errs, 'downPayment.amount is required'); END IF;
    ELSIF v_amt < 0 THEN
      errs := array_append(errs, 'downPayment.amount must be 0 or more');
    END IF;
  ELSE
    errs := array_append(errs, 'downPayment.mode must be amount or percent');
  END IF;

  IF jsonb_typeof(_config -> 'rules') IS DISTINCT FROM 'array' THEN
    RETURN array_append(errs, 'rules must be an array'::text);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(_config -> 'rules') LOOP
    v_start := public.payment_estimator_num(r -> 'startYear');
    v_end := public.payment_estimator_num(r -> 'endYear');
    v_default := public.payment_estimator_num(r -> 'defaultTermMonths');
    IF v_start IS NULL OR v_start <> trunc(v_start) OR v_start < 1900 OR v_start > 2100
       OR v_end IS NULL OR v_end <> trunc(v_end) OR v_end < 1900 OR v_end > 2100 THEN
      errs := array_append(errs, format('rule %s: model years must be four-digit years', coalesce(r ->> 'id', '?')));
    ELSIF v_start > v_end THEN
      errs := array_append(errs, format('rule %s: start year after end year', coalesce(r ->> 'id', '?')));
    ELSE
      FOR i IN 1 .. coalesce(array_length(v_ranges, 1), 0) LOOP
        IF v_start <= v_ranges[i][2] AND v_ranges[i][1] <= v_end THEN
          errs := array_append(errs, format('rule %s: model-year range overlaps another range', coalesce(r ->> 'id', '?')));
        END IF;
      END LOOP;
      v_ranges := v_ranges || ARRAY[ARRAY[v_start, v_end]];
    END IF;

    v_seen := ARRAY[]::numeric[];
    v_enabled_terms := ARRAY[]::numeric[];
    IF jsonb_typeof(r -> 'terms') IS DISTINCT FROM 'array' THEN
      errs := array_append(errs, format('rule %s: terms must be an array', coalesce(r ->> 'id', '?')));
      CONTINUE;
    END IF;
    FOR t IN SELECT value FROM jsonb_array_elements(r -> 'terms') LOOP
      v_months := public.payment_estimator_num(t -> 'months');
      v_apr := public.payment_estimator_num(t -> 'aprPercent');
      IF v_months IS NULL OR v_months <> trunc(v_months) OR v_months <= 0 OR v_months > 120 THEN
        errs := array_append(errs, format('rule %s: term months must be a whole number from 1 to 120', coalesce(r ->> 'id', '?')));
      ELSIF v_months = ANY (v_seen) THEN
        errs := array_append(errs, format('rule %s: duplicate %s-month term', coalesce(r ->> 'id', '?'), v_months));
      ELSE
        v_seen := v_seen || v_months;
      END IF;
      IF coalesce((t ->> 'enabled')::boolean, false) THEN
        IF v_apr IS NULL OR v_apr < 0 THEN
          errs := array_append(errs, format('rule %s: enabled %s-month term needs an APR of 0 or more', coalesce(r ->> 'id', '?'), v_months));
        END IF;
        v_enabled_terms := v_enabled_terms || v_months;
      END IF;
    END LOOP;

    IF coalesce((r ->> 'enabled')::boolean, true) THEN
      v_any_rule := true;
      IF coalesce(array_length(v_enabled_terms, 1), 0) = 0 THEN
        errs := array_append(errs, format('rule %s: needs at least one enabled term', coalesce(r ->> 'id', '?')));
      ELSIF v_default IS NULL OR NOT (v_default = ANY (v_enabled_terms)) THEN
        errs := array_append(errs, format('rule %s: default term must be enabled', coalesce(r ->> 'id', '?')));
      END IF;
    END IF;
  END LOOP;

  IF v_enabled AND NOT v_any_rule THEN
    errs := array_append(errs, 'an enabled estimator needs at least one model-year range');
  END IF;
  RETURN errs;
END;
$function$;

-- ── Apply ────────────────────────────────────────────────────────────────

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
GRANT EXECUTE ON FUNCTION public.payment_estimator_config_errors(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_payment_estimator_settings(uuid, text, integer, jsonb, uuid) IS
  'The only write path for a rooftop''s Passport payment estimator. Pricing roles only; the store must belong to the tenant; the config is validated; the base version must match (stale drafts are refused with 40001); a repeated request id replays; settings, version history and audit_log are written in one transaction.';

-- ── Rollback (run manually; keeps audit_log rows) ───────────────────────
-- DROP FUNCTION IF EXISTS public.apply_payment_estimator_settings(uuid, text, integer, jsonb, uuid);
-- DROP FUNCTION IF EXISTS public.payment_estimator_config_errors(jsonb);
-- DROP FUNCTION IF EXISTS public.payment_estimator_num(jsonb);
-- DROP TABLE IF EXISTS public.passport_payment_estimator_versions;
-- DROP TABLE IF EXISTS public.passport_payment_estimator_settings;
