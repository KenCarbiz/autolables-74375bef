-- Used-vehicle window sticker: finish the lane.
--
-- create_draft_window_sticker has been filing a metadata-only DRAFT at ingest
-- since 20260726020000 — no PDF, no artifact, and no transition out of draft.
-- Nothing rendered it and nothing published it, so on the reference tenant all
-- 64 `window` rows sat at draft with a null pdf_url. generate-vehicle-forms now
-- renders and files that sheet (kind "window") and publishes it, so the two
-- things this migration owes it are:
--
--   1. the stub must exist for every used vehicle, including the ones whose
--      feed writes "pre-owned" rather than "used" — those fell out of every
--      used-vehicle document path, not just this one; and
--   2. the stub's snapshot must stop telling the dealer to go and build the
--      sticker by hand, because the renderer now does it on ingest.
--
-- What this migration deliberately does NOT change: create_draft_buyers_guide
-- and create_draft_safety_inspection. Both keep drafting exactly as they do
-- today, including the state-by-state warranty ladder the Guide depends on.
--
-- Publishing is decided in generate-vehicle-forms, per document:
--   window        publishes itself (evaluateUsedStickerAutoPublish);
--   buyers_guide  publishes when its warranty box was DETERMINED — forced by
--                 the operating state, selected by a named statute, or set by
--                 the dealership's configured default — and holds only when it
--                 fell through to a bare as-is nobody chose
--                 (evaluateBuyersGuideAutoPublish);
--   k208          never publishes from here. It is dealer-only until service
--                 signs the inspection, and enforce_k208_publish_requires_
--                 execution (20260726130000) fails closed on any attempt.

