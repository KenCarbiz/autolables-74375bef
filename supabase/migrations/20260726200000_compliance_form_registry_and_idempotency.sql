-- ──────────────────────────────────────────────────────────────────────
-- Compliance build — Phase 1 (template version registry) + Phase 2
-- (generation idempotency). Phase 6 (golden PDF tests) lives in
-- src/lib/compliance/formTemplates.golden.test.ts and pins the hashes
-- seeded here to the actual bytes in /public/forms.
--
-- Phase 1: compliance_form_templates — the version-of-record for every
--   official government form we fill. Each row pins one template revision
--   to its SHA-256, legal source, and effective date. generate-vehicle-forms
--   verifies the fetched template's hash against the ACTIVE row before
--   filling, so a drifted or swapped form file fails loudly instead of
--   silently producing a wrong-revision government document, and stamps the
--   registry version into each document's data_snapshot.
--
-- Phase 2: idempotency the schema can prove, not just the code paths:
--   * ONE live (draft/pending_approval) buyers_guide / k208 row per
--     (tenant, vehicle) — the invariant generate-vehicle-forms' keyed
--     upsert and the 20260724000000 dedupe already assume. Scoped to the
--     compliance types only: sticker flows (saveStickerToVehicle) insert
--     the new draft BEFORE superseding the old one, so a global index
--     would break them.
--   * ONE open (pending) K-208 per (tenant, vin) — the one-truth row
--     create_draft_safety_inspection pre-creates at ingest.
--   * signed_document_archive: byte-identical re-fills no longer append
--     duplicate archive rows.
--   * create_draft_buyers_guide: concurrent ingest can no longer error on
--     the race — the loser folds into the winner's row.
--   Verified before creation: live data has zero violations of all three
--   uniqueness rules (2026-07-26).
-- ──────────────────────────────────────────────────────────────────────

-- ── Phase 1: template version registry ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.compliance_form_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key  text NOT NULL,
  version       text NOT NULL,
  file_path     text NOT NULL,
  content_hash  text NOT NULL,
  legal_source  text NOT NULL,
  effective_from date NOT NULL,
  retired_at    timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, version)
);

-- Exactly one ACTIVE (un-retired) revision per template.
CREATE UNIQUE INDEX IF NOT EXISTS ux_compliance_form_templates_active
  ON public.compliance_form_templates (template_key)
  WHERE retired_at IS NULL;

ALTER TABLE public.compliance_form_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compliance_form_templates_read" ON public.compliance_form_templates;
CREATE POLICY "compliance_form_templates_read"
  ON public.compliance_form_templates FOR SELECT
  TO authenticated
  USING (true);
-- No INSERT/UPDATE/DELETE policies: the registry is written only via
-- migrations / service_role (which bypasses RLS).

INSERT INTO public.compliance_form_templates
  (template_key, version, file_path, content_hash, legal_source, effective_from, notes)
VALUES
  ('ftc-buyers-guide-en', '2026.07.1', '/forms/ftc-buyers-guide-en.pdf',
   '532e7887b9e5180800952ad53cc75ac43c7d84e42b2fc318ef33ae2760dd9769',
   '16 CFR Part 455 (FTC Used Car Rule), OMB 3084-0112', DATE '2026-07-01',
   'Official English Buyers Guide AcroForm. Page 1 As-Is front, page 2 Implied front, page 3 back.'),
  ('ftc-buyers-guide-es', '2026.07.1', '/forms/ftc-buyers-guide-es.pdf',
   '04c56ea52392601b9fb594ae838b95e1b3ec2513db9967a5a7d5101ccd0d3aaa',
   '16 CFR 455.5 (Spanish-language sales), Appendix B', DATE '2026-07-01',
   'Official Spanish Buyers Guide. Flat artwork (no AcroForm) — filled by measured-coordinate overlay; pages as EN.'),
  ('ct-k208', '2026.07.1', '/forms/k208-inspection.pdf',
   '95477857966141315778fc97714fe9020dc2af6adf1b8b2465268ab93274429c',
   'Conn. Gen. Stat. §14-62(g) / §42-221 — CT DMV form K-208', DATE '2026-07-01',
   'CT used-car safety inspection. Header AcroForm (VIN in 17 boxes); A/B/C determination marked by coordinate overlay.')
