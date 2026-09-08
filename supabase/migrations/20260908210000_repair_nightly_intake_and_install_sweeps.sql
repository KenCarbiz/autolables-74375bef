-- ──────────────────────────────────────────────────────────────────────────
-- Two nightly jobs that report success while doing nothing.
--
-- DEFECT 1 — intake-draft-sweep (jobid 12, 20 3 * * *) rolls back everything
-- it creates. sweep_missing_intake_drafts() guarantees auth.uid() IS NULL
-- (it refuses to run for an interactive caller), then calls
-- issue_vehicle_ready_token(), whose first statement is
--   IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required';
-- That call sits in the SAME BEGIN..EXCEPTION subtransaction as the five
-- create_draft_* calls before it, so the raise rolls the drafts back with it.
-- The handler then writes a vehicle_exceptions row (the handler runs in the
-- surviving outer transaction, which is why the evidence persisted while the
-- work did not) and pg_cron logs `succeeded`.
--
-- Live proof, 2026-09-08 03:20:00.229064+00 — the job's start time to the
-- microsecond — 173 of 173 used vehicles carry an artifact_autogen_failed row
-- whose explanation is exactly 'authentication required'. 45 consecutive runs
-- since 2026-07-26, all logged `succeeded`.
--
-- DEFECT 2 — getready-install-safety-net (jobid 11, 30 4 * * *) failed 45
-- times, 2026-07-24 through 2026-09-06, with
--   ERROR: column ad.getready_dispatched_at does not exist
-- The reference is CORRECT; the column was missing. 20260722140000 was never
-- applied to this database, so addendums lost getready_dispatched_at,
-- accepted_by, accept_addendum() and mark_addendum_getready_dispatched() all
-- at once. 20260906173529 re-added the column two days ago, which is why the
-- job silently flipped to `succeeded` on 2026-09-07 with nobody touching it.
--
-- It is still doing no work, for two reasons this migration fixes:
--   a. the loop body reads ip.vin, but install_proofs has vehicle_vin — a
--      second wrong column that has never fired only because the outer query
--      returns no rows, and that would fail the job again the moment one
--      real candidate appears; and
--   b. nothing in the database writes getready_dispatched_at. No live
--      function references it except the sweep that reads it, and the app
--      calls accept_addendum / mark_addendum_getready_dispatched
--      (AddendumSection.tsx, ReadyBoard.tsx, useCommandCenter.ts) which do
--      not exist here. Manager acceptance is broken live and the safety net
--      is structurally guaranteed to find zero candidates forever.
--
-- Nothing is dropped, deleted or unscheduled. The historical
-- vehicle_exceptions rows stay exactly as they are: they are the evidence.
-- Every statement below is CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS /
-- GRANT / REVOKE, so the file is safe to re-run.
-- ──────────────────────────────────────────────────────────────────────────


-- ══ DEFECT 1 ══════════════════════════════════════════════════════════════
--
-- Token issuance is the part that cannot work under cron. Three ways out were
-- available; this migration takes the third.
--
--   Skip it. Rejected: the hub token IS the QR the shop scans to reach the
--   vehicle. A vehicle with five drafts and no token is half-provisioned,
--   which is what the brief forbids.
--
--   Defer it to a queue. Rejected: there is no such queue, and inventing one
--   makes a second thing that can silently stop running — the exact failure
--   mode being repaired.
--
--   Make it work for the service/cron caller. Taken. Every other function
--   this sweep calls already does this: create_draft_* call
--   assert_tenant_member_or_service(), which passes on a NULL uid and calls
--   that the service context; recompute_delivery_clearance() applies its
--   membership check only when v_uid IS NOT NULL. issue_vehicle_ready_token
--   is the single hard-raise in the chain.
--
-- It is NOT relaxed in place. issue_vehicle_ready_token is currently
-- executable by anon and PUBLIC (proacl: =X/postgres, anon=X/postgres); its
-- 'authentication required' raise is the only thing standing between an
-- anonymous caller and minting a year-long sign-off token for any tenant it
-- can name. So the mint moves into a service-only function, and the public
-- entry point keeps its guard and delegates. One implementation, two guards.

