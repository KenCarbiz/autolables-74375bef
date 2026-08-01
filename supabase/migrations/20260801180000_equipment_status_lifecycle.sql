-- Equipment status lifecycle.
--
-- vehicle_addendum_items is already the per-vehicle equipment record with a
-- stable uuid id, so this extends it rather than introducing a parallel table.
-- item_type stays the customer-facing projection every existing reader uses
-- (passport, signing, exporters); customer_status becomes the authoritative
-- field and a trigger keeps the legacy columns in lockstep, so nothing has to
-- migrate at once and the two can never disagree.
--
-- Adds: the three customer statuses, an internal proof workflow with a 96-hour
-- deadline, the server-side automation that expires and restores items, and a
-- guard that makes a signed addendum immutable.

-- ── 1. Columns ────────────────────────────────────────────────────────
ALTER TABLE public.vehicle_addendum_items
  ADD COLUMN IF NOT EXISTS customer_status  text,
  ADD COLUMN IF NOT EXISTS workflow_status  text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS proof_due_at     timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status_changed_by uuid,
  ADD COLUMN IF NOT EXISTS installer_name   text,
  -- Stable handle shared with get_ready_records.accessories_to_install so
  -- install work is matched by identity, never by display name.
  ADD COLUMN IF NOT EXISTS external_ref     text;

-- Backfill the authoritative field from the legacy projection before it is
-- constrained, so an existing row is never left invalid.
UPDATE public.vehicle_addendum_items
   SET customer_status = CASE item_type
         WHEN 'installed'         THEN 'pre_installed'
         WHEN 'benefit'           THEN 'included_benefit'
         ELSE 'optional'
       END
 WHERE customer_status IS NULL;

UPDATE public.vehicle_addendum_items SET external_ref = id::text WHERE external_ref IS NULL;