ON CONFLICT (template_key, version) DO NOTHING;

-- ── Phase 2: idempotency the schema enforces ──────────────────────────

-- One live compliance draft per (tenant, vehicle, type). Collapse any
-- strays first (same keeper choice as 20260724000000), then enforce.
WITH ranked AS (
  SELECT id,
    first_value(id) OVER w AS keeper_id,
    row_number()  OVER w AS rn
  FROM public.generated_documents
  WHERE document_status IN ('draft', 'pending_approval')
    AND document_type IN ('buyers_guide', 'k208')
  WINDOW w AS (
    PARTITION BY tenant_id, vehicle_id, document_type
    ORDER BY ((online_url IS NOT NULL AND online_url <> '')) DESC, version DESC, created_at DESC
  )
)
UPDATE public.generated_documents g
SET document_status = 'superseded',
    superseded_by = r.keeper_id,
    updated_at = now()
FROM ranked r
WHERE g.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_generated_documents_one_live_compliance_draft
  ON public.generated_documents (tenant_id, vehicle_id, document_type)
  WHERE document_status IN ('draft', 'pending_approval')
    AND document_type IN ('buyers_guide', 'k208');

-- One OPEN K-208 per (tenant, vin). Signed/voided history is unlimited;
-- only the pending one-truth row is unique.
CREATE UNIQUE INDEX IF NOT EXISTS ux_safety_inspections_one_pending
  ON public.safety_inspections (tenant_id, vin)
  WHERE status = 'pending';

-- Archive dedupe: a byte-identical artifact for the same entity is the
-- same archive record.
CREATE UNIQUE INDEX IF NOT EXISTS ux_signed_document_archive_unique_artifact
  ON public.signed_document_archive (tenant_id, doc_type, entity_id, content_hash);

