-- ── Administration V2: policy version, idempotent fee application, health reads ──
--
-- Until 2026-10-28 the dealer doc fee was recalculated by an effect in the
-- Admin page: a change in settings state, including the ordinary hydration of
-- cached and then server settings, called recalc_tenant_doc_fee, which
-- rewrote doc_fee and website_sale_price on every listing of the tenant,
-- archived stock included, and stamped price_last_verified_at as if each
-- price had just been observed. The effect is gone from the page. This
-- migration gives the explicit Review & Apply flow its server side.
--
--   dealer_profiles.policy_version   bumped by trigger whenever settings
--                                    change, so a review computed against one
--                                    version cannot apply against another
--   vehicle_listings.price_recalculated_at
--                                    when an administrative fee change last
--                                    rewrote a listing's fee columns; the
--                                    verification stamp is no longer touched
--   admin_policy_applications        idempotency ledger: a repeated key returns
--                                    the stored result and changes nothing
--   admin_doc_fee_change_preview     read-only impact: eligible, unchanged,
--                                    archived excluded, samples, warnings
--   admin_doc_fee_change_apply       the one writer: pricing roles only,
--                                    version check, changed rows only, active
--                                    stock unless archived is asked for,
--                                    audit row, ledger row
--   admin_policy_version             the current version for optimistic
--                                    concurrency
--   admin_feed_last_success          newest successful or partial feed run
--                                    over the whole ledger, never a page
--   admin_job_status                 scheduled-job facts a dealer may see,
--                                    without the command text that carries
--                                    credentials
--
-- Helpers tenant_role_in and admin_tenant_member_ok are shared with the
-- settings-authority migration that follows.
-- ──────────────────────────────────────────────────────────────────────────

-- ── Helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tenant_role_in(p_tenant_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = (SELECT auth.uid())
      AND tm.accepted_at IS NOT NULL
      AND lower(trim(coalesce(tm.role, ''))) = ANY (p_roles)
  );
$function$;

