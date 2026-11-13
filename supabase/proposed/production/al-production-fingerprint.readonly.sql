-- AutoLabels PRODUCTION RooftopOS fingerprint. READ ONLY: one SELECT over the catalogs and the dark rows; no write, no secret,
-- no Vault value, no pg_net or auth table. Each *_ok column compares a live value with the expected one; all must be true
-- after step 10 (and stay true until an enrollment card changes connections, keys or flags).
-- Code and schema digests equal staging: S1, S3, R and E component digests are the staging B2 digests (staging fingerprint
-- expression, C collation); the rtgip function digest is the staging post-ar3 set 30dc3dd02521e28ade139dc27a7e548e without the staging-only
-- C-S4 key-import trigger function (key_import_tickets_guard:0c8a30c3), i.e. 0fcc549679f0ba6ad1555020dfc3adf9 over 56 functions.
-- Identities differ from staging by design: server address, project ref, no keys, no connections, no tenants enrolled.
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
         md5(coalesce(string_agg(name || '=' || detail::text, ';' ORDER BY name COLLATE "C") FILTER (WHERE present), '')) AS digest,
         count(*) FILTER (WHERE present) AS present_count, count(*) AS total_count,
         coalesce(jsonb_agg(name ORDER BY name) FILTER (WHERE NOT present), '[]') AS missing_objects
    FROM objs GROUP BY component
)
SELECT host(inet_server_addr()) AS addr,
       coalesce(host(inet_server_addr()), '') = '2a05:d018:135e:166d:40ff:d4ff:1780:16c1' AS addr_ok,
       current_setting('server_version_num')::int / 10000 = 17 AS pg17_ok,
       (SELECT state = 'installed' AND digest = '4794f427afc762d4ef5b40b5842e37ce' FROM comp WHERE component = 'E') AS e_ok,
       (SELECT state = 'installed' AND digest = '8a8156a72bfc4259836e9084fdd80bab' FROM comp WHERE component = 'R') AS r_ok,
       (SELECT state = 'installed' AND digest = '2e6e815d213242e4dc57fbc2635ff381' FROM comp WHERE component = 'S1') AS s1_ok,
       (SELECT state = 'installed' AND digest = 'cc7e6e9a10f4ace44c2d4246620e0c9c' FROM comp WHERE component = 'S3') AS s3_ok,
       (SELECT md5(string_agg(p.proname || ':' || left(md5(pg_get_functiondef(p.oid)), 8), ',' ORDER BY p.proname COLLATE "C"))
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'rtgip' AND p.prokind IN ('f','p')) AS rtgip_fn_digest,
       (SELECT md5(string_agg(p.proname || ':' || left(md5(pg_get_functiondef(p.oid)), 8), ',' ORDER BY p.proname COLLATE "C")) = '0fcc549679f0ba6ad1555020dfc3adf9' AND count(*) = 56
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'rtgip' AND p.prokind IN ('f','p')) AS rtgip_fn_ok,
       obj_description(to_regclass('rtgip.evidence_v3'), 'pg_class') IS NOT DISTINCT FROM '{"version":"AR3-APP-r1","contract":"rtgip/3-contract-freeze/1","attest":"rtgip/3-attest/1"}' AS ar3_ok,
       (SELECT local_app = 'autolabels' AND transport_enabled = false FROM rtgip.delivery_config) AS dark_config_ok,
       (SELECT count(*) = 1 FROM pg_constraint WHERE conrelid = to_regclass('rtgip.delivery_config') AND contype = 'c'
           AND pg_get_constraintdef(oid) = 'CHECK ((transport_enabled = false))') AS transport_check_ok,
       (SELECT count(*) FROM rtgip.connections) AS connections,
       (SELECT count(*) FILTER (WHERE producer_enabled OR reader_enabled) FROM rtgip.connections) AS flags_on,
       (SELECT count(*) FROM rtgip.connections WHERE send_protocol <> 'rtgip/3' OR accept_protocols <> '{rtgip/3}') AS v2_capable_connections,
       (SELECT count(*) FROM rtgip.signing_keys) AS rtgip2_keys,
       (SELECT count(*) FROM rtgip.public_keys) AS rtgip3_keys,
       (SELECT count(*) FROM rtgip.public_keys WHERE key_id !~ '^prd-') AS non_prd_keys,
       to_regclass('rtgip.key_import_tickets') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname ~ 'key_import') AS no_key_import_ok,
       (SELECT (SELECT count(*) FROM rtgip.outbox) + (SELECT count(*) FROM rtgip.inbox) + (SELECT count(*) FROM rtgip.receipts) + (SELECT count(*) FROM rtgip.admissions)
             + (SELECT count(*) FROM rtgip.evidence_v3)) AS ledger_rows,
       (SELECT string_agg(rolname, ',' ORDER BY rolname COLLATE "C") FROM pg_roles WHERE rolname LIKE 'rtgip%') AS rtgip_roles,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_edge' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls) AS edge_role_ok,
       (SELECT string_agg(r.rolname, ',' ORDER BY r.rolname COLLATE "C") FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid
         WHERE am.member = to_regrole('rtgip_edge') AND am.set_option AND NOT am.inherit_option AND NOT am.admin_option) = 'rtgip_dispatcher,rtgip_inbox_receiver,rtgip_outbox_writer,rtgip_source_reader' AS edge_memberships_ok,
       NOT EXISTS (SELECT 1 FROM pg_roles r WHERE (r.rolname IN ('anon','authenticated','service_role') OR r.rolname LIKE 'sandbox\_exec%')
                     AND (has_schema_privilege(r.oid, 'rtgip', 'USAGE') OR has_schema_privilege(r.oid, 'rtgip_fx', 'USAGE')
                          OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace IN ('rtgip'::regnamespace, 'rtgip_fx'::regnamespace) AND has_function_privilege(r.oid, p.oid, 'EXECUTE')))) AS api_closed_ok,
       NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'rtgip' AND c.relkind = 'r' AND NOT c.relrowsecurity) AS rtgip_rls_ok;
