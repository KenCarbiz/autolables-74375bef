-- ──────────────────────────────────────────────────────────────────────
-- Extend the publish gate: an OPEN recall service task (auto-raised when an
-- open recall is detected) blocks publish until the service department records
-- one of the three approved outcomes. Additive to the existing prep + recall-
-- freshness gates; admins still bypass. Recreates enforce_prep_gate in full.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_prep_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_unlocked      BOOLEAN;
  v_do_not_drive  BOOLEAN;
  v_checked_at    TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN

    -- Admins bypass all gates (they are responsible for overrides).
    IF public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;

    -- a) prep-gate: VIN must have a signed prep_sign_off with listing_unlocked=true
    SELECT listing_unlocked INTO v_unlocked
      FROM public.prep_sign_offs
      WHERE vin = NEW.vin
        AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
        AND listing_unlocked = true
      ORDER BY signed_at DESC NULLS LAST, created_at DESC
      LIMIT 1;

    IF v_unlocked IS NOT TRUE THEN
      RAISE EXCEPTION 'prep_gate_blocked: vehicle % has no signed prep_sign_off with listing_unlocked=true',
        NEW.vin
        USING ERRCODE = 'check_violation';
    END IF;

    -- b) recall-gate: do-not-drive requires an override; recall_check must be fresh.
    v_do_not_drive := COALESCE((NEW.recall_check ->> 'do_not_drive')::BOOLEAN, false);
    v_checked_at   := (NEW.recall_check ->> 'checked_at')::TIMESTAMPTZ;

    IF v_do_not_drive AND NEW.recall_override_by IS NULL THEN
      RAISE EXCEPTION 'recall_gate_blocked: vehicle % has an active do-not-drive recall; admin override required',
        NEW.vin
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_checked_at IS NULL OR v_checked_at < now() - INTERVAL '30 days' THEN
      RAISE EXCEPTION 'recall_gate_blocked: NHTSA recall check missing or stale for vehicle %; refresh before publish',
        NEW.vin
        USING ERRCODE = 'check_violation';
    END IF;

    -- c) recall-service-gate: an open recall must be reviewed by the service
    --    department (one of the three approved outcomes) before publish.
    IF EXISTS (
      SELECT 1 FROM public.recall_service_tasks t
      WHERE t.vehicle_listing_id = NEW.id
        AND t.status = 'open_review'
    ) THEN
      RAISE EXCEPTION 'recall_gate_blocked: vehicle % has an open recall awaiting service review',
        NEW.vin
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
