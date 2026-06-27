-- ─────────────────────────────────────────────────────────────────────────
-- Extend the publish gate with an opt-in CT K-208 safety-inspection requirement.
--
-- enforce_prep_gate() already blocks publish without a signed prep_sign_off
-- (listing_unlocked) and a fresh, non-do-not-drive recall check, with an admin
-- bypass. This adds: when the dealer turns on settings.require_safety_inspection,
-- a used/cpo car cannot publish until it has a signed safety_inspections (K-208).
--
-- SAFE BY DEFAULT: the flag defaults off, so existing inventory is unaffected
-- until a dealer enables it. New cars are exempt (K-208 is a used-car rule).
-- The admin bypass and every existing check are preserved verbatim.
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
  v_require_k208  BOOLEAN;
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

    -- Opt-in CT K-208 gate (used/cpo only). Off by default → no disruption.
    SELECT (settings ->> 'require_safety_inspection')::BOOLEAN INTO v_require_k208
      FROM public.dealer_profiles WHERE tenant_id = NEW.tenant_id;

    IF v_require_k208 IS TRUE
       AND lower(COALESCE(NEW.condition, 'used')) IN ('used', 'cpo', 'certified') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.safety_inspections
        WHERE vin = NEW.vin
          AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
          AND status = 'signed'
      ) THEN
        RAISE EXCEPTION 'safety_inspection_gate_blocked: vehicle % has no signed K-208 safety inspection',
          NEW.vin USING ERRCODE = 'check_violation';
      END IF;
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
