
-- ── 1. tenants: restrict sensitive billing/PII columns to admins + service_role
REVOKE SELECT (stripe_customer_id, billing_email, primary_email, carfax_dealer_id, autocheck_dealer_id)
  ON public.tenants FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_tenant_billing(_tenant_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  stripe_customer_id text,
  billing_email text,
  primary_email text,
  carfax_dealer_id text,
  autocheck_dealer_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.name, t.stripe_customer_id, t.billing_email, t.primary_email,
         t.carfax_dealer_id, t.autocheck_dealer_id
  FROM public.tenants t
  WHERE t.id = _tenant_id
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.tenant_members m
        WHERE m.tenant_id = t.id
          AND m.user_id = (SELECT auth.uid())
          AND m.accepted_at IS NOT NULL
          AND m.role IN ('owner','admin')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_tenant_billing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_billing(uuid) TO authenticated;

-- ── 2. vehicle_listings: drop direct anon SELECT; public reads go through get_vehicle_listing_by_slug RPC
DROP POLICY IF EXISTS "Anyone can view published listings" ON public.vehicle_listings;
REVOKE SELECT ON public.vehicle_listings FROM anon;

-- ── 3. passport_sms_verifications: document hash + service-role-only access
COMMENT ON COLUMN public.passport_sms_verifications.code_hash IS
  'SHA-256 of (request_id:phone:code:server_salt) — salt is PASSPORT_SMS_CODE_SALT (falls back to service role key). Per-request salt + RLS deny-by-default (only service_role can read) make offline brute-force infeasible. Never grant SELECT to authenticated or anon.';

COMMENT ON TABLE public.passport_sms_verifications IS
  'OTP verification ledger. RLS: service_role only. All read/write must go through the verify-passport-document-request edge function.';

-- ── 4. addendum_signings: assert customer-facing writes go through SECURITY DEFINER RPC
COMMENT ON TABLE public.addendum_signings IS
  'Customer/dealer signature ledger containing PII (signer_email, signer_phone, ip_address, signature_data). Anonymous customer signings MUST be inserted via record_customer_signing() SECURITY DEFINER RPC — there is intentionally no anon INSERT policy. Do not add one; any new customer-facing signing path must extend the RPC instead.';