-- create_draft_buyers_guide: identical to 20260726160000 except the INSERT
-- is race-safe — a concurrent ingest that loses the insert race returns the
-- winner's live draft instead of raising unique_violation.
CREATE OR REPLACE FUNCTION public.create_draft_buyers_guide(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_condition text; v_price numeric; v_ymm text;
  v_year int; v_make text; v_model text; v_mileage int;
  v_existing uuid; v_settings jsonb; v_state text; v_default text;
  v_price_n numeric := 0; v_miles_n int := 0; v_age int := 0;
  v_box text := 'as-is'; v_forced boolean := false;
  v_days int := 0; v_mi int := 0; v_pct int := 0; v_citation text := '';
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;
  PERFORM public.assert_tenant_member_or_service(p_tenant_id);

  SELECT id, lower(coalesce(condition, 'used')), price, ymm, mileage
    INTO v_listing_id, v_condition, v_price, v_ymm, v_mileage
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;

  IF v_condition NOT IN ('used', 'cpo', 'certified') THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.generated_documents
    WHERE tenant_id = p_tenant_id AND vehicle_id = v_listing_id AND document_type = 'buyers_guide' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT nullif(regexp_replace(coalesce(year, ''), '[^0-9]', '', 'g'), '')::int,
         make, model, mileage
    INTO v_year, v_make, v_model, v_mileage
    FROM public.vehicle_files WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  v_price_n := COALESCE(v_price, 0);
  v_miles_n := COALESCE(v_mileage, 0);
  v_age := CASE WHEN v_year IS NULL THEN 0 ELSE (date_part('year', current_date)::int - v_year) END;

  SELECT settings INTO v_settings FROM public.dealer_profiles WHERE tenant_id = p_tenant_id;
  v_state := upper(trim(coalesce(v_settings->>'doc_fee_state', v_settings->>'dealer_state', '')));
  v_default := lower(coalesce(v_settings->>'default_ftc_warranty', ''));

  CASE v_state
    WHEN 'CT' THEN
      IF v_price_n < 3000 THEN v_box := 'as-is';
      ELSIF v_year IS NOT NULL AND v_age >= 7 THEN
        v_box := 'as-is'; v_citation := 'Conn. Gen. Stat. §42-221';
      ELSIF v_price_n >= 5000 THEN v_box := 'warranty'; v_forced := true; v_days := 60; v_mi := 3000; v_pct := 100; v_citation := 'Conn. Gen. Stat. §42-221';
      ELSE v_box := 'warranty'; v_forced := true; v_days := 30; v_mi := 1500; v_pct := 100; v_citation := 'Conn. Gen. Stat. §42-221';
      END IF;
    WHEN 'MA' THEN
      IF v_miles_n >= 125000 THEN v_box := 'as-is';
      ELSIF v_miles_n < 40000 THEN v_box := 'warranty'; v_forced := true; v_days := 90; v_mi := 3750; v_pct := 100; v_citation := 'M.G.L. c. 90 §7N¼';
      ELSIF v_miles_n < 80000 THEN v_box := 'warranty'; v_forced := true; v_days := 60; v_mi := 2500; v_pct := 100; v_citation := 'M.G.L. c. 90 §7N¼';
      ELSE v_box := 'warranty'; v_forced := true; v_days := 30; v_mi := 1250; v_pct := 100; v_citation := 'M.G.L. c. 90 §7N¼';
      END IF;
    WHEN 'NY' THEN
      IF v_price_n < 1500 OR v_miles_n > 100000 THEN v_box := 'as-is';
      ELSIF v_miles_n <= 36000 THEN v_box := 'warranty'; v_forced := true; v_days := 90; v_mi := 4000; v_pct := 100; v_citation := 'NY Gen. Bus. Law §198-b';
      ELSIF v_miles_n < 80000 THEN v_box := 'warranty'; v_forced := true; v_days := 60; v_mi := 3000; v_pct := 100; v_citation := 'NY Gen. Bus. Law §198-b';
      ELSE v_box := 'warranty'; v_forced := true; v_days := 30; v_mi := 1000; v_pct := 100; v_citation := 'NY Gen. Bus. Law §198-b';
      END IF;
    WHEN 'NJ' THEN
      IF v_price_n < 3000 OR v_miles_n >= 100000 THEN v_box := 'as-is';
      ELSIF v_miles_n <= 24000 THEN v_box := 'warranty'; v_forced := true; v_days := 90; v_mi := 3000; v_pct := 100; v_citation := 'N.J.S.A. 56:8-67';
      ELSIF v_miles_n < 60000 THEN v_box := 'warranty'; v_forced := true; v_days := 60; v_mi := 2000; v_pct := 100; v_citation := 'N.J.S.A. 56:8-67';
      ELSE v_box := 'warranty'; v_forced := true; v_days := 30; v_mi := 1000; v_pct := 100; v_citation := 'N.J.S.A. 56:8-67';
      END IF;
    WHEN 'ME' THEN v_box := 'implied'; v_forced := true; v_citation := 'Maine Used Car Information Act';
    WHEN 'WI' THEN v_box := 'implied'; v_forced := true; v_citation := 'Wis. Admin. Code Trans 139';
    WHEN 'CA' THEN v_box := 'implied'; v_forced := true; v_citation := 'Song-Beverly Consumer Warranty Act, Cal. Civ. Code §1792';
    WHEN 'DC' THEN v_box := 'implied'; v_forced := true; v_citation := 'D.C. Code §28:2-314';
    WHEN 'KS' THEN v_box := 'implied'; v_forced := true; v_citation := 'Kan. Stat. Ann. §50-639';
    WHEN 'LA' THEN v_box := 'implied'; v_forced := true; v_citation := 'La. Civ. Code art. 2520 (redhibition)';
    WHEN 'MD' THEN v_box := 'implied'; v_forced := true; v_citation := 'Md. Code, Com. Law §2-316.1';
    WHEN 'MN' THEN v_box := 'implied'; v_forced := true; v_citation := 'Minn. Stat. §325G.18 (used-vehicle warranty)';
    WHEN 'MS' THEN v_box := 'implied'; v_forced := true; v_citation := 'Miss. Code Ann. §11-7-18';
    WHEN 'OR' THEN v_box := 'implied'; v_forced := true; v_citation := 'Or. Rev. Stat. §72.3160';
    WHEN 'WA' THEN v_box := 'implied'; v_forced := true; v_citation := 'Wash. Rev. Code §62A.2-316 / §46.70';
    WHEN 'RI' THEN v_box := 'implied'; v_forced := true; v_citation := 'R.I. Gen. Laws §31-5.4 (used-vehicle warranty)';
    WHEN 'VT' THEN v_box := 'implied'; v_forced := true; v_citation := 'Vt. Stat. Ann. tit. 9 §4173';
    WHEN 'WV' THEN v_box := 'implied'; v_forced := true; v_citation := 'W. Va. Code §46A-6-107';
    ELSE v_box := 'as-is';
  END CASE;

  IF v_box <> 'warranty' AND NOT v_forced THEN
    IF v_default = 'implied' THEN v_box := 'implied';
    ELSIF v_default = 'dealer' THEN v_box := 'warranty';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.generated_documents (
      tenant_id, vehicle_id, template_id, document_type, document_status, version, data_snapshot
    ) VALUES (
      p_tenant_id, v_listing_id, 'ftc-buyers-guide', 'buyers_guide', 'draft', 1,
      jsonb_build_object(
        'source', 'ingest_autogen',
        'box', v_box, 'forced', v_forced,
        'min_duration_days', v_days, 'min_miles', v_mi, 'min_pct', v_pct,
        'citation', v_citation, 'needs_verification', true,
        'operating_state', v_state, 'default_ftc_warranty', v_default,
        'vehicle', jsonb_build_object(
          'year', v_year, 'make', v_make, 'model', v_model, 'ymm', v_ymm,
          'vin', v_vin, 'mileage', v_miles_n, 'price', v_price
        ),
        'note', 'Auto-drafted at ingest from operating state + dealer default. Confirm the warranty box before publishing.'
      )
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.generated_documents
      WHERE tenant_id = p_tenant_id AND vehicle_id = v_listing_id
        AND document_type = 'buyers_guide'
        AND document_status IN ('draft', 'pending_approval')
      LIMIT 1;
  END;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_draft_buyers_guide(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_buyers_guide(uuid, text) TO authenticated, service_role;

-- create_draft_safety_inspection: identical to 20260726160000 except the
-- INSERT is race-safe against ux_safety_inspections_one_pending.
CREATE OR REPLACE FUNCTION public.create_draft_safety_inspection(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_condition text; v_ymm text; v_stock text;
  v_existing uuid; v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;
  PERFORM public.assert_tenant_member_or_service(p_tenant_id);

  SELECT id, lower(coalesce(condition,'used')), ymm
    INTO v_listing_id, v_condition, v_ymm
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;

  IF v_condition NOT IN ('used','cpo','certified') THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.safety_inspections
    WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT stock_number INTO v_stock FROM public.vehicle_files
    WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  BEGIN
    INSERT INTO public.safety_inspections
      (tenant_id, vehicle_listing_id, vin, ymm, stock_number, form_type, checklist, status)
    VALUES
      (p_tenant_id, v_listing_id, v_vin, v_ymm, v_stock, 'CT-K208', '[]'::jsonb, 'pending')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.safety_inspections
      WHERE tenant_id = p_tenant_id AND vin = v_vin AND status = 'pending'
      LIMIT 1;
  END;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_draft_safety_inspection(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_safety_inspection(uuid, text) TO authenticated, service_role;

-- ── Verification snippets (run manually; not executed by this migration) ─────
-- A. Registry seeded and unique-active:
--    SELECT template_key, version, content_hash FROM public.compliance_form_templates WHERE retired_at IS NULL;
-- B. Second live buyers_guide draft for the same vehicle is impossible:
--    INSERT INTO public.generated_documents (tenant_id, vehicle_id, document_type, document_status, version)
--    VALUES ('<t>', '<v>', 'buyers_guide', 'draft', 99);  -- => unique_violation when a live draft exists
-- C. Second pending K-208 for the same (tenant, vin) is impossible:
--    INSERT INTO public.safety_inspections (tenant_id, vin, form_type, checklist, status)
--    VALUES ('<t>', '<vin-with-pending>', 'CT-K208', '[]'::jsonb, 'pending');  -- => unique_violation
