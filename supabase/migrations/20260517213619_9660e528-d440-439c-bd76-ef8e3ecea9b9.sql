-- autocurb_upsert_dealer + cancel
CREATE OR REPLACE FUNCTION public.autocurb_upsert_dealer(
  p_autocurb_tenant_id TEXT, p_user_id UUID, p_user_email TEXT, p_dealer_name TEXT,
  p_state TEXT, p_autocurb_tier TEXT, p_bundle_autolabels BOOLEAN,
  p_autolabels_tier TEXT DEFAULT 'essential',
  p_stripe_subscription_id TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_stripe_customer_id TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant_id UUID; _slug TEXT;
BEGIN
  _slug := lower(regexp_replace(coalesce(p_dealer_name,'dealer')||'-'||right(p_autocurb_tenant_id,6),'[^a-z0-9]+','-','g'));
  INSERT INTO public.tenants AS t (name, slug, source, autocurb_tenant_id, primary_email, billing_email, stripe_customer_id, is_active)
  VALUES (p_dealer_name, _slug, 'autocurb', p_autocurb_tenant_id, p_user_email, p_user_email, p_stripe_customer_id, true)
  ON CONFLICT (autocurb_tenant_id) DO UPDATE
    SET name = EXCLUDED.name, primary_email = EXCLUDED.primary_email,
        stripe_customer_id = coalesce(EXCLUDED.stripe_customer_id, t.stripe_customer_id),
        is_active = true, updated_at = now()
  RETURNING id INTO _tenant_id;
  IF _tenant_id IS NULL THEN
    SELECT id INTO _tenant_id FROM public.tenants WHERE autocurb_tenant_id = p_autocurb_tenant_id LIMIT 1;
  END IF;
  INSERT INTO public.tenant_members (user_id, tenant_id, role)
  VALUES (p_user_id, _tenant_id, 'owner')
  ON CONFLICT (user_id, tenant_id) DO UPDATE
    SET role = CASE WHEN public.tenant_members.role='owner' THEN 'owner' ELSE EXCLUDED.role END;
  INSERT INTO public.onboarding_profiles (tenant_id, display_name, phone, stores)
  VALUES (_tenant_id, p_dealer_name, NULL,
    jsonb_build_array(jsonb_build_object('name', p_dealer_name, 'state', coalesce(p_state,''))))
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.app_entitlements (tenant_id, app_slug, plan_tier, status, activated_at, expires_at, stripe_subscription_id)
  VALUES (_tenant_id, 'autocurb', coalesce(p_autocurb_tier,'essential'), 'active', now(), p_expires_at, p_stripe_subscription_id)
  ON CONFLICT (tenant_id, app_slug) DO UPDATE
    SET plan_tier = EXCLUDED.plan_tier, status='active', renewed_at = now(),
        expires_at = EXCLUDED.expires_at,
        stripe_subscription_id = coalesce(EXCLUDED.stripe_subscription_id, public.app_entitlements.stripe_subscription_id),
        updated_at = now();
  IF p_bundle_autolabels THEN
    INSERT INTO public.app_entitlements (tenant_id, app_slug, plan_tier, status, activated_at, expires_at, stripe_subscription_id)
    VALUES (_tenant_id, 'autolabels', coalesce(p_autolabels_tier,'essential'), 'active', now(), p_expires_at, p_stripe_subscription_id)
    ON CONFLICT (tenant_id, app_slug) DO UPDATE
      SET plan_tier = EXCLUDED.plan_tier, status='active', renewed_at = now(),
          expires_at = EXCLUDED.expires_at,
          stripe_subscription_id = coalesce(EXCLUDED.stripe_subscription_id, public.app_entitlements.stripe_subscription_id),
          updated_at = now();
  END IF;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_email, details)
  VALUES ('subscription_activated','app_entitlement', _tenant_id::text, _tenant_id::text, p_user_email,
    jsonb_build_object('source','autocurb_stripe_webhook','autocurb_tier',p_autocurb_tier,
      'bundle_autolabels',p_bundle_autolabels,
      'autolabels_tier', CASE WHEN p_bundle_autolabels THEN p_autolabels_tier ELSE NULL END,
      'stripe_subscription_id', p_stripe_subscription_id));
  RETURN _tenant_id;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_autocurb_tenant_id
  ON public.tenants (autocurb_tenant_id) WHERE autocurb_tenant_id IS NOT NULL;

