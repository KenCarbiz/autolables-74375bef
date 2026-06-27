-- ─────────────────────────────────────────────────────────────────────────
-- NOTE (revised 2026-06-27): the K-208 / get-ready requirement does NOT gate
-- PUBLISH. Vehicles auto-publish to the Passport with no requirements so they're
-- shoppable immediately. The get-ready gate moves to DEAL FINALIZATION (the
-- disclosure signing) — see the finalization-gate migration.
--
-- This migration therefore restores enforce_prep_gate() to its original publish
-- behavior (prep_sign_off + recall checks, admin bypass) with NO K-208 clause.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_prep_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unlocked      BOOLEAN;
  v_do_not_drive  BOOLEAN;
  v_checked_at    TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN

    IF public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;

    SELECT listing_unlocked INTO v_unlocked
      FROM public.prep_sign_offs
      WHERE vin = NEW.vin
        AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
        AND listing_unlocked = true
      ORDER BY signed_at DESC NULLS LAST, created_at DESC
      LIMIT 1;

    IF v_unlocked IS NOT TRUE THEN
      RAISE EXCEPTION 'prep_gate_blocked: vehicle % has no signed prep_sign_off with listing_unlocked=true',
        NEW.vin USING ERRCODE = 'check_violation';
    END IF;

    v_do_not_drive := COALESCE((NEW.recall_check ->> 'do_not_drive')::BOOLEAN, false);
    v_checked_at   := (NEW.recall_check ->> 'checked_at')::TIMESTAMPTZ;

    IF v_do_not_drive AND NEW.recall_override_by IS NULL THEN
      RAISE EXCEPTION 'recall_gate_blocked: vehicle % has an active do-not-drive recall; admin override required',
        NEW.vin USING ERRCODE = 'check_violation';
    END IF;

    IF v_checked_at IS NULL OR v_checked_at < now() - INTERVAL '30 days' THEN
      RAISE EXCEPTION 'recall_gate_blocked: NHTSA recall check missing or stale for vehicle %; refresh before publish',
        NEW.vin USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
