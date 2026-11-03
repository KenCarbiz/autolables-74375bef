-- E precondition. READ ONLY. One 'label|t/f' row per prerequisite, then 'component_state|missing|installed|partial'.
-- Apply only when every prerequisite is t and the state is missing; installed means skip; partial means stop and inspect.
SELECT 'prereq:delivery_D_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
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
SELECT 'prereq:readers_R_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_authority')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_history')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_json')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_milestones')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_listing_state')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_milestone_json')),
    (to_regclass('rtgip_src.rooftop_stores') IS NOT NULL),
    (to_regnamespace('rtgip_src') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_source_reader'))
  ) o(x)) = 'installed' THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:pgcrypto_digest|' || CASE WHEN to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'component_state|' || (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_fx') AND p.proname = 'append_only')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_fx') AND p.proname = 'envelope_sha')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_fx') AND p.proname = 'labels_apply')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_fx') AND p.proname = 'labels_effect')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'consumer_effect' AND position('labels_apply' IN p.prosrc) > 0)),
    (to_regclass('rtgip_fx.applied') IS NOT NULL),
    (to_regclass('rtgip_fx.acquisition_evidence') IS NOT NULL),
    (to_regclass('rtgip_fx.reconciliation_reviews') IS NOT NULL),
    (to_regclass('rtgip_fx.media_refs') IS NOT NULL),
    (to_regclass('rtgip_fx.media_revocations') IS NOT NULL),
    (to_regclass('rtgip_fx.media_reinstatements') IS NOT NULL),
    (to_regnamespace('rtgip_fx') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_labels_consumer'))
  ) o(x));
