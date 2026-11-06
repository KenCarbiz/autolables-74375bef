-- RooftopOS staging step p2_22 (phase 2, after HTTP stage B). WRITES, synthetic data only.
-- The returned snapshot is read before this step's row updates (one statement,
-- one snapshot), so it shows the retry and poison rows as stage B left them.
-- Writes, for stage C:
--   * drops the temporary CHECK constraint (the injected failure is over);
--   * makes the retry row due now;
--   * makes the poison row due now with attempts = 5, so the next apply is its
--     6th failed attempt and must dead-letter it.
-- Save the row as <out>/steps/p2_22_after_stage_b.json.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug NOT LIKE 'rooftopos-staging-%') THEN
    RAISE EXCEPTION 'p2_22: refusing to run, non-synthetic tenants present';
  END IF;
  ALTER TABLE public.inspection_evidence DROP CONSTRAINT IF EXISTS rooftopos_staging_injected_failure;
END $$;

WITH retry_ready AS (
  UPDATE public.integration_inbox SET next_attempt_at = now(), claimed_until = NULL
   WHERE tenant_id = '5ea90000-0000-4000-8000-00000000000a' AND source_record_id = 'stg-retry'
     AND status IN ('received', 'held')
  RETURNING id
),
poison_ready AS (
  UPDATE public.integration_inbox SET next_attempt_at = now(), claimed_until = NULL, attempts = 5
   WHERE tenant_id = '5ea90000-0000-4000-8000-00000000000a' AND source_record_id = 'stg-poison'
     AND status IN ('received', 'held')
  RETURNING id
)
SELECT jsonb_build_object(
  'step', 'p2_22_after_stage_b',
  'generated_at', now(),
  'retry_ready', (SELECT count(*) FROM retry_ready),
  'poison_ready', (SELECT count(*) FROM poison_ready),
  'retry_poison', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'record', source_record_id, 'status', status, 'attempts', attempts, 'outcome', outcome_code,
      'next_attempt_epoch', extract(epoch FROM next_attempt_at)) ORDER BY source_record_id), '[]')
    FROM public.integration_inbox
   WHERE tenant_id = '5ea90000-0000-4000-8000-00000000000a' AND source_record_id IN ('stg-retry', 'stg-poison')),
  'rotation', (SELECT coalesce(jsonb_agg(jsonb_build_object('record', source_record_id, 'status', status)
      ORDER BY source_record_id), '[]')
    FROM public.integration_inbox
   WHERE tenant_id = '5ea90000-0000-4000-8000-00000000000a' AND source_record_id LIKE 'stg-rot-%'),
  'af_corr', (SELECT coalesce(jsonb_agg(DISTINCT envelope->>'correlation_id'), '[]')
    FROM public.integration_inbox WHERE connection_id = '5ea90000-0000-4000-8000-0000000000a2'),
  'outbox', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'event_id', event_id, 'connection', connection_id, 'status', status, 'attempts', attempts,
      'last_error_code', last_error_code) ORDER BY event_id), '[]')
    FROM public.integration_outbox WHERE tenant_id = '5ea90000-0000-4000-8000-00000000000a'),
  'dispatched', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'tenant', tenant_id, 'connection', connection_id, 'status', status)), '[]')
    FROM public.integration_inbox WHERE source_record_id = 'stg-dispatch-native'),
  'shared_vin_tenants', (SELECT coalesce(jsonb_agg(DISTINCT e.tenant_id), '[]')
    FROM public.inspection_evidence e
    JOIN public.vehicle_instances i ON i.id = e.instance_id
   WHERE i.vin = '1HGCM82633A004352'),
  'views_over_spine', (SELECT coalesce(jsonb_agg(DISTINCT v.oid::regclass::text || '->' || s.relname), '[]')
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
    JOIN pg_class s ON s.oid = d.refobjid
    JOIN pg_namespace sn ON sn.oid = s.relnamespace
   WHERE sn.nspname = 'public' AND v.oid <> s.oid
     AND s.relname IN ('vehicles','vehicle_instances','vehicle_external_refs','integration_connections',
       'integration_connection_keys','integration_inbox','integration_source_versions','integration_outbox',
       'integration_direction_flags','inspection_evidence','repair_items','acquisition_records')),
  'stored_customer_public',
    (SELECT count(*) FROM public.inspection_evidence WHERE visibility = 'customer_public')
    + (SELECT count(*) FROM public.repair_items WHERE visibility = 'customer_public'),
  'constraint_dropped', NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooftopos_staging_injected_failure')
) AS result;
