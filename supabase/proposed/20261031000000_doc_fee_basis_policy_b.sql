-- Doc fee change, policy B: one pricing contract for preview, apply and the
-- legacy recalculation. PROPOSED. Not applied to any hosted project; verified
-- only in the isolated database (scripts/db-verify/run.sh --policy-b).
--
-- Fee basis of a tenant (doc_fee_basis):
--   includes_fee  advertised_includes_doc_fee is true (or the legacy
--                 advertised_excludes_doc_fee is false), or neither is set and
--                 price_display_mode is website_sale_price, which is how the
--                 Passport already reads `price` (resolveDisplayPrice).
--   before_fee    the setting says the advertised price excludes the fee, or
--                 neither is set and the display mode is advertised_before_doc.
--   conflict      both settings are present and contradict each other. Nothing
--                 is recalculated until a person resolves it.
--
-- Which field is the source and which is derived (marketcheck-sync and
-- crawl-advertised-prices write them this way):
--   includes_fee  `price` is the dealer's advertised total (source).
--                 advertised_price_before_doc = price - doc_fee (derived).
--                 website_sale_price is the observed website figure (source);
--                 it is never rewritten here and never used to reprice.
--   before_fee    advertised_price_before_doc is the source.
--                 website_sale_price = advertised_price_before_doc + doc_fee
--                 (derived).
--
-- A fee change therefore keeps the advertised total on an includes_fee
-- tenant and moves the split between vehicle and fee; on a before_fee tenant
-- the selling price is kept and the total moves with the fee.
--
-- An includes_fee row whose stored split already disagrees with its total
-- (before-fee + current fee <> price) is skipped as split_mismatch: which of
-- the two is the newer observation is not knowable here, so neither is
-- rewritten to make them agree. Such rows are counted, reported, and listed
-- by scripts/db-verify/fee-basis-reconciliation.sql for a person to resolve.

