-- 1. Lock bootstrap_tenant to the starter 'essential' trial tier
CREATE OR REPLACE FUNCTION public.bootstrap_tenant(
  _name text,
  _slug text,
  _source text DEFAULT 'autolabels'::text,
  _app_slug text DEFAULT 'autolabels'::text,
  _plan_tier text DEFAULT 'essential'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_user UUID := (SELECT auth.uid());
  v_source TEXT;
  v_app_slug TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'must be signed in';
  END IF;

  v_source := CASE
    WHEN _source IN ('autolabels', 'autocurb', 'manual') THEN _source
    ELSE 'autolabels'
  END;

  v_app_slug := CASE
    WHEN _app_slug IN ('autolabels', 'autocurb', 'autoframe', 'autovideo') THEN _app_slug
    ELSE 'autolabels'
  END;

  INSERT INTO public.tenants (name, slug, source)
  VALUES (_name, _slug, v_source)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at, invited_by)
  VALUES (v_tenant_id, v_user, 'owner', now(), v_user);

  INSERT INTO public.onboarding_profiles (tenant_id, source)
  VALUES (v_tenant_id, v_source);

  -- Always provision the entry 'essential' trial tier; paid tiers require verified billing.
  INSERT INTO public.app_entitlements (tenant_id, app_slug, plan_tier, status, trial_ends_at)
  VALUES (v_tenant_id, v_app_slug, 'essential', 'trial', now() + INTERVAL '14 days');

  RETURN v_tenant_id;
END;
$function$;

-- 2. Remove direct tenant owner/admin writes on app_entitlements and add server-verified bundle RPC
DROP POLICY IF EXISTS "Admins write entitlements" ON public.app_entitlements;

CREATE OR REPLACE FUNCTION public.activate_bundled_entitlement(
  _tenant_id uuid,
  _app_slug text DEFAULT 'autolabels'::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := (SELECT auth.uid());
  v_is_manager BOOLEAN;
  v_has_bundle BOOLEAN;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF _app_slug <> 'autolabels' THEN
    RAISE EXCEPTION 'only autolabels bundled activation is supported';
  END IF;

  v_is_manager := public.has_role(v_user, 'admin'::public.app_role) OR EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id
      AND tm.user_id = v_user
      AND tm.role IN ('owner', 'admin')
      AND tm.accepted_at IS NOT NULL
  );

  IF NOT v_is_manager THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_has_bundle := EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = _tenant_id AND t.source = 'autocurb'
  ) OR EXISTS (
    SELECT 1 FROM public.app_entitlements ae
    WHERE ae.tenant_id = _tenant_id
      AND ae.app_slug = 'autocurb'
      AND ae.status IN ('active', 'trial')
      AND (ae.expires_at IS NULL OR ae.expires_at > now())
  );

  IF NOT v_has_bundle THEN
    RAISE EXCEPTION 'tenant is not eligible for bundled activation';
  END IF;

  INSERT INTO public.app_entitlements (tenant_id, app_slug, plan_tier, status, trial_ends_at, metadata)
  VALUES (
    _tenant_id,
    'autolabels',
    'essential',
    'active',
    NULL,
    jsonb_build_object('source', 'activate_bundled_entitlement', 'activated_by', v_user)
  )
  ON CONFLICT (tenant_id, app_slug) DO UPDATE
  SET status = CASE
        WHEN public.app_entitlements.status IN ('active', 'trial') THEN public.app_entitlements.status
        ELSE 'active'
      END,
      plan_tier = CASE
        WHEN public.app_entitlements.status IN ('active', 'trial') THEN public.app_entitlements.plan_tier
        ELSE 'essential'
      END,
      updated_at = now();

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_bundled_entitlement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_bundled_entitlement(uuid, text) TO authenticated;

