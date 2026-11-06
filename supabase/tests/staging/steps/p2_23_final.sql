-- RooftopOS staging step p2_23 (phase 2, after HTTP stage C, last). Writes only cleanup:
-- revokes the remaining rotation key and makes sure the injected constraint is gone.
-- Save the row as <out>/steps/p2_23_final.json.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug NOT LIKE 'rooftopos-staging-%') THEN
    RAISE EXCEPTION 'p2_23: refusing to run, non-synthetic tenants present';
  END IF;
  ALTER TABLE public.inspection_evidence DROP CONSTRAINT IF EXISTS rooftopos_staging_injected_failure;
END $$;

WITH cleanup AS (
  UPDATE public.integration_connection_keys SET status = 'revoked', revoked_at = coalesce(revoked_at, now())
   WHERE key_id LIKE 'rooftopos-staging-rot-%' AND status <> 'revoked'
  RETURNING key_id
)
SELECT jsonb_build_object(
  'step', 'p2_23_final',
  'generated_at', now(),
  'rotation_keys_revoked', (SELECT count(*) FROM cleanup),
  'retry_poison', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'record', source_record_id, 'status', status, 'attempts', attempts, 'outcome', outcome_code)
      ORDER BY source_record_id), '[]')
    FROM public.integration_inbox
   WHERE tenant_id = '5ea90000-0000-4000-8000-00000000000a' AND source_record_id IN ('stg-retry', 'stg-poison')),
  'retry_evidence', (SELECT coalesce(jsonb_agg(odometer_miles), '[]') FROM public.inspection_evidence
   WHERE tenant_id = '5ea90000-0000-4000-8000-00000000000a' AND source_record_id = 'stg-retry'),
  'poison_dead_audits', (SELECT count(*) FROM public.audit_log a
    JOIN public.integration_inbox i ON a.entity_id = i.id::text
   WHERE i.source_record_id = 'stg-poison' AND i.tenant_id = '5ea90000-0000-4000-8000-00000000000a'
     AND a.action = 'integration_event_dead'),
  'stored_customer_public',
    (SELECT count(*) FROM public.inspection_evidence WHERE visibility = 'customer_public')
    + (SELECT count(*) FROM public.repair_items WHERE visibility = 'customer_public')
) AS result;