-- The condition vocabulary every used-vehicle document agrees on. Mirrors
-- classifyCondition in src/lib/documents/families.ts and USED_CONDITIONS in
-- generate-vehicle-forms.
CREATE OR REPLACE FUNCTION public.is_used_condition(p_condition text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
AS $function$
  SELECT lower(trim(coalesce(p_condition, 'used'))) IN
    ('used', 'cpo', 'certified', 'certified pre-owned', 'pre-owned', 'preowned');
$function$;

REVOKE ALL ON FUNCTION public.is_used_condition(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_used_condition(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_draft_window_sticker(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_cond text; v_ymm text; v_slug text; v_stock text;
  v_price numeric; v_mileage int;
  v_existing uuid; v_version int; v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;
  PERFORM public.assert_tenant_member_or_service(p_tenant_id);

  SELECT id, lower(coalesce(condition, 'used')), ymm, slug, price, mileage,
         nullif(trim(coalesce(mc_attributes->>'stock_no', '')), '')
    INTO v_listing_id, v_cond, v_ymm, v_slug, v_price, v_mileage, v_stock
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;
  -- New vehicles take the OEM Monroney (document_type 'factory_sticker',
  -- produced by factory-sticker-orchestrate), never this sheet.
  IF NOT public.is_used_condition(v_cond) THEN RETURN NULL; END IF;

  -- Stock lives on vehicle_files; mc_attributes->>'stock_no' is only a
  -- legacy fallback.
  v_stock := coalesce(
    (SELECT nullif(trim(stock_number), '') FROM public.vehicle_files
      WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1),
    v_stock);

  SELECT id INTO v_existing FROM public.generated_documents
    WHERE tenant_id = p_tenant_id AND vehicle_id = v_listing_id AND document_type = 'window'
      AND document_status NOT IN ('superseded', 'archived', 'rejected')
    ORDER BY version DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.generated_documents
    WHERE tenant_id = p_tenant_id AND vehicle_id = v_listing_id AND document_type = 'window';

  -- Race-safe like create_draft_buyers_guide: two ingest paths hitting the
  -- same brand-new VIN must resolve to ONE row, never two stacked drafts.
  BEGIN
    INSERT INTO public.generated_documents (
      tenant_id, vehicle_id, template_id, document_type, document_status, version, data_snapshot
    ) VALUES (
      p_tenant_id, v_listing_id, 'used-car-sticker', 'window', 'draft', v_version,
      jsonb_build_object(
        'source', 'ingest_autogen',
        'qr_slug', v_slug,
        'vehicle', jsonb_build_object(
          'vin', v_vin, 'ymm', v_ymm, 'condition', v_cond,
          'stock_no', v_stock, 'mileage', v_mileage, 'price', v_price
        ),
        'note', 'Placeholder filed at ingest. generate-vehicle-forms renders the sheet from the saved build record and publishes it automatically; this snapshot is replaced by the rendered one.'
      )
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.generated_documents
      WHERE tenant_id = p_tenant_id AND vehicle_id = v_listing_id
        AND document_type = 'window'
        AND document_status NOT IN ('superseded', 'archived', 'rejected')
      ORDER BY version DESC LIMIT 1;
  END;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_draft_window_sticker(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_window_sticker(uuid, text) TO authenticated, service_role;

-- The nightly intake sweep used the same narrow ('used','cpo','certified')
-- list, so a "pre-owned" vehicle got no Buyers Guide, no K-208, no Get-Ready
-- and no window sticker, and nothing ever noticed.
CREATE OR REPLACE FUNCTION public.sweep_missing_intake_drafts(_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_scanned integer := 0;
  v_failed integer := 0;
  v_err text;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;

  FOR r IN
    SELECT tenant_id, vin FROM public.vehicle_listings
    WHERE public.is_used_condition(condition)
      AND tenant_id IS NOT NULL
      AND coalesce(trim(vin), '') <> ''
    LIMIT _limit
  LOOP
    v_scanned := v_scanned + 1;
    BEGIN
      PERFORM public.create_draft_buyers_guide(r.tenant_id, r.vin);
      PERFORM public.create_draft_safety_inspection(r.tenant_id, r.vin);
      PERFORM public.create_draft_get_ready(r.tenant_id, r.vin);
      PERFORM public.create_draft_addendum(r.tenant_id, r.vin);
      PERFORM public.create_draft_window_sticker(r.tenant_id, r.vin);
      PERFORM public.issue_vehicle_ready_token(r.tenant_id, r.vin);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_err := left(SQLERRM, 500);
      BEGIN
        INSERT INTO public.vehicle_exceptions AS ve
          (tenant_id, vin, exception_type, severity, title, explanation, source_values, recommended_action, status)
        VALUES
          (r.tenant_id, r.vin, 'artifact_autogen_failed', 'high',
           'Intake draft sweep failed for this vehicle',
           v_err,
           jsonb_build_object('artifacts', jsonb_build_object('draft_sweep', v_err), 'source', 'intake_draft_sweep'),
           'Retry the drafts from the vehicle intake summary; the nightly sweep will also retry.',
           'open')
        ON CONFLICT (tenant_id, vin, exception_type) WHERE status IN ('open', 'in_progress')
        DO UPDATE SET
          explanation = EXCLUDED.explanation,
          source_values = coalesce(ve.source_values, '{}'::jsonb) || EXCLUDED.source_values,
          severity = 'high';
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  RETURN jsonb_build_object('scanned', v_scanned, 'failed', v_failed);
END $$;

REVOKE ALL ON FUNCTION public.sweep_missing_intake_drafts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_missing_intake_drafts(integer) TO service_role;

-- One live window sticker per vehicle. The stub's SELECT-then-INSERT and the
-- Sticker Studio's save path both mint rows, and generate-vehicle-forms folds
-- strays back into a single row on every fill — but a vehicle that already
-- carries two live drafts today never reaches that fold cleanly. Retire the
-- extras once, keeping whichever row actually points at a file.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER w AS keeper_id,
         row_number() OVER w AS rn
  FROM public.generated_documents
  WHERE document_type = 'window'
    AND document_status IN ('draft', 'pending_approval')
  WINDOW w AS (
    PARTITION BY tenant_id, vehicle_id, document_type
    ORDER BY ((pdf_url IS NOT NULL AND pdf_url <> '')) DESC, version DESC, created_at DESC
  )
)
UPDATE public.generated_documents g
SET document_status = 'superseded',
    superseded_by = r.keeper_id,
    updated_at = now()
FROM ranked r
WHERE g.id = r.id AND r.rn > 1;