CREATE OR REPLACE FUNCTION public.issue_vehicle_ready_token_service(
  p_tenant_id uuid,
  p_vin text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_vin text := upper(trim(coalesce(p_vin, '')));
  v_token text;
  v_listing public.vehicle_listings%ROWTYPE;
BEGIN
  -- No caller check here by design: this function is unreachable except from
  -- the definer chain and service_role. Every path in must do its own check.
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;

  SELECT token INTO v_token FROM public.dept_signoff_tokens
   WHERE tenant_id = p_tenant_id AND vin = v_vin AND department = 'vehicle'
     AND status = 'pending' AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;

  SELECT * INTO v_listing FROM public.vehicle_listings
   WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.dept_signoff_tokens
    (tenant_id, vehicle_listing_id, vin, ymm, department, purpose, token, expires_at, created_by)
  VALUES
    (p_tenant_id, v_listing.id, v_vin, v_listing.ymm, 'vehicle', 'get_ready', v_token,
     now() + interval '1 year', (SELECT auth.uid()));

  RETURN v_token;
END $$;

REVOKE ALL ON FUNCTION public.issue_vehicle_ready_token_service(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_vehicle_ready_token_service(uuid, text)
  TO service_role;

-- Unchanged guard, unchanged signature, unchanged search_path (gen_random_bytes
-- lives in extensions and the mint now happens one call down, but the setting
-- is kept identical so nothing about this function's resolution shifts).
CREATE OR REPLACE FUNCTION public.issue_vehicle_ready_token(
  p_tenant_id uuid,
  p_vin text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE user_id = v_uid AND tenant_id = p_tenant_id AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not a member of this tenant';
  END IF;

  RETURN public.issue_vehicle_ready_token_service(p_tenant_id, p_vin);
END $$;

-- anon can only ever receive 'authentication required' from this function, so
-- withdrawing the grant changes no behaviour — but it stops an anonymous
-- caller from reaching a mint path at all, now that an unguarded one exists
-- one level down. Same shape as 20260908180000 / 20260908200000.
REVOKE EXECUTE ON FUNCTION public.issue_vehicle_ready_token(uuid, text)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_vehicle_ready_token(uuid, text)
  TO authenticated, service_role;


-- The sweep records a failure from inside an exception handler, i.e. after the
-- failed subtransaction has rolled back but while the outer transaction is
-- still alive. Factored out so all three stages report identically and so the
-- insert can never be the thing that kills the run.
CREATE OR REPLACE FUNCTION public.record_intake_sweep_exception(
  p_tenant_id uuid,
  p_vin text,
  p_stage text,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.vehicle_exceptions AS ve
    (tenant_id, vin, exception_type, severity, title, explanation,
     source_values, recommended_action, status)
  VALUES
    (p_tenant_id, p_vin, 'artifact_autogen_failed', 'high',
     'Intake draft sweep failed for this vehicle',
     p_stage || ': ' || left(coalesce(p_error, 'unknown'), 460),
     jsonb_build_object(
       'artifacts', jsonb_build_object('draft_sweep', left(coalesce(p_error, 'unknown'), 460)),
       'source', 'intake_draft_sweep',
       'stage', p_stage,
       'observed_at', now()),
     'Retry the drafts from the vehicle intake summary; the nightly sweep will also retry.',
     'open')
  ON CONFLICT (tenant_id, vin, exception_type) WHERE status IN ('open', 'in_progress')
  DO UPDATE SET
    explanation = EXCLUDED.explanation,
    source_values = coalesce(ve.source_values, '{}'::jsonb) || EXCLUDED.source_values,
    severity = 'high',
    updated_at = now();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

REVOKE ALL ON FUNCTION public.record_intake_sweep_exception(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intake_sweep_exception(uuid, text, text, text)
  TO service_role;


-- Three independent stages, three subtransactions. A failure in any one can no
-- longer roll back the others, and none of them is swallowed: each records the
-- stage that failed. Restores the isolation 20260726150000 introduced and the
-- 20260908021207 / 20260908170000 rewrites lost.
--
-- The return value gains counters, and every run writes one audit_log row, so
-- "the job ran" and "the job did work" stop being the same observation.
CREATE OR REPLACE FUNCTION public.sweep_missing_intake_drafts(_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_scanned integer := 0;
  v_failed integer := 0;
  v_stage_failures integer := 0;
  v_docs_before integer;
  v_docs_after integer;
  v_documents_created integer := 0;
  v_tokens_minted integer := 0;
  v_clearance_ok integer := 0;
  v_vehicle_failed boolean;
  v_had_token boolean;
  v_token text;
  v_started timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  -- Cron/service automation only; an interactive session must not run a
  -- cross-tenant sweep.
  IF (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;

  FOR r IN
    SELECT id, tenant_id, vin
    FROM public.vehicle_listings
    WHERE public.is_used_condition(condition)
      AND tenant_id IS NOT NULL
      AND coalesce(trim(vin), '') <> ''
    ORDER BY created_at DESC
    LIMIT _limit
  LOOP
    v_scanned := v_scanned + 1;
    v_vehicle_failed := false;

    -- Stage 1 — the five VIN-idempotent drafts.
    BEGIN
      SELECT count(*) INTO v_docs_before
        FROM public.generated_documents g
       WHERE g.tenant_id = r.tenant_id AND g.vehicle_id = r.id
         AND g.document_status NOT IN ('superseded', 'archived', 'rejected');

      PERFORM public.create_draft_buyers_guide(r.tenant_id, r.vin);
      PERFORM public.create_draft_safety_inspection(r.tenant_id, r.vin);
      PERFORM public.create_draft_get_ready(r.tenant_id, r.vin);
      PERFORM public.create_draft_addendum(r.tenant_id, r.vin);
      PERFORM public.create_draft_window_sticker(r.tenant_id, r.vin);

      SELECT count(*) INTO v_docs_after
        FROM public.generated_documents g
       WHERE g.tenant_id = r.tenant_id AND g.vehicle_id = r.id
         AND g.document_status NOT IN ('superseded', 'archived', 'rejected');

      v_documents_created := v_documents_created + greatest(v_docs_after - v_docs_before, 0);
    EXCEPTION WHEN OTHERS THEN
      v_stage_failures := v_stage_failures + 1;
      v_vehicle_failed := true;
      PERFORM public.record_intake_sweep_exception(r.tenant_id, r.vin, 'drafts', SQLERRM);
    END;

    -- Stage 2 — the per-vehicle hub token. Its own subtransaction, and now via
    -- the service-context mint, so it neither raises under cron nor can take
    -- the drafts down with it if it ever does.
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM public.dept_signoff_tokens t
         WHERE t.tenant_id = r.tenant_id
           AND t.vin = upper(trim(r.vin))
           AND t.department = 'vehicle'
           AND t.status = 'pending'
           AND t.expires_at > now()
      ) INTO v_had_token;

      v_token := public.issue_vehicle_ready_token_service(r.tenant_id, r.vin);

      IF v_token IS NOT NULL AND NOT v_had_token THEN
        v_tokens_minted := v_tokens_minted + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_stage_failures := v_stage_failures + 1;
      v_vehicle_failed := true;
      PERFORM public.record_intake_sweep_exception(r.tenant_id, r.vin, 'hub_token', SQLERRM);
    END;

    -- Stage 3 — delivery clearance recompute.
    BEGIN
      PERFORM public.recompute_delivery_clearance(r.tenant_id, r.vin);
      v_clearance_ok := v_clearance_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_stage_failures := v_stage_failures + 1;
      v_vehicle_failed := true;
      PERFORM public.record_intake_sweep_exception(r.tenant_id, r.vin, 'clearance', SQLERRM);
    END;

    IF v_vehicle_failed THEN
      v_failed := v_failed + 1;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'scanned', v_scanned,
    'failed', v_failed,
    'stage_failures', v_stage_failures,
    'documents_created', v_documents_created,
    'tokens_minted', v_tokens_minted,
    'clearance_recomputed', v_clearance_ok,
    'duration_ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );

  -- One durable row per run. pg_cron's `succeeded` says the statement returned;
  -- this says what it did.
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, details)
    VALUES ('intake_draft_sweep_run', 'system', 'intake-draft-sweep', v_result);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.sweep_missing_intake_drafts(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_missing_intake_drafts(integer) TO service_role;


-- ══ DEFECT 2 ══════════════════════════════════════════════════════════════

-- 2a. The other half of what 20260722140000 never applied. getready_dispatched_at
-- came back on 2026-09-06; accepted_by did not.
ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2b. ip.vin -> ip.vehicle_vin. install_proofs has never had a `vin` column;
-- this reference has been latent since 20260723070000 because the outer query
-- returned no rows to plan it with. Fixing it now is the difference between a
-- job that works and a job that fails again on its first real candidate.
--
-- Also: the days cast is guarded. A dealer whose settings JSON holds a
-- non-numeric install_safety_net_days would take the whole nightly run down
-- with invalid_text_representation — the same class of silent-stop this
-- migration exists to end.
--
-- Everything else — the 3-day default, the proof lookup, the flip to
-- 'optional', the audit row — is unchanged.
CREATE OR REPLACE FUNCTION public.sweep_getready_install_safety_net()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a record;
  e jsonb;
  v_new jsonb;
  v_changed boolean;
  v_has_proof boolean;
  v_flipped int := 0;
  v_scanned int := 0;
  v_addendums int := 0;
BEGIN
  FOR a IN
    SELECT ad.id, ad.tenant_id, ad.vehicle_vin, ad.products_snapshot, ad.getready_dispatched_at,
           coalesce(
             (SELECT (dp.settings ->> 'install_safety_net_days')
                WHERE (dp.settings ->> 'install_safety_net_days') ~ '^[0-9]+$')::int,
             3) AS days
    FROM public.addendums ad
    LEFT JOIN public.dealer_profiles dp ON dp.tenant_id = ad.tenant_id
    WHERE ad.getready_dispatched_at IS NOT NULL
      AND coalesce(ad.status, '') <> 'signed'
      AND ad.products_snapshot::text LIKE '%"install_pending"%'
  LOOP
    v_scanned := v_scanned + 1;
    IF a.getready_dispatched_at > now() - make_interval(days => greatest(a.days, 0)) THEN CONTINUE; END IF;

    v_changed := false;
    v_new := '[]'::jsonb;
    FOR e IN SELECT * FROM jsonb_array_elements(coalesce(a.products_snapshot, '[]'::jsonb))
    LOOP
      IF (e ->> 'install_pending')::boolean IS TRUE AND coalesce(e ->> 'badge_type', '') = 'installed' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.install_proofs ip
          WHERE ip.tenant_id = a.tenant_id AND upper(ip.vehicle_vin) = upper(a.vehicle_vin)
            AND ip.is_verified = true
            AND (ip.product_id::text = (e ->> 'id') OR lower(ip.product_name) = lower(coalesce(e ->> 'name', '')))
        ) INTO v_has_proof;

        IF v_has_proof THEN
          v_new := v_new || jsonb_build_array(e - 'install_pending');
        ELSE
          v_new := v_new || jsonb_build_array(e || jsonb_build_object('badge_type', 'optional', 'install_pending', false, 'flipped_to_optional', true));
          v_changed := true; v_flipped := v_flipped + 1;
        END IF;
      ELSE
        v_new := v_new || jsonb_build_array(e);
      END IF;
    END LOOP;

    IF v_changed THEN
      v_addendums := v_addendums + 1;
      UPDATE public.addendums SET products_snapshot = v_new, updated_at = now() WHERE id = a.id;
      BEGIN
        INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
        VALUES ('install_safety_net_flip', 'vehicle', a.vehicle_vin, a.tenant_id::text, jsonb_build_object('addendum_id', a.id));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, details)
    VALUES ('install_safety_net_run', 'system', 'getready-install-safety-net',
            jsonb_build_object('candidates', v_scanned, 'addendums_updated', v_addendums, 'lines_flipped', v_flipped));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN v_flipped;
END $$;

REVOKE ALL ON FUNCTION public.sweep_getready_install_safety_net()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_getready_install_safety_net() TO service_role;

-- 2c. Restore the two RPCs the app has been calling into a void. Without these
-- getready_dispatched_at is never written by anything, so the safety net above
-- can only ever return 0 no matter how correct its SQL is.
--
-- Bodies are 20260722150000's — the capability-gated versions, not the
-- membership-only originals — so this restores the security review's outcome
-- rather than the state it replaced. auth.uid() is wrapped per CLAUDE.md.
CREATE OR REPLACE FUNCTION public.accept_addendum(_addendum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid; _vin text; _ymm text; _uid uuid; _accepted timestamptz;
BEGIN
  _uid := (SELECT auth.uid());
  IF _uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;

  SELECT tenant_id, vehicle_vin, vehicle_ymm, accepted_at
    INTO _tenant, _vin, _ymm, _accepted
    FROM public.addendums WHERE id = _addendum_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'addendum not found'; END IF;

  -- Allow-list mirrors can_approve_print in
  -- src/lib/permissions/dealerRoleCapabilities.ts. Keep the two in sync.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _uid AND accepted_at IS NOT NULL
       AND role IN ('owner','general_manager','gsm','admin','manager',
                    'sales_manager','used_car_manager','inventory_manager')
  ) AND NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized: manager acceptance required';
  END IF;

  IF _accepted IS NULL THEN
    UPDATE public.addendums
       SET accepted_at = now(), accepted_by = _uid, updated_at = now()
     WHERE id = _addendum_id
     RETURNING accepted_at INTO _accepted;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'addendum_id', _addendum_id,
    'tenant_id', _tenant, 'vin', _vin, 'ymm', _ymm,
    'accepted_at', _accepted
  );
END $$;

CREATE OR REPLACE FUNCTION public.mark_addendum_getready_dispatched(_addendum_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _tenant uuid; _uid uuid;
BEGIN
  _uid := (SELECT auth.uid());
  IF _uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;

  SELECT tenant_id INTO _tenant FROM public.addendums WHERE id = _addendum_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'addendum not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _uid AND accepted_at IS NOT NULL
       AND role IN ('owner','general_manager','gsm','admin','manager',
                    'sales_manager','used_car_manager','inventory_manager')
  ) AND NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized: manager acceptance required';
  END IF;

  UPDATE public.addendums
     SET getready_dispatched_at = COALESCE(getready_dispatched_at, now()), updated_at = now()
   WHERE id = _addendum_id;
END $$;

REVOKE ALL ON FUNCTION public.accept_addendum(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_addendum_getready_dispatched(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_addendum(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_addendum_getready_dispatched(uuid) TO authenticated, service_role;


-- ══ Self-verification ═════════════════════════════════════════════════════
-- Same contract as 20260908180000 / 20260908200000: refuse to report success
-- on a schema that would make either function a no-op again. Read-only.
DO $$
DECLARE
  v_missing text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='install_proofs'
                    AND column_name='vehicle_vin') THEN
    v_missing := v_missing || ' install_proofs.vehicle_vin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='addendums'
                    AND column_name='getready_dispatched_at') THEN
    v_missing := v_missing || ' addendums.getready_dispatched_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='addendums'
                    AND column_name='accepted_by') THEN
    v_missing := v_missing || ' addendums.accepted_by';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='issue_vehicle_ready_token_service') THEN
    v_missing := v_missing || ' issue_vehicle_ready_token_service()';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'sweep repair incomplete, missing:%', v_missing;
  END IF;

  IF has_function_privilege('anon', 'public.issue_vehicle_ready_token(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'hardening failed: issue_vehicle_ready_token still anon-executable';
  END IF;
END $$;
