-- AutoLabels hosted schema fingerprint. READ ONLY: one SELECT over the catalogs and, only where the
-- table exists, the rtgip delivery_config row. No temp objects, no writes, no side-effect functions,
-- AccessShare locks only. Run as postgres (or any role that can read pg_catalog).
--
-- integration_claim_inbox and integration_apply_event are owned by S3 (the foundation replaces the spine bodies);
-- consumer_effect is owned by E (D only installs the refusing default).
-- Output: one jsonb document.
--   prerequisites  objects the RooftopOS components assume (tenants, tenant_members, dealer_stores.status,
--                  vehicle_listings.owning_store_id, ...). Each is present true/false with detail.
--   components     S1 spine, S2 store registry, S3 vehicle history (PR #46 foundation), D delivery,
--                  R readers, E effects. state = installed | partial | missing; digest = md5 over the
--                  present objects (function bodies by md5(prosrc), so it does not depend on the PG major).
--   security       RLS state and anon/authenticated privileges on every table of the RooftopOS components,
--                  SECURITY DEFINER functions without a pinned search_path, API-role EXECUTE on them.
--   roles          the rtgip roles: present, NOLOGIN, NOINHERIT, memberships.
--   consumer_effect  body the shared inbox runs (D default refuses with no_consumer; E sets labels_apply).
--   transport      rtgip.delivery_config row if D is installed (transport_enabled must stay false).
WITH fn(component, name, marker) AS (VALUES
  ('S1','public.integration_key_secret',NULL), ('S1','public.integration_record_source_version',NULL),
  ('S1','public.integration_connection_secrets',NULL), ('S1','public.integration_fail_inbox',NULL),
  ('S2','public.tenant_store_registry',NULL),
  ('S2','public.apply_payment_estimator_settings','dealer_stores'),
  ('S3','public.integration_claim_inbox','vehicle_history_flag'), ('S3','public.integration_apply_event','vehicle_history_flag'),
  ('S3','public.integration_delivery_allowed',NULL), ('S3','public.integration_quarantine',NULL),
  ('S3','public.integration_replay_inbox',NULL), ('S3','public.repair_items_record_status',NULL),
  ('S3','public.vehicle_history_append_only',NULL), ('S3','public.vehicle_history_apply_identity_correction',NULL),
  ('S3','public.vehicle_history_audit_write',NULL), ('S3','public.vehicle_history_backfill_tenant',NULL),
  ('S3','public.vehicle_history_can_read',NULL), ('S3','public.vehicle_history_effective_setting',NULL),
  ('S3','public.vehicle_history_end_access',NULL), ('S3','public.vehicle_history_flag',NULL),
  ('S3','public.vehicle_history_flag_reappearance',NULL), ('S3','public.vehicle_history_grant_access',NULL),
  ('S3','public.vehicle_history_is_manager',NULL), ('S3','public.vehicle_history_is_platform_admin',NULL),
  ('S3','public.vehicle_history_is_service',NULL), ('S3','public.vehicle_history_next_state',NULL),
  ('S3','public.vehicle_history_owner_view',NULL), ('S3','public.vehicle_history_record_milestone',NULL),
  ('S3','public.vehicle_history_resolve_reappearance',NULL), ('S3','public.vehicle_history_set_setting',NULL),
  ('S3','public.vehicle_history_set_transaction_retention',NULL), ('S3','public.vehicle_instances_custody_guard',NULL),
  ('D','rtgip.audit_log_immutable',NULL), ('D','rtgip.canonical_json',NULL), ('D','rtgip.claim_nonce',NULL),
  ('D','rtgip.clock',NULL), ('D','rtgip.ct_equal',NULL),
  ('D','rtgip.deliverable_reason',NULL), ('D','rtgip.delivery_identity',NULL), ('D','rtgip.derive_event_id',NULL),
  ('D','rtgip.envelope_sha',NULL), ('D','rtgip.inbox_admit',NULL), ('D','rtgip.inbox_deliveries_guard',NULL),
  ('D','rtgip.inbox_receive',NULL), ('D','rtgip.inbox_record_receipts',NULL), ('D','rtgip.local_app',NULL),
  ('D','rtgip.outbox_advance',NULL), ('D','rtgip.outbox_claim',NULL), ('D','rtgip.outbox_enqueue',NULL),
  ('D','rtgip.outbox_fail',NULL), ('D','rtgip.outbox_guard',NULL), ('D','rtgip.outbox_redrive',NULL),
  ('D','rtgip.purge_expired_nonces',NULL), ('D','rtgip.receipt_canonical',NULL),
  ('D','rtgip.receipt_check_signature',NULL), ('D','rtgip.receipt_verify',NULL), ('D','rtgip.refusal_class',NULL),
  ('D','rtgip.watermark_key',NULL),
  ('R','rtgip_src.labels_authority',NULL), ('R','rtgip_src.labels_episode_history',NULL),
  ('R','rtgip_src.labels_episode_json',NULL), ('R','rtgip_src.labels_episode_milestones',NULL),
  ('R','rtgip_src.labels_listing_state',NULL), ('R','rtgip_src.labels_milestone_json',NULL),
  ('E','rtgip_fx.append_only',NULL), ('E','rtgip_fx.envelope_sha',NULL), ('E','rtgip_fx.labels_apply',NULL),
  ('E','rtgip_fx.labels_effect',NULL),
  ('E','rtgip.consumer_effect','labels_apply')
), tb(component, name) AS (VALUES
  ('S1','public.vehicles'), ('S1','public.vehicle_instances'), ('S1','public.vehicle_external_refs'),
  ('S1','public.integration_connections'), ('S1','public.integration_connection_keys'),
  ('S1','public.integration_inbox'), ('S1','public.integration_source_versions'), ('S1','public.integration_outbox'),
  ('S1','public.integration_direction_flags'), ('S1','public.inspection_evidence'), ('S1','public.repair_items'),
  ('S1','public.acquisition_records'),
  ('S3','public.vehicle_identity_quarantine'), ('S3','public.vehicle_identity_corrections'),
  ('S3','public.vehicle_custody_milestones'), ('S3','public.service_visits'),
  ('S3','public.repair_item_status_history'), ('S3','public.vehicle_reappearance_reviews'),
  ('S3','public.vehicle_access_grants'), ('S3','public.vehicle_history_setting_keys'),
  ('S3','public.vehicle_history_settings'), ('S3','public.vehicle_history_audit'),
  ('D','rtgip.delivery_config'), ('D','rtgip.connections'), ('D','rtgip.signing_keys'), ('D','rtgip.nonce_claims'),
  ('D','rtgip.outbox'), ('D','rtgip.receipts'), ('D','rtgip.inbox'), ('D','rtgip.inbox_conflicts'),
  ('D','rtgip.inbox_deliveries'), ('D','rtgip.admissions'), ('D','rtgip.event_catalog'),
  ('D','rtgip.forbidden_keys'), ('D','rtgip.watermarks'), ('D','rtgip.audit_log'),
  ('R','rtgip_src.rooftop_stores'),
  ('E','rtgip_fx.applied'), ('E','rtgip_fx.acquisition_evidence'), ('E','rtgip_fx.reconciliation_reviews'),
  ('E','rtgip_fx.media_refs'), ('E','rtgip_fx.media_revocations'), ('E','rtgip_fx.media_reinstatements')
), col(component, rel, att) AS (VALUES
  ('S3','public.vehicles','id'), ('S3','public.vehicle_instances','listing_id'),
  ('S3','public.vehicle_instances','opened_reason'), ('S3','public.vehicle_instances','previous_instance_id'),
  ('S3','public.vehicle_instances','custody_state'), ('S3','public.vehicle_custody_milestones','seq'),
  ('S3','public.vehicle_access_grants','transaction_access_until')
), trg(component, rel, name) AS (VALUES
  ('S1','public.vehicle_instances','vehicle_instances_set_updated_at'),
  ('S1','public.integration_connections','integration_connections_set_updated_at'),
  ('S1','public.repair_items','repair_items_set_updated_at'),
  ('S3','public.vehicle_instances','vehicle_instances_custody_guard'),
  ('S3','public.vehicle_custody_milestones','vehicle_custody_milestones_append_only'),
  ('S3','public.vehicle_history_audit','vehicle_history_audit_append_only'),
  ('S3','public.vehicle_history_settings','vehicle_history_settings_append_only'),
  ('S3','public.repair_items','repair_items_status_history'),
  ('S3','public.repair_item_status_history','repair_item_status_history_append_only')
), sch(component, name) AS (VALUES ('D','rtgip'), ('R','rtgip_src'), ('E','rtgip_fx')
), rl(component, name) AS (VALUES
  ('D','rtgip_outbox_writer'), ('D','rtgip_dispatcher'), ('D','rtgip_inbox_receiver'), ('D','rtgip_operator'),
  ('R','rtgip_source_reader'), ('E','rtgip_labels_consumer')
), fnrows AS (
  SELECT f.component, f.name, p.oid::regprocedure::text AS sig, md5(p.prosrc) AS body_md5, p.prosecdef AS secdef,
         coalesce(array_to_string(p.proconfig, ','), '') AS config,
         (f.marker IS NULL OR position(f.marker IN p.prosrc) > 0) AS marker_ok
    FROM fn f
    LEFT JOIN pg_namespace n ON n.nspname = split_part(f.name, '.', 1)
    LEFT JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = split_part(f.name, '.', 2)
), objs AS (
  SELECT component, 'fn ' || name AS name, (sig IS NOT NULL AND marker_ok) AS present,
         jsonb_build_object('sig', sig, 'body_md5', body_md5, 'secdef', secdef, 'config', config) AS detail
    FROM fnrows
  UNION ALL SELECT component, 'table ' || name, to_regclass(name) IS NOT NULL, '{}'::jsonb FROM tb
  UNION ALL SELECT c.component, 'column ' || c.rel || '.' || c.att,
         EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(c.rel) AND a.attname = c.att AND NOT a.attisdropped AND a.attnum > 0),
         '{}'::jsonb FROM col c
  UNION ALL SELECT t.component, 'trigger ' || t.name,
         EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass(t.rel) AND g.tgname = t.name AND NOT g.tgisinternal),
         '{}'::jsonb FROM trg t
  UNION ALL SELECT component, 'schema ' || name, to_regnamespace(name) IS NOT NULL, '{}'::jsonb FROM sch
  UNION ALL SELECT component, 'role ' || name, EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = rl.name), '{}'::jsonb FROM rl
), comp AS (
  SELECT component,
         CASE WHEN bool_and(present) THEN 'installed' WHEN bool_or(present) THEN 'partial' ELSE 'missing' END AS state,
         md5(coalesce(string_agg(name || '=' || detail::text, ';' ORDER BY name) FILTER (WHERE present), '')) AS digest,
         count(*) FILTER (WHERE present) AS present_count, count(*) AS total_count,
         coalesce(jsonb_agg(name ORDER BY name) FILTER (WHERE NOT present), '[]') AS missing_objects
    FROM objs GROUP BY component
), pre(name, present, detail) AS (VALUES
  ('table public.tenants', to_regclass('public.tenants') IS NOT NULL, NULL),
  ('table public.tenant_members', to_regclass('public.tenant_members') IS NOT NULL, NULL),
  ('tenant_members.user_id, tenant_id, role, accepted_at',
     (SELECT count(*) = 4 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.tenant_members') AND a.attname IN ('user_id','tenant_id','role','accepted_at') AND NOT a.attisdropped), NULL),
  ('table public.dealer_stores', to_regclass('public.dealer_stores') IS NOT NULL, NULL),
  ('column public.dealer_stores.status', EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dealer_stores') AND a.attname = 'status' AND NOT a.attisdropped), NULL),
  ('column public.dealer_stores.tenant_id', EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dealer_stores') AND a.attname = 'tenant_id' AND NOT a.attisdropped), NULL),
  ('table public.vehicle_listings', to_regclass('public.vehicle_listings') IS NOT NULL, NULL),
  ('column public.vehicle_listings.owning_store_id', EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_listings') AND a.attname = 'owning_store_id' AND NOT a.attisdropped), NULL),
  ('vehicle_listings price and identity columns',
     (SELECT count(*) = 9 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_listings') AND a.attname IN ('vin','slug','status','price','doc_fee','advertised_price_before_doc','website_sale_price','vehicle_file_id','updated_at') AND NOT a.attisdropped),
     (SELECT coalesce(jsonb_agg(c ORDER BY c), '[]') FROM unnest(ARRAY['vin','slug','status','price','doc_fee','advertised_price_before_doc','website_sale_price','vehicle_file_id','updated_at']) c
        WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_listings') AND a.attname = c AND NOT a.attisdropped))),
  ('table public.vehicle_files', to_regclass('public.vehicle_files') IS NOT NULL, NULL),
  ('table public.dealer_profiles', to_regclass('public.dealer_profiles') IS NOT NULL, NULL),
  ('column public.dealer_profiles.settings', EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dealer_profiles') AND a.attname = 'settings' AND NOT a.attisdropped), NULL),
  ('table public.user_roles', to_regclass('public.user_roles') IS NOT NULL, NULL),
  ('table public.onboarding_profiles', to_regclass('public.onboarding_profiles') IS NOT NULL, NULL),
  ('table public.passport_payment_estimator_settings', to_regclass('public.passport_payment_estimator_settings') IS NOT NULL, NULL),
  ('table public.passport_payment_estimator_versions', to_regclass('public.passport_payment_estimator_versions') IS NOT NULL, NULL),
  ('table public.audit_log', to_regclass('public.audit_log') IS NOT NULL, NULL),
  ('function public.update_updated_at_column', to_regprocedure('public.update_updated_at_column()') IS NOT NULL, NULL),
  ('function public.has_role', EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'has_role'), NULL),
  ('function public.tenant_role_in', EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'tenant_role_in'), NULL),
  ('function public.apply_payment_estimator_settings (pre-S2 or S2 body)',
     EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'apply_payment_estimator_settings'),
     (SELECT coalesce(jsonb_agg(jsonb_build_object('sig', p.oid::regprocedure::text, 'body_md5', md5(p.prosrc), 'mentions_dealer_stores', position('dealer_stores' IN p.prosrc) > 0)), '[]')
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'apply_payment_estimator_settings')),
  ('function auth.uid', to_regprocedure('auth.uid()') IS NOT NULL, NULL),
  ('view vault.decrypted_secrets', to_regclass('vault.decrypted_secrets') IS NOT NULL, NULL),
  ('extension pgcrypto in schema extensions', EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto' AND n.nspname = 'extensions'),
     (SELECT jsonb_agg(jsonb_build_object('ext', e.extname, 'schema', n.nspname)) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto')),
  ('roles anon, authenticated, service_role', (SELECT count(*) = 3 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')), NULL)
), sec_tables AS (
  SELECT c.oid, n.nspname || '.' || c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
         has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE') AS anon_any,
         has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE') AS auth_any,
         has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
         (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p')
     AND (n.nspname IN ('rtgip','rtgip_src','rtgip_fx') OR n.nspname || '.' || c.relname IN (SELECT name FROM tb WHERE component IN ('S1','S3')))
), sec_fns AS (
  SELECT p.oid::regprocedure::text AS sig, p.prosecdef AS secdef, coalesce(array_to_string(p.proconfig, ','), '') AS config,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('rtgip','rtgip_src','rtgip_fx')
      OR (n.nspname = 'public' AND n.nspname || '.' || p.proname IN (SELECT name FROM fn WHERE component IN ('S1','S3')))
)
SELECT jsonb_build_object(
  'fingerprint_version', 1,
  'server_version', current_setting('server_version'),
  'database', current_database(),
  'prerequisites', (SELECT jsonb_object_agg(name, jsonb_build_object('present', coalesce(present, false)) || CASE WHEN detail IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('detail', detail) END) FROM pre),
  'components', (SELECT jsonb_object_agg(component, jsonb_build_object('state', state, 'digest', digest, 'present', present_count, 'total', total_count, 'missing', missing_objects)) FROM comp),
  'security', jsonb_build_object(
     'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'rls', rls, 'forced', forced, 'anon_any', anon_any, 'authenticated_any', auth_any, 'policies', policies) ORDER BY name), '[]') FROM sec_tables),
     'rtgip_tables_open_to_api', (SELECT coalesce(jsonb_agg(name ORDER BY name), '[]') FROM sec_tables WHERE name ~ '^rtgip' AND (anon_any OR auth_any)),
     'definer_without_search_path', (SELECT coalesce(jsonb_agg(sig ORDER BY sig), '[]') FROM sec_fns WHERE secdef AND config NOT LIKE '%search_path=%'),
     'api_execute', (SELECT coalesce(jsonb_agg(jsonb_build_object('fn', sig, 'anon', anon_exec, 'authenticated', auth_exec) ORDER BY sig), '[]') FROM sec_fns WHERE anon_exec OR auth_exec)),
  'roles', (SELECT coalesce(jsonb_object_agg(r.rolname, jsonb_build_object('login', r.rolcanlogin, 'inherit', r.rolinherit, 'super', r.rolsuper,
              'member_of', (SELECT coalesce(jsonb_agg(g.rolname ORDER BY g.rolname), '[]') FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid))), '{}')
              FROM pg_roles r WHERE r.rolname LIKE 'rtgip\_%'),
  'consumer_effect', (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('rtgip.consumer_effect(jsonb)')),
  'transport', CASE WHEN to_regclass('rtgip.delivery_config') IS NOT NULL THEN
     (xpath('//v/text()', query_to_xml('SELECT row_to_json(c)::text AS v FROM rtgip.delivery_config c', false, false, '')))[1]::text END,
  'ledger', jsonb_build_object(
     'supabase', CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
        (xpath('//v/text()', query_to_xml('SELECT count(*)::text || '' rows, last '' || coalesce(max(version), ''none'') AS v FROM supabase_migrations.schema_migrations', false, false, '')))[1]::text END)
) AS fingerprint;
