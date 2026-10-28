-- ── Administration V2: server authority for settings, products and priced columns ──
--
-- The October 20 review confirmed a definition-level gap: the client decides
-- what each role may change (dealerRoleCapabilities, adminTabAccess), but
-- the server let any accepted member of a tenant rewrite dealer_profiles
-- directly, edit products and product rules, and change a listing's price or
-- recall override through the member-wide UPDATE policy. A role-aware
-- navigation is not authorization. This migration makes the server the
-- authority for the writes the Administration surfaces touch, without
-- changing how service jobs, cron and migrations work.
--
--   merge_dealer_settings            key-level authority. Pricing keys need a
--                                    pricing role, routing keys a routing
--                                    role, publishing and brand keys a
--                                    settings-managing role, service keys the
--                                    existing service list; three workspace
--                                    preference keys stay open to any member.
--                                    Every policy-class change is audited.
--   dealer_profiles                  the member-wide INSERT and UPDATE
--                                    policies are dropped, so the RPC is the
--                                    only client path. The platform-admin
--                                    policy stays. Service roles are
--                                    unaffected (RLS does not apply to them).
--   products, product_rules          writes need a role that holds
--                                    can_manage_addons; reads are unchanged.
--   vehicle_listings                 a column guard: changing price columns
--                                    needs a role that holds
--                                    can_edit_inventory; changing the recall
--                                    override columns needs a role that holds
--                                    can_manage_compliance. Service-role and
--                                    owner paths pass through.
--   TRUNCATE, REFERENCES, TRIGGER    revoked from the API roles on the four
--                                    tables; row security never governed them.
--
-- Requires 20261029000000 (tenant_role_in). Prepared with a dry-run and a
-- rollback in ADMIN_V2_SERVER_AUTHORITY.md; apply only on authorization.
-- ──────────────────────────────────────────────────────────────────────────