CREATE OR REPLACE FUNCTION public.doc_fee_setting_bool(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(p_value) = 'boolean' THEN p_value::text::boolean
    WHEN jsonb_typeof(p_value) = 'string' AND lower(btrim(p_value #>> '{}')) = 'true' THEN true
    WHEN jsonb_typeof(p_value) = 'string' AND lower(btrim(p_value #>> '{}')) = 'false' THEN false
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public.doc_fee_basis(p_settings jsonb, OUT basis text, OUT basis_source text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_inc boolean := public.doc_fee_setting_bool(coalesce(p_settings, '{}'::jsonb) -> 'advertised_includes_doc_fee');
  v_exc boolean := public.doc_fee_setting_bool(coalesce(p_settings, '{}'::jsonb) -> 'advertised_excludes_doc_fee');
BEGIN
  IF v_inc IS NOT NULL AND v_exc IS NOT NULL AND v_inc = v_exc THEN
    basis := 'conflict'; basis_source := 'settings_conflict';
  ELSIF v_inc IS NOT NULL THEN
    basis := CASE WHEN v_inc THEN 'includes_fee' ELSE 'before_fee' END; basis_source := 'advertised_includes_doc_fee';
  ELSIF v_exc IS NOT NULL THEN
    basis := CASE WHEN v_exc THEN 'before_fee' ELSE 'includes_fee' END; basis_source := 'advertised_excludes_doc_fee';
  ELSE
    basis := CASE WHEN p_settings ->> 'price_display_mode' = 'website_sale_price' THEN 'includes_fee' ELSE 'before_fee' END;
    basis_source := 'price_display_mode';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.doc_fee_basis(jsonb) IS
  'The tenant fee basis shared by preview, apply, recalculation and the reconciliation report: includes_fee, before_fee or conflict, and the setting it was read from. Mirrors resolveFeeBasis in src/lib/admin/pricing/feeBasis.ts.';

-- What a fee change does to one row. status: change, unchanged, no_basis
-- (nothing to anchor on), split_mismatch (the stored split already disagrees
-- with the total; left alone), invalid (the fee would leave no vehicle
-- price), or conflict. source_mismatch marks a stored observation that disagrees with
-- the advertised total; it is reported and preserved, never resolved here.
CREATE OR REPLACE FUNCTION public.doc_fee_row_plan(
  p_basis text,
  p_price numeric,
  p_advertised_before_doc numeric,
  p_website_sale_price numeric,
  p_doc_fee numeric,
  p_fee numeric,
  OUT status text,
  OUT selling_before numeric,
  OUT selling_after numeric,
  OUT total_before numeric,
  OUT total_after numeric,
  OUT advertised_before_doc_after numeric,
  OUT website_sale_price_after numeric,
  OUT source_mismatch boolean
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_fee numeric := round(coalesce(p_fee, 0), 2);
BEGIN
  source_mismatch := false;
  IF p_basis = 'conflict' THEN
    status := 'conflict';
    RETURN;
  END IF;
  IF p_basis = 'includes_fee' THEN
    IF p_price IS NULL OR p_price <= 0 THEN
      status := 'no_basis';
      RETURN;
    END IF;
    total_before := p_price;
    total_after := p_price;
    selling_before := round(p_price - coalesce(p_doc_fee, 0), 2);
    selling_after := round(p_price - v_fee, 2);
    advertised_before_doc_after := selling_after;
    website_sale_price_after := p_website_sale_price;
    source_mismatch := p_website_sale_price IS NOT NULL AND abs(p_website_sale_price - p_price) >= 0.01;
    IF p_advertised_before_doc IS NOT NULL AND abs(p_advertised_before_doc + coalesce(p_doc_fee, 0) - p_price) >= 0.01 THEN
      status := 'split_mismatch';
      selling_before := p_advertised_before_doc;
      selling_after := p_advertised_before_doc;
      advertised_before_doc_after := p_advertised_before_doc;
    ELSIF selling_after <= 0 THEN
      status := 'invalid';
    ELSIF p_doc_fee IS DISTINCT FROM v_fee OR p_advertised_before_doc IS DISTINCT FROM selling_after THEN
      status := 'change';
    ELSE
      status := 'unchanged';
    END IF;
    RETURN;
  END IF;
  IF p_advertised_before_doc IS NULL THEN
    status := 'no_basis';
    RETURN;
  END IF;
  selling_before := p_advertised_before_doc;
  selling_after := p_advertised_before_doc;
  total_before := p_website_sale_price;
  total_after := round(p_advertised_before_doc + v_fee, 2);
  advertised_before_doc_after := p_advertised_before_doc;
  website_sale_price_after := total_after;
  source_mismatch := p_price IS NOT NULL AND abs(p_price - p_advertised_before_doc) >= 0.01;
  IF p_advertised_before_doc <= 0 THEN
    status := 'invalid';
  ELSIF p_doc_fee IS DISTINCT FROM v_fee OR p_website_sale_price IS DISTINCT FROM total_after THEN
    status := 'change';
  ELSE
    status := 'unchanged';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.doc_fee_row_plan(text, numeric, numeric, numeric, numeric, numeric) IS
  'One row under a fee change. includes_fee keeps price as the total and derives advertised_price_before_doc; before_fee keeps advertised_price_before_doc and derives website_sale_price. Mirrors planFeeChange in src/lib/admin/pricing/feeBasis.ts.';

CREATE OR REPLACE FUNCTION public.admin_doc_fee_change_preview(
  p_tenant_id uuid,
  p_enabled boolean,
  p_amount numeric,
  p_include_archived boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fee numeric;
  v_version bigint;
  v_settings jsonb;
  v_basis text;
  v_basis_source text;
  v_eligible integer;
  v_unchanged integer;
  v_archived_changed integer;
  v_no_basis integer;
  v_invalid integer;
  v_split integer;
  v_mismatch integer;
  v_parse_warnings integer;
  v_samples jsonb;
  v_warnings text[] := ARRAY[]::text[];
BEGIN
  IF NOT (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.tenant_role_in(p_tenant_id, ARRAY['owner','admin','general_manager','gsm'])
  ) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'fee amount must be zero or more';
  END IF;

  v_fee := CASE WHEN p_enabled THEN round(p_amount, 2) ELSE 0 END;
  SELECT policy_version, settings INTO v_version, v_settings FROM public.dealer_profiles WHERE tenant_id = p_tenant_id;
  v_version := coalesce(v_version, 1);
  SELECT b.basis, b.basis_source INTO v_basis, v_basis_source FROM public.doc_fee_basis(v_settings) b;

  SELECT
    count(*) FILTER (WHERE (l.archived_at IS NULL OR p_include_archived) AND p.status = 'change'),
    count(*) FILTER (WHERE (l.archived_at IS NULL OR p_include_archived) AND p.status = 'unchanged'),
    count(*) FILTER (WHERE l.archived_at IS NOT NULL AND NOT p_include_archived AND p.status = 'change'),
    count(*) FILTER (WHERE l.archived_at IS NULL AND p.status = 'no_basis'),
    count(*) FILTER (WHERE (l.archived_at IS NULL OR p_include_archived) AND p.status = 'invalid'),
    count(*) FILTER (WHERE (l.archived_at IS NULL OR p_include_archived) AND p.status = 'split_mismatch'),
    count(*) FILTER (WHERE (l.archived_at IS NULL OR p_include_archived) AND p.source_mismatch),
    count(*) FILTER (WHERE l.archived_at IS NULL AND p.status = 'change' AND l.price_parse_status = 'warning')
  INTO v_eligible, v_unchanged, v_archived_changed, v_no_basis, v_invalid, v_split, v_mismatch, v_parse_warnings
  FROM public.vehicle_listings l
  CROSS JOIN LATERAL public.doc_fee_row_plan(v_basis, l.price, l.advertised_price_before_doc, l.website_sale_price, l.doc_fee, v_fee) p
  WHERE l.tenant_id = p_tenant_id;

  SELECT coalesce(jsonb_agg(s), '[]'::jsonb) INTO v_samples
  FROM (
    SELECT jsonb_build_object(
      'vin_suffix', right(l.vin, 6),
      'basis', v_basis,
      'selling_price', p.selling_after,
      'selling_before', p.selling_before,
      'selling_after', p.selling_after,
      'fee_before', l.doc_fee,
      'fee_after', v_fee,
      'total_before', p.total_before,
      'total_after', p.total_after,
      'source_mismatch', p.source_mismatch,
      'archived', l.archived_at IS NOT NULL
    ) AS s
    FROM public.vehicle_listings l
    CROSS JOIN LATERAL public.doc_fee_row_plan(v_basis, l.price, l.advertised_price_before_doc, l.website_sale_price, l.doc_fee, v_fee) p
    WHERE l.tenant_id = p_tenant_id
      AND (l.archived_at IS NULL OR p_include_archived)
      AND p.status = 'change'
    ORDER BY l.archived_at NULLS FIRST, l.price_last_verified_at DESC NULLS LAST, l.vin
    LIMIT 5
  ) q;

  IF v_basis = 'conflict' THEN
    v_warnings := v_warnings || 'The fee basis settings contradict each other (advertised_includes_doc_fee and advertised_excludes_doc_fee). Nothing can be applied until one is corrected.'::text;
  ELSIF v_basis = 'includes_fee' THEN
    v_warnings := v_warnings || 'Advertised prices include the fee: each advertised total is kept and the fee is taken out of the vehicle price.'::text;
  ELSE
    v_warnings := v_warnings || 'Advertised prices exclude the fee: each vehicle price is kept and the fee is added on top.'::text;
  END IF;
  IF v_no_basis > 0 THEN
    v_warnings := v_warnings || format('%s active vehicle(s) have no advertised price basis and are not affected.', v_no_basis);
  END IF;
  IF v_invalid > 0 THEN
    v_warnings := v_warnings || format('%s vehicle(s) would be left with no vehicle price under this fee and are skipped.', v_invalid);
  END IF;
  IF v_split > 0 THEN
    v_warnings := v_warnings || format('%s vehicle(s) have a stored before-fee price that does not add up to the advertised total; they are skipped and left as stored for review.', v_split);
  END IF;
  IF v_mismatch > 0 THEN
    v_warnings := v_warnings || format('%s vehicle(s) carry a website price that differs from the advertised total; it is preserved for review and not used to reprice.', v_mismatch);
  END IF;
  IF v_parse_warnings > 0 THEN
    v_warnings := v_warnings || format('%s active vehicle(s) carry a price parse warning; it is preserved.', v_parse_warnings);
  END IF;
  IF p_include_archived THEN
    v_warnings := v_warnings || 'Archived vehicles are included by explicit request.'::text;
  END IF;
  v_warnings := v_warnings || 'Source verification dates and mismatch flags are preserved; recalculation is not a fresh observation.'::text;

  RETURN jsonb_build_object(
    'version', v_version,
    'computed_at', now(),
    'fee', v_fee,
    'basis', v_basis,
    'basis_source', v_basis_source,
    'eligible', CASE WHEN v_basis = 'conflict' THEN 0 ELSE v_eligible END,
    'unchanged', v_unchanged,
    'excluded_archived', v_archived_changed,
    'no_price_basis', v_no_basis,
    'invalid', v_invalid,
    'split_mismatches', v_split,
    'source_mismatches', v_mismatch,
    'samples', v_samples,
    'warnings', to_jsonb(v_warnings)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_doc_fee_change_apply(
  p_tenant_id uuid,
  p_enabled boolean,
  p_amount numeric,
  p_expected_version bigint,
  p_idempotency_key text,
  p_include_archived boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_fee numeric;
  v_current bigint;
  v_prev jsonb;
  v_basis text;
  v_basis_source text;
  v_count integer;
  v_invalid integer;
  v_split integer;
  v_mismatch integer;
  v_audit_id uuid;
  v_result jsonb;
  v_existing jsonb;
  v_requested jsonb;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.tenant_role_in(p_tenant_id, ARRAY['owner','admin','general_manager','gsm'])
  ) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'fee amount must be zero or more';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'expected policy version required';
  END IF;

  SELECT result INTO v_existing
  FROM public.admin_policy_applications
  WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('status', 'duplicate', 'original_status', v_existing->>'status');
  END IF;

  v_fee := CASE WHEN p_enabled THEN round(p_amount, 2) ELSE 0 END;
  v_requested := jsonb_build_object(
    'enabled', p_enabled, 'amount', p_amount, 'include_archived', p_include_archived,
    'expected_version', p_expected_version);

  INSERT INTO public.dealer_profiles (tenant_id, settings, updated_by)
  VALUES (p_tenant_id, '{}'::jsonb, v_uid)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT policy_version, coalesce(settings, '{}'::jsonb)
    INTO v_current, v_prev
  FROM public.dealer_profiles
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  SELECT result INTO v_existing
  FROM public.admin_policy_applications
  WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('status', 'duplicate', 'original_status', v_existing->>'status');
  END IF;

  IF v_current IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object('status', 'conflict', 'affected', 0, 'version', v_current, 'audit_id', NULL);
  END IF;

  SELECT b.basis, b.basis_source INTO v_basis, v_basis_source FROM public.doc_fee_basis(v_prev) b;
  -- Contradicting basis settings: refuse before anything is written, so the
  -- fee setting and the stored prices cannot disagree about which side won.
  IF v_basis = 'conflict' THEN
    RETURN jsonb_build_object('status', 'failed', 'affected', 0, 'version', v_current, 'audit_id', NULL, 'basis', v_basis,
      'message', 'The fee basis settings contradict each other; correct advertised_includes_doc_fee before changing the fee.');
  END IF;

  UPDATE public.dealer_profiles
  SET settings = coalesce(settings, '{}'::jsonb)
                 || jsonb_build_object('doc_fee_enabled', p_enabled, 'doc_fee_amount', p_amount),
      updated_by = v_uid
  WHERE tenant_id = p_tenant_id
  RETURNING policy_version INTO v_current;

  -- Derived fields only. On includes_fee `price` and website_sale_price are
  -- source values and are left exactly as observed; on before_fee
  -- advertised_price_before_doc is. Verification stamps and parse status are
  -- untouched: recalculation is not an observation of the dealer's price.
  UPDATE public.vehicle_listings l
  SET doc_fee = v_fee,
      advertised_price_before_doc = p.advertised_before_doc_after,
      website_sale_price = p.website_sale_price_after,
      price_recalculated_at = now()
  FROM public.vehicle_listings src
  CROSS JOIN LATERAL public.doc_fee_row_plan(v_basis, src.price, src.advertised_price_before_doc, src.website_sale_price, src.doc_fee, v_fee) p
  WHERE src.id = l.id
    AND l.tenant_id = p_tenant_id
    AND (l.archived_at IS NULL OR p_include_archived)
    AND p.status = 'change';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT count(*) FILTER (WHERE p.status = 'invalid'), count(*) FILTER (WHERE p.status = 'split_mismatch'), count(*) FILTER (WHERE p.source_mismatch)
    INTO v_invalid, v_split, v_mismatch
  FROM public.vehicle_listings l
  CROSS JOIN LATERAL public.doc_fee_row_plan(v_basis, l.price, l.advertised_price_before_doc, l.website_sale_price, l.doc_fee, v_fee) p
  WHERE l.tenant_id = p_tenant_id
    AND (l.archived_at IS NULL OR p_include_archived);

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES (
    'doc_fee_policy_applied', 'tenant', p_tenant_id::text, p_tenant_id::text, v_uid,
    jsonb_build_object(
      'prev', jsonb_build_object('doc_fee_enabled', v_prev->'doc_fee_enabled', 'doc_fee_amount', v_prev->'doc_fee_amount'),
      'next', jsonb_build_object('doc_fee_enabled', p_enabled, 'doc_fee_amount', p_amount),
      'fee_applied', v_fee,
      'basis', v_basis,
      'basis_source', v_basis_source,
      'affected', v_count,
      'skipped_invalid', v_invalid,
      'skipped_split_mismatch', v_split,
      'source_mismatches_preserved', v_mismatch,
      'include_archived', p_include_archived,
      'expected_version', p_expected_version,
      'version', v_current,
      'idempotency_key', p_idempotency_key))
  RETURNING id INTO v_audit_id;

  v_result := jsonb_build_object('status', CASE WHEN v_invalid + v_split > 0 THEN 'partial' ELSE 'applied' END,
    'affected', v_count, 'version', v_current, 'audit_id', v_audit_id, 'basis', v_basis,
    'skipped_invalid', v_invalid, 'skipped_split_mismatch', v_split, 'source_mismatches', v_mismatch,
    'message', CASE WHEN v_invalid + v_split > 0 THEN format('%s vehicle(s) were skipped (%s whose stored before-fee price does not add up to the advertised total, %s the fee would leave with no vehicle price); their stored prices are unchanged and need review.', v_invalid + v_split, v_split, v_invalid) END);

  INSERT INTO public.admin_policy_applications (idempotency_key, tenant_id, policy, requested, result, applied_by)
  VALUES (p_idempotency_key, p_tenant_id, 'doc_fee', v_requested, v_result, v_uid);

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT result INTO v_existing
    FROM public.admin_policy_applications
    WHERE idempotency_key = p_idempotency_key;
    RETURN coalesce(v_existing, jsonb_build_object('status', 'failed', 'affected', 0, 'version', NULL, 'audit_id', NULL))
           || jsonb_build_object('status', 'duplicate');
END;
$function$;

-- The legacy routine (the browser fallback when the reviewed functions are
-- missing) follows the same row plan, so neither path can split the total.
-- Based on the hosted definition (pricing roles, changed rows only); its
-- restamping of the verification date is unchanged and still disclosed by
-- the fallback copy.
CREATE OR REPLACE FUNCTION public.recalc_tenant_doc_fee(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_settings jsonb;
  v_fee   numeric;
  v_basis text;
  v_count integer;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = p_tenant_id AND user_id = (SELECT auth.uid())
        AND lower(coalesce(role, '')) IN ('owner','admin','general_manager','gsm')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id;
  END IF;

  SELECT settings INTO v_settings FROM public.dealer_profiles WHERE tenant_id = p_tenant_id;
  v_fee := CASE WHEN (v_settings->>'doc_fee_enabled')::boolean
                THEN round(COALESCE((v_settings->>'doc_fee_amount')::numeric, 0), 2) ELSE 0 END;
  v_fee := COALESCE(v_fee, 0);
  SELECT b.basis INTO v_basis FROM public.doc_fee_basis(v_settings) b;
  IF v_basis = 'conflict' THEN
    RAISE EXCEPTION 'fee basis settings contradict each other for tenant %', p_tenant_id;
  END IF;

  UPDATE public.vehicle_listings l
  SET doc_fee                     = v_fee,
      advertised_price_before_doc = p.advertised_before_doc_after,
      website_sale_price          = p.website_sale_price_after,
      price_parse_status          = 'ok',
      price_parse_notes           = CASE WHEN v_basis = 'includes_fee'
                                      THEN 'Doc fee updated in admin; advertised total kept, vehicle price = total - doc fee.'
                                      ELSE 'Doc fee updated in admin; sale price = advertised + doc fee.' END,
      price_last_verified_at      = now()
  FROM public.vehicle_listings src
  CROSS JOIN LATERAL public.doc_fee_row_plan(v_basis, src.price, src.advertised_price_before_doc, src.website_sale_price, src.doc_fee, v_fee) p
  WHERE src.id = l.id
    AND l.tenant_id = p_tenant_id
    AND p.status = 'change';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_tenant_doc_fee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_tenant_doc_fee(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.doc_fee_basis(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.doc_fee_row_plan(text, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_fee_basis(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_fee_row_plan(text, numeric, numeric, numeric, numeric, numeric) TO authenticated, service_role;