ALTER TABLE public.vehicle_addendum_items
  ALTER COLUMN customer_status SET DEFAULT 'optional',
  ALTER COLUMN customer_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_addendum_items_customer_status_chk') THEN
    ALTER TABLE public.vehicle_addendum_items
      ADD CONSTRAINT vehicle_addendum_items_customer_status_chk
      CHECK (customer_status IN ('pre_installed','optional','included_benefit'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_addendum_items_workflow_status_chk') THEN
    ALTER TABLE public.vehicle_addendum_items
      ADD CONSTRAINT vehicle_addendum_items_workflow_status_chk
      CHECK (workflow_status IN ('not_applicable','awaiting_proof','verified_installed','verification_overdue'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_addendum_items_proof_due
  ON public.vehicle_addendum_items (proof_due_at)
  WHERE workflow_status = 'awaiting_proof';

-- ── 2. Keep the legacy projection in lockstep ─────────────────────────
-- One record, one truth: writing customer_status rewrites item_type and the
-- boolean flags, so passport / signing / exporter reads stay correct without
-- each of them learning a new column on day one.
CREATE OR REPLACE FUNCTION public.sync_addendum_item_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_addendum_item_projection ON public.vehicle_addendum_items;
CREATE TRIGGER trg_addendum_item_projection
  BEFORE INSERT OR UPDATE OF customer_status ON public.vehicle_addendum_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_addendum_item_projection();

-- ── 3. Proof lookup ───────────────────────────────────────────────────
-- An item counts as verified when install_proofs holds a photo for it on this
-- VIN. Matching prefers the stable product/external ref and falls back to the
-- name for proofs recorded before this migration.
CREATE OR REPLACE FUNCTION public.equipment_has_verified_proof(_vin text, _name text, _ref text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.install_proofs p
     WHERE p.vehicle_vin = upper(_vin)
       AND p.photo_path IS NOT NULL
       AND (
         (_ref IS NOT NULL AND p.product_id::text = _ref)
         OR lower(coalesce(p.product_name,'')) = lower(coalesce(_name,''))
       )
  );
$$;

-- ── 4. Audit ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_equipment_status_change(
  _item_id uuid, _vin text, _tenant uuid, _name text,
  _prev_status text, _next_status text, _prev_workflow text, _next_workflow text,
  _price numeric, _automatic boolean, _source text, _actor uuid
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, details)
  VALUES (
    'equipment_status_changed', 'vehicle_addendum_item', _item_id::text, _actor,
    jsonb_build_object(
      'tenant_id', _tenant, 'vin', _vin, 'name', _name,
      'previous_status', _prev_status, 'new_status', _next_status,
      'previous_workflow_status', _prev_workflow, 'new_workflow_status', _next_workflow,
      'price', _price, 'automatic', _automatic, 'source_module', _source,
      'changed_at', now()
    )
  );
$$;

-- ── 5. Authoritative status write ─────────────────────────────────────
-- Tenant-scoped and permission-checked: the caller must be an accepted member
-- of the tenant that owns the parent addendum, so no dealership can move
-- another dealership's equipment.
CREATE OR REPLACE FUNCTION public.set_equipment_status(
  _item_id uuid, _status text, _source text DEFAULT 'sticker_studio'
) RETURNS public.vehicle_addendum_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _item public.vehicle_addendum_items;
  _head public.vehicle_addendums;
  _vin text;
  _verified boolean;
  _prev_status text;
  _prev_workflow text;
  _next_workflow text;
  _due timestamptz;
BEGIN
  IF _status NOT IN ('pre_installed','optional','included_benefit') THEN
    RAISE EXCEPTION 'invalid equipment status: %', _status;
  END IF;

  SELECT * INTO _item FROM public.vehicle_addendum_items WHERE id = _item_id;
  IF _item.id IS NULL THEN RAISE EXCEPTION 'equipment item not found'; END IF;
  SELECT * INTO _head FROM public.vehicle_addendums WHERE id = _item.vehicle_addendum_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = _head.tenant_id
       AND m.user_id = (SELECT auth.uid())
       AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not authorized for this dealership';
  END IF;

  SELECT vin INTO _vin FROM public.vehicle_listings WHERE id = _head.vehicle_id;
  _prev_status := _item.customer_status;
  _prev_workflow := _item.workflow_status;

  IF _status = 'pre_installed' THEN
    _verified := public.equipment_has_verified_proof(coalesce(_vin,''), _item.name, _item.external_ref);
    IF _verified THEN
      _next_workflow := 'verified_installed';
      _due := NULL;
    ELSE
      -- Customer status stays Pre-Installed through the verification window;
      -- only the internal workflow flags that proof is outstanding.
      _next_workflow := 'awaiting_proof';
      _due := now() + interval '96 hours';
    END IF;
  ELSE
    _next_workflow := 'not_applicable';
    _due := NULL;
  END IF;

  UPDATE public.vehicle_addendum_items
     SET customer_status = _status,
         workflow_status = _next_workflow,
         proof_due_at = _due,
         status_changed_at = now(),
         status_changed_by = (SELECT auth.uid())
   WHERE id = _item_id
   RETURNING * INTO _item;

  PERFORM public.log_equipment_status_change(
    _item_id, _vin, _head.tenant_id, _item.name,
    _prev_status, _status, _prev_workflow, _next_workflow,
    _item.price, false, _source, (SELECT auth.uid())
  );
  RETURN _item;
END $$;

REVOKE ALL ON FUNCTION public.set_equipment_status(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_equipment_status(uuid, text, text) TO authenticated;

-- ── 6. The 96-hour automation ─────────────────────────────────────────
-- Runs server-side; Sticker Studio does not need to be open. Expiry demotes an
-- unproven item to Optional (removing it from the adjusted total everywhere,
-- because every reader projects from customer_status), and restoration returns
-- it the moment valid proof lands. Get-ready history is untouched.
CREATE OR REPLACE FUNCTION public.expire_overdue_equipment_proofs()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row record; _count integer := 0;
BEGIN
  FOR _row IN
    SELECT i.id, i.name, i.price, i.external_ref, i.customer_status, i.workflow_status,
           h.tenant_id, v.vin
      FROM public.vehicle_addendum_items i
      JOIN public.vehicle_addendums h ON h.id = i.vehicle_addendum_id
      LEFT JOIN public.vehicle_listings v ON v.id = h.vehicle_id
     WHERE i.workflow_status = 'awaiting_proof'
       AND i.proof_due_at IS NOT NULL
       AND i.proof_due_at <= now()
  LOOP
    IF public.equipment_has_verified_proof(coalesce(_row.vin,''), _row.name, _row.external_ref) THEN
      UPDATE public.vehicle_addendum_items
         SET workflow_status = 'verified_installed', proof_due_at = NULL, status_changed_at = now()
       WHERE id = _row.id;
      PERFORM public.log_equipment_status_change(_row.id, _row.vin, _row.tenant_id, _row.name,
        _row.customer_status, _row.customer_status, _row.workflow_status, 'verified_installed',
        _row.price, true, 'proof_automation', NULL);
    ELSE
      UPDATE public.vehicle_addendum_items
         SET customer_status = 'optional', workflow_status = 'verification_overdue',
             proof_due_at = NULL, status_changed_at = now()
       WHERE id = _row.id;
      PERFORM public.log_equipment_status_change(_row.id, _row.vin, _row.tenant_id, _row.name,
        _row.customer_status, 'optional', _row.workflow_status, 'verification_overdue',
        _row.price, true, 'proof_automation', NULL);
    END IF;
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END $$;

-- Late proof: return the item to Pre-Installed and restore its price. Called by
-- the automation sweep and directly when a proof row lands.
CREATE OR REPLACE FUNCTION public.restore_verified_equipment()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row record; _count integer := 0;
BEGIN
  FOR _row IN
    SELECT i.id, i.name, i.price, i.external_ref, i.customer_status, i.workflow_status,
           h.tenant_id, v.vin
      FROM public.vehicle_addendum_items i
      JOIN public.vehicle_addendums h ON h.id = i.vehicle_addendum_id
      LEFT JOIN public.vehicle_listings v ON v.id = h.vehicle_id
     WHERE i.workflow_status IN ('verification_overdue','awaiting_proof')
  LOOP
    IF public.equipment_has_verified_proof(coalesce(_row.vin,''), _row.name, _row.external_ref) THEN
      UPDATE public.vehicle_addendum_items
         SET customer_status = 'pre_installed', workflow_status = 'verified_installed',
             proof_due_at = NULL, status_changed_at = now()
       WHERE id = _row.id;
      PERFORM public.log_equipment_status_change(_row.id, _row.vin, _row.tenant_id, _row.name,
        _row.customer_status, 'pre_installed', _row.workflow_status, 'verified_installed',
        _row.price, true, 'proof_automation', NULL);
      _count := _count + 1;
    END IF;
  END LOOP;
  RETURN _count;
END $$;

CREATE OR REPLACE FUNCTION public.run_equipment_proof_sweep()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.expire_overdue_equipment_proofs() + public.restore_verified_equipment();
$$;

-- Hourly sweep. Skipped cleanly when pg_cron is unavailable so the migration
-- still applies; deploy the same call as a scheduled edge function in that case.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('equipment-proof-sweep')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'equipment-proof-sweep');
    PERFORM cron.schedule('equipment-proof-sweep', '7 * * * *', 'SELECT public.run_equipment_proof_sweep();');
  END IF;
END $$;

-- ── 7. Signed documents are immutable ─────────────────────────────────
ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS revision_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision_reason      text,
  ADD COLUMN IF NOT EXISTS revised_from_id      uuid;

-- Once a customer has signed, the executed record is evidence. Any attempt to
-- rewrite its substance is rejected outright rather than silently applied; the
-- application creates a new revision instead.
CREATE OR REPLACE FUNCTION public.protect_signed_addendum()
RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_protect_signed_addendum ON public.addendums;
CREATE TRIGGER trg_protect_signed_addendum
  BEFORE UPDATE ON public.addendums
  FOR EACH ROW EXECUTE FUNCTION public.protect_signed_addendum();

-- Flag a signed document for re-signature after a material change, preserving
-- the executed version untouched.
CREATE OR REPLACE FUNCTION public.flag_addendum_revision(_addendum_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.addendums
     SET revision_required_at = now(), revision_reason = _reason
   WHERE id = _addendum_id
     AND customer_signed_at IS NOT NULL
     AND revision_required_at IS NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.flag_addendum_revision(uuid, text) TO authenticated;
