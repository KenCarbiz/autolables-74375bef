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

-- Stamp the buyer side of the most recent signed K-208, resolving tenant + VIN
-- from the customer's signing token (the anon buyer never sees a tenant_id).
-- Called at assignment BEFORE the addendum is signed: the customer's name is
-- populated, they sign, it's dated and locked — then the addendum can be signed.
-- Idempotent: a K-208 already buyer-signed is left as-is.
CREATE OR REPLACE FUNCTION public.k208_record_buyer_signature(
  _signing_token text, _buyer_name text, _buyer_signature_data text, _result_initial text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_vin text; v_id uuid; v_already timestamptz;
BEGIN
  -- Resolve the deal context from the token (addendum path, then deal token).
  SELECT tenant_id, upper(vehicle_vin) INTO v_tenant, v_vin
    FROM public.addendums WHERE signing_token::text = _signing_token LIMIT 1;
  IF v_tenant IS NULL THEN
    SELECT tenant_id, upper(vehicle_payload->>'vin') INTO v_tenant, v_vin
      FROM public.deal_signing_tokens WHERE token = _signing_token LIMIT 1;
  END IF;
  IF v_tenant IS NULL OR coalesce(v_vin, '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_deal'); END IF;

  SELECT id, buyer_signed_at INTO v_id, v_already FROM public.safety_inspections
    WHERE tenant_id = v_tenant AND vin = v_vin AND status = 'signed'
    ORDER BY signed_at DESC NULLS LAST, created_at DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_inspection'); END IF;
  IF v_already IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_signed', true, 'id', v_id); END IF;

  UPDATE public.safety_inspections SET
    buyer_name = nullif(btrim(coalesce(_buyer_name, '')), ''),
    buyer_signature_data = _buyer_signature_data,
    buyer_signed_at = now(),
    result_initial = CASE WHEN _result_initial IN ('A','B','C') THEN _result_initial ELSE result_initial END,
    updated_at = now()
  WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.k208_record_buyer_signature(text, text, text, text) TO anon, authenticated;