REVOKE ALL ON FUNCTION public.tenant_role_in(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_role_in(uuid, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.tenant_role_in(uuid, text[]) IS
  'True when the caller is an accepted member of the tenant holding one of the given roles. The server-side counterpart of the client capability map; policies and RPCs call it instead of trusting a role the client sends.';

CREATE OR REPLACE FUNCTION public.admin_tenant_member_ok(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.tenant_members tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = (SELECT auth.uid())
          AND tm.accepted_at IS NOT NULL
      );
$function$;

REVOKE ALL ON FUNCTION public.admin_tenant_member_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tenant_member_ok(uuid) TO authenticated, service_role;

-- ── Policy version ──────────────────────────────────────────────────────

ALTER TABLE public.dealer_profiles
  ADD COLUMN IF NOT EXISTS policy_version bigint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.dealer_profiles.policy_version IS
  'Increments whenever settings change. A reviewed change carries the version it was reviewed against and is refused when the row has moved on.';

CREATE OR REPLACE FUNCTION public.dealer_profiles_bump_policy_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.settings IS DISTINCT FROM OLD.settings THEN
    NEW.policy_version := coalesce(OLD.policy_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS dealer_profiles_bump_policy_version ON public.dealer_profiles;
CREATE TRIGGER dealer_profiles_bump_policy_version
  BEFORE UPDATE ON public.dealer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.dealer_profiles_bump_policy_version();

-- ── Recalculation stamp, separate from source verification ──────────────

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS price_recalculated_at timestamp with time zone;

COMMENT ON COLUMN public.vehicle_listings.price_recalculated_at IS
  'When an administrative fee change last rewrote doc_fee and website_sale_price. Not an observation of the dealer''s price: price_last_verified_at remains the verification stamp and is never touched by recalculation.';

-- ── Idempotency ledger ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_policy_applications (
  idempotency_key text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  policy text NOT NULL,
  requested jsonb NOT NULL,
  result jsonb NOT NULL,
  applied_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_policy_applications_tenant_created_idx
  ON public.admin_policy_applications (tenant_id, created_at DESC);

ALTER TABLE public.admin_policy_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_policy_applications tenant read" ON public.admin_policy_applications;
CREATE POLICY "admin_policy_applications tenant read"
  ON public.admin_policy_applications FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

REVOKE ALL ON public.admin_policy_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_policy_applications TO authenticated;

COMMENT ON TABLE public.admin_policy_applications IS
  'One row per applied (or failed) consequential policy change, keyed by the idempotency key the reviewer supplied. Written only by the apply RPCs; a repeated key returns the stored result.';

-- ── Current version for optimistic concurrency ──────────────────────────

CREATE OR REPLACE FUNCTION public.admin_policy_version(p_tenant_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_tenant_member_ok(p_tenant_id) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = p_tenant_id), 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_policy_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_policy_version(uuid) TO authenticated, service_role;

-- ── Doc fee change: preview ─────────────────────────────────────────────

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
    v_warnings := v_warnings || 'Archived vehicles are included by explicit request.';
  END IF;
  v_warnings := v_warnings || 'Source verification dates and mismatch flags are preserved; recalculation is not a fresh observation.';

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

-- ── Doc fee change: apply ───────────────────────────────────────────────

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
  v_count integer;
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

  -- A repeated key is the same operation: return what happened, change nothing.
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

  -- The policy row is the lock. A tenant that never saved settings gets one.
  INSERT INTO public.dealer_profiles (tenant_id, settings, updated_by)
  VALUES (p_tenant_id, '{}'::jsonb, v_uid)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT policy_version, coalesce(settings, '{}'::jsonb)
    INTO v_current, v_prev
  FROM public.dealer_profiles
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  -- Under the lock the ledger is authoritative: a same-key call that finished
  -- while this one waited is answered as a duplicate, not as a conflict.
  SELECT result INTO v_existing
  FROM public.admin_policy_applications
  WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('status', 'duplicate', 'original_status', v_existing->>'status');
  END IF;

  IF v_current IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object('status', 'conflict', 'affected', 0, 'version', v_current, 'audit_id', NULL);
  END IF;

  UPDATE public.dealer_profiles
  SET settings = coalesce(settings, '{}'::jsonb)
                 || jsonb_build_object('doc_fee_enabled', p_enabled, 'doc_fee_amount', p_amount),
      updated_by = v_uid
  WHERE tenant_id = p_tenant_id
  RETURNING policy_version INTO v_current;

  -- Changed rows only. Active stock unless archived is asked for. The
  -- verification stamp and the parse status are not touched: recalculation
  -- is not an observation of the dealer's price.
  UPDATE public.vehicle_listings
  SET doc_fee = v_fee,
      website_sale_price = advertised_price_before_doc + v_fee,
      price_recalculated_at = now()
  WHERE tenant_id = p_tenant_id
    AND advertised_price_before_doc IS NOT NULL
    AND (archived_at IS NULL OR p_include_archived)
    AND (doc_fee IS DISTINCT FROM v_fee
         OR website_sale_price IS DISTINCT FROM advertised_price_before_doc + v_fee);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES (
    'doc_fee_policy_applied', 'tenant', p_tenant_id::text, p_tenant_id::text, v_uid,
    jsonb_build_object(
      'prev', jsonb_build_object('doc_fee_enabled', v_prev->'doc_fee_enabled', 'doc_fee_amount', v_prev->'doc_fee_amount'),
      'next', jsonb_build_object('doc_fee_enabled', p_enabled, 'doc_fee_amount', p_amount),
      'fee_applied', v_fee,
      'affected', v_count,
      'include_archived', p_include_archived,
      'expected_version', p_expected_version,
      'version', v_current,
      'idempotency_key', p_idempotency_key))
  RETURNING id INTO v_audit_id;

  v_result := jsonb_build_object('status', 'applied', 'affected', v_count, 'version', v_current, 'audit_id', v_audit_id);

  INSERT INTO public.admin_policy_applications (idempotency_key, tenant_id, policy, requested, result, applied_by)
  VALUES (p_idempotency_key, p_tenant_id, 'doc_fee', v_requested, v_result, v_uid);

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent call with the same key finished first; its result stands
    -- and this call's work is rolled back with the exception.
    SELECT result INTO v_existing
    FROM public.admin_policy_applications
    WHERE idempotency_key = p_idempotency_key;
    RETURN coalesce(v_existing, jsonb_build_object('status', 'failed', 'affected', 0, 'version', NULL, 'audit_id', NULL))
           || jsonb_build_object('status', 'duplicate');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_doc_fee_change_apply(uuid, boolean, numeric, bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_doc_fee_change_apply(uuid, boolean, numeric, bigint, text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_doc_fee_change_apply(uuid, boolean, numeric, bigint, text, boolean) IS
  'The one writer for a reviewed doc fee change: pricing roles only, refused when the policy version moved, changed rows only, active stock unless archived is asked for, verification stamp untouched, one audit row, one ledger row per idempotency key.';

-- ── Feed last success over the whole ledger ─────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_feed_last_success(p_tenant_id uuid)
RETURNS timestamp with time zone
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_tenant_member_ok(p_tenant_id) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT max(started_at)
    FROM public.inventory_sync_runs
    WHERE tenant_id = p_tenant_id
      AND status IN ('success', 'partial')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_feed_last_success(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_feed_last_success(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_feed_last_success(uuid) IS
  'The newest successful or partial inventory pull for the tenant, read from the whole run ledger. Independent of any page window, so a long run of skips can never turn a real success into "never".';

-- ── Scheduled job facts a dealer may see ────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_job_status(p_tenant_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  r record;
  v_jobs text[] := ARRAY[
    'marketcheck-sync',
    'autolabels_crawl_advertised_prices',
    'enrich-sweep-nightly',
    'marketcheck-incentives',
    'description-reconcile-nightly',
    'specs-backfill',
    'factory-sticker-sweep',
    'ingest-orchestrate-sweep',
    'intake-draft-sweep',
    'get-ready-sweep',
    'getready-install-safety-net',
    'passport-lead-escalation-every-5-min',
    'passport-delivery-flush',
    'price-drop-reengage',
    'title-reminders-sweep',
    'epa-fuel-economy-sweep',
    'carfax-link-sweep',
    'equipment-proof-sweep',
    'oem-document-copy-sweep',
    'packet-backfill',
    'compliance-forms-sweep',
    'ct-compliance-digests'
  ];
BEGIN
  IF NOT public.admin_tenant_member_ok(p_tenant_id) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;

  -- Platform schedules. Only name, schedule, enabled state and run times
  -- leave this function: the job definition text carries credentials and
  -- the run message can carry provider bodies, so neither is selected.
  FOR r IN
    SELECT
      j.jobname::text AS jobname,
      j.schedule::text AS schedule,
      j.active,
      (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_attempt_at,
      (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'succeeded') AS last_success_at,
      (SELECT d.status::text FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_outcome
    FROM cron.job j
    WHERE j.jobname = ANY (v_jobs)
    ORDER BY j.jobname
  LOOP
    RETURN NEXT jsonb_build_object(
      'job', r.jobname,
      'schedule', r.schedule,
      'active', r.active,
      'last_attempt_at', r.last_attempt_at,
      'last_success_at', r.last_success_at,
      'last_outcome', r.last_outcome,
      'scope', 'platform');
  END LOOP;

  -- Tenant ledgers: what actually happened for this rooftop.
  RETURN NEXT jsonb_build_object(
    'job', 'inventory_sync',
    'schedule', (SELECT CASE WHEN c.enabled THEN c.frequency || ' at ' || lpad(c.run_hour::text, 2, '0') || ':00 UTC' ELSE 'disabled' END
                 FROM public.marketcheck_sync_config c WHERE c.tenant_id = p_tenant_id),
    'active', (SELECT c.enabled FROM public.marketcheck_sync_config c WHERE c.tenant_id = p_tenant_id),
    'last_attempt_at', (SELECT max(started_at) FROM public.inventory_sync_runs WHERE tenant_id = p_tenant_id AND status <> 'skipped'),
    'last_success_at', (SELECT max(started_at) FROM public.inventory_sync_runs WHERE tenant_id = p_tenant_id AND status IN ('success', 'partial')),
    'last_outcome', (SELECT status FROM public.inventory_sync_runs WHERE tenant_id = p_tenant_id AND status <> 'skipped' ORDER BY started_at DESC LIMIT 1),
    'last_http_status', (SELECT http_status FROM public.inventory_sync_runs WHERE tenant_id = p_tenant_id AND status <> 'skipped' ORDER BY started_at DESC LIMIT 1),
    'scope', 'tenant');

  RETURN NEXT jsonb_build_object(
    'job', 'price_crawl',
    'schedule', (SELECT j.schedule::text FROM cron.job j WHERE j.jobname = 'autolabels_crawl_advertised_prices'),
    'active', (SELECT j.active FROM cron.job j WHERE j.jobname = 'autolabels_crawl_advertised_prices'),
    'last_attempt_at', (SELECT max(last_attempt_at) FROM public.advertised_price_crawl_attempts WHERE tenant_id = p_tenant_id),
    'last_success_at', (SELECT max(resolved_at) FROM public.advertised_price_crawl_attempts WHERE tenant_id = p_tenant_id AND outcome = 'captured'),
    'last_outcome', (SELECT outcome FROM public.advertised_price_crawl_attempts WHERE tenant_id = p_tenant_id ORDER BY last_attempt_at DESC NULLS LAST LIMIT 1),
    'scope', 'tenant');

  RETURN NEXT jsonb_build_object(
    'job', 'description_pipeline',
    'schedule', (SELECT j.schedule::text FROM cron.job j WHERE j.jobname = 'description-reconcile-nightly'),
    'active', (SELECT j.active FROM cron.job j WHERE j.jobname = 'description-reconcile-nightly'),
    'last_attempt_at', (SELECT max(coalesce(started_at, scheduled_at, created_at)) FROM public.description_jobs WHERE tenant_id = p_tenant_id),
    'last_success_at', (SELECT max(completed_at) FROM public.description_jobs WHERE tenant_id = p_tenant_id AND status = 'succeeded'),
    'last_outcome', (SELECT status FROM public.description_jobs WHERE tenant_id = p_tenant_id ORDER BY coalesce(completed_at, failed_at, started_at, created_at) DESC NULLS LAST LIMIT 1),
    'scope', 'tenant');

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_job_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_job_status(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_job_status(uuid) IS
  'Scheduled job facts for the Administration health center: platform cron name, schedule, enabled state and run times, plus the tenant''s own ledgers for the feed, the price crawl and the description pipeline. A schedule proves intent, not execution; the caller derives health from the run facts.';
