-- Second pass over the anon-executable SECURITY DEFINER surface.
--
-- 20260908180000 closed the eleven functions that were proven exploitable and
-- left 89 still anon-executable. Classifying all 89 rather than sweeping them:
--
--   17  trigger functions -- return `trigger`, so PostgREST never exposes them
--   26  resolve the caller's identity themselves (auth.uid(), auth.jwt(),
--       has_role, tenant_members, current_tenant_id(), recon_caller_role())
--   34  take a token/slug/code capability argument and are anon by design
--       (the public passport and signing surfaces)
--   12  neither -- they accept a caller-supplied _tenant_id (or nothing) and
--       do no authorization at all. Those twelve are closed here.
--
-- Note for anyone re-running this analysis: grepping only for a literal
-- auth.uid() badly over-counts. recon_decide_member and resolve_return look
-- unauthorized that way, but delegate to recon_caller_role() and
-- current_tenant_id() respectively, both of which resolve auth.uid()
-- internally. Both are correctly gated and are deliberately untouched here.
--
-- Every function below was checked for callers across src/ and
-- supabase/functions/. All are service-role, pg_cron, or uncalled, except the
-- two noted at the bottom which have a single authenticated browser caller and
-- therefore lose only the anon grant.

-- Service-role / pg_cron / uncalled: lose anon AND authenticated.
--   claim_oem_document_hosting      oem-document-store (service role)
--   oem_distribution_for_vehicle    public-listing-view (service role)
--   record_provider_payload_shape   marketcheck-specs (service role)
--   seed_recon_estimate_for_ingest  ingest-orchestrate (service role)
--   sweep_getready_install_safety_net  pg_cron, runs as postgres
--   recon_recompute_estimate        internal, called by recon_decide_member
--   declared_oem_brands, installs_block_finalize,
--   tenant_may_host_oem_documents   no callers anywhere in the repo
--
--   request_signing_link_resend is the important one. It is reached through
--   supabase/functions/request-signing-link, whose own header calls it an
--   "anti-enumeration wrapper". Direct anon RPC access walks straight around
--   that wrapper. The function itself is well built -- it requires the caller
--   to already know the VIN *and* the signer's registered email or phone, and
--   returns {ok:true} with no data on a mismatch -- but it hands the signing
--   token back to the CALLER rather than emailing it to the registered
--   contact, so VIN (public on the passport) plus a known customer email
--   yields a signing capability. Closing the direct path restores the
--   wrapper's rate limiting. Returning the link to the contact instead of the
--   caller is the follow-up fix and needs owner review.
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'claim_oem_document_hosting(uuid,text,text,text,text,text,integer,text,uuid)',
    'declared_oem_brands(uuid)',
    'installs_block_finalize(uuid,text)',
    'oem_distribution_for_vehicle(uuid,text,text)',
    'tenant_may_host_oem_documents(uuid,text,text)',
    'recon_recompute_estimate(uuid)',
    'record_provider_payload_shape(text,text,text,text[],jsonb,jsonb,boolean,text)',
    'request_signing_link_resend(text,text,text)',
    'seed_recon_estimate_for_ingest(uuid,text,text,uuid,text)',
    'sweep_getready_install_safety_net()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated, PUBLIC', fn);
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE WARNING 'hardening: no such function public.%, grant not revoked', fn;
    END;
  END LOOP;
END $$;

-- These two have a real authenticated browser caller, so only anon is
-- withdrawn:
--   getready_upsert_addendum_line  src/hooks/useGetReady.ts:443,484
--   derive_oem_franchise_brands    src/components/admin/OemDistributionPanel.tsx:34
-- Both still accept p_tenant_id/_tenant_id from the caller with no membership
-- check, so a signed-in user of one dealer can still address another dealer's
-- rows. Adding that check is the follow-up fix; it is left out here because it
-- changes behaviour for multi-store users and needs owner review.
REVOKE EXECUTE ON FUNCTION public.getready_upsert_addendum_line(uuid, text, text)
  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.derive_oem_franchise_brands(uuid)
  FROM anon, PUBLIC;

-- Self-verification, same contract as 20260908180000: refuse to report success
-- while any of the twelve is still reachable by anon.
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
      'claim_oem_document_hosting','declared_oem_brands','installs_block_finalize',
      'oem_distribution_for_vehicle','tenant_may_host_oem_documents',
      'recon_recompute_estimate','record_provider_payload_shape',
      'request_signing_link_resend','seed_recon_estimate_for_ingest',
      'sweep_getready_install_safety_net','getready_upsert_addendum_line',
      'derive_oem_franchise_brands')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF still_open IS NOT NULL THEN
    RAISE EXCEPTION 'hardening failed: still anon-executable: %', still_open;
  END IF;
END $$;