-- 3. Disable self-claim in public.claim_platform(): require existing platform admin role
CREATE OR REPLACE FUNCTION public.claim_platform()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := (SELECT auth.uid());
  v_email TEXT;
  v_tenant_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.has_role(v_user, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user;

  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'autolabels';
  IF v_tenant_id IS NULL THEN
    INSERT INTO public.tenants (name, slug, domain, primary_email, source, is_active)
    VALUES ('AutoLabels.io', 'autolabels', 'autolabels.io', v_email, 'manual', true)
    RETURNING id INTO v_tenant_id;
  END IF;

  INSERT INTO public.onboarding_profiles (tenant_id, display_name, tagline, source, completed_at)
  VALUES (v_tenant_id, 'AutoLabels.io', 'Clear. Compliant. Consistent.', 'manual', now())
  ON CONFLICT (tenant_id) DO UPDATE SET completed_at = COALESCE(public.onboarding_profiles.completed_at, now());

  INSERT INTO public.app_entitlements (tenant_id, app_slug, plan_tier, status, expires_at, metadata)
  VALUES (
    v_tenant_id,
    'autolabels',
    'unlimited',
    'active',
    NULL,
    jsonb_build_object('source', 'claim_platform_rpc', 'refreshed_by', v_user)
  )
  ON CONFLICT (tenant_id, app_slug) DO UPDATE SET plan_tier = 'unlimited', status = 'active', expires_at = NULL;

  INSERT INTO public.tenant_members (tenant_id, user_id, invited_email, role, accepted_at, invited_by)
  VALUES (v_tenant_id, v_user, v_email, 'owner', now(), v_user)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner', accepted_at = COALESCE(public.tenant_members.accepted_at, now());

  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, user_email, details)
  VALUES (
    'platform_house_tenant_refreshed',
    'platform',
    v_tenant_id::text,
    v_user,
    v_email,
    jsonb_build_object('already_admin', true)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_admin', true,
    'tenant_id', v_tenant_id,
    'message', 'You are already an admin. House-tenant membership and entitlement refreshed.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_platform() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_platform() TO authenticated;

-- 4. Require confirmed email before linking invited tenant_members rows
CREATE OR REPLACE FUNCTION public.link_invited_member_to_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email_confirmed_at IS NULL OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.tenant_members
  SET user_id = NEW.id,
      accepted_at = COALESCE(accepted_at, now())
  WHERE lower(invited_email) = lower(NEW.email)
    AND (user_id IS NULL OR user_id = NEW.id);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS link_invited_member_to_user ON auth.users;
CREATE TRIGGER link_invited_member_to_user
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.link_invited_member_to_user();

CREATE OR REPLACE FUNCTION public.admin_create_tenant(
  _name TEXT,
  _slug TEXT,
  _domain TEXT,
  _owner_email TEXT,
  _app_slug TEXT DEFAULT 'autolabels',
  _plan_tier TEXT DEFAULT 'essential',
  _trial_days INTEGER DEFAULT 14
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_existing_user UUID;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;
  IF _owner_email IS NULL OR _owner_email NOT LIKE '%@%' THEN
    RAISE EXCEPTION 'valid owner_email required';
  END IF;

  INSERT INTO public.tenants (name, slug, domain, primary_email, source, is_active)
  VALUES (
    _name,
    COALESCE(_slug, lower(regexp_replace(_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' ||
             substring(md5(random()::text) for 4)),
    _domain,
    _owner_email,
    'manual',
    true
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.onboarding_profiles (tenant_id, display_name, source, completed_at)
  VALUES (v_tenant_id, _name, 'manual', now());

  INSERT INTO public.app_entitlements (tenant_id, app_slug, plan_tier, status, trial_ends_at, metadata)
  VALUES (
    v_tenant_id, _app_slug, _plan_tier,
    CASE WHEN _trial_days > 0 THEN 'trial' ELSE 'active' END,
    CASE WHEN _trial_days > 0 THEN now() + (_trial_days || ' days')::INTERVAL ELSE NULL END,
    jsonb_build_object('created_by_admin', (SELECT auth.uid()), 'source', 'admin_create_tenant')
  );

  SELECT id INTO v_existing_user
  FROM auth.users
  WHERE lower(email) = lower(_owner_email)
    AND email_confirmed_at IS NOT NULL
  LIMIT 1;

  IF v_existing_user IS NOT NULL THEN
    INSERT INTO public.tenant_members (tenant_id, user_id, invited_email, role, accepted_at, invited_by)
    VALUES (v_tenant_id, v_existing_user, _owner_email, 'owner', now(), (SELECT auth.uid()))
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';
  ELSE
    INSERT INTO public.tenant_members (tenant_id, invited_email, role, invited_by)
    VALUES (v_tenant_id, _owner_email, 'owner', (SELECT auth.uid()))
    ON CONFLICT (tenant_id, invited_email) DO NOTHING;
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, details)
  VALUES (
    'tenant_created', 'tenant', v_tenant_id::text, (SELECT auth.uid()),
    jsonb_build_object('name', _name, 'owner_email', _owner_email, 'app_slug', _app_slug, 'plan_tier', _plan_tier)
  );

  RETURN v_tenant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_invite_member(
  _tenant_id UUID,
  _email TEXT,
  _role TEXT DEFAULT 'staff'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_existing_user UUID;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _email IS NULL OR _email NOT LIKE '%@%' THEN
    RAISE EXCEPTION 'valid email required';
  END IF;
  IF _role NOT IN ('owner','admin','manager','staff') THEN
    RAISE EXCEPTION 'invalid role %', _role;
  END IF;

  SELECT id INTO v_existing_user
  FROM auth.users
  WHERE lower(email) = lower(_email)
    AND email_confirmed_at IS NOT NULL
  LIMIT 1;

  IF v_existing_user IS NOT NULL THEN
    INSERT INTO public.tenant_members (tenant_id, user_id, invited_email, role, accepted_at, invited_by)
    VALUES (_tenant_id, v_existing_user, _email, _role, now(), (SELECT auth.uid()))
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = _role
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.tenant_members (tenant_id, invited_email, role, invited_by)
    VALUES (_tenant_id, _email, _role, (SELECT auth.uid()))
    ON CONFLICT (tenant_id, invited_email) DO UPDATE SET role = _role
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, details)
  VALUES (
    'member_invited', 'tenant_member', v_id::text, (SELECT auth.uid()),
    jsonb_build_object('tenant_id', _tenant_id, 'email', _email, 'role', _role)
  );

  RETURN v_id;
END;
$function$;

-- 5. Lock deal_signing_tokens so authenticated users can only insert pending rows and update pending -> revoked
DROP POLICY IF EXISTS "Tenant members create deal tokens" ON public.deal_signing_tokens;
CREATE POLICY "Tenant members create deal tokens"
  ON public.deal_signing_tokens FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (tenant_id IS NULL OR tenant_id = public.current_tenant_id())
    AND status = 'pending'
    AND signed_at IS NULL
    AND signed_payload IS NULL
    AND content_hash IS NULL
    AND esign_consent IS NULL
    AND customer_ip IS NULL
    AND user_agent IS NULL
    AND revoked_at IS NULL
  );

DROP POLICY IF EXISTS "Creator can revoke deal tokens" ON public.deal_signing_tokens;
CREATE POLICY "Creator can revoke deal tokens"
  ON public.deal_signing_tokens FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND (created_by = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  )
  WITH CHECK (
    status = 'revoked'
    AND revoked_at IS NOT NULL
    AND signed_at IS NULL
    AND signed_payload IS NULL
    AND content_hash IS NULL
    AND esign_consent IS NULL
    AND customer_ip IS NULL
    AND user_agent IS NULL
  );

-- 6. Restrict ct_mvp_certification_runs writes to tenant managers and validate readiness server-side
DROP POLICY IF EXISTS "ct_mvp_certification_runs tenant members write" ON public.ct_mvp_certification_runs;
DROP POLICY IF EXISTS "ct_mvp_certification_runs managers insert" ON public.ct_mvp_certification_runs;

CREATE POLICY "ct_mvp_certification_runs managers insert"
  ON public.ct_mvp_certification_runs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.tenant_id = ct_mvp_certification_runs.tenant_id
        AND tm.user_id = (SELECT auth.uid())
        AND tm.accepted_at IS NOT NULL
        AND tm.role IN (
          'owner', 'admin', 'general_manager', 'gsm', 'manager',
          'sales_manager', 'used_car_manager', 'inventory_manager', 'compliance_manager'
        )
    )
  );

CREATE OR REPLACE FUNCTION public.validate_ct_mvp_certification_run()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_checks_valid BOOLEAN := false;
  v_has_open_issue BOOLEAN := true;
  v_has_doc_evidence BOOLEAN := true;
  v_vin_upper TEXT;
BEGIN
  IF NEW.vehicle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicle_listings vl
      WHERE vl.id = NEW.vehicle_id AND vl.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'vehicle_id does not belong to tenant';
    END IF;
  END IF;

  IF jsonb_typeof(NEW.checks) = 'array' AND jsonb_array_length(NEW.checks) > 0 THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.checks) AS elem
      WHERE coalesce(elem->>'status', '') NOT IN ('pass', 'skip')
    ) INTO v_checks_valid;
    v_has_open_issue := NOT v_checks_valid;
  END IF;

  IF NEW.ready IS TRUE THEN
    IF v_has_open_issue THEN
      NEW.ready := false;
    ELSIF NEW.source = 'admin-smoke-test' THEN
      IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
        NEW.ready := false;
      END IF;
    ELSE
      v_vin_upper := NULLIF(upper(trim(coalesce(NEW.vin, ''))), '');
      IF NEW.vehicle_id IS NULL AND v_vin_upper IS NULL THEN
        NEW.ready := false;
      ELSE
        -- Verify at least one independent stored compliance artifact exists for this tenant & vehicle/VIN
        SELECT EXISTS (
          SELECT 1 FROM public.generated_documents gd
          WHERE gd.tenant_id = NEW.tenant_id
            AND ((NEW.vehicle_id IS NOT NULL AND gd.vehicle_id = NEW.vehicle_id)
                 OR (v_vin_upper IS NOT NULL AND upper(gd.vin) = v_vin_upper))
        ) OR EXISTS (
          SELECT 1 FROM public.document_lifecycle_events dle
          WHERE dle.tenant_id = NEW.tenant_id
            AND ((NEW.vehicle_id IS NOT NULL AND dle.vehicle_id = NEW.vehicle_id)
                 OR (v_vin_upper IS NOT NULL AND upper(dle.vin) = v_vin_upper))
        ) OR EXISTS (
          SELECT 1 FROM public.safety_inspections si
          WHERE si.tenant_id = NEW.tenant_id
            AND ((NEW.vehicle_id IS NOT NULL AND si.vehicle_listing_id = NEW.vehicle_id)
                 OR (v_vin_upper IS NOT NULL AND upper(si.vin) = v_vin_upper))
        ) INTO v_has_doc_evidence;

        IF NOT v_has_doc_evidence THEN
          NEW.ready := false;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_ct_mvp_certification_run ON public.ct_mvp_certification_runs;
