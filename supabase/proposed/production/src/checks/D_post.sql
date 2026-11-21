-- D postcondition. READ ONLY. One 'label|t/f' row per check; every row must be t.
SELECT 'component_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'audit_log_immutable')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'canonical_json')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'claim_nonce')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'clock')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'ct_equal')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'deliverable_reason')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'delivery_identity')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'derive_event_id')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'envelope_sha')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'inbox_admit')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'inbox_deliveries_guard')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'inbox_receive')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'inbox_record_receipts')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'local_app')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'outbox_advance')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'outbox_claim')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'outbox_enqueue')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'outbox_fail')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'outbox_guard')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'outbox_redrive')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'purge_expired_nonces')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'receipt_canonical')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'receipt_check_signature')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'receipt_verify')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'refusal_class')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'watermark_key')),
    (to_regclass('rtgip.delivery_config') IS NOT NULL),
    (to_regclass('rtgip.connections') IS NOT NULL),
    (to_regclass('rtgip.signing_keys') IS NOT NULL),
    (to_regclass('rtgip.nonce_claims') IS NOT NULL),
    (to_regclass('rtgip.outbox') IS NOT NULL),
    (to_regclass('rtgip.receipts') IS NOT NULL),
    (to_regclass('rtgip.inbox') IS NOT NULL),
    (to_regclass('rtgip.inbox_conflicts') IS NOT NULL),
    (to_regclass('rtgip.inbox_deliveries') IS NOT NULL),
    (to_regclass('rtgip.admissions') IS NOT NULL),
    (to_regclass('rtgip.event_catalog') IS NOT NULL),
    (to_regclass('rtgip.forbidden_keys') IS NOT NULL),
    (to_regclass('rtgip.watermarks') IS NOT NULL),
    (to_regclass('rtgip.audit_log') IS NOT NULL),
    (to_regnamespace('rtgip') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_outbox_writer')),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_dispatcher')),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_inbox_receiver')),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_operator'))
  ) o(x)) = 'installed' THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip.delivery_config','rtgip.connections','rtgip.signing_keys','rtgip.nonce_claims','rtgip.outbox','rtgip.receipts','rtgip.inbox','rtgip.inbox_conflicts','rtgip.inbox_deliveries','rtgip.admissions','rtgip.event_catalog','rtgip.forbidden_keys','rtgip.watermarks','rtgip.audit_log']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('anon', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip.delivery_config','rtgip.connections','rtgip.signing_keys','rtgip.nonce_claims','rtgip.outbox','rtgip.receipts','rtgip.inbox','rtgip.inbox_conflicts','rtgip.inbox_deliveries','rtgip.admissions','rtgip.event_catalog','rtgip.forbidden_keys','rtgip.watermarks','rtgip.audit_log']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('authenticated', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'service_role_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip.delivery_config','rtgip.connections','rtgip.signing_keys','rtgip.nonce_claims','rtgip.outbox','rtgip.receipts','rtgip.inbox','rtgip.inbox_conflicts','rtgip.inbox_deliveries','rtgip.admissions','rtgip.event_catalog','rtgip.forbidden_keys','rtgip.watermarks','rtgip.audit_log']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('service_role', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'rls_enabled_on_every_table|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip.delivery_config','rtgip.connections','rtgip.signing_keys','rtgip.nonce_claims','rtgip.outbox','rtgip.receipts','rtgip.inbox','rtgip.inbox_conflicts','rtgip.inbox_deliveries','rtgip.admissions','rtgip.event_catalog','rtgip.forbidden_keys','rtgip.watermarks','rtgip.audit_log']::text[]) t WHERE to_regclass(t) IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t))) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'security_definer_functions_pin_search_path|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip.audit_log_immutable','rtgip.canonical_json','rtgip.claim_nonce','rtgip.clock','rtgip.ct_equal','rtgip.deliverable_reason','rtgip.delivery_identity','rtgip.derive_event_id','rtgip.envelope_sha','rtgip.inbox_admit','rtgip.inbox_deliveries_guard','rtgip.inbox_receive','rtgip.inbox_record_receipts','rtgip.local_app','rtgip.outbox_advance','rtgip.outbox_claim','rtgip.outbox_enqueue','rtgip.outbox_fail','rtgip.outbox_guard','rtgip.outbox_redrive','rtgip.purge_expired_nonces','rtgip.receipt_canonical','rtgip.receipt_check_signature','rtgip.receipt_verify','rtgip.refusal_class','rtgip.watermark_key']::text[]) AND p.prosecdef AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=%') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip.audit_log_immutable','rtgip.canonical_json','rtgip.claim_nonce','rtgip.clock','rtgip.ct_equal','rtgip.deliverable_reason','rtgip.delivery_identity','rtgip.derive_event_id','rtgip.envelope_sha','rtgip.inbox_admit','rtgip.inbox_deliveries_guard','rtgip.inbox_receive','rtgip.inbox_record_receipts','rtgip.local_app','rtgip.outbox_advance','rtgip.outbox_claim','rtgip.outbox_enqueue','rtgip.outbox_fail','rtgip.outbox_guard','rtgip.outbox_redrive','rtgip.purge_expired_nonces','rtgip.receipt_canonical','rtgip.receipt_check_signature','rtgip.receipt_verify','rtgip.refusal_class','rtgip.watermark_key']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip.audit_log_immutable','rtgip.canonical_json','rtgip.claim_nonce','rtgip.clock','rtgip.ct_equal','rtgip.deliverable_reason','rtgip.delivery_identity','rtgip.derive_event_id','rtgip.envelope_sha','rtgip.inbox_admit','rtgip.inbox_deliveries_guard','rtgip.inbox_receive','rtgip.inbox_record_receipts','rtgip.local_app','rtgip.outbox_advance','rtgip.outbox_claim','rtgip.outbox_enqueue','rtgip.outbox_fail','rtgip.outbox_guard','rtgip.outbox_redrive','rtgip.purge_expired_nonces','rtgip.receipt_canonical','rtgip.receipt_check_signature','rtgip.receipt_verify','rtgip.refusal_class','rtgip.watermark_key']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'service_role_cannot_execute_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip.audit_log_immutable','rtgip.canonical_json','rtgip.claim_nonce','rtgip.clock','rtgip.ct_equal','rtgip.deliverable_reason','rtgip.delivery_identity','rtgip.derive_event_id','rtgip.envelope_sha','rtgip.inbox_admit','rtgip.inbox_deliveries_guard','rtgip.inbox_receive','rtgip.inbox_record_receipts','rtgip.local_app','rtgip.outbox_advance','rtgip.outbox_claim','rtgip.outbox_enqueue','rtgip.outbox_fail','rtgip.outbox_guard','rtgip.outbox_redrive','rtgip.purge_expired_nonces','rtgip.receipt_canonical','rtgip.receipt_check_signature','rtgip.receipt_verify','rtgip.refusal_class','rtgip.watermark_key']::text[]) AND has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'rtgip_roles_nologin_noinherit|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator') AND (r.rolcanlogin OR r.rolinherit OR r.rolsuper)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'transport_stays_disabled|' || CASE WHEN (SELECT count(*) FROM rtgip.delivery_config WHERE transport_enabled) = 0 THEN 't' ELSE 'f' END
UNION ALL
SELECT 'default_consumer_refuses_or_app_effect|' || CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('rtgip.consumer_effect(jsonb)') AND (p.prosrc LIKE '%no_consumer%' OR p.prosrc LIKE '%labels_apply%')) THEN 't' ELSE 'f' END;
