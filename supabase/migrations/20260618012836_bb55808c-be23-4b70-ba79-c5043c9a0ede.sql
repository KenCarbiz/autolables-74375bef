
-- Add accepted_at IS NOT NULL check to RLS policies that referenced tenant_members without it

-- dealer_profiles INSERT
DROP POLICY IF EXISTS dealer_profiles_insert ON public.dealer_profiles;
CREATE POLICY dealer_profiles_insert ON public.dealer_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role((SELECT auth.uid()), 'admin'::app_role)
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS dealer_profiles_select ON public.dealer_profiles;
CREATE POLICY dealer_profiles_select ON public.dealer_profiles
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'admin'::app_role)
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS dealer_profiles_update ON public.dealer_profiles;
CREATE POLICY dealer_profiles_update ON public.dealer_profiles
  FOR UPDATE TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'admin'::app_role)
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    has_role((SELECT auth.uid()), 'admin'::app_role)
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

-- evidence_receipts SELECT
DROP POLICY IF EXISTS evidence_receipts_tenant_read ON public.evidence_receipts;
CREATE POLICY evidence_receipts_tenant_read ON public.evidence_receipts
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
    OR has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- product-docs storage policies
DROP POLICY IF EXISTS product_docs_read ON storage.objects;
CREATE POLICY product_docs_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'product-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS product_docs_write ON storage.objects;
CREATE POLICY product_docs_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS product_docs_update ON storage.objects;
CREATE POLICY product_docs_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS product_docs_delete ON storage.objects;
CREATE POLICY product_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

-- Set search_path on enforce_price_verified_before_sign
CREATE OR REPLACE FUNCTION public.enforce_price_verified_before_sign()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'signed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'signed')
     AND COALESCE(NEW.price_verified, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'price not verified: addendum cannot be signed (status=%)',
      COALESCE(NEW.price_verification_status, 'pending')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
