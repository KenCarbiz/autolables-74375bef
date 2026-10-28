-- PROPOSED, NOT APPLIED. Corrects admin_doc_fee_change_preview, which fails
-- on every call on the hosted project (PostgreSQL 17.6, verified 2026-10-28):
-- `text[] || 'literal'` resolves the untyped literal as an array, so the
-- unconditional closing warning raises 22P02 "malformed array literal" and the
-- Review & Apply step reports that the preview could not be computed. Nothing
-- is written by the failing call. The two literal appends are cast to text;
-- nothing else in the function changes. CREATE OR REPLACE keeps the grants.

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
  v_eligible integer;
  v_unchanged integer;
  v_archived_changed integer;
  v_no_basis integer;
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
  v_version := coalesce((SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = p_tenant_id), 1);

  SELECT
    count(*) FILTER (WHERE (archived_at IS NULL OR p_include_archived)
                       AND (doc_fee IS DISTINCT FROM v_fee
                            OR website_sale_price IS DISTINCT FROM advertised_price_before_doc + v_fee)),
    count(*) FILTER (WHERE (archived_at IS NULL OR p_include_archived)
                       AND NOT (doc_fee IS DISTINCT FROM v_fee
                                OR website_sale_price IS DISTINCT FROM advertised_price_before_doc + v_fee)),
    count(*) FILTER (WHERE archived_at IS NOT NULL AND NOT p_include_archived
                       AND (doc_fee IS DISTINCT FROM v_fee
                            OR website_sale_price IS DISTINCT FROM advertised_price_before_doc + v_fee)),
    count(*) FILTER (WHERE archived_at IS NULL AND price_parse_status = 'warning')
  INTO v_eligible, v_unchanged, v_archived_changed, v_parse_warnings
  FROM public.vehicle_listings
  WHERE tenant_id = p_tenant_id
    AND advertised_price_before_doc IS NOT NULL;

  SELECT count(*) INTO v_no_basis
  FROM public.vehicle_listings
  WHERE tenant_id = p_tenant_id
    AND archived_at IS NULL
    AND advertised_price_before_doc IS NULL;

  SELECT coalesce(jsonb_agg(s), '[]'::jsonb) INTO v_samples
  FROM (
    SELECT jsonb_build_object(
      'vin_suffix', right(vin, 6),
      'selling_price', advertised_price_before_doc,
      'fee_before', doc_fee,
      'fee_after', v_fee,
      'total_before', website_sale_price,
      'total_after', advertised_price_before_doc + v_fee,
      'archived', archived_at IS NOT NULL
    ) AS s
    FROM public.vehicle_listings
    WHERE tenant_id = p_tenant_id
      AND advertised_price_before_doc IS NOT NULL
      AND (archived_at IS NULL OR p_include_archived)
      AND (doc_fee IS DISTINCT FROM v_fee
           OR website_sale_price IS DISTINCT FROM advertised_price_before_doc + v_fee)
    ORDER BY archived_at NULLS FIRST, price_last_verified_at DESC NULLS LAST, vin
    LIMIT 5
  ) q;

  IF v_no_basis > 0 THEN
    v_warnings := v_warnings || format('%s active vehicle(s) have no advertised price basis and are not affected.', v_no_basis);
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
    'eligible', v_eligible,
    'unchanged', v_unchanged,
    'excluded_archived', v_archived_changed,
    'no_price_basis', v_no_basis,
    'samples', v_samples,
    'warnings', to_jsonb(v_warnings)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_doc_fee_change_preview(uuid, boolean, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_doc_fee_change_preview(uuid, boolean, numeric, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_doc_fee_change_preview(uuid, boolean, numeric, boolean) IS
  'Read-only impact of a doc fee change for the review step: counts under the changed-value predicate, archived rows excluded unless asked for, five sample deltas by VIN suffix, and warnings. Never writes.';
