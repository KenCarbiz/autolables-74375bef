-- RooftopOS staging step p2_21 (phase 2, after HTTP stage A). WRITES, synthetic data only.
-- The returned snapshot is read before this step's writes take effect (one
-- statement, one snapshot). Writes, for stage B:
--   * revokes rotation keys rooftopos-staging-rot-1 and rooftopos-staging-rot-af;
--   * adds the temporary CHECK constraint that makes odometer_miles = 777 fail to apply;
--   * queues two outbox rows (native connection and autofilm.v1 connection).
-- Save the row as <out>/steps/p2_21_after_stage_a.json.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug NOT LIKE 'rooftopos-staging-%') THEN
    RAISE EXCEPTION 'p2_21: refusing to run, non-synthetic tenants present';
  END IF;
  ALTER TABLE public.inspection_evidence DROP CONSTRAINT IF EXISTS rooftopos_staging_injected_failure;
  ALTER TABLE public.inspection_evidence ADD CONSTRAINT rooftopos_staging_injected_failure
    CHECK (odometer_miles IS DISTINCT FROM 777) NOT VALID;
END $$;

WITH revoked_keys AS (
  UPDATE public.integration_connection_keys SET status = 'revoked', revoked_at = now()
   WHERE key_id IN ('rooftopos-staging-rot-1', 'rooftopos-staging-rot-af')
  RETURNING key_id
),
env AS (
  SELECT r.event_id, r.record, r.connection_id, jsonb_build_object(
    'event_id', r.event_id, 'event_type', 'autofilm.inspection.completed', 'schema_version', '1.0.0',
    'producer', 'autofilm', 'source_record_id', r.record, 'source_version', 1,
    'idempotency_key', r.record || '-1', 'correlation_id', 'staging-dispatch', 'causation_id', NULL,
    'occurred_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'observed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sent_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'vin', '1HGCM82633A004352', 'tenant_ref', 'ADVISORY', 'instance_ref', NULL,
    'visibility', 'tenant_private', 'evidence_refs', '["staging-evidence:1"]'::jsonb,
    'payload', '{"odometer_miles": 41300, "measurements": {}, "technician_verified": false}'::jsonb) AS envelope
  FROM (VALUES
    ('5ea90000-0000-4000-8000-00000000d001'::uuid, 'stg-dispatch-native', '5ea90000-0000-4000-8000-0000000000a1'::uuid),
    ('5ea90000-0000-4000-8000-00000000d002'::uuid, 'stg-dispatch-af',     '5ea90000-0000-4000-8000-0000000000a2'::uuid)
  ) AS r(event_id, record, connection_id)
),
queued AS (
  INSERT INTO public.integration_outbox (tenant_id, connection_id, event_id, event_type, envelope)
  SELECT '5ea90000-0000-4000-8000-00000000000a', connection_id, event_id, 'autofilm.inspection.completed', envelope FROM env
  RETURNING event_id
)
SELECT jsonb_build_object(
  'step', 'p2_21_after_stage_a',
  'generated_at', now(),
  'revoked', (SELECT count(*) FROM revoked_keys),
  'queued', (SELECT count(*) FROM queued),
  'inbox', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'record', source_record_id, 'version', source_version, 'status', status, 'outcome', outcome_code,
      'tenant', tenant_id, 'connection', connection_id, 'visibility', visibility,
      'requested', requested_visibility, 'adapter', adapter, 'vin', vin, 'attempts', attempts)
      ORDER BY source_record_id, source_version, received_at), '[]')
    FROM public.integration_inbox
   WHERE adapter = 'rooftop.v1' AND source_record_id LIKE 'stg-%'
     AND tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b')),
  'af', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'corr', envelope->>'correlation_id', 'event_type', event_type, 'record', source_record_id,
      'version', source_version, 'status', status, 'tenant', tenant_id, 'vin', vin,
      'visibility', visibility, 'requested', requested_visibility, 'adapter', adapter)
      ORDER BY envelope->>'correlation_id', event_type, source_record_id), '[]')
    FROM public.integration_inbox WHERE connection_id = '5ea90000-0000-4000-8000-0000000000a2'),
  'b_inbox_count', (SELECT count(*) FROM public.integration_inbox WHERE tenant_id = '5ea90000-0000-4000-8000-00000000000b'),
  'evidence', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'record', source_record_id, 'version', source_version, 'odometer', odometer_miles,
      'technician_verified', technician_verified, 'visibility', visibility, 'tenant', tenant_id, 'source_app', source_app)
      ORDER BY source_record_id), '[]')
    FROM public.inspection_evidence
   WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b')),
  'repair', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'record', source_record_id, 'status', status, 'verified_by', verified_by,
      'verified_evidence_ref', verified_evidence_ref, 'visibility', visibility)
      ORDER BY source_record_id), '[]')
    FROM public.repair_items
   WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b')),
  'watermarks', (SELECT coalesce(jsonb_object_agg(source_record_id, latest_version), '{}')
    FROM public.integration_source_versions
   WHERE connection_id = '5ea90000-0000-4000-8000-0000000000a1' AND source_record_id LIKE 'stg-%'),
  'stored_customer_public',
    (SELECT count(*) FROM public.inspection_evidence WHERE visibility = 'customer_public')
    + (SELECT count(*) FROM public.repair_items WHERE visibility = 'customer_public')
) AS result;
