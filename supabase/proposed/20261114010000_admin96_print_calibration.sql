-- PROPOSED (Admin 96 printing wizard). Not applied. Requires owner approval.
--
-- Closes calibration gap G4 on dealer_print_settings:
--   * UNIQUE (tenant_id, location_id) treats NULL location ids as distinct, so
--     a tenant can hold several "all rooftops" rows. Replace it with a
--     NULLS NOT DISTINCT unique index. The migration stops (does not delete)
--     if duplicates already exist, so the owner can pick the surviving row.
--   * Two safe-margin column families exist (top_/left_safe_margin_inches and
--     safe_margin_{top,right,bottom,left}_inches). The four-sided family is
--     canonical; the two legacy columns are copied across where the canonical
--     value is still the default, and kept (not dropped) so current code keeps
--     working until the wizard ships.
--   * Adds test-sheet and verification persistence so the wizard can record
--     "test sheet printed" and "calibration verified" per printer profile.
-- RLS is left unchanged here (members FOR ALL). Narrowing writes to settings
-- roles is listed in DATA-CONTRACTS.md as a separate decision, because it
-- can lock out staff who calibrate printers today.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.dealer_print_settings
    GROUP BY tenant_id, location_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'dealer_print_settings has duplicate (tenant_id, location_id) rows; resolve before applying';
  END IF;
END $$;

ALTER TABLE public.dealer_print_settings
  DROP CONSTRAINT IF EXISTS dealer_print_settings_tenant_id_location_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS dealer_print_settings_scope_unique
  ON public.dealer_print_settings (tenant_id, location_id) NULLS NOT DISTINCT;

ALTER TABLE public.dealer_print_settings
  ADD COLUMN IF NOT EXISTS safe_margin_top_inches    numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS safe_margin_right_inches  numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS safe_margin_bottom_inches numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS safe_margin_left_inches   numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS profile_name              text,
  ADD COLUMN IF NOT EXISTS test_sheet_printed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS test_sheet_printed_by     uuid,
  ADD COLUMN IF NOT EXISTS calibration_verified_at   timestamptz,
  ADD COLUMN IF NOT EXISTS calibration_verified_by   uuid,
  ADD COLUMN IF NOT EXISTS calibration_measurements  jsonb
    CHECK (calibration_measurements IS NULL OR jsonb_typeof(calibration_measurements) = 'object');

UPDATE public.dealer_print_settings
   SET safe_margin_top_inches  = top_safe_margin_inches
 WHERE safe_margin_top_inches = 0.25 AND top_safe_margin_inches IS DISTINCT FROM 0.25;
UPDATE public.dealer_print_settings
   SET safe_margin_left_inches = left_safe_margin_inches
 WHERE safe_margin_left_inches = 0.25 AND left_safe_margin_inches IS DISTINCT FROM 0.25;

COMMENT ON COLUMN public.dealer_print_settings.top_safe_margin_inches IS
  'Deprecated by Admin 96: use safe_margin_top_inches.';
COMMENT ON COLUMN public.dealer_print_settings.left_safe_margin_inches IS
  'Deprecated by Admin 96: use safe_margin_left_inches.';

CREATE OR REPLACE FUNCTION public.record_print_calibration(
  p_tenant_id    uuid,
  p_location_id  uuid,
  p_event        text,
  p_measurements jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_id  uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_event NOT IN ('test_sheet_printed', 'calibration_verified') THEN
    RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM public.dealer_print_settings
  WHERE tenant_id = p_tenant_id AND location_id IS NOT DISTINCT FROM p_location_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'print_profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_event = 'test_sheet_printed' THEN
    UPDATE public.dealer_print_settings
       SET test_sheet_printed_at = v_now, test_sheet_printed_by = v_uid,
           calibration_verified_at = NULL, calibration_verified_by = NULL,
           updated_at = v_now
     WHERE id = v_id;
  ELSE
    IF p_measurements IS NULL OR jsonb_typeof(p_measurements) <> 'object' THEN
      RAISE EXCEPTION 'measurements_required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.dealer_print_settings
       SET calibration_verified_at = v_now, calibration_verified_by = v_uid,
           calibration_measurements = p_measurements, updated_at = v_now
     WHERE id = v_id AND test_sheet_printed_at IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'test_sheet_not_printed' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('print_' || p_event, 'dealer_print_settings', v_id::text,
          coalesce(p_location_id, p_tenant_id)::text, v_uid,
          jsonb_build_object('location_id', p_location_id, 'measurements', p_measurements));
  RETURN v_now;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_print_calibration(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_print_calibration(uuid, uuid, text, jsonb) TO authenticated;

COMMIT;