CREATE TRIGGER validate_ct_mvp_certification_run
  BEFORE INSERT ON public.ct_mvp_certification_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_ct_mvp_certification_run();

-- 7. Allowlist _origin inside request_signing_link_resend
CREATE OR REPLACE FUNCTION public.request_signing_link_resend(
  _vin text,
  _contact text,
  _origin text DEFAULT 'https://autolabels.io'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _vin_norm TEXT;
  _contact_norm TEXT;
  _phone_digits TEXT;
  _sig RECORD;
  _safe_origin TEXT;
BEGIN
  _vin_norm := upper(trim(_vin));
  _contact_norm := lower(trim(_contact));
  _phone_digits := regexp_replace(_contact_norm, '\D', '', 'g');
  IF length(_vin_norm) <> 17 OR length(_contact_norm) = 0 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  _safe_origin := rtrim(lower(trim(coalesce(_origin, ''))), '/');
  IF _safe_origin NOT IN (
    'https://autolabels.io',
    'https://www.autolabels.io',
    'https://app.autolabels.io',
    'https://autolables.lovable.app',
    'https://autosticker.io',
    'https://www.autosticker.io',
    'https://marketpass.io',
    'https://www.marketpass.io'
  ) THEN
    _safe_origin := 'https://autolabels.io';
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, details)
  VALUES (
    'signing_link_lookup_attempt', 'vin', _vin_norm,
    jsonb_build_object(
      'contact_kind', CASE WHEN position('@' in _contact_norm) > 0 THEN 'email' ELSE 'phone' END,
      'when', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );

  SELECT s.id, s.signer_email, a.signing_token, a.vehicle_ymm, a.dealer_snapshot
    INTO _sig
    FROM public.addendum_signings s
    JOIN public.addendums a ON a.id = s.addendum_id
   WHERE s.signer_type = 'customer'
     AND upper(s.vin) = _vin_norm
     AND (
       (position('@' in _contact_norm) > 0 AND lower(s.signer_email) = _contact_norm)
       OR (position('@' in _contact_norm) = 0 AND _phone_digits <> ''
           AND regexp_replace(coalesce(s.signer_phone, ''), '\D', '', 'g') = _phone_digits)
     )
   ORDER BY s.signed_at DESC NULLS LAST
   LIMIT 1;

  IF _sig.id IS NULL OR _sig.signer_email IS NULL OR _sig.signing_token IS NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, details)
  VALUES (
    'signing_link_resent', 'addendum_signing', _sig.id::text,
    jsonb_build_object('vin', _vin_norm, 'ymm', _sig.vehicle_ymm)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'dispatch', jsonb_build_object(
      'email', _sig.signer_email,
      'signing_url', _safe_origin || '/sign/' || _sig.signing_token::text,
      'ymm', _sig.vehicle_ymm,
      'dealer_name', _sig.dealer_snapshot ->> 'name'
    )
  );
