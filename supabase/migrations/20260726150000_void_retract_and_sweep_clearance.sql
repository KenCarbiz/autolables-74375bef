-- Applied live 2026-07-26; this file now carries the real SQL (it was
-- briefly a comment-only marker, which made repo truth diverge from the DB).
--
-- 1. autopublish_k208_on_signoff fires on sign AND void: the newest
--    remaining signed inspection decides; a fail, or nothing, retracts.
-- 2. sweep_missing_intake_drafts: drafts, hub-token mint (direct insert in
--    its own subtransaction — issue_vehicle_ready_token raises under cron's
--    NULL auth), and per-vehicle clearance recompute, each isolated so one
--    failure can never roll back another. Newest-first, deterministic order.

CREATE OR REPLACE FUNCTION public.autopublish_k208_on_signoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_newest public.safety_inspections%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('signed','voided') THEN RETURN NEW; END IF;

  SELECT * INTO v_newest FROM public.safety_inspections
    WHERE tenant_id = NEW.tenant_id AND vin = NEW.vin AND status = 'signed'
    ORDER BY signed_at DESC NULLS LAST, created_at DESC LIMIT 1;

  IF v_newest.id IS NOT NULL AND v_newest.result IS DISTINCT FROM 'fail' THEN
    UPDATE public.generated_documents g
    SET document_status = 'published',
        published_at = COALESCE(g.published_at, now()), updated_at = now()
    FROM public.vehicle_listings vl
    WHERE vl.tenant_id = NEW.tenant_id AND vl.vin = NEW.vin
      AND g.vehicle_id = vl.id AND g.tenant_id = NEW.tenant_id
      AND g.document_type = 'k208'
      AND g.document_status NOT IN ('published','superseded','archived','rejected');
  ELSE
    UPDATE public.generated_documents g
    SET document_status = 'draft', published_at = NULL, updated_at = now()
    FROM public.vehicle_listings vl
    WHERE vl.tenant_id = NEW.tenant_id AND vl.vin = NEW.vin
      AND g.vehicle_id = vl.id AND g.tenant_id = NEW.tenant_id
      AND g.document_type = 'k208' AND g.document_status = 'published';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sweep_missing_intake_drafts(_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record; v_scanned integer := 0; v_failed integer := 0; v_err text;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN RAISE EXCEPTION 'insufficient_permission'; END IF;

  FOR r IN
    SELECT tenant_id, vin FROM public.vehicle_listings
    WHERE lower(coalesce(condition, 'used')) IN ('used', 'cpo', 'certified')
      AND tenant_id IS NOT NULL AND coalesce(trim(vin), '') <> ''
    ORDER BY created_at DESC LIMIT _limit
  LOOP
    v_scanned := v_scanned + 1;
    BEGIN
      PERFORM public.create_draft_buyers_guide(r.tenant_id, r.vin);
      PERFORM public.create_draft_safety_inspection(r.tenant_id, r.vin);
      PERFORM public.create_draft_get_ready(r.tenant_id, r.vin);
      PERFORM public.create_draft_addendum(r.tenant_id, r.vin);
      PERFORM public.create_draft_window_sticker(r.tenant_id, r.vin);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1; v_err := left(SQLERRM, 500);
      BEGIN
        INSERT INTO public.vehicle_exceptions AS ve
          (tenant_id, vin, exception_type, severity, title, explanation, source_values, recommended_action, status)
        VALUES (r.tenant_id, r.vin, 'artifact_autogen_failed', 'high',
           'Intake draft sweep failed for this vehicle', v_err,
           jsonb_build_object('artifacts', jsonb_build_object('draft_sweep', v_err), 'source', 'intake_draft_sweep'),
           'Retry the drafts from the vehicle intake summary; the nightly sweep will also retry.', 'open')
        ON CONFLICT (tenant_id, vin, exception_type) WHERE status IN ('open', 'in_progress')
        DO UPDATE SET explanation = EXCLUDED.explanation,
          source_values = coalesce(ve.source_values, '{}'::jsonb) || EXCLUDED.source_values,
          severity = 'high';
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;

    BEGIN
      INSERT INTO public.dept_signoff_tokens (tenant_id, vehicle_listing_id, vin, ymm, department, purpose, token, status, expires_at)
      SELECT vl.tenant_id, vl.id, vl.vin, vl.ymm, 'vehicle', 'get_ready',
             encode(gen_random_bytes(24), 'hex'), 'pending', now() + interval '365 days'
      FROM public.vehicle_listings vl
      WHERE vl.tenant_id = r.tenant_id AND vl.vin = r.vin
        AND NOT EXISTS (SELECT 1 FROM public.dept_signoff_tokens t
          WHERE t.tenant_id = vl.tenant_id AND t.vin = vl.vin
            AND t.department = 'vehicle' AND t.status = 'pending' AND t.expires_at > now())
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
      PERFORM public.recompute_delivery_clearance(r.tenant_id, r.vin);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  RETURN jsonb_build_object('scanned', v_scanned, 'failed', v_failed);
END $$;
