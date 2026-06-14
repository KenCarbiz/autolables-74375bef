
-- 1) Security definer view -> security_invoker
DROP VIEW IF EXISTS public.addendum_signings_full;
CREATE VIEW public.addendum_signings_full
WITH (security_invoker = true) AS
SELECT s.id, s.tenant_id, t.name AS tenant_name, s.addendum_id, s.deal_token_id,
  s.vehicle_listing_id, s.prep_sign_off_id, s.vin, s.signer_type, s.signer_name,
  s.signer_email, s.signer_phone, s.signature_type, s.ip_address, s.content_hash,
  s.signed_at, s.acknowledgments, s.delivery_mileage
FROM public.addendum_signings s
LEFT JOIN public.tenants t ON t.id = s.tenant_id;
GRANT SELECT ON public.addendum_signings_full TO authenticated, service_role;

-- 2) Tighten always-true public RLS policies
-- tenants: only allow authenticated users to insert rows where they will be the owner
DROP POLICY IF EXISTS "Authenticated users can create tenants" ON public.tenants;
CREATE POLICY "Authenticated users can create tenants"
  ON public.tenants FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- audit_log: caller must stamp their own user id (or be service role which bypasses RLS)
DROP POLICY IF EXISTS "Auth users can insert audit events" ON public.audit_log;
CREATE POLICY "Auth users can insert audit events"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));

-- demo_requests: anon can submit but require a real-looking email and reasonable length
DROP POLICY IF EXISTS "Anyone can submit demo request" ON public.demo_requests;
CREATE POLICY "Anyone can submit demo request"
  ON public.demo_requests FOR INSERT TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL
    AND position('@' in email) > 1
    AND length(email) BETWEEN 5 AND 320
  );

-- advertised_prices: drop redundant service_role ALL policy (service role bypasses RLS)
DROP POLICY IF EXISTS "service_role full access advertised_prices" ON public.advertised_prices;

-- 3) Storage policies: scope writes to tenant ownership via first path segment
DROP POLICY IF EXISTS "Auth users can upload dealer logos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can update dealer logos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete dealer logos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view dealer logos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload listing-photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users update listing-photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users delete listing-photos" ON storage.objects;
DROP POLICY IF EXISTS "Public read listing-photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload prep-photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users update prep-photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users delete prep-photos" ON storage.objects;
DROP POLICY IF EXISTS "Public read prep-photos" ON storage.objects;

-- Helper macro inlined per policy: first path segment must be a tenant the caller belongs to.
-- Buckets stay public so files remain accessible via /storage/v1/object/public/... URLs
-- without needing a SELECT policy on storage.objects.

CREATE POLICY "dealer_logos_tenant_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dealer-logos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "dealer_logos_tenant_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dealer-logos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    bucket_id = 'dealer-logos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "dealer_logos_tenant_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'dealer-logos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "listing_photos_tenant_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'listing-photos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "listing_photos_tenant_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'listing-photos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    bucket_id = 'listing-photos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "listing_photos_tenant_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'listing-photos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "prep_photos_tenant_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'prep-photos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "prep_photos_tenant_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'prep-photos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    bucket_id = 'prep-photos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "prep_photos_tenant_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'prep-photos'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

-- 4) Revoke EXECUTE on internal SECURITY DEFINER functions from anon/authenticated.
-- These are called by triggers, cron jobs, or edge functions (service_role) and
-- should never be reachable through the public PostgREST API.
REVOKE EXECUTE ON FUNCTION public._audit_chain_before_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._audit_chain_payload(text, text, text, text, text, text, jsonb, timestamptz) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_create_tenant(text, text, text, text, text, text, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_invite_member(uuid, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_override_entitlement(uuid, text, text, text, timestamptz, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_member_role(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_tenant_active(uuid, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attach_super_admin_to_house_tenant() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.autocurb_cancel_subscription(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.autocurb_upsert_dealer(text, uuid, text, text, text, text, boolean, text, text, timestamptz, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_super_admin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_prep_gate() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_seat_limit() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_abandoned_signings(integer, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_reengage_schedule() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_invited_member_to_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.merge_scraped_vdp(uuid, text, jsonb, text, jsonb, jsonb, numeric, integer, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_signing_reengagement(uuid, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_reengage_abandoned_signings(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id_advertised_prices() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id_email_recipients() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id_leads() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id_on_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id_trade_ins() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id_vehicle_files() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id_vin_queue() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sign_deal_token(text, jsonb, text, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unschedule_reengage_abandoned_signings() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_audit_chain(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.listings_with_stale_recalls(integer) FROM anon, authenticated;