END;
$function$;

-- 8. Sanitize watcher name on watch_price insert/update
CREATE OR REPLACE FUNCTION public.watch_price(
  _slug text,
  _email text,
  _name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text;
  v_tenant uuid;
  v_slug text;
  v_price numeric;
  v_email text;
  v_name text;
BEGIN
  v_email := lower(btrim(coalesce(_email, '')));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_email');
  END IF;

  v_name := nullif(left(btrim(regexp_replace(coalesce(_name, ''), '[<>"''\r\n\t]', '', 'g')), 80), '');

  SELECT vin, tenant_id, slug, price INTO v_vin, v_tenant, v_slug, v_price
    FROM public.vehicle_listings
   WHERE (slug = _slug OR vin = upper(_slug))
     AND status = 'published'
   ORDER BY (slug = _slug) DESC
   LIMIT 1;
  IF v_vin IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  INSERT INTO public.price_watchers (tenant_id, vin, slug, email, name, last_price)
  VALUES (v_tenant, v_vin, v_slug, v_email, v_name, v_price)
  ON CONFLICT (vin, email) DO UPDATE
    SET slug = EXCLUDED.slug,
        name = COALESCE(EXCLUDED.name, public.price_watchers.name),
        last_price = COALESCE(public.price_watchers.last_price, EXCLUDED.last_price);
  RETURN jsonb_build_object('ok', true);
END;
$function$;
