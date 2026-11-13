-- D precondition. READ ONLY. One 'label|t/f' row per prerequisite, then 'component_state|missing|installed|partial'.
-- Apply only when every prerequisite is t and the state is missing; installed means skip; partial means stop and inspect.
SELECT 'prereq:vault_decrypted_secrets|' || CASE WHEN to_regclass('vault.decrypted_secrets') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:api_roles|' || CASE WHEN (SELECT count(*) = 3 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:pgcrypto_in_extensions_or_creatable|' || CASE WHEN (to_regnamespace('extensions') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'component_state|' || (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
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
  ) o(x));
