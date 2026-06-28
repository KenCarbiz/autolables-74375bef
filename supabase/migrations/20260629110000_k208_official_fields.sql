-- ─────────────────────────────────────────────────────────────────────────
-- Official CT K-208 fields the State form carries beyond the service sign-off:
--   • result_initial   — the A/B/C box the dealer initials (warranty result).
--   • buyer_*          — the buyer's printed name, signature, and signature date
--                        (added when the customer signs at deal finalization).
-- All nullable: the service department completes the inspection first; the
-- buyer side is filled later. Existing rows are unaffected.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.safety_inspections
  ADD COLUMN IF NOT EXISTS result_initial      text CHECK (result_initial IN ('A','B','C')),
  ADD COLUMN IF NOT EXISTS buyer_name          text,
  ADD COLUMN IF NOT EXISTS buyer_signature_data text,
  ADD COLUMN IF NOT EXISTS buyer_signed_at      timestamptz;

-- Stamp the buyer side of the most recent signed K-208 for a vehicle. Called
-- from the finalize/signing flow once the customer signs the disclosure, so the
-- K-208's buyer signature + date match the deal. SECURITY DEFINER: the buyer
-- signs with no login, exactly like the disclosure itself.
CREATE OR REPLACE FUNCTION public.k208_record_buyer_signature(
  _tenant_id uuid, _vin text, _buyer_name text, _buyer_signature_data text, _result_initial text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_vin text := upper(coalesce(_vin, ''));
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_args'); END IF;
  SELECT id INTO v_id FROM public.safety_inspections
    WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
    ORDER BY signed_at DESC NULLS LAST, created_at DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_inspection'); END IF;
  UPDATE public.safety_inspections SET
    buyer_name = nullif(btrim(coalesce(_buyer_name, '')), ''),
    buyer_signature_data = _buyer_signature_data,
    buyer_signed_at = now(),
    result_initial = CASE WHEN _result_initial IN ('A','B','C') THEN _result_initial ELSE result_initial END,
    updated_at = now()
  WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.k208_record_buyer_signature(uuid, text, text, text, text) TO anon, authenticated;
