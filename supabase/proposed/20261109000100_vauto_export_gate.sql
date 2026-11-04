-- PROPOSED, NOT APPLIED. Needs Ken's approval before it runs anywhere.
--
-- Server-side enforcement for the vAuto description export. The admin screen
-- shows the same decision, but nothing it does can approve or release text:
--
--   description_store_disclosures   legal-reviewed disclosure per store and
--                                    fee basis: pending_legal_review ->
--                                    approved -> retired. Only counsel-reviewed
--                                    wording with plain-text format accepted
--                                    can be approved.
--   description_export_checks       the gate decision recorded by the
--                                    description-export function
--                                    (service_role only), with a state
--                                    fingerprint computed here, not sent in.
--   description_export_approvals    a human approval of one passed check.
--                                    The insert trigger re-proves every
--                                    condition, so no RPC, service job or
--                                    direct insert can approve a failing text.
--   vauto_export_sql_blockers()     an independent SQL re-check of the hard
--                                    rules (3,921 characters, single line,
--                                    ASCII, approved disclosure at the end with
--                                    the vehicle's own fee, price
--                                    reconciliation, no price outside the
--                                    disclosure, no open blocking evidence).
--   export_vauto_description()      the only route that returns vAuto text,
--                                    and only under a still-valid approval.
--   record_description_output_use() now refuses the vauto channel, and a
--                                    trigger on description_deliveries refuses
--                                    a recorded/queued/delivered vauto row
--                                    without a valid approval. The orchestrator's
--                                    skipped/unavailable rows are unaffected.
--
-- A changed price, fee, fee basis, disclosure, text or evidence changes the
-- fingerprint, which voids every earlier check and approval.
--
-- Depends on: description engine tables, dealer_profiles, dealer_stores and
-- vehicle_listings.owning_store_id (drizzle 0006), has_description_authority.
-- Gate version string must equal VAUTO_GATE_VERSION in
-- supabase/functions/_shared/vauto-export-gate.ts (a vitest checks it).
-- Rollback: 20261109000100_vauto_export_gate.rollback.sql.

