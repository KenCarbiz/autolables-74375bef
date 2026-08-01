-- Lock down the equipment lifecycle functions.
REVOKE ALL ON FUNCTION public.run_equipment_proof_sweep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_overdue_equipment_proofs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_verified_equipment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_equipment_proof_sweep() TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_overdue_equipment_proofs() TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_verified_equipment() TO service_role;

REVOKE ALL ON FUNCTION public.log_equipment_status_change(uuid, text, uuid, text, text, text, text, text, numeric, boolean, text, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.equipment_has_verified_proof(text, text, text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.set_equipment_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_status(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.flag_addendum_revision(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_addendum_revision(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.flag_addendum_revision(_addendum_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.addendums a
     SET revision_required_at = now(), revision_reason = _reason
   WHERE a.id = _addendum_id
     AND a.customer_signed_at IS NOT NULL
     AND a.revision_required_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.tenant_members m
        WHERE m.tenant_id = a.tenant_id
          AND m.user_id = (SELECT auth.uid())
          AND m.accepted_at IS NOT NULL
     );
END $$;

REVOKE ALL ON FUNCTION public.flag_addendum_revision(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_addendum_revision(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_addendum_item_projection()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.item_type := CASE NEW.customer_status
    WHEN 'pre_installed'    THEN 'installed'
    WHEN 'included_benefit' THEN 'benefit'
    ELSE 'available_upgrade'
  END;
  NEW.is_installed := NEW.customer_status = 'pre_installed';
  NEW.is_included  := NEW.customer_status = 'included_benefit';
  IF NEW.external_ref IS NULL THEN NEW.external_ref := NEW.id::text; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.protect_signed_addendum()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.customer_signed_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.products_snapshot IS DISTINCT FROM OLD.products_snapshot
     OR NEW.dealer_snapshot IS DISTINCT FROM OLD.dealer_snapshot
     OR NEW.frozen_snapshot IS DISTINCT FROM OLD.frozen_snapshot
     OR NEW.total_installed IS DISTINCT FROM OLD.total_installed
     OR NEW.total_with_optional IS DISTINCT FROM OLD.total_with_optional
     OR NEW.selling_price IS DISTINCT FROM OLD.selling_price
     OR NEW.optional_selections IS DISTINCT FROM OLD.optional_selections
     OR NEW.customer_signature_data IS DISTINCT FROM OLD.customer_signature_data
     OR NEW.customer_signed_at IS DISTINCT FROM OLD.customer_signed_at
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'signed addendum % is immutable; create a revision instead', OLD.id;
  END IF;
  RETURN NEW;
END $$;