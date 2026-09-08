-- Production hardening: close unauthenticated RPC grants, add two
-- evidence-backed indexes.
--
-- Root cause for the grants half: this project carries Supabase's stock
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS
--   TO anon, authenticated, service_role
-- (pg_default_acl, grantor postgres). Every function a migration creates is
-- therefore anon-callable the moment it exists, and `REVOKE ALL ... FROM
-- PUBLIC` does NOT undo it -- anon and authenticated hold their own explicit
-- grants, not PUBLIC's. Only an explicit
--   REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC
-- closes the door. 20260627175334 established that shape for the admin
-- functions; the sweep schedulers added after it were never added to the list.
--
-- Nothing is dropped, no row is touched, and no cron job is rescheduled.

-- ── 1. Cron scheduler RPCs -------------------------------------------------
-- Each of these runs as postgres, reads vault.decrypted_secrets, calls
-- cron.unschedule('<production job name>') and re-registers the job with a
-- caller-supplied URL. Reachable by anon they let an unauthenticated caller
-- delete or redirect the production sweeps (compliance-forms-sweep,
-- factory-sticker-sweep, ingest-orchestrate-sweep, oem-document-copy-sweep,
-- passport-delivery-flush, description-reconcile-nightly). No client code
-- calls them; schedule_marketcheck_sync already carries the correct grant.
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'schedule_compliance_forms_sweep(text,text,text)',
    'schedule_factory_sticker_sweep(text,text,text)',
    'schedule_ingest_orchestrate_sweep(text,text,text)',
    'schedule_oem_document_copy_sweep(text,text,text)',
    'schedule_packet_backfill(text,text,text)',
    'schedule_passport_delivery_flush(text,text,text)',
    'schedule_description_reconcile(text)',
    -- Cross-tenant reader: advertised_price_crawl_queue(NULL, n) returns
    -- every tenant's advertised prices. Only crawl-advertised-prices calls
    -- it, with the service-role key.
    'advertised_price_crawl_queue(uuid,integer)',
    -- Cross-tenant writers with no caller check, both service-role only:
    -- ingest-orchestrate and marketcheck-sync respectively.
    'claim_listing_orchestration(uuid)',
    'marketcheck_revive_listing(uuid,text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated, PUBLIC', fn);
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      -- Surface drift instead of swallowing it. A silently skipped REVOKE is
      -- exactly the failure this migration exists to correct.
      RAISE WARNING 'hardening: no such function public.%, grant not revoked', fn;
    END;
  END LOOP;
END $$;

-- ── 2. get_or_create_install_token ----------------------------------------
-- SECURITY DEFINER, no authorization check at all: it returns the
-- install_token for any (store_id, vin) and creates a draft vehicle_listings
-- row when none exists. The install-proofs storage policy and
-- record_install_proof both treat that token as the sole credential, so an
-- anonymous caller who knows a store id and a VIN (both visible on a public
-- passport) could mint the token and file installation-proof evidence
-- against a real vehicle. The dealer UI (GetReadySheet) calls it as an
-- authenticated user, so only the anon grant is withdrawn here; adding a
-- tenant-membership check inside the function is the follow-up fix and is
-- deliberately left for owner review.
REVOKE EXECUTE ON FUNCTION public.get_or_create_install_token(text, text, text)
  FROM anon, PUBLIC;

-- ── 3. Indexes -------------------------------------------------------------
-- description_feature_selections is the largest table in the database
-- (35,616 rows) and had no index on tenant_id or vehicle_id, so every
-- RLS-filtered read is a full sequential scan:
--   Seq Scan on description_feature_selections
--     (actual time=1.267..897.541 rows=35616) Buffers: shared hit=1450
CREATE INDEX IF NOT EXISTS idx_description_feature_selections_tenant
  ON public.description_feature_selections (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_description_feature_selections_vehicle
  ON public.description_feature_selections (vehicle_id);

-- audit_log's hot read is `WHERE store_id = $1 ORDER BY created_at DESC
-- LIMIT n` (13,514 calls, 10.73 ms mean in pg_stat_statements). idx_audit_store
-- is store_id only, so the planner walks idx_audit_created and filters -- which
-- works today only because one dealer owns 9,145 of 10,915 rows. It degrades
-- to a near-full scan for every smaller tenant as the table grows.
CREATE INDEX IF NOT EXISTS idx_audit_store_created
  ON public.audit_log (store_id, created_at DESC);

-- 4. Self-verification ------------------------------------------------------
-- C1's lesson was that a passing test asserted a defense that did not hold:
-- REVOKE ... FROM PUBLIC left anon's own explicit grant untouched, so the
-- door stayed open while CI stayed green. This migration refuses to report
-- success under the same illusion -- if any function it just closed is still
-- executable by anon, it aborts and rolls itself back.
DO $$
DECLARE
  still_open text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO still_open
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'schedule_compliance_forms_sweep','schedule_factory_sticker_sweep',
      'schedule_ingest_orchestrate_sweep','schedule_oem_document_copy_sweep',
      'schedule_packet_backfill','schedule_passport_delivery_flush',
      'schedule_description_reconcile','advertised_price_crawl_queue',
      'claim_listing_orchestration','marketcheck_revive_listing',
      'get_or_create_install_token')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF still_open IS NOT NULL THEN
    RAISE EXCEPTION 'hardening failed: still anon-executable: %', still_open;
  END IF;
END $$;