GRANT EXECUTE ON FUNCTION public.autocurb_upsert_dealer(
  TEXT, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.autocurb_cancel_subscription(p_stripe_subscription_id TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n INTEGER;
BEGIN
  UPDATE public.app_entitlements SET status='canceled', updated_at = now()
   WHERE stripe_subscription_id = p_stripe_subscription_id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.autocurb_cancel_subscription(TEXT) TO authenticated, service_role;

-- listings_with_stale_recalls (store_id is TEXT, not UUID)
CREATE OR REPLACE FUNCTION public.listings_with_stale_recalls(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  id UUID, tenant_id UUID, store_id TEXT, vin TEXT, ymm TEXT, slug TEXT,
  published_at TIMESTAMPTZ, recall_checked_at TIMESTAMPTZ, status TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT vl.id, vl.tenant_id, vl.store_id, vl.vin, vl.ymm, vl.slug, vl.published_at,
    (vl.recall_check ->> 'checked_at')::TIMESTAMPTZ AS recall_checked_at,
    CASE
      WHEN vl.recall_check IS NULL OR (vl.recall_check ->> 'checked_at') IS NULL THEN 'missing'
      WHEN (vl.recall_check ->> 'checked_at')::TIMESTAMPTZ < now() - INTERVAL '30 days' THEN 'stale'
      ELSE 'fresh'
    END AS status
   FROM public.vehicle_listings vl
   WHERE vl.status='published'
     AND (vl.recall_check IS NULL OR (vl.recall_check ->> 'checked_at') IS NULL
          OR (vl.recall_check ->> 'checked_at')::TIMESTAMPTZ < now() - INTERVAL '30 days')
   ORDER BY vl.published_at DESC NULLS LAST
   LIMIT GREATEST(p_limit, 0);
$$;
GRANT EXECUTE ON FUNCTION public.listings_with_stale_recalls(INTEGER) TO authenticated, service_role;

-- request_signing_link_resend
CREATE OR REPLACE FUNCTION public.request_signing_link_resend(
  _vin TEXT, _contact TEXT, _origin TEXT DEFAULT 'https://autolabels.io'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _vin_norm TEXT; _contact_norm TEXT; _phone_digits TEXT; _sig RECORD;
BEGIN
  _vin_norm := upper(trim(_vin));
  _contact_norm := lower(trim(_contact));
  _phone_digits := regexp_replace(_contact_norm, '\D', '', 'g');
  IF length(_vin_norm) <> 17 OR length(_contact_norm) = 0 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  INSERT INTO public.audit_log (action, entity_type, entity_id, details)
  VALUES ('signing_link_lookup_attempt','vin', _vin_norm,
    jsonb_build_object(
      'contact_kind', CASE WHEN position('@' in _contact_norm) > 0 THEN 'email' ELSE 'phone' END,
      'when', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  SELECT s.id, s.signer_email, a.signing_token, a.vehicle_ymm, a.dealer_snapshot
    INTO _sig
    FROM public.addendum_signings s
    JOIN public.addendums a ON a.id = s.addendum_id
   WHERE s.signer_type='customer' AND upper(s.vin) = _vin_norm
     AND ((position('@' in _contact_norm) > 0 AND lower(s.signer_email) = _contact_norm)
          OR (position('@' in _contact_norm) = 0 AND _phone_digits <> ''
              AND regexp_replace(coalesce(s.signer_phone,''),'\D','','g') = _phone_digits))
   ORDER BY s.signed_at DESC NULLS LAST LIMIT 1;
  IF _sig.id IS NULL OR _sig.signer_email IS NULL OR _sig.signing_token IS NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  INSERT INTO public.audit_log (action, entity_type, entity_id, details)
  VALUES ('signing_link_resent','addendum_signing', _sig.id::text,
    jsonb_build_object('vin', _vin_norm, 'ymm', _sig.vehicle_ymm));
  RETURN jsonb_build_object('ok', true,
    'dispatch', jsonb_build_object(
      'email', _sig.signer_email,
      'signing_url', _origin || '/sign/' || _sig.signing_token::text,
      'ymm', _sig.vehicle_ymm,
      'dealer_name', _sig.dealer_snapshot ->> 'name'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_signing_link_resend(TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- Stamp original filename versions
INSERT INTO supabase_migrations.schema_migrations (version) VALUES
  ('20260419010000'), ('20260419030000'), ('20260419050000'), ('20260419080000'),
  ('20260419090000'), ('20260419100000'), ('20260419110000'), ('20260419120000'),
  ('20260517020000'), ('20260518000000'), ('20260518100000'), ('20260518200000')
ON CONFLICT (version) DO NOTHING;