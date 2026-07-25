-- Description Intelligence — reconcile sweep fairness + drain cursor
--
-- Two defects in the nightly sweep:
--   1. Strict `ORDER BY pri` meant a tenant with more stalled cases than the
--      batch limit starved every lower branch forever: `missing_case`
--      vehicles never got a case, so ingest sources that bypass the
--      MarketCheck hook (AutoCurb / DMS / CSV / manual VIN) stayed dark.
--   2. There was no sweep cursor, so a self-chaining hop would re-select the
--      same rows it had just processed instead of advancing.
--
-- The batch now round-robins across the four branches and accepts a
-- sweep_start so each hop only sees work untouched by this sweep.

DROP FUNCTION IF EXISTS public.next_description_reconcile_batch(uuid, integer);

CREATE OR REPLACE FUNCTION public.next_description_reconcile_batch(
  p_tenant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_sweep_start timestamptz DEFAULT NULL)
RETURNS TABLE (tenant_id uuid, vehicle_id uuid, vin text, case_id uuid, reason text)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH candidates AS (
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id AS case_id, 'stalled'::text AS reason, 1 AS pri
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL
       AND dc.status IN ('QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','PUBLISHING')
       AND dc.updated_at < now() - interval '30 minutes'
       AND (p_sweep_start IS NULL OR dc.last_orchestrated_at IS NULL
            OR dc.last_orchestrated_at < p_sweep_start)
    UNION ALL
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'source_changed', 2
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL
       AND dc.status NOT IN ('ARCHIVED','FAILED_BLOCKED')
       AND dc.current_source_data_version IS NOT NULL
       AND dc.current_source_data_version IS DISTINCT FROM dc.processed_source_data_version
       AND (p_sweep_start IS NULL OR dc.last_orchestrated_at IS NULL
            OR dc.last_orchestrated_at < p_sweep_start)
    UNION ALL
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'retryable', 3
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL AND dc.status = 'FAILED_RETRYABLE'
       AND (p_sweep_start IS NULL OR dc.last_orchestrated_at IS NULL
            OR dc.last_orchestrated_at < p_sweep_start)
       AND EXISTS (SELECT 1 FROM public.description_jobs j
                    WHERE j.description_case_id = dc.id
                      AND j.status = 'failed_retryable' AND j.attempt_count < j.max_attempts)
    UNION ALL
    SELECT vl.tenant_id, vl.id, vl.vin, NULL::uuid, 'missing_case', 4
      FROM public.vehicle_listings vl
      LEFT JOIN public.description_cases dc
        ON dc.vehicle_id = vl.id AND dc.tenant_id = vl.tenant_id
     WHERE vl.tenant_id IS NOT NULL AND vl.status IN ('draft','published')
       AND vl.vin IS NOT NULL AND dc.id IS NULL
  ), scoped AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.pri ORDER BY c.vehicle_id) AS rn
      FROM candidates c
     WHERE (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
  )
  -- round-robin: one from each branch, then the next from each, so a large
  -- backlog in branch 1 can never starve branches 2-4.
  SELECT tenant_id, vehicle_id, vin, case_id, reason
    FROM scoped
   ORDER BY rn, pri
   LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.next_description_reconcile_batch(uuid, integer, timestamptz) TO service_role;
