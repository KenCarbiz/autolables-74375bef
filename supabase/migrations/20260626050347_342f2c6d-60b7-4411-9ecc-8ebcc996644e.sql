
-- 1) Drop broad SELECT policies on public buckets (linter: SUPA_public_bucket_allows_listing).
--    Files in public buckets remain readable by direct public URL; this only blocks API listing.
DROP POLICY IF EXISTS "dealer_logos_read" ON storage.objects;
DROP POLICY IF EXISTS "listing_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "prep_photos_public_read" ON storage.objects;

-- 2) Revoke EXECUTE on all SECURITY DEFINER functions in public from PUBLIC/anon/authenticated,
--    then grant back only the intended public/auth surfaces.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END$$;

-- Allowlist: callable by anon AND authenticated (public-facing flows).
GRANT EXECUTE ON FUNCTION public.get_addendum_by_token(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_deal_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_signing_documents(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_file_by_deal_token(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_listing_by_slug(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_documents_public(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_install_proofs_public(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_listing_view(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_qr_scan(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_signing(text, text, text, text, text, text, text, text, text, jsonb, text, jsonb, jsonb, jsonb, integer, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_install_proof(uuid, uuid, text, text, text, timestamptz, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_install_proof(uuid, uuid, text, text, text, timestamptz, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_addendum_event(uuid, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_deal_token(text, jsonb, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_signing_link_resend(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_install_token(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_evidence_receipt(text, text, jsonb, text) TO anon, authenticated;

-- Allowlist: authenticated-only (regular app surface).
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_manager(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_price_verification_on(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_tenant(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_marketcheck_config(uuid, boolean, text, integer, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_marketcheck_config(uuid, boolean, text, integer, text, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_marketcheck_allowed(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_addendum_price(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_addendum_executed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_ready_for_signature(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_signing_reengagement(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_billing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_abandoned_signings(integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listings_with_stale_recalls(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketcheck_prune_inventory(uuid, text[]) TO authenticated;

-- Admin-only RPCs: only service_role at the API boundary; admins still pass internal has_role checks
-- when invoked from service-role contexts (edge functions / SQL).
GRANT EXECUTE ON FUNCTION public.admin_create_tenant(text, text, text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_invite_member(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_link_autocurb(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_override_entitlement(uuid, text, text, text, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_member_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_features(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_synced_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_job_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reengage_schedule() TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_reengage_abandoned_signings(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_marketcheck_sync(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unschedule_marketcheck_sync() TO authenticated;
GRANT EXECUTE ON FUNCTION public.unschedule_reengage_abandoned_signings() TO authenticated;

-- Service-role-only (edge functions / webhooks): no anon, no authenticated grant.
-- autocurb_*, merge_scraped_vdp remain restricted to service_role (which always has implicit access).

-- Trigger functions stay revoked from all client roles — they only run via triggers as their owner.