-- ── Settings: key-level authority ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.merge_dealer_settings(_tenant_id uuid, _patch jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_admin boolean;
  v_keys text[];
  v_touched text[];
  v_class record;
  -- Compliance and signer-authority keys: policy, settings-managing roles plus the service manager.
  v_service_keys text[] := ARRAY[
    'k208_authority_roles','k208_authorized_users',
    'require_safety_inspection','require_k208_licensee_certification',
    'service_failure_photo_required','service_reinspection_managers_only',
    'service_pass_all_enabled','service_overdue_hours'];
  v_service_roles text[] := ARRAY['owner','general_manager','gsm','admin','manager','service_manager'];
  -- Price basis and customer price presentation: the same roles the fee apply RPC accepts.
  v_pricing_keys text[] := ARRAY[
    'doc_fee_enabled','doc_fee_amount','doc_fee_state',
    'price_display_mode','price_label','comp_settings',
    'todays_price_mode','todays_price_custom','financing_disclosure_apr',
    'title_policy_no_branded'];
  v_pricing_roles text[] := ARRAY['owner','admin','general_manager','gsm'];
  -- Customer routing: settings managers and the roles that manage deals.
  v_routing_keys text[] := ARRAY[
    'passport_contact_routing','passport_agents','vehicle_agent_assignments','passport_rotation_state'];
  v_routing_roles text[] := ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance'];
  -- Publication and document policy.
  v_publishing_keys text[] := ARRAY[
    'ingest_auto_publish','document_rules','require_install_verification',
    'ingest_recon_dispatch','ingest_detail_dispatch','factory_sticker',
    'packet_module_defaults','passport_version','history_report_links_enabled'];
  -- Benefit, warranty and product presentation claims: roles that hold can_manage_addons.
  v_addon_keys text[] := ARRAY[
    'dealer_programs','oem_factory_warranties','cpo_programs',
    'product_default_mode','allow_type_override_at_signing'];
  v_addon_roles text[] := ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'];
  -- Workspace preferences any member may save from the pages that use them.
  v_member_keys text[] := ARRAY['label_defaults','used_sticker_options','inventory_show_quick_actions'];
  -- Everything else is dealership identity, brand, feature and notification
  -- configuration: roles that hold can_manage_settings.
  v_settings_roles text[] := ARRAY['owner','admin','general_manager','gsm','manager'];
BEGIN
  SELECT lower(trim(tm.role)) INTO v_role
    FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
    LIMIT 1;
  v_admin := public.has_role(v_uid, 'admin'::public.app_role);
  IF v_role IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(k), ARRAY[]::text[]) INTO v_keys
    FROM jsonb_object_keys(coalesce(_patch, '{}'::jsonb)) AS t(k);

  IF NOT v_admin THEN
    FOR v_class IN
      SELECT * FROM (VALUES
        ('service',    v_service_keys,    v_service_roles),
        ('pricing',    v_pricing_keys,    v_pricing_roles),
        ('routing',    v_routing_keys,    v_routing_roles),
        ('publishing', v_publishing_keys, v_settings_roles),
        ('addon',      v_addon_keys,      v_addon_roles)
      ) AS c(name, keys, roles)
    LOOP
      IF v_keys && v_class.keys AND NOT (v_role = ANY (v_class.roles)) THEN
        RAISE EXCEPTION 'not_authorized_for_policy_keys' USING ERRCODE = '42501', DETAIL = v_class.name;
      END IF;
    END LOOP;

    SELECT coalesce(array_agg(k), ARRAY[]::text[]) INTO v_touched
      FROM unnest(v_keys) AS t(k)
      WHERE NOT (k = ANY (v_service_keys || v_pricing_keys || v_routing_keys || v_publishing_keys || v_addon_keys || v_member_keys));
    IF array_length(v_touched, 1) > 0 AND NOT (v_role = ANY (v_settings_roles)) THEN
      RAISE EXCEPTION 'not_authorized_for_settings_keys' USING ERRCODE = '42501', DETAIL = array_to_string(v_touched, ',');
    END IF;
  END IF;

  -- Every policy-class change leaves an audit row with the keys, the values
  -- before and the values after. The service action name is unchanged so its
  -- existing readers keep working.
  FOR v_class IN
    SELECT * FROM (VALUES
      ('service_policy_changed',    v_service_keys),
      ('pricing_policy_changed',    v_pricing_keys),
      ('routing_policy_changed',    v_routing_keys),
      ('publishing_policy_changed', v_publishing_keys),
      ('addon_policy_changed',      v_addon_keys)
    ) AS c(action, keys)
  LOOP
    SELECT array_agg(k) INTO v_touched
      FROM unnest(v_keys) AS t(k)
      WHERE k = ANY (v_class.keys);
    IF v_touched IS NOT NULL THEN
      INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
      VALUES (v_class.action, 'tenant', _tenant_id::text, _tenant_id::text, v_uid,
              jsonb_build_object('keys', to_jsonb(v_touched),
                'prev', (SELECT jsonb_object_agg(k, dp.settings -> k)
                         FROM unnest(v_touched) AS k, public.dealer_profiles dp
                         WHERE dp.tenant_id = _tenant_id),
                'next', (SELECT jsonb_object_agg(k, _patch -> k) FROM unnest(v_touched) AS k)));
    END IF;
  END LOOP;

  INSERT INTO public.dealer_profiles (tenant_id, settings, updated_by)
  VALUES (_tenant_id, coalesce(_patch, '{}'::jsonb), v_uid)
  ON CONFLICT (tenant_id) DO UPDATE
    SET settings   = coalesce(dealer_profiles.settings, '{}'::jsonb) || coalesce(_patch, '{}'::jsonb),
        updated_by = v_uid;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_dealer_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_dealer_settings(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.merge_dealer_settings(uuid, jsonb) IS
  'The one client path for dealer settings. Patches only the keys sent. Each key class needs the role class that owns it on the server, mirroring the client capability map; policy-class changes are audited with before and after values.';

-- ── dealer_profiles: RPC-only for members, platform admins unchanged ────

DROP POLICY IF EXISTS dealer_profiles_update ON public.dealer_profiles;
DROP POLICY IF EXISTS dealer_profiles_insert ON public.dealer_profiles;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.dealer_profiles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dealer_profiles FROM anon;

-- ── products and product_rules: writes need can_manage_addons ───────────

DROP POLICY IF EXISTS "products tenant members write" ON public.products;
DROP POLICY IF EXISTS "products addon roles insert" ON public.products;
DROP POLICY IF EXISTS "products addon roles update" ON public.products;
DROP POLICY IF EXISTS "products addon roles delete" ON public.products;

CREATE POLICY "products addon roles insert"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'])
  );