-- ── Disclosures ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_store_disclosures (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id                    uuid        REFERENCES public.dealer_stores(id) ON DELETE CASCADE,
  basis                       text        NOT NULL CHECK (basis IN ('includes_fee','before_fee')),
  template                    text        NOT NULL CHECK (length(trim(template)) BETWEEN 20 AND 1200),
  version                     integer     NOT NULL CHECK (version > 0),
  status                      text        NOT NULL DEFAULT 'pending_legal_review'
                                CHECK (status IN ('draft','pending_legal_review','approved','retired')),
  legal_reviewed_by           text,
  legal_reviewed_at           timestamptz,
  legal_reference             text,
  legal_recorded_by           uuid,
  plain_text_format_accepted  boolean     NOT NULL DEFAULT false,
  approved_by                 uuid,
  approved_at                 timestamptz,
  created_by                  uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_store_disclosures_approved_ready CHECK (
    status <> 'approved' OR (legal_reviewed_by IS NOT NULL AND legal_reviewed_at IS NOT NULL
      AND plain_text_format_accepted AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_description_store_disclosures_version
  ON public.description_store_disclosures (tenant_id, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), basis, version);
CREATE UNIQUE INDEX IF NOT EXISTS uq_description_store_disclosures_approved
  ON public.description_store_disclosures (tenant_id, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), basis)
  WHERE status = 'approved';

-- ── Checks and approvals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_export_checks (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel_version_id  uuid        NOT NULL REFERENCES public.description_channel_versions(id) ON DELETE CASCADE,
  channel             text        NOT NULL,
  ok                  boolean     NOT NULL,
  reasons             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  counts              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  gate_version        text        NOT NULL,
  fingerprint         text        NOT NULL,
  sql_blockers        text[]      NOT NULL DEFAULT '{}',
  disclosure_id       uuid        REFERENCES public.description_store_disclosures(id) ON DELETE SET NULL,
  requested_by        uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_export_checks_cv ON public.description_export_checks (channel_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.description_export_approvals (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel_version_id  uuid        NOT NULL REFERENCES public.description_channel_versions(id) ON DELETE CASCADE,
  check_id            uuid        NOT NULL UNIQUE REFERENCES public.description_export_checks(id) ON DELETE CASCADE,
  fingerprint         text        NOT NULL,
  approved_by         uuid        NOT NULL,
  note                text,
  revoked_at          timestamptz,
  revoked_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_export_approvals_cv ON public.description_export_approvals (channel_version_id) WHERE revoked_at IS NULL;

ALTER TABLE public.description_store_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.description_export_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.description_export_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "description disclosures members read" ON public.description_store_disclosures;
CREATE POLICY "description disclosures members read"
  ON public.description_store_disclosures FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
DROP POLICY IF EXISTS "description export checks members read" ON public.description_export_checks;
CREATE POLICY "description export checks members read"
  ON public.description_export_checks FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
DROP POLICY IF EXISTS "description export approvals members read" ON public.description_export_approvals;
CREATE POLICY "description export approvals members read"
  ON public.description_export_approvals FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

REVOKE ALL ON public.description_store_disclosures, public.description_export_checks, public.description_export_approvals FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.description_store_disclosures, public.description_export_checks, public.description_export_approvals FROM authenticated;
GRANT SELECT ON public.description_store_disclosures, public.description_export_checks, public.description_export_approvals TO authenticated;
-- The service role reads; it never writes approvals (the trigger below refuses
-- a write without a signed-in approver) and writes checks only through the RPC.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.description_export_approvals, public.description_export_checks, public.description_store_disclosures FROM service_role;
GRANT SELECT ON public.description_store_disclosures, public.description_export_checks, public.description_export_approvals TO service_role;

-- ── Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vauto_gate_version() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'vauto_gate_2'::text $$;

CREATE OR REPLACE FUNCTION public.description_configured_boolean(_v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _v IS NULL OR jsonb_typeof(_v) = 'null' THEN NULL
    WHEN jsonb_typeof(_v) = 'boolean' THEN _v::text::boolean
    WHEN jsonb_typeof(_v) = 'string' AND lower(trim(_v #>> '{}')) = 'true' THEN true
    WHEN jsonb_typeof(_v) = 'string' AND lower(trim(_v #>> '{}')) = 'false' THEN false
    ELSE NULL END $$;

-- Same rule as resolveFeeBasis (feeBasis.ts / vauto-export-gate.ts).
CREATE OR REPLACE FUNCTION public.description_fee_basis(_settings jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_has_inc boolean := _settings ? 'advertised_includes_doc_fee' AND jsonb_typeof(_settings->'advertised_includes_doc_fee') <> 'null';
  v_has_exc boolean := _settings ? 'advertised_excludes_doc_fee' AND jsonb_typeof(_settings->'advertised_excludes_doc_fee') <> 'null';
  v_inc boolean := public.description_configured_boolean(_settings->'advertised_includes_doc_fee');
  v_exc boolean := public.description_configured_boolean(_settings->'advertised_excludes_doc_fee');
BEGIN
  IF _settings IS NULL OR jsonb_typeof(_settings) <> 'object' THEN RETURN 'unconfigured'; END IF;
  IF (v_has_inc AND v_inc IS NULL) OR (v_has_exc AND v_exc IS NULL) THEN RETURN 'unconfigured'; END IF;
  IF v_inc IS NOT NULL AND v_exc IS NOT NULL AND v_inc = v_exc THEN RETURN 'conflict'; END IF;
  IF v_inc IS NOT NULL THEN RETURN CASE WHEN v_inc THEN 'includes_fee' ELSE 'before_fee' END; END IF;
  IF v_exc IS NOT NULL THEN RETURN CASE WHEN v_exc THEN 'before_fee' ELSE 'includes_fee' END; END IF;
  RETURN 'unconfigured';
END $$;

CREATE OR REPLACE FUNCTION public.description_money(_n numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _n IS NULL THEN NULL
    WHEN round(_n, 2) = trunc(_n) THEN '$' || to_char(trunc(_n), 'FM999,999,999,990')
    ELSE '$' || to_char(round(_n, 2), 'FM999,999,999,990.00') END $$;

CREATE OR REPLACE FUNCTION public.description_render_disclosure(_template text, _fee numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(CASE WHEN _fee IS NULL THEN _template ELSE replace(_template, '{conveyance_fee}', public.description_money(_fee)) END) $$;

-- The approved disclosure for a vehicle: its owning store's row first, then
-- the dealership-wide row (store_id NULL), for the dealership's fee basis.
CREATE OR REPLACE FUNCTION public.description_disclosure_for(_tenant_id uuid, _store_id uuid, _basis text)
RETURNS public.description_store_disclosures LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.* FROM public.description_store_disclosures d
   WHERE d.tenant_id = _tenant_id AND d.basis = _basis AND d.status = 'approved'
     AND (d.store_id = _store_id OR d.store_id IS NULL)
   ORDER BY (d.store_id IS NULL), d.version DESC LIMIT 1 $$;

-- Everything the decision depends on. Any change voids earlier checks.
CREATE OR REPLACE FUNCTION public.vauto_export_state_fingerprint(_channel_version_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cv public.description_channel_versions%ROWTYPE;
  v_case public.description_cases%ROWTYPE;
  v_vl public.vehicle_listings%ROWTYPE;
  v_settings jsonb;
  v_disc public.description_store_disclosures%ROWTYPE;
  v_exc integer; v_find integer;
BEGIN
  SELECT * INTO v_cv FROM public.description_channel_versions WHERE id = _channel_version_id;
  IF v_cv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_case FROM public.description_cases WHERE id = v_cv.description_case_id;
  SELECT * INTO v_vl FROM public.vehicle_listings WHERE id = v_case.vehicle_id;
  SELECT coalesce(settings, '{}'::jsonb) INTO v_settings FROM public.dealer_profiles WHERE tenant_id = v_cv.tenant_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_disc := public.description_disclosure_for(v_cv.tenant_id, v_vl.owning_store_id, public.description_fee_basis(v_settings));
  SELECT count(*) INTO v_exc FROM public.description_exceptions
   WHERE description_case_id = v_case.id AND blocking AND status IN ('open','in_progress') AND (channel IS NULL OR channel = v_cv.channel);
  SELECT count(*) INTO v_find FROM public.description_validation_results
   WHERE description_case_id = v_case.id AND blocking AND status = 'open'
     AND (channel_version_id = v_cv.id OR (channel_version_id IS NULL AND version_id = v_cv.master_version_id));
  RETURN md5(concat_ws('|', public.vauto_gate_version(), v_cv.id, md5(v_cv.content), v_cv.channel, v_cv.master_version_id,
    v_cv.potentially_stale, v_case.current_master_version_id, v_case.potentially_stale,
    v_vl.id, v_vl.owning_store_id, v_vl.price, v_vl.doc_fee, v_vl.advertised_price_before_doc, v_vl.website_sale_price,
    v_settings->'advertised_includes_doc_fee', v_settings->'advertised_excludes_doc_fee',
    v_settings->'doc_fee_enabled', v_settings->'doc_fee_amount',
    v_disc.id, v_disc.version, v_disc.status, md5(coalesce(v_disc.template, '')), v_exc, v_find));
END $$;

-- Independent of the TypeScript gate: rules SQL can prove on its own.
CREATE OR REPLACE FUNCTION public.vauto_export_sql_blockers(_channel_version_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cv public.description_channel_versions%ROWTYPE;
  v_case public.description_cases%ROWTYPE;
  v_vl public.vehicle_listings%ROWTYPE;
  v_settings jsonb;
  v_basis text;
  v_disc public.description_store_disclosures%ROWTYPE;
  v_disclosure text;
  v_body text;
  v_fee numeric;
  v_cfg_fee numeric;
  v_b text[] := '{}';
BEGIN
  SELECT * INTO v_cv FROM public.description_channel_versions WHERE id = _channel_version_id;
  IF v_cv.id IS NULL THEN RETURN ARRAY['CHANNEL_VERSION_NOT_FOUND']; END IF;
  IF v_cv.channel <> 'vauto' THEN RETURN ARRAY['NOT_VAUTO_CHANNEL']; END IF;
  SELECT * INTO v_case FROM public.description_cases WHERE id = v_cv.description_case_id;
  SELECT * INTO v_vl FROM public.vehicle_listings WHERE id = v_case.vehicle_id;
  SELECT coalesce(settings, '{}'::jsonb) INTO v_settings FROM public.dealer_profiles WHERE tenant_id = v_cv.tenant_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);

  IF v_cv.potentially_stale OR v_case.potentially_stale THEN v_b := v_b || 'EVIDENCE_STALE'::text; END IF;
  IF v_case.current_master_version_id IS DISTINCT FROM v_cv.master_version_id THEN v_b := v_b || 'NOT_CURRENT_VERSION'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.description_exceptions WHERE description_case_id = v_case.id AND blocking
             AND status IN ('open','in_progress') AND (channel IS NULL OR channel = v_cv.channel)) THEN
    v_b := v_b || 'EVIDENCE_BLOCKING_EXCEPTION'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.description_validation_results WHERE description_case_id = v_case.id AND blocking AND status = 'open'
             AND (channel_version_id = v_cv.id OR (channel_version_id IS NULL AND version_id = v_cv.master_version_id))) THEN
    v_b := v_b || 'EVIDENCE_BLOCKING_FINDING'::text;
  END IF;

  IF char_length(v_cv.content) <> 3921 THEN v_b := v_b || 'CHARACTER_COUNT'::text; END IF;
  IF v_cv.content ~ '[\r\n]' THEN v_b := v_b || 'LINE_BREAKS'::text; END IF;
  IF v_cv.content !~ '^[ -~]*$' THEN v_b := v_b || 'NON_ASCII'::text; END IF;

  v_basis := public.description_fee_basis(v_settings);
  IF v_basis NOT IN ('includes_fee','before_fee') THEN
    v_b := v_b || ('FEE_BASIS_' || upper(v_basis));
  ELSE
    v_fee := v_vl.doc_fee;
    v_cfg_fee := CASE WHEN jsonb_typeof(v_settings->'doc_fee_amount') = 'number' THEN (v_settings->>'doc_fee_amount')::numeric END;
    IF public.description_configured_boolean(v_settings->'doc_fee_enabled') IS FALSE AND coalesce(v_fee, 0) > 0 THEN v_b := v_b || 'DOC_FEE_DISABLED_BUT_STORED'::text; END IF;
    IF v_fee IS NULL THEN v_b := v_b || 'DOC_FEE_MISSING'::text;
    ELSIF v_cfg_fee IS NOT NULL AND round(v_cfg_fee, 2) <> round(v_fee, 2) THEN v_b := v_b || 'DOC_FEE_MISMATCH'::text; END IF;
    IF v_basis = 'includes_fee' THEN
      IF v_vl.price IS NULL OR v_vl.price <= 0 THEN v_b := v_b || 'NO_PRICE'::text;
      ELSIF v_vl.advertised_price_before_doc IS NULL OR round(v_vl.advertised_price_before_doc + coalesce(v_fee, 0), 2) <> round(v_vl.price, 2) THEN
        v_b := v_b || 'PRICE_SPLIT_MISMATCH'::text;
      END IF;
      IF v_vl.website_sale_price IS NOT NULL AND round(v_vl.website_sale_price, 2) <> round(coalesce(v_vl.price, 0), 2) THEN v_b := v_b || 'SALE_PRICE_DIFFERS'::text; END IF;
    ELSE
      IF v_vl.advertised_price_before_doc IS NULL OR v_vl.advertised_price_before_doc <= 0 THEN v_b := v_b || 'NO_PRICE'::text;
      ELSIF v_vl.price IS NOT NULL AND round(v_vl.price, 2) <> round(v_vl.advertised_price_before_doc, 2) THEN v_b := v_b || 'PRICE_SPLIT_MISMATCH'::text; END IF;
    END IF;

    v_disc := public.description_disclosure_for(v_cv.tenant_id, v_vl.owning_store_id, v_basis);
    IF v_disc.id IS NULL THEN
      v_b := v_b || 'DISCLOSURE_NOT_APPROVED'::text;
    ELSE
      v_disclosure := public.description_render_disclosure(v_disc.template, v_fee);
      IF v_disclosure ~ '\{[a-z_]+\}' THEN v_b := v_b || 'DISCLOSURE_PLACEHOLDER_UNFILLED'::text; END IF;
      IF right(v_cv.content, char_length(v_disclosure)) <> v_disclosure THEN
        v_b := v_b || 'DISCLOSURE_PLACEMENT'::text;
      ELSE
        v_body := left(v_cv.content, char_length(v_cv.content) - char_length(v_disclosure));
        IF v_body ~ '\$\s?[0-9]' THEN v_b := v_b || 'PRICE_IN_DESCRIPTION'::text; END IF;
      END IF;
    END IF;
  END IF;
  RETURN v_b;
END $$;

-- ── Disclosure lifecycle ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propose_description_disclosure(_tenant_id uuid, _store_id uuid, _basis text, _template text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_next integer; v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_description_authority(_tenant_id, 'configure') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF _store_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dealer_stores WHERE id = _store_id AND tenant_id = _tenant_id) THEN
    RAISE EXCEPTION 'store_not_in_tenant' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.description_store_disclosures
   WHERE tenant_id = _tenant_id AND store_id IS NOT DISTINCT FROM _store_id AND basis = _basis;
  INSERT INTO public.description_store_disclosures (tenant_id, store_id, basis, template, version, status, created_by)
  VALUES (_tenant_id, _store_id, _basis, trim(_template), v_next, 'pending_legal_review', v_uid) RETURNING id INTO v_id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_disclosure_proposed', 'description_disclosure', v_id::text, _tenant_id::text, v_uid,
          jsonb_build_object('store', _store_id, 'basis', _basis, 'version', v_next));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.record_description_disclosure_legal_review(
  _disclosure_id uuid, _reviewer text, _reviewed_at timestamptz, _reference text, _plain_text_format_accepted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_d public.description_store_disclosures%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.description_store_disclosures WHERE id = _disclosure_id FOR UPDATE;
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'disclosure_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_uid IS NULL OR NOT public.has_description_authority(v_d.tenant_id, 'configure') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF v_d.status <> 'pending_legal_review' THEN RAISE EXCEPTION 'not_pending_legal_review' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(_reviewer, ''))) < 3 OR _reviewed_at IS NULL OR _reviewed_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'legal_review_incomplete' USING ERRCODE = '22023';
  END IF;
  UPDATE public.description_store_disclosures
     SET legal_reviewed_by = trim(_reviewer), legal_reviewed_at = _reviewed_at, legal_reference = nullif(trim(coalesce(_reference, '')), ''),
         legal_recorded_by = v_uid, plain_text_format_accepted = coalesce(_plain_text_format_accepted, false)
   WHERE id = _disclosure_id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_disclosure_legal_review', 'description_disclosure', _disclosure_id::text, v_d.tenant_id::text, v_uid,
          jsonb_build_object('reviewer', trim(_reviewer), 'reference', _reference, 'plain_text_format_accepted', coalesce(_plain_text_format_accepted, false)));
END $$;

CREATE OR REPLACE FUNCTION public.approve_description_disclosure(_disclosure_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_d public.description_store_disclosures%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.description_store_disclosures WHERE id = _disclosure_id FOR UPDATE;
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'disclosure_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_uid IS NULL OR NOT public.has_description_authority(v_d.tenant_id, 'configure') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF v_d.status <> 'pending_legal_review' THEN RAISE EXCEPTION 'not_pending_legal_review' USING ERRCODE = '22023'; END IF;
  IF v_d.legal_reviewed_by IS NULL THEN RAISE EXCEPTION 'legal_review_missing' USING ERRCODE = '22023'; END IF;
  IF NOT v_d.plain_text_format_accepted THEN RAISE EXCEPTION 'plain_text_format_not_accepted' USING ERRCODE = '22023'; END IF;
  UPDATE public.description_store_disclosures SET status = 'retired'
   WHERE tenant_id = v_d.tenant_id AND store_id IS NOT DISTINCT FROM v_d.store_id AND basis = v_d.basis AND status = 'approved';
  UPDATE public.description_store_disclosures SET status = 'approved', approved_by = v_uid, approved_at = now() WHERE id = _disclosure_id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_disclosure_approved', 'description_disclosure', _disclosure_id::text, v_d.tenant_id::text, v_uid,
          jsonb_build_object('store', v_d.store_id, 'basis', v_d.basis, 'version', v_d.version));
END $$;

-- ── Checks ────────────────────────────────────────────────────────────────
-- Called only by the description-export function (service role) after it
-- ran decideVautoExport. The fingerprint and SQL blockers are computed here;
-- a check that SQL disagrees with is stored as failed.
CREATE OR REPLACE FUNCTION public.record_vauto_export_check(
  _channel_version_id uuid, _ok boolean, _reasons jsonb, _counts jsonb, _gate_version text, _requested_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cv public.description_channel_versions%ROWTYPE;
  v_vl_store uuid;
  v_blockers text[];
  v_ok boolean;
  v_id uuid;
  v_disc uuid;
BEGIN
  SELECT * INTO v_cv FROM public.description_channel_versions WHERE id = _channel_version_id;
  IF v_cv.id IS NULL THEN RAISE EXCEPTION 'channel_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _requested_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_cv.tenant_id AND user_id = _requested_by AND accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'requester_not_member' USING ERRCODE = '42501';
  END IF;
  v_blockers := public.vauto_export_sql_blockers(_channel_version_id);
  v_ok := coalesce(_ok, false) AND _gate_version = public.vauto_gate_version() AND coalesce(array_length(v_blockers, 1), 0) = 0;
  SELECT vl.owning_store_id INTO v_vl_store FROM public.description_cases c JOIN public.vehicle_listings vl ON vl.id = c.vehicle_id WHERE c.id = v_cv.description_case_id;
  SELECT (public.description_disclosure_for(v_cv.tenant_id, v_vl_store,
           public.description_fee_basis((SELECT coalesce(settings, '{}'::jsonb) FROM public.dealer_profiles WHERE tenant_id = v_cv.tenant_id)))).id INTO v_disc;
  INSERT INTO public.description_export_checks (tenant_id, channel_version_id, channel, ok, reasons, counts, gate_version, fingerprint, sql_blockers, disclosure_id, requested_by)
  VALUES (v_cv.tenant_id, v_cv.id, v_cv.channel, v_ok, coalesce(_reasons, '[]'::jsonb), coalesce(_counts, '{}'::jsonb), coalesce(_gate_version, ''),
          public.vauto_export_state_fingerprint(v_cv.id), v_blockers, v_disc, _requested_by)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('check_id', v_id, 'ok', v_ok, 'sql_blockers', to_jsonb(v_blockers));
END $$;

-- ── Approvals ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.description_export_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_check public.description_export_checks%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL
       AND (NEW.channel_version_id, NEW.check_id, NEW.fingerprint, NEW.approved_by, NEW.tenant_id) = (OLD.channel_version_id, OLD.check_id, OLD.fingerprint, OLD.approved_by, OLD.tenant_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'export_approvals_are_append_only' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'approval_requires_signed_in_approver' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_check FROM public.description_export_checks WHERE id = NEW.check_id;
  IF v_check.id IS NULL OR v_check.channel_version_id <> NEW.channel_version_id OR v_check.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'check_mismatch' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_description_authority(NEW.tenant_id, 'approve') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF NOT v_check.ok THEN RAISE EXCEPTION 'check_failed' USING ERRCODE = '22023'; END IF;
  IF v_check.created_at < now() - interval '15 minutes' THEN RAISE EXCEPTION 'check_expired' USING ERRCODE = '22023'; END IF;
  IF v_check.gate_version <> public.vauto_gate_version() THEN RAISE EXCEPTION 'gate_version_changed' USING ERRCODE = '22023'; END IF;
  IF v_check.fingerprint IS DISTINCT FROM public.vauto_export_state_fingerprint(NEW.channel_version_id) THEN
    RAISE EXCEPTION 'state_changed_since_check' USING ERRCODE = '40001';
  END IF;
  IF coalesce(array_length(public.vauto_export_sql_blockers(NEW.channel_version_id), 1), 0) > 0 THEN
    RAISE EXCEPTION 'sql_blockers_present' USING ERRCODE = '22023';
  END IF;
  NEW.approved_by := v_uid;
  NEW.fingerprint := v_check.fingerprint;
  NEW.revoked_at := NULL;
  NEW.revoked_by := NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_description_export_approval_guard ON public.description_export_approvals;
CREATE TRIGGER trg_description_export_approval_guard
  BEFORE INSERT OR UPDATE ON public.description_export_approvals
  FOR EACH ROW EXECUTE FUNCTION public.description_export_approval_guard();

CREATE OR REPLACE FUNCTION public.approve_vauto_export(_check_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_check public.description_export_checks%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_check FROM public.description_export_checks WHERE id = _check_id;
  IF v_check.id IS NULL THEN RAISE EXCEPTION 'check_not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.description_export_approvals (tenant_id, channel_version_id, check_id, fingerprint, approved_by, note)
  VALUES (v_check.tenant_id, v_check.channel_version_id, v_check.id, v_check.fingerprint, coalesce((SELECT auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid), _note)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_vauto_export_approved', 'description_channel_version', v_check.channel_version_id::text, v_check.tenant_id::text, (SELECT auth.uid()),
          jsonb_build_object('check_id', _check_id, 'approval_id', v_id, 'gate_version', v_check.gate_version));
  RETURN jsonb_build_object('approval_id', v_id);
END $$;

-- A still-valid approval for this channel version, or NULL.
CREATE OR REPLACE FUNCTION public.vauto_valid_approval(_channel_version_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id FROM public.description_export_approvals a
   WHERE a.channel_version_id = _channel_version_id AND a.revoked_at IS NULL
     AND a.fingerprint = public.vauto_export_state_fingerprint(_channel_version_id)
     AND coalesce(array_length(public.vauto_export_sql_blockers(_channel_version_id), 1), 0) = 0
   ORDER BY a.created_at DESC LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.export_vauto_description(_channel_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_cv public.description_channel_versions%ROWTYPE; v_approval uuid;
BEGIN
  SELECT * INTO v_cv FROM public.description_channel_versions WHERE id = _channel_version_id;
  IF v_cv.id IS NULL THEN RAISE EXCEPTION 'channel_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_cv.tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_approval := public.vauto_valid_approval(_channel_version_id);
  IF v_approval IS NULL THEN RAISE EXCEPTION 'export_not_approved' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.description_deliveries (tenant_id, vehicle_id, description_case_id, version_id, channel_version_id, destination,
    delivery_mode, connector_status, status, idempotency_key, response_metadata)
  VALUES (v_cv.tenant_id, v_cv.vehicle_id, v_cv.description_case_id, v_cv.master_version_id, v_cv.id, 'vauto',
    'export_only', 'export_only', 'recorded', v_cv.id::text || ':vauto_export:' || v_approval::text || ':' || v_uid::text,
    jsonb_build_object('approval_id', v_approval, 'note', 'Operator exported approved vAuto text. No automated delivery was performed.'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_vauto_exported', 'description_channel_version', v_cv.id::text, v_cv.tenant_id::text, v_uid, jsonb_build_object('approval_id', v_approval));
  RETURN jsonb_build_object('content', v_cv.content, 'approval_id', v_approval, 'characters', char_length(v_cv.content));
END $$;

-- ── Close the other routes ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.description_delivery_vauto_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cv uuid;
BEGIN
  IF NEW.destination IS DISTINCT FROM 'vauto' OR NEW.status IN ('skipped','unavailable','failed') THEN RETURN NEW; END IF;
  v_cv := coalesce(NEW.channel_version_id,
    (SELECT id FROM public.description_channel_versions WHERE master_version_id = NEW.version_id AND channel = 'vauto'));
  IF v_cv IS NULL OR public.vauto_valid_approval(v_cv) IS NULL THEN
    RAISE EXCEPTION 'vauto_delivery_requires_valid_export_approval' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_description_delivery_vauto_guard ON public.description_deliveries;
CREATE TRIGGER trg_description_delivery_vauto_guard
  BEFORE INSERT OR UPDATE OF status, destination, channel_version_id, version_id ON public.description_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.description_delivery_vauto_guard();

-- Same body as 20260727225826 plus the vauto refusal.
CREATE OR REPLACE FUNCTION public.record_description_output_use(
  p_version_id  uuid,
  p_channel     text,
  p_action      text,
  p_destination text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_ver   public.description_versions%ROWTYPE;
  v_ok    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_action NOT IN ('saved_to_vehicle','exported','copied') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_action');
  END IF;
  IF lower(coalesce(p_channel, '')) = 'vauto' OR lower(coalesce(p_destination, '')) = 'vauto' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'use_export_vauto_description');
  END IF;
  SELECT * INTO v_ver FROM public.description_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'version_not_found');
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_ver.tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL
  ) INTO v_ok;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  INSERT INTO public.description_deliveries (
    tenant_id, vehicle_id, description_case_id, version_id, destination,
    delivery_mode, connector_status, status, idempotency_key, response_metadata
  ) VALUES (
    v_ver.tenant_id, v_ver.vehicle_id, v_ver.description_case_id, p_version_id,
    COALESCE(p_destination, p_channel, 'manual_export'),
    'export_only', 'export_only', 'recorded',
    p_version_id::text || ':' || p_action || ':' || COALESCE(p_channel,'master') || ':' || v_uid::text,
    jsonb_build_object('action', p_action, 'channel', p_channel,
                       'note', 'Operator took a copy of a stored version. No delivery was performed.')
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('description_' || p_action, 'description_version', p_version_id, v_ver.tenant_id,
          jsonb_build_object('channel', p_channel, 'version_number', v_ver.version_number,
                             'destination', p_destination));
  RETURN jsonb_build_object('ok', true, 'version_id', p_version_id,
                            'version_number', v_ver.version_number, 'action', p_action);
END;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.vauto_export_state_fingerprint(uuid), public.vauto_export_sql_blockers(uuid), public.vauto_valid_approval(uuid),
  public.description_disclosure_for(uuid, uuid, text), public.record_vauto_export_check(uuid, boolean, jsonb, jsonb, text, uuid),
  public.propose_description_disclosure(uuid, uuid, text, text), public.record_description_disclosure_legal_review(uuid, text, timestamptz, text, boolean),
  public.approve_description_disclosure(uuid), public.approve_vauto_export(uuid, text), public.export_vauto_description(uuid),
  public.description_export_approval_guard(), public.description_delivery_vauto_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vauto_export_state_fingerprint(uuid), public.vauto_export_sql_blockers(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_vauto_export_check(uuid, boolean, jsonb, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.propose_description_disclosure(uuid, uuid, text, text), public.record_description_disclosure_legal_review(uuid, text, timestamptz, text, boolean),
  public.approve_description_disclosure(uuid), public.approve_vauto_export(uuid, text), public.export_vauto_description(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.record_description_output_use(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_description_output_use(uuid, text, text, text) TO authenticated;