CREATE POLICY "products addon roles update"
  ON public.products FOR UPDATE
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'])
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'])
  );

CREATE POLICY "products addon roles delete"
  ON public.products FOR DELETE
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'])
  );

DROP POLICY IF EXISTS "Tenant members write product_rules" ON public.product_rules;
DROP POLICY IF EXISTS "product_rules addon roles insert" ON public.product_rules;
DROP POLICY IF EXISTS "product_rules addon roles update" ON public.product_rules;
DROP POLICY IF EXISTS "product_rules addon roles delete" ON public.product_rules;

CREATE POLICY "product_rules addon roles insert"
  ON public.product_rules FOR INSERT
  TO authenticated
  WITH CHECK (
    public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'])
  );

CREATE POLICY "product_rules addon roles update"
  ON public.product_rules FOR UPDATE
  TO authenticated
  USING (
    public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'])
  )
  WITH CHECK (
    public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'])
  );

CREATE POLICY "product_rules addon roles delete"
  ON public.product_rules FOR DELETE
  TO authenticated
  USING (
    public.tenant_role_in(tenant_id, ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'])
  );

REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.products FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.product_rules FROM anon, authenticated;

-- ── vehicle_listings: priced and recall-override columns ─────────────────

-- SECURITY INVOKER on purpose: current_user must be the caller's role so the
-- guard can tell an API request (authenticated) from a service job
-- (service_role) or an owner-run RPC and migration (postgres).
CREATE OR REPLACE FUNCTION public.vehicle_listings_guard_priced_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_tenant uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
  v_price_changed boolean;
  v_recall_changed boolean;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_price_changed :=
       NEW.price IS DISTINCT FROM OLD.price
    OR NEW.doc_fee IS DISTINCT FROM OLD.doc_fee
    OR NEW.website_sale_price IS DISTINCT FROM OLD.website_sale_price
    OR NEW.advertised_price_before_doc IS DISTINCT FROM OLD.advertised_price_before_doc
    OR NEW.dealer_discount IS DISTINCT FROM OLD.dealer_discount
    OR NEW.retail_cash IS DISTINCT FROM OLD.retail_cash;
  v_recall_changed :=
       NEW.recall_override_by IS DISTINCT FROM OLD.recall_override_by
    OR NEW.recall_override_notes IS DISTINCT FROM OLD.recall_override_notes
    OR NEW.recall_override_at IS DISTINCT FROM OLD.recall_override_at;

  IF NOT v_price_changed AND NOT v_recall_changed THEN
    RETURN NEW;
  END IF;

  v_uid := (SELECT auth.uid());
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- A tenantless draft is its creator's own; the insert policy bound it.
  IF v_tenant IS NULL THEN
    IF OLD.created_by = v_uid THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'not authorized to change this listing' USING ERRCODE = '42501';
  END IF;

  IF v_price_changed AND NOT public.tenant_role_in(v_tenant, ARRAY['owner','admin','general_manager','gsm','manager','inventory_manager','used_car_manager']) THEN
    RAISE EXCEPTION 'not authorized to change vehicle pricing' USING ERRCODE = '42501';
  END IF;
  IF v_recall_changed AND NOT public.tenant_role_in(v_tenant, ARRAY['owner','admin','general_manager','gsm','manager','compliance','office','finance']) THEN
    RAISE EXCEPTION 'not authorized to override a recall' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_vehicle_listings_priced_columns_guard ON public.vehicle_listings;
CREATE TRIGGER trg_vehicle_listings_priced_columns_guard
  BEFORE UPDATE OF price, doc_fee, website_sale_price, advertised_price_before_doc, dealer_discount, retail_cash,
                   recall_override_by, recall_override_notes, recall_override_at
  ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.vehicle_listings_guard_priced_columns();

COMMENT ON FUNCTION public.vehicle_listings_guard_priced_columns() IS
  'Column-level authority on vehicle_listings for API callers: price columns need a role that holds can_edit_inventory, recall override columns a role that holds can_manage_compliance. Service jobs, cron and owner-run RPCs are not API callers and pass through.';

REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.vehicle_listings FROM anon, authenticated;